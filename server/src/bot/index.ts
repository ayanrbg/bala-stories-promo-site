import { Bot, Context, InlineKeyboard, Keyboard } from 'grammy';
import { Contest, Participant, PrismaClient } from '@prisma/client';
import * as t from './texts';
import { CONTEST_ID, StandingRow, computeStandings, getContest, getStandings } from '../lib/contestStandings';
import { issueCodeFor } from '../lib/contestCode';
import { Lang, botIsPublic, isAdmin, normalizePhone, parseSocial } from '../lib/tgFormat';

const prisma = new PrismaClient();

/**
 * Бот — второй вход в тот же конкурс, что живёт на `/ugc`. Участник здесь —
 * автор: он получает личный промокод и раздаёт его аудитории. Все данные лежат
 * в `Contest`/`Participant`, своих таблиц у бота нет — кроме языка (`TgPref`).
 *
 * Состояние анкеты нигде не хранится: шаг выводится из того, что уже заполнено
 * у участника. Поэтому рестарт процесса не роняет незаконченную регистрацию, а
 * «продолжить» работает само по себе.
 */

type Ctx = Context & { contest: Contest; lang: Lang };

export const bot = new Bot<Ctx>(process.env.TG_BOT_TOKEN || '');

/**
 * Кабинет — это страница `/ugc`, открытая внутри Telegram. Вход там не
 * спрашивается: Telegram подписывает, кто открыл, и сервер это проверяет.
 */
export const MINIAPP_URL = process.env.TG_MINIAPP_URL || 'https://promocode-stories.apiapp.kz/ugc';

/** Сколько строк рейтинга влезает в сообщение, не превращая его в простыню. */
const TOP_LIMIT = 10;

// ─────────────────────────── клавиатуры ───────────────────────────

const kbJoin = (l: Lang) => new InlineKeyboard()
  .text(t.btn(l, 'join'), 'join').row()
  .text(t.btn(l, 'top'), 'top').text(t.btn(l, 'lang'), 'lang');

/** Код уже есть, а телефона нет — по нему платят приз, поэтому просим отдельно. */
const kbNeedPhone = (l: Lang) => new InlineKeyboard().text(t.btn(l, 'needPhone'), 'join');

const kbStatus = (l: Lang) => new InlineKeyboard()
  .webApp(t.btn(l, 'cabinet'), MINIAPP_URL).row()
  .text(t.btn(l, 'status'), 'status').text(t.btn(l, 'top'), 'top');

const kbTop = (l: Lang, registered: boolean) => {
  const kb = new InlineKeyboard().webApp(t.btn(l, 'cabinet'), MINIAPP_URL);
  if (!registered) kb.row().text(t.btn(l, 'join'), 'join');
  return kb;
};

const kbLang = () => new InlineKeyboard()
  .text('🇰🇿 Қазақша', 'lang:kk')
  .text('🇷🇺 Русский', 'lang:ru');

/**
 * Кнопка запроса контакта. Номер присылает сам Telegram, и это единственный
 * способ убедиться, что телефон принадлежит собеседнику: набранному руками
 * номеру верить нельзя, иначе он стал бы ключом к чужому кабинету с призом.
 */
const kbPhone = (l: Lang) => new Keyboard().requestContact(t.btn(l, 'phone')).resized().oneTime();

// ─────────────────────────── язык ───────────────────────────

/**
 * Выбор языка помним в `TgPref`; пока выбора не было — берём язык клиента
 * Telegram. Догадка лучше, чем экран «выберите язык» на входе: человек пришёл
 * за конкурсом, а не за настройками.
 */
async function resolveLang(tgUserId: string, clientLang?: string): Promise<Lang> {
  const pref = await prisma.tgPref.findUnique({ where: { tgUserId } });
  if (pref?.lang === 'kk' || pref?.lang === 'ru') return pref.lang;
  return String(clientLang || '').toLowerCase().startsWith('kk') ? 'kk' : 'ru';
}

async function setLang(tgUserId: string, lang: Lang): Promise<void> {
  await prisma.tgPref.upsert({
    where: { tgUserId },
    update: { lang },
    create: { tgUserId, lang },
  });
}

// ─────────────────────────── общий вход ───────────────────────────

bot.use(async (ctx, next) => {
  if (!ctx.from || ctx.from.is_bot) return;

  const tgUserId = String(ctx.from.id);
  ctx.lang = await resolveLang(tgUserId, ctx.from.language_code);

  const contest = await getContest();
  if (!contest) {
    console.error(`[TG] конкурс ${CONTEST_ID} не найден в базе`);
    await ctx.reply(t.noContest(ctx.lang));
    return;
  }
  if (!botIsPublic() && !isAdmin(tgUserId)) {
    await ctx.reply(t.notPublic(ctx.lang));
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
  const { contest, lang } = ctx;
  const now = new Date();

  if (now < contest.startsAt) {
    await ctx.reply(t.beforeStart(lang, contest), { parse_mode: 'HTML' });
    return;
  }
  if (now > contest.endsAt) {
    await ctx.reply(t.afterEnd(lang, contest), { parse_mode: 'HTML' });
    return;
  }

  const participant = await participantOf(ctx);
  const keyboard = !participant?.code
    ? kbJoin(lang)
    : participant.phone ? kbStatus(lang) : kbNeedPhone(lang);
  await ctx.reply(t.terms(lang, contest), { parse_mode: 'HTML', reply_markup: keyboard });
}

bot.command('start', showTerms);

/** Код, активации и место. Рейтинг тот же, что на сайте. */
async function showStatus(ctx: Ctx): Promise<void> {
  const { contest, lang } = ctx;
  const participant = await participantOf(ctx);
  if (!participant?.code) {
    await ctx.reply(t.notRegisteredYet(lang), { reply_markup: kbJoin(lang) });
    return;
  }

  // Кэш на 60 секунд стоит внутри: сто участников, нажавших «обновить»,
  // дают один поход в Fairy, а не сто.
  const rows = await computeStandings(contest);
  const mine = rows.find((r) => r.participantId === participant.id) || null;

  const text = t.status(lang, contest, participant.code, mine) + (participant.phone ? '' : t.phoneMissing(lang));
  await ctx.reply(text, {
    parse_mode: 'HTML',
    reply_markup: participant.phone
      ? new InlineKeyboard().webApp(t.btn(lang, 'cabinet'), MINIAPP_URL)
      : kbNeedPhone(lang),
  });
}

bot.command('status', showStatus);

/**
 * Открытый рейтинг: те же строки и те же ники, что на сайте и на /top. Виден
 * всем, включая тех, кто в конкурсе не участвует, — это витрина, а не отчёт.
 */
async function showTop(ctx: Ctx): Promise<void> {
  const { contest, lang } = ctx;
  const standings = await getStandings(contest);
  const rows: StandingRow[] = standings.rows.filter((r) => r.rank !== null).slice(0, TOP_LIMIT);

  const participant = await participantOf(ctx);
  const mine = participant
    ? standings.rows.find((r) => r.participantId === participant.id) || null
    : null;

  await ctx.reply(t.top(lang, rows, mine), {
    parse_mode: 'HTML',
    reply_markup: kbTop(lang, !!participant?.code),
  });
}

bot.command('top', showTop);

bot.command('lang', async (ctx) => {
  await ctx.reply(t.langAsk(ctx.lang), { reply_markup: kbLang() });
});

// Команды объявляются ДО общего обработчика текста: он ловит и их тоже, и
// зарегистрированная ниже команда до своего обработчика уже не дошла бы.
bot.command('help', async (ctx) => {
  await ctx.reply(t.help(ctx.lang));
});

// ─────────────────────────── кнопки ───────────────────────────

/** Квитанция о нажатии не должна решать судьбу обработчика: у старой кнопки
 *  Telegram отвечает ошибкой, и тап молча не сработал бы. */
const ack = (ctx: Ctx) => ctx.answerCallbackQuery().catch(() => undefined);

bot.callbackQuery('status', async (ctx) => {
  await ack(ctx);
  await showStatus(ctx);
});

bot.callbackQuery('top', async (ctx) => {
  await ack(ctx);
  await showTop(ctx);
});

bot.callbackQuery('lang', async (ctx) => {
  await ack(ctx);
  await ctx.reply(t.langAsk(ctx.lang), { reply_markup: kbLang() });
});

bot.callbackQuery(/^lang:(ru|kk)$/, async (ctx) => {
  await ack(ctx);
  const lang = ctx.match![1] as Lang;
  await setLang(String(ctx.from.id), lang);
  ctx.lang = lang;
  await ctx.reply(t.langChanged(lang));
  await showTerms(ctx);
});

// ─────────────────────────── регистрация ───────────────────────────

/**
 * Следующий шаг выводится из данных, а не из памяти процесса: нет телефона —
 * спрашиваем телефон, нет соцсети — соцсеть, есть всё — выдаём код.
 */
async function nextStep(ctx: Ctx, participant: Participant | null): Promise<void> {
  // Телефон спрашивается и у того, чья запись уже есть: она могла появиться из
  // Mini App, где вход происходит без анкеты вовсе. Без этой проверки человек
  // получал код, ни разу не назвав телефон, — а по нему платят приз.
  if (!participant || !participant.phone) {
    await ctx.reply(t.askPhone(ctx.lang), { parse_mode: 'HTML', reply_markup: kbPhone(ctx.lang) });
    return;
  }
  if (!hasSocial(participant)) {
    await ctx.reply(t.askSocial(ctx.lang), { parse_mode: 'HTML', reply_markup: { remove_keyboard: true } });
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
  const { contest, lang } = ctx;

  if (participant.code) {
    await ctx.reply(t.welcomeBack(lang, contest, participant.code), {
      parse_mode: 'HTML',
      reply_markup: kbStatus(lang),
    });
    return;
  }

  try {
    const { code } = await issueCodeFor(participant.id);
    console.log(`[TG] регистрация ${participant.id} tg=${participant.tgUserId} код=${code}`);
    await ctx.reply(t.codeIssued(lang, contest, code), { parse_mode: 'HTML', reply_markup: kbStatus(lang) });
  } catch (e) {
    console.error(`[TG] не выдал код участнику ${participant.id}: ${(e as Error).message}`);
    await ctx.reply(t.unknown(lang));
  }
}

bot.callbackQuery('join', async (ctx) => {
  await ack(ctx);

  const now = new Date();
  if (now < ctx.contest.startsAt) {
    await ctx.reply(t.beforeStart(ctx.lang, ctx.contest), { parse_mode: 'HTML' });
    return;
  }
  if (now > ctx.contest.endsAt) {
    await ctx.reply(t.afterEnd(ctx.lang, ctx.contest), { parse_mode: 'HTML' });
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
    await ctx.reply(t.badPhone(ctx.lang), { reply_markup: kbPhone(ctx.lang) });
    return;
  }

  const tgUserId = String(ctx.from!.id);
  // Своя запись может уже существовать без телефона: вход в Mini App заводит её
  // без анкеты. Тогда телефон дописывается в неё, а не создаётся вторая.
  const mine = await participantOf(ctx);
  const other = await findByPhone(phone);

  if (other && other.id !== mine?.id) {
    if (other.tgUserId) {
      await ctx.reply(t.phoneTakenByOther(ctx.lang), { reply_markup: { remove_keyboard: true } });
      return;
    }
    if (!verified) {
      await ctx.reply(t.phoneNeedsProof(ctx.lang), { parse_mode: 'HTML', reply_markup: kbPhone(ctx.lang) });
      return;
    }

    // Свой код уже выдан — переезжать поздно: чужая запись осталась бы с нашим
    // кодом, а розданный аудитории код исчез бы. Просто дописываем телефон себе.
    if (mine?.code) {
      const updated = await prisma.participant.update({
        where: { id: mine.id },
        data: { phone, lastSeenAt: new Date() },
      });
      console.log(`[TG] телефон дописан участнику ${updated.id} (запись ${other.id} не тронута)`);
      await nextStep(ctx, updated);
      return;
    }

    // Пустая оболочка из Mini App уступает место настоящей записи с сайта.
    // Удаление и привязка одной транзакцией: tgUserId уникален, и между двумя
    // отдельными запросами он оказался бы занят дважды.
    const merged = await prisma.$transaction(async (tx) => {
      if (mine) await tx.participant.delete({ where: { id: mine.id } });
      return tx.participant.update({
        where: { id: other.id },
        data: {
          tgUserId,
          tgUsername: ctx.from!.username || null,
          name: other.name || displayName(ctx),
          telegram: other.telegram || (ctx.from!.username ? `@${ctx.from!.username}` : null),
          lastSeenAt: new Date(),
        },
      });
    });
    console.log(`[TG] привязан tg=${tgUserId} к участнику ${merged.id} по телефону`);
    await nextStep(ctx, merged);
    return;
  }

  if (mine) {
    const updated = await prisma.participant.update({
      where: { id: mine.id },
      data: { phone, lastSeenAt: new Date() },
    });
    await nextStep(ctx, updated);
    return;
  }

  const created = await prisma.participant.create({
    data: {
      tgUserId,
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
    await ctx.reply(t.foreignContact(ctx.lang), { reply_markup: kbPhone(ctx.lang) });
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
    await ctx.reply(t.unknown(ctx.lang));
    return;
  }

  const participant = await participantOf(ctx);

  if (!participant || !participant.phone) {
    await handlePhone(ctx, text, false);
    return;
  }

  if (!hasSocial(participant)) {
    const social = parseSocial(text);
    if (!social) {
      await ctx.reply(t.badSocial(ctx.lang));
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

  await ctx.reply(t.unknown(ctx.lang));
});

// Срабатывает только у long polling: при вебхуке grammy пробрасывает ошибку
// наружу, и ловит её обёртка в tgbot.ts. Оставлено на случай локального запуска
// через bot.start() — чтобы отладка не роняла процесс.
bot.catch((err) => {
  console.error(`[TG] ошибка обработки: ${err.message}`);
});
