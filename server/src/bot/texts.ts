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

export const notRegisteredYet =
  'Вы ещё не участвуете в конкурсе.\n\n' +
  'Нажмите /start и кнопку «Участвовать» — это две минуты.';

// ─────────────────────────── регистрация ───────────────────────────

export const askPhone =
  '📱 <b>Шаг 1 из 2 — телефон</b>\n\n' +
  'По нему мы выплатим приз, если вы победите, и найдём вас, если возникнет вопрос.\n\n' +
  'Нажмите кнопку внизу — Telegram отправит номер сам. Можно и написать его сообщением.';

/** Прислали чужую визитку: Telegram позволяет переслать любой контакт. */
export const foreignContact =
  'Это контакт другого человека. Нажмите кнопку «Отправить телефон» — Telegram пришлёт ваш собственный номер.';

export const badPhone =
  'Не похоже на номер телефона. Пришлите его в виде +7 777 123 45 67 — или нажмите кнопку внизу.';

/**
 * Номер уже есть у участника, зарегистрированного на сайте. Набранному руками
 * номеру верить нельзя: иначе чужой телефон стал бы ключом к чужому кабинету с
 * призом. Кнопка Telegram присылает номер сама, и это уже доказательство.
 */
export const phoneNeedsProof =
  'Этот номер уже участвует в конкурсе.\n\n' +
  'Если он ваш — нажмите кнопку «Отправить телефон» внизу, и я покажу ваш промокод. ' +
  'Так я убеждаюсь, что номер действительно ваш.';

export const phoneTakenByOther =
  'Этот номер уже привязан к другому аккаунту Telegram.\n\n' +
  'Если это ваш номер и доступ потерян — напишите нам, разберёмся вручную.';

/** Дописка к статусу: код есть, а телефона нет — приз платить некуда. */
export const phoneMissing =
  '\n\n⚠️ У вас не указан телефон. Без него мы не сможем связаться с вами по призу — ' +
  'нажмите кнопку ниже, это одно касание.';

export const askSocial =
  '📸 <b>Шаг 2 из 2 — где вы снимаете</b>\n\n' +
  'Пришлите ссылку на профиль в Instagram, TikTok или YouTube. ' +
  'Можно просто ник в Instagram.';

export const badSocial =
  'Не разобрал. Пришлите ссылку на профиль — например instagram.com/username — или ник.';

/** Узнали человека по подтверждённому телефону: второй код ему не нужен. */
export function welcomeBack(contest: Contest, code: string): string {
  return (
    '✅ Нашёл вас — вы уже зарегистрированы на сайте, второй код не нужен.\n\n' +
    `Ваш промокод: <code>${code}</code>\n\n` +
    `Теперь я буду присылать сюда новые активации. До конца конкурса: ${timeLeft(contest.endsAt)}.`
  );
}

export function codeIssued(contest: Contest, code: string): string {
  return (
    '🎉 <b>Готово, вы участвуете!</b>\n\n' +
    `Ваш промокод: <code>${code}</code>\n` +
    '<i>нажмите на код, чтобы скопировать</i>\n\n' +
    '<b>Что делать дальше</b>\n' +
    'Называйте код в видео и сторис: зритель ставит Bala Stories, вводит код — ' +
    'и получает сказки в подарок, а вам засчитывается активация.\n\n' +
    `Нужно минимум ${contest.minActivations} ` +
    `${plural(contest.minActivations, 'активация', 'активации', 'активаций')}, ` +
    `чтобы участвовать в распределении призов. До конца конкурса: ${timeLeft(contest.endsAt)}.\n\n` +
    'Новые активации я буду присылать сюда сам.'
  );
}

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

// ─────────────────────────── уведомления ───────────────────────────

export function notifyActivations(delta: number, total: number, contest: Contest): string {
  const left = Math.max(0, contest.minActivations - total);
  const tail = left > 0
    ? `До порога ещё ${left} ${plural(left, 'активация', 'активации', 'активаций')}.`
    : 'Порог пройден — вы в распределении призов.';
  return (
    `📈 +${delta} ${plural(delta, 'активация', 'активации', 'активаций')}!\n` +
    `Всего у вас: <b>${total}</b>. ${tail}`
  );
}

export function notifyThreshold(total: number, contest: Contest): string {
  return (
    '🟢 <b>Порог пройден!</b>\n\n' +
    `У вас ${total} ${plural(total, 'активация', 'активации', 'активаций')} — ` +
    `это больше ${contest.minActivations}, и теперь вы участвуете в распределении призов.\n` +
    'Чем выше место, тем больше приз, так что не останавливайтесь.'
  );
}

export function notifyRankUp(rank: number, total: number, prizeAmount: number | null): string {
  const prize = prizeAmount ? `\n💰 Приз за это место — ${money(prizeAmount)}.` : '';
  return (
    `🏆 Вы поднялись на <b>${rank} место</b>!\n` +
    `Активаций: ${total}.${prize}`
  );
}

export function notifyThreeDays(contest: Contest, total: number, rank: number | null): string {
  const where = rank ? `Сейчас вы на ${rank} месте с ${total} активациями.` : 'Активаций пока нет.';
  return (
    '⏳ <b>Три дня до финиша</b>\n\n' +
    `${where}\n` +
    `Приём активаций закрывается ${almatyDate(contest.endsAt)}. ` +
    'Последние дни обычно решают всё — самое время напомнить о коде своей аудитории.'
  );
}

export function notifyResults(row: StandingRow | null): string {
  if (!row || row.rank === null) {
    return (
      '🏁 <b>Конкурс завершён</b>\n\n' +
      'Спасибо, что участвовали! В этот раз активаций по вашему коду не набралось, ' +
      'но код продолжает работать — сказки по нему по-прежнему открываются.'
    );
  }
  if (row.prizeAmount) {
    return (
      '🎉 <b>Вы в числе победителей!</b>\n\n' +
      `Итоговое место: <b>${row.rank}</b>, активаций: ${row.activations}.\n` +
      `Приз — ${money(row.prizeAmount)}. Мы свяжемся с вами по указанному телефону, ` +
      'чтобы договориться о выплате.'
    );
  }
  return (
    '🏁 <b>Конкурс завершён</b>\n\n' +
    `Ваше итоговое место: <b>${row.rank}</b>, активаций: ${row.activations}.\n` +
    'В призовую часть в этот раз не попали — но спасибо, что были с нами.'
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
