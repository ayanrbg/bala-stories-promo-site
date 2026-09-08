import { Bot, Context, InlineKeyboard } from 'grammy';
import { Contest, PrismaClient } from '@prisma/client';
import * as t from './texts';
import { CONTEST_ID, computeStandings, getContest } from '../lib/contestStandings';
import { botIsPublic, isAdmin } from '../lib/tgFormat';

const prisma = new PrismaClient();

/**
 * Бот — второй вход в тот же конкурс, что живёт на `/ugc`. Участник здесь —
 * автор: он получает личный промокод и раздаёт его аудитории. Поэтому все
 * данные берутся из `Contest`/`Participant`, а своих таблиц у бота нет.
 *
 * Кабинет с рейтингом — Mini App (та же страница `/ugc`), а бот отвечает за
 * вход, промокод и уведомления. Регистрация с анкетой — следующий шаг.
 */

type Ctx = Context & { contest: Contest };

export const bot = new Bot<Ctx>(process.env.TG_BOT_TOKEN || '');

const kbTerms = () => new InlineKeyboard().text('🏆 Мой результат', 'status');

/**
 * Одна проверка на все обработчики: есть ли конкурс и можно ли его показывать.
 * Пока `TG_BOT_PUBLIC` не равен 1, отвечаем только своим — случайная
 * регистрация до анонса попала бы в боевой рейтинг, где раздаются деньги.
 */
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

/**
 * Участник этого телеграм-аккаунта, если он уже есть. Бот никого не заводит:
 * строка появляется только вместе с анкетой и кодом — «зашёл в бот» ещё не
 * участие, и пустых строк в рейтинге быть не должно.
 */
function participantOf(tgUserId: string) {
  return prisma.participant.findUnique({ where: { tgUserId } });
}

bot.command('start', async (ctx) => {
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

  await ctx.reply(t.terms(contest), { parse_mode: 'HTML', reply_markup: kbTerms() });
});

/** Код, активации и место. Рейтинг считается тем же кодом, что и на сайте. */
async function showStatus(ctx: Ctx): Promise<void> {
  const contest = ctx.contest;
  const participant = await participantOf(String(ctx.from!.id));

  if (!participant?.code) {
    await ctx.reply(t.notRegisteredYet);
    return;
  }

  // Кэш на 60 секунд стоит внутри: сто участников, нажавших «обновить»,
  // дают один поход в Fairy, а не сто.
  const rows = await computeStandings(contest);
  const mine = rows.find((r) => r.participantId === participant.id) || null;

  await ctx.reply(t.status(contest, participant.code, mine), { parse_mode: 'HTML' });
}

bot.callbackQuery('status', async (ctx) => {
  await ctx.answerCallbackQuery();
  await showStatus(ctx);
});

bot.command('status', showStatus);

bot.command('help', async (ctx) => {
  await ctx.reply(t.help);
});

bot.on('message:text', async (ctx) => {
  await ctx.reply(t.unknown);
});

// Срабатывает только у long polling: при вебхуке grammy пробрасывает ошибку
// наружу, и ловит её обёртка в tgbot.ts. Оставлено на случай локального запуска
// через bot.start() — чтобы отладка не роняла процесс.
bot.catch((err) => {
  console.error(`[TG] ошибка обработки: ${err.message}`);
});
