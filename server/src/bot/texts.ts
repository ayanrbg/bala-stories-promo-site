import { Contest } from '@prisma/client';
import { PRIZE_FUND, WINNERS_TOTAL, StandingRow, prizeTable } from '../lib/contestStandings';
import { almatyDate, money, plural, timeLeft } from '../lib/tgFormat';

/**
 * Все тексты бота в одном файле: их правит не программист, а маркетинг.
 * Разметка — HTML: <code> в Telegram копируется одним нажатием, а промокод для
 * того и нужен.
 *
 * Условия конкурса нигде здесь не заданы — фонд, сетка, порог и сроки приходят
 * из `Contest` и `contestStandings.ts`. Второго списка призов быть не должно:
 * на сайте он однажды разъехался с настоящим, и это стоило спора об условиях.
 */

/** Экранирование для мест, куда попадает чужой текст (имя, ник). */
export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function prizeLines(): string {
  const medals = ['🥇', '🥈', '🥉'];
  return prizeTable()
    .map((row, i) => {
      const place = row.fromRank === row.toRank
        ? `${row.fromRank} место`
        : `${row.fromRank}–${row.toRank} места`;
      const sum = row.winners === 1 ? money(row.amount) : `по ${money(row.amount)}`;
      return `${medals[i] || '🎁'} ${place} — ${sum}`;
    })
    .join('\n');
}

export function terms(contest: Contest): string {
  return (
    `🎁 <b>${esc(contest.title)}</b>\n\n` +
    `Призовой фонд — <b>${money(PRIZE_FUND)}</b>, ` +
    `${WINNERS_TOTAL} ${plural(WINNERS_TOTAL, 'победитель', 'победителя', 'победителей')}.\n` +
    `${prizeLines()}\n\n` +
    '<b>Как это работает</b>\n' +
    '1️⃣ Вы получаете личный промокод\n' +
    '2️⃣ Называете его в своих видео и сторис\n' +
    '3️⃣ Зритель ставит Bala Stories и вводит ваш код — это активация\n' +
    '4️⃣ Чем больше активаций, тем выше вы в рейтинге\n\n' +
    `Для участия в распределении призов нужно минимум <b>${contest.minActivations}</b> ` +
    `${plural(contest.minActivations, 'активация', 'активации', 'активаций')}.\n` +
    `Конкурс идёт до <b>${almatyDate(contest.endsAt)}</b> — осталось ${timeLeft(contest.endsAt)}.`
  );
}

export function beforeStart(contest: Contest): string {
  return (
    `🎁 <b>${esc(contest.title)}</b>\n\n` +
    `Конкурс стартует ${almatyDate(contest.startsAt)}. Возвращайтесь к этому времени.`
  );
}

export function afterEnd(contest: Contest): string {
  return (
    '⏳ Конкурс завершён.\n\n' +
    `Приём активаций закрылся ${almatyDate(contest.endsAt)}. ` +
    'Итоги зафиксированы — свой результат можно посмотреть в кабинете.'
  );
}

/** Бот собран, но ещё не объявлен: случайный человек не должен в него попадать. */
export const notPublic =
  '🐣 Конкурс скоро откроется для приёма заявок.\n\n' +
  'Загляните чуть позже — здесь появятся условия и ваш личный промокод.';

/** Регистрация появится на следующем шаге; сейчас бот только показывает условия. */
export const notRegisteredYet =
  'Вы ещё не участвуете в конкурсе.\n\n' +
  'Регистрация в боте вот-вот откроется. Пока получить промокод можно на сайте: ' +
  'promocode-stories.apiapp.kz/ugc';

export function status(contest: Contest, code: string, row: StandingRow | null): string {
  const head = `Ваш промокод: <code>${code}</code>\n\n`;
  const activations = row?.activations ?? 0;

  if (!row || row.rank === null) {
    return (
      head +
      'Активаций пока нет.\n' +
      'Назовите код в видео — как только зритель установит приложение и введёт его, ' +
      'я сообщу.\n\n' +
      `До конца конкурса: ${timeLeft(contest.endsAt)}.`
    );
  }

  const left = Math.max(0, contest.minActivations - activations);
  const gate = row.qualified
    ? '🟢 Порог пройден — вы участвуете в распределении призов.'
    : `🔴 До порога ещё ${left} ${plural(left, 'активация', 'активации', 'активаций')}.`;
  const prize = row.prizeAmount ? `\n💰 Приз за это место — ${money(row.prizeAmount)}.` : '';

  return (
    head +
    `🏆 Место: <b>${row.rank}</b>\n` +
    `📈 Активаций: <b>${activations}</b>\n` +
    `${gate}${prize}\n\n` +
    `До конца конкурса: ${timeLeft(contest.endsAt)}.`
  );
}

export const help =
  'Что я умею:\n\n' +
  '/start — условия конкурса\n' +
  '/status — мой промокод, активации и место\n' +
  '/help — это сообщение\n\n' +
  'Если у вас вопрос по конкурсу — напишите нам в поддержку, я передам.';

export const unknown =
  'Я понимаю только кнопки и команды: /start, /status, /help.';

/** Конкурса нет в базе — это ошибка настройки, а не состояние для человека. */
export const noContest =
  '🐣 Конкурс сейчас настраивается. Загляните чуть позже.';
