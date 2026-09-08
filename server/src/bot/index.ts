import { Bot, Context, InlineKeyboard, Keyboard } from 'grammy';
import { Contest, Participant, PrismaClient } from '@prisma/client';
import * as t from './texts';
import { CONTEST_ID, computeStandings, getContest } from '../lib/contestStandings';
import { issueCodeFor } from '../lib/contestCode';
import { botIsPublic, isAdmin, normalizePhone, parseSocial } from '../lib/tgFormat';

const prisma = new PrismaClient();

/**
 * Бот — второй вход в тот же конкурс, что живёт на `/ugc`. Участник здесь —
 * автор: он получает личный промокод и раздаёт его аудитории. Все данные лежат
 * в `Contest`/`Participant`, своих таблиц у бота нет.
 *
 * Состояние анкеты тоже нигде не хранится: шаг выводится из того, что уже
 * заполнено у участника. Поэтому рестарт процесса не роняет незаконченную
 * регистрацию, а «продолжить» работает само по себе.
 */

type Ctx = Context & { contest: Contest };

export const bot = new Bot<Ctx>(process.env.TG_BOT_TOKEN || '');

// ─────────────────────────── клавиатуры ───────────────────────────

/**
 * Кабинет — это страница `/ugc`, открытая внутри Telegram. Вход там не
 * спрашивается: Telegram подписывает, кто открыл, и сервер это проверяет.
 */
export const MINIAPP_URL = process.env.TG_MINIAPP_URL || 'https://promocode-stories.apiapp.kz/ugc';

const kbJoin = () => new InlineKeyboard().text('📝 Участвовать', 'join');
const kbStatus = () => new InlineKeyboard()
  .webApp('📊 Кабинет и рейтинг', MINIAPP_URL).row()
  .text('🏆 Мой результат', 'status');

/**
 * Кнопка запроса контакта. Номер присылает сам Telegram, и это единственный
 * способ убедиться, что телефон принадлежит собеседнику: набранному руками
 * номеру верить нельзя, иначе он стал бы ключом к чужому кабинету с призом.
 */
const kbPhone = () => new Keyboard().requestContact('📱 Отправить телефон').resized().oneTime();

// ─────────────────────────── общий вход ───────────────────────────

bot.use(async (ctx, next) => {
  if (!ctx.from || ctx.from.is_bot) return;

  const contest = await getContest();
  if (!contest) {
    console.error(`[TG] конкурс ${CONTEST_ID} не найден в базе`);
    await ctx.reply(t.noContest);
    return;
  }
  if (!botIsPublic() && !isAdmin(String(ctx.from.id))) {
    await ctx.reply(t.notPublic);
    return;
  }

  ctx.contest = contest;
  await next();
});

// ─────────────────────────── участник ───────────────────────────

function participantOf(ctx: Ctx): Promise<Participant | null> {
  return prisma.participant.findUnique({ where: { tgUserId: String(ctx.from!.id) } });
}

function displayName(ctx: Ctx): string {
  const from = ctx.from!;
  return [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || 'Участник';
}

/**
 * Найти участника с таким телефоном. Номера на сайте набирали руками в любом
 * виде, поэтому сравниваем нормализованные, а не строки из базы. Участников
 * сотни, так что перебор дешевле, чем нормализация в SQL.
 */
async function findByPhone(phone: string): Promise<Participant | null> {
  const rows = await prisma.participant.findMany({ where: { phone: { not: null } } });
  return rows.find((p) => normalizePhone(p.phone as string) === phone) || null;
}

// ─────────────────────────── экраны ───────────────────────────

async function showTerms(ctx: Ctx): Promise<void> {
  const contest = ctx.contest;
  const now = new Date();

  if (now < contest.startsAt) {
    await ctx.reply(t.beforeStart(contest), { parse_mode: 'HTML' });
    return;
  }
  if (now > contest.endsAt) {
    await ctx.reply(t.afterEnd(contest), { parse_mode: 'HTML' });
    return;
  }

  const participant = await participantOf(ctx);
  await ctx.reply(t.terms(contest), {
    parse_mode: 'HTML',
    reply_markup: participant?.code ? kbStatus() : kbJoin(),
  });
}

bot.command('start', showTerms);

/** Код, активации и место. Рейтинг тот же, что на сайте. */
async function showStatus(ctx: Ctx): Promise<void> {
  const participant = await participantOf(ctx);
  if (!participant?.code) {
    await ctx.reply(t.notRegisteredYet);
    return;
  }

  // Кэш на 60 секунд стоит внутри: сто участников, нажавших «обновить»,
  // дают один поход в Fairy, а не сто.
  const rows = await computeStandings(ctx.contest);
  const mine = rows.find((r) => r.participantId === participant.id) || null;

  await ctx.reply(t.status(ctx.contest, participant.code, mine), {
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().webApp('📊 Кабинет и рейтинг', MINIAPP_URL),
  });
}

bot.command('status', showStatus);
bot.callbackQuery('status', async (ctx) => {
  await ctx.answerCallbackQuery();
  await showStatus(ctx);
});

// Команды объявляются ДО общего обработчика текста: он ловит и их тоже, и
// зарегистрированная ниже команда до своего обработчика уже не дошла бы.
bot.command('help', async (ctx) => {
  await ctx.reply(t.help);
});

// ─────────────────────────── регистрация ───────────────────────────

/**
 * Следующий шаг выводится из данных, а не из памяти процесса: нет телефона —
 * спрашиваем телефон, нет соцсети — соцсеть, есть всё — выдаём код.
 */
async function nextStep(ctx: Ctx, participant: Participant | null): Promise<void> {
  if (!participant) {
    await ctx.reply(t.askPhone, { parse_mode: 'HTML', reply_markup: kbPhone() });
    return;
  }
  if (!hasSocial(participant)) {
    await ctx.reply(t.askSocial, { parse_mode: 'HTML', reply_markup: { remove_keyboard: true } });
    return;
  }
  await issueAndShow(ctx, participant);
}

/**
 * Площадка, где выходят видео. Колонка `telegram` сюда не входит: её бот
 * заполняет сам ником из Telegram, и она сделала бы шаг анкеты «уже пройденным».
 */
function hasSocial(p: Participant): boolean {
  return !!(p.instagram || p.tiktok || p.youtube);
}

async function issueAndShow(ctx: Ctx, participant: Participant): Promise<void> {
  if (participant.code) {
    await ctx.reply(t.welcomeBack(ctx.contest, participant.code), {
      parse_mode: 'HTML',
      reply_markup: kbStatus(),
    });
    return;
  }

  try {
    const { code } = await issueCodeFor(participant.id);
    console.log(`[TG] регистрация ${participant.id} tg=${participant.tgUserId} код=${code}`);
    await ctx.reply(t.codeIssued(ctx.contest, code), { parse_mode: 'HTML', reply_markup: kbStatus() });
  } catch (e) {
    console.error(`[TG] не выдал код участнику ${participant.id}: ${(e as Error).message}`);
    await ctx.reply('Не получилось выдать код — попробуйте ещё раз через минуту.');
  }
}

bot.callbackQuery('join', async (ctx) => {
  await ctx.answerCallbackQuery();

  const now = new Date();
  if (now < ctx.contest.startsAt) {
    await ctx.reply(t.beforeStart(ctx.contest), { parse_mode: 'HTML' });
    return;
  }
  if (now > ctx.contest.endsAt) {
    await ctx.reply(t.afterEnd(ctx.contest), { parse_mode: 'HTML' });
    return;
  }

  await nextStep(ctx, await participantOf(ctx));
});

/**
 * Телефон. `verified` — прислан кнопкой, то есть самим Telegram. Только такой
 * номер даёт право войти в чужую уже существующую запись: набранный руками
 * телефон известного блогера иначе открывал бы его кабинет постороннему.
 */
async function handlePhone(ctx: Ctx, raw: string, verified: boolean): Promise<void> {
  const phone = normalizePhone(raw);
  if (!phone) {
    await ctx.reply(t.badPhone, { reply_markup: kbPhone() });
    return;
  }

  const existing = await findByPhone(phone);

  // Свой же номер прислали второй раз — просто продолжаем анкету.
  if (existing && existing.tgUserId === String(ctx.from!.id)) {
    await nextStep(ctx, existing);
    return;
  }

  if (existing) {
    if (existing.tgUserId) {
      await ctx.reply(t.phoneTakenByOther, { reply_markup: { remove_keyboard: true } });
      return;
    }
    if (!verified) {
      await ctx.reply(t.phoneNeedsProof, { parse_mode: 'HTML', reply_markup: kbPhone() });
      return;
    }

    const merged = await prisma.participant.update({
      where: { id: existing.id },
      data: {
        tgUserId: String(ctx.from!.id),
        tgUsername: ctx.from!.username || null,
        name: existing.name || displayName(ctx),
        telegram: existing.telegram || (ctx.from!.username ? `@${ctx.from!.username}` : null),
        lastSeenAt: new Date(),
      },
    });
    console.log(`[TG] привязан tg=${merged.tgUserId} к участнику ${merged.id} по телефону`);
    await nextStep(ctx, merged);
    return;
  }

  const created = await prisma.participant.create({
    data: {
      tgUserId: String(ctx.from!.id),
      tgUsername: ctx.from!.username || null,
      telegram: ctx.from!.username ? `@${ctx.from!.username}` : null,
      name: displayName(ctx),
      phone,
    },
  });
  console.log(`[TG] новый участник ${created.id} tg=${created.tgUserId}`);
  await nextStep(ctx, created);
}

bot.on('message:contact', async (ctx) => {
  const contact = ctx.message.contact;
  // Telegram позволяет переслать чужую визитку, поэтому сверяем, чей это номер.
  if (contact.user_id !== ctx.from.id) {
    await ctx.reply(t.foreignContact, { reply_markup: kbPhone() });
    return;
  }
  await handlePhone(ctx, contact.phone_number, true);
});

/**
 * Свободный текст — это ответ на текущий шаг анкеты. Отдельного «состояния
 * диалога» нет: чего у участника не хватает, то он сейчас и присылает.
 */
bot.on('message:text', async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) {
    await ctx.reply(t.unknown);
    return;
  }

  const participant = await participantOf(ctx);

  if (!participant) {
    await handlePhone(ctx, text, false);
    return;
  }

  if (!hasSocial(participant)) {
    const social = parseSocial(text);
    if (!social) {
      await ctx.reply(t.badSocial);
      return;
    }
    const patch: { instagram?: string; tiktok?: string; youtube?: string } = {};
    patch[social.field] = social.value;
    const updated = await prisma.participant.update({
      where: { id: participant.id },
      data: { ...patch, lastSeenAt: new Date() },
    });
    await issueAndShow(ctx, updated);
    return;
  }

  if (!participant.code) {
    await issueAndShow(ctx, participant);
    return;
  }

  await ctx.reply(t.unknown);
});

// Срабатывает только у long polling: при вебхуке grammy пробрасывает ошибку
// наружу, и ловит её обёртка в tgbot.ts. Оставлено на случай локального запуска
// через bot.start() — чтобы отладка не роняла процесс.
bot.catch((err) => {
  console.error(`[TG] ошибка обработки: ${err.message}`);
});
