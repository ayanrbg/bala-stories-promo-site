import { Contest, Participant, PrismaClient } from '@prisma/client';
import { InlineKeyboard } from 'grammy';
import * as t from './texts';
import { bot, MINIAPP_URL } from './index';
import { Lang } from '../lib/tgFormat';
import { StandingRow, WINNERS_TOTAL, getContest, getStandings } from '../lib/contestStandings';

const prisma = new PrismaClient();

/**
 * Уведомления об активациях — единственное, что бот умеет, а страница нет, и
 * ради чего его вообще стоило делать: автор узнаёт о новом зрителе, не открывая
 * кабинет.
 *
 * Три правила, без которых это превращается в спам и человек выключает бота:
 * 1. Первый цикл для участника только запоминает цифры (`notifiedAt IS NULL`).
 *    Иначе перенёсший телеграм на свою сайтовую запись получил бы «+84» разом.
 * 2. Не чаще раза в час. Активации в удачный день идут пачками, и двенадцать
 *    сообщений в час — это выключенный бот, а не радость.
 * 3. Одно сообщение за раз: перешёл порог — про порог, поднялся в призах — про
 *    место, иначе просто про активации.
 */

const TICK_MS = 5 * 60_000;
const MIN_GAP_MS = 60 * 60_000;
const THREE_DAYS_MS = 3 * 24 * 60 * 60_000;
/** Пауза между отправками: у Telegram лимит около 30 сообщений в секунду. */
const SEND_GAP_MS = 60;

const kb = (lang: Lang) => new InlineKeyboard().webApp(t.btn(lang, 'cabinet'), MINIAPP_URL);

/** Уведомление приходит на том языке, который человек выбрал в боте. */
async function langOf(tgUserId: string): Promise<Lang> {
  const pref = await prisma.tgPref.findUnique({ where: { tgUserId } });
  return pref?.lang === 'kk' ? 'kk' : 'ru';
}

/**
 * @returns true, если сообщение ушло. Заблокировавшего бота помечаем и больше
 * не трогаем — иначе каждый цикл будет писать в лог одну и ту же ошибку.
 */
async function send(p: Participant, text: string, lang: Lang): Promise<boolean> {
  try {
    await bot.api.sendMessage(p.tgUserId as string, text, {
      parse_mode: 'HTML',
      reply_markup: kb(lang),
    });
    return true;
  } catch (e) {
    const msg = (e as Error).message;
    if (/bot was blocked|user is deactivated|chat not found/i.test(msg)) {
      await prisma.participant.update({
        where: { id: p.id },
        data: { remindersSent: { push: 'blocked' } },
      }).catch(() => undefined);
      console.log(`[TG] ${p.tgUserId} выключил бота — больше не пишем`);
      return false;
    }
    console.error(`[TG] не доставил сообщение ${p.tgUserId}: ${msg}`);
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Что сказать участнику в этот цикл — или null, если говорить нечего.
 * Экспортируется ради проверки: решение «писать или молчать» — самое дорогое в
 * этой рассылке, и его надо уметь прогнать без Telegram и без базы.
 */
export function pickMessage(
  contest: Contest,
  p: Participant,
  row: StandingRow | null,
  now: number,
  lang: Lang = 'ru'
): { text: string; reminder?: string } | null {
  const activations = row?.activations ?? 0;
  const rank = row?.rank ?? null;

  // Итоги — один раз и вместо всего остального.
  if (contest.finalizedAt) {
    if (p.remindersSent.includes('results')) return null;
    return { text: t.notifyResults(lang, row), reminder: 'results' };
  }

  const delta = activations - p.notifiedActivations;
  const gapOk = !p.notifiedAt || now - p.notifiedAt.getTime() >= MIN_GAP_MS;

  if (delta > 0 && gapOk) {
    if (p.notifiedActivations < contest.minActivations && activations >= contest.minActivations) {
      return { text: t.notifyThreshold(lang, activations, contest) };
    }
    // Про место пишем только когда оно улучшилось и попало в призовую часть:
    // «вы на 47 месте вместо 48» никого не радует.
    if (rank && p.notifiedRank && rank < p.notifiedRank && rank <= WINNERS_TOTAL) {
      return { text: t.notifyRankUp(lang, rank, activations, row?.prizeAmount ?? null) };
    }
    return { text: t.notifyActivations(lang, delta, activations, contest) };
  }

  // Напоминание за три дня — независимо от паузы: оно одно на весь конкурс.
  const leftMs = contest.endsAt.getTime() - now;
  if (leftMs > 0 && leftMs <= THREE_DAYS_MS && !p.remindersSent.includes('3d')) {
    return { text: t.notifyThreeDays(lang, contest, activations, rank), reminder: '3d' };
  }

  return null;
}

async function tick(): Promise<void> {
  const contest = await getContest();
  if (!contest) return;

  const participants = await prisma.participant.findMany({
    where: { tgUserId: { not: null }, code: { not: null }, disqualified: false },
  });
  if (!participants.length) return;

  const standings = await getStandings(contest);
  const byId = new Map(standings.rows.map((r) => [r.participantId, r]));
  const now = Date.now();

  for (const p of participants) {
    if (p.remindersSent.includes('blocked')) continue;

    const row = byId.get(p.id) || null;
    const activations = row?.activations ?? 0;
    const rank = row?.rank ?? null;

    // Первое наблюдение: молча запоминаем, с чего человек начал.
    if (!p.notifiedAt) {
      await prisma.participant.update({
        where: { id: p.id },
        data: { notifiedActivations: activations, notifiedRank: rank, notifiedAt: new Date() },
      });
      continue;
    }

    const lang = await langOf(p.tgUserId as string);
    const message = pickMessage(contest, p, row, now, lang);
    if (!message) continue;

    const delivered = await send(p, message.text, lang);
    if (!delivered) continue;

    await prisma.participant.update({
      where: { id: p.id },
      data: {
        notifiedActivations: activations,
        notifiedRank: rank,
        notifiedAt: new Date(),
        ...(message.reminder ? { remindersSent: { push: message.reminder } } : {}),
      },
    });
    await sleep(SEND_GAP_MS);
  }
}

export function startNotifier(): void {
  const run = () => {
    tick().catch((e) => console.error(`[TG] цикл уведомлений упал: ${(e as Error).message}`));
  };
  setInterval(run, TICK_MS).unref();
  // Первый прогон не сразу: дать процессу подняться и не устроить всплеск
  // запросов в Fairy одновременно с рестартом сайта.
  setTimeout(run, 30_000).unref();
  console.log(`[TG] уведомления включены, цикл раз в ${TICK_MS / 60000} мин`);
}
