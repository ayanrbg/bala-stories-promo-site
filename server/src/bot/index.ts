import { Bot, Context, InlineKeyboard } from 'grammy';
import { PrismaClient, TgCampaign, TgParticipant } from '@prisma/client';
import * as t from './texts';
import { CAMPAIGN_ID, getCampaign, isAdmin, phaseOf } from '../lib/tgCampaign';
import { campaignTaleIds, issueCodeFor } from '../lib/tgCode';
import { ticketsFor } from '../lib/tgTickets';

const prisma = new PrismaClient();

/** Умная ссылка: сама уводит в App Store или Google Play по устройству. */
const APP_URL = process.env.TG_APP_URL || 'https://bala.apiapp.kz';

type Ctx = Context & { campaign: TgCampaign };

const TOKEN = process.env.TG_BOT_TOKEN || '';

export const bot = new Bot<Ctx>(TOKEN);

// ─────────────────────────── клавиатуры ───────────────────────────

const kbWelcome = () => new InlineKeyboard()
  .text('🎁 Участвовать', 'join').row()
  .text('📄 Условия', 'terms');

const kbCode = () => new InlineKeyboard()
  .url('📱 Установить приложение', APP_URL).row()
  .text('🔄 Я ввёл код', 'check').row()
  .text('👥 Позвать друга', 'invite');

const kbStatus = () => new InlineKeyboard()
  .text('🔄 Обновить', 'check').row()
  .text('👥 Позвать друга', 'invite');

// ─────────────────────────── участник ───────────────────────────

/**
 * Разбор `?start=<payload>`. Два вида: `ref_<tgUserId>` — пригласивший,
 * всё остальное — источник (блогер, канал, реклама). Payload приходит из
 * ссылки, поэтому длина и алфавит режутся здесь, а не в базе.
 */
function parsePayload(payload: string): { source: string | null; inviterTgId: string | null } {
  const clean = (payload || '').trim().slice(0, 64).replace(/[^A-Za-z0-9_-]/g, '');
  if (!clean) return { source: null, inviterTgId: null };
  if (clean.startsWith('ref_')) {
    const id = clean.slice(4);
    return { source: null, inviterTgId: /^\d+$/.test(id) ? id : null };
  }
  return { source: clean, inviterTgId: null };
}

/**
 * Найти или завести участника. Источник и пригласивший пишутся ТОЛЬКО при
 * создании: иначе человек, пришедший по ссылке блогера, а потом по ссылке
 * друга, переписал бы себе атрибуцию — а по ней раздаются билеты и деньги.
 */
async function ensureParticipant(ctx: Ctx, payload = ''): Promise<TgParticipant> {
  const from = ctx.from!;
  const tgUserId = String(from.id);
  const campaignId = ctx.campaign.id;

  const existing = await prisma.tgParticipant.findUnique({
    where: { campaignId_tgUserId: { campaignId, tgUserId } },
  });
  if (existing) {
    return prisma.tgParticipant.update({
      where: { id: existing.id },
      data: {
        username: from.username || null,
        firstName: from.first_name || null,
        lastSeenAt: new Date(),
      },
    });
  }

  const { source, inviterTgId } = parsePayload(payload);

  // Пригласить самого себя нельзя — это первый способ накрутки, который
  // пробуют. Ссылка своя же, поэтому проверка по tgUserId, а не по строке.
  let invitedById: string | null = null;
  if (inviterTgId && inviterTgId !== tgUserId) {
    const inviter = await prisma.tgParticipant.findUnique({
      where: { campaignId_tgUserId: { campaignId, tgUserId: inviterTgId } },
      select: { id: true },
    });
    invitedById = inviter?.id || null;
  }

  const created = await prisma.tgParticipant.create({
    data: {
      campaignId,
      tgUserId,
      username: from.username || null,
      firstName: from.first_name || null,
      languageCode: from.language_code || null,
      source,
      invitedById,
    },
  });
  console.log(
    `[TG] новый участник ${tgUserId} (@${from.username || '—'}) ` +
    `источник=${source || '—'} пригласил=${invitedById || '—'}`
  );
  return created;
}

// ─────────────────────────── общий вход ───────────────────────────

/**
 * Одна проверка на все обработчики: есть ли кампания и можно ли её показывать.
 * Пока `published = false`, бот отвечает только админам — это способ прогнать
 * живую воронку до того, как объявлены призы, а не режим отладки на проде.
 */
bot.use(async (ctx, next) => {
  if (!ctx.from || ctx.from.is_bot) return;

  const campaign = await getCampaign();
  if (!campaign) {
    console.error(`[TG] кампания ${CAMPAIGN_ID} не найдена в базе`);
    await ctx.reply(t.noCampaign);
    return;
  }
  if (!campaign.published && !isAdmin(String(ctx.from.id))) {
    await ctx.reply(t.notPublished);
    return;
  }

  ctx.campaign = campaign;
  await next();
});

// ─────────────────────────── экраны ───────────────────────────

bot.command('start', async (ctx) => {
  const campaign = ctx.campaign;
  await ensureParticipant(ctx, typeof ctx.match === 'string' ? ctx.match : '');

  const phase = phaseOf(campaign);
  if (phase === 'before') {
    await ctx.reply(t.beforeStart(campaign), { parse_mode: 'HTML' });
    return;
  }
  if (phase === 'ended') {
    await ctx.reply(t.afterEnd(campaign), { parse_mode: 'HTML' });
    return;
  }

  await ctx.reply(t.welcome(campaign), { parse_mode: 'HTML', reply_markup: kbWelcome() });
});

bot.callbackQuery('terms', async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply(t.terms(ctx.campaign), {
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().text('🎁 Участвовать', 'join'),
  });
});

/** «Участвовать» — выдача кода. Повторное нажатие возвращает тот же код. */
bot.callbackQuery('join', async (ctx) => {
  await ctx.answerCallbackQuery();
  const campaign = ctx.campaign;

  const phase = phaseOf(campaign);
  if (phase !== 'running') {
    await ctx.reply(phase === 'before' ? t.beforeStart(campaign) : t.afterEnd(campaign), { parse_mode: 'HTML' });
    return;
  }

  const participant = await ensureParticipant(ctx);
  try {
    const { code } = await issueCodeFor(participant.id, campaign);
    const tales = await campaignTaleIds(campaign);
    await ctx.reply(t.codeIssued(campaign, code, tales.length), {
      parse_mode: 'HTML',
      reply_markup: kbCode(),
    });
  } catch (e) {
    console.error(`[TG] не выдал код участнику ${participant.tgUserId}: ${(e as Error).message}`);
    await ctx.reply('Не получилось выдать код — попробуйте ещё раз через минуту.');
  }
});

/** «Я ввёл код» и /status — одно и то же: показать, что мы про него знаем. */
async function showStatus(ctx: Ctx): Promise<void> {
  const campaign = ctx.campaign;
  const participant = await ensureParticipant(ctx);
  const { tickets } = await ticketsFor(campaign, participant);

  await ctx.reply(t.status(campaign, participant.code, !!participant.activatedAt, tickets), {
    parse_mode: 'HTML',
    reply_markup: participant.code ? (participant.activatedAt ? kbStatus() : kbCode()) : kbWelcome(),
  });
}

bot.callbackQuery('check', async (ctx) => {
  await ctx.answerCallbackQuery();
  await showStatus(ctx);
});

bot.command('status', showStatus);

bot.callbackQuery('invite', async (ctx) => {
  await ctx.answerCallbackQuery();
  const participant = await ensureParticipant(ctx);
  const username = ctx.me.username;
  const link = `https://t.me/${username}?start=ref_${participant.tgUserId}`;
  await ctx.reply(t.inviteText(ctx.campaign, link), {
    parse_mode: 'HTML',
    // Пересылать нечего: ссылка внутри текста, её копируют или пересылают
    // сообщение целиком — так друг видит, от кого оно.
    link_preview_options: { is_disabled: true },
  });
});

bot.command('help', async (ctx) => {
  await ctx.reply(t.help);
});

bot.on('message:text', async (ctx) => {
  await ctx.reply(t.unknown);
});

// Ошибка в одном обновлении не должна ронять процесс: Telegram повторит
// доставку, и упавший бот получит тот же сбой снова.
bot.catch((err) => {
  console.error(`[TG] ошибка обработки: ${err.message}`);
});
