import { TgCampaign } from '@prisma/client';
import { almatyDate, money, prizeFund, prizeTiers, timeLeft, plural, winnersTotal } from '../lib/tgCampaign';

/**
 * Все тексты бота в одном файле: их правит не программист, а маркетинг, и
 * искать их по обработчикам никто не должен. Разметка — HTML, потому что
 * <code> в Telegram копируется одним нажатием, а промокод для того и нужен.
 */

/** Экранирование для мест, куда попадает чужой текст (имя, ник). */
export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** «1 победитель — 100 000 ₸» построчно. Пусто, пока сетка не заведена. */
function prizeLines(campaign: TgCampaign): string {
  const tiers = prizeTiers(campaign);
  if (!tiers.length) return '';
  const medals = ['🥇', '🥈', '🥉'];
  return tiers
    .map((t, i) => {
      const who = t.count === 1
        ? '1 победитель'
        : `${t.count} ${plural(t.count, 'победитель', 'победителя', 'победителей')}`;
      const sum = t.count === 1 ? money(t.amount) : `по ${money(t.amount)}`;
      return `${medals[i] || '🎁'} ${who} — ${sum}`;
    })
    .join('\n');
}

/** Шапка с фондом. Пока призы не заведены, про деньги молчим. */
function prizeBlock(campaign: TgCampaign): string {
  const fund = prizeFund(campaign);
  if (!fund) return '';
  const lines = prizeLines(campaign);
  return `Призовой фонд — <b>${money(fund)}</b>\n${lines}\n\n`;
}

export function welcome(campaign: TgCampaign): string {
  return (
    `🎁 <b>${esc(campaign.title)}</b>\n\n` +
    prizeBlock(campaign) +
    'Как участвовать:\n' +
    '1️⃣ Установить приложение Bala Stories\n' +
    '2️⃣ Ввести в нём промокод, который я дам\n' +
    '3️⃣ Получить билет и ждать розыгрыша\n\n' +
    `Приём заявок до <b>${almatyDate(campaign.endsAt)}</b> — осталось ${timeLeft(campaign)}.`
  );
}

export function beforeStart(campaign: TgCampaign): string {
  return (
    `🎁 <b>${esc(campaign.title)}</b>\n\n` +
    prizeBlock(campaign) +
    `Приём заявок открывается ${almatyDate(campaign.startsAt)}.\n` +
    'Возвращайтесь к этому времени — я напомню.'
  );
}

export function afterEnd(campaign: TgCampaign): string {
  return (
    '⏳ Приём заявок закрыт.\n\n' +
    `Розыгрыш прошёл ${almatyDate(campaign.endsAt)}. ` +
    'Если вы участвовали и выиграли — я напишу вам сам, отвечать никуда не нужно.'
  );
}

/** Бот собран, но кампания не опубликована: обычный человек не должен видеть черновик. */
export const notPublished =
  '🐣 Розыгрыш скоро начнётся.\n\n' +
  'Подпишитесь на наши соцсети, чтобы не пропустить старт, — а пока можно просто ' +
  'почитать сказки в приложении Bala Stories.';

export function codeIssued(campaign: TgCampaign, code: string, taleCount: number): string {
  const tales = taleCount
    ? `откроются ${taleCount} ${plural(taleCount, 'сказка', 'сказки', 'сказок')} в подарок, а я`
    : 'я';
  return (
    `Ваш промокод: <code>${code}</code>\n` +
    '<i>нажмите на код, чтобы скопировать</i>\n\n' +
    '1️⃣ Установите приложение — кнопка ниже\n' +
    '2️⃣ Откройте его и введите этот код\n' +
    `3️⃣ ${tales} засчитаю участие\n\n` +
    `Код действует до ${almatyDate(campaign.endsAt)}. ` +
    'Как только вы его введёте, я напишу сам — проверять вручную не нужно.'
  );
}

export function status(campaign: TgCampaign, code: string | null, activated: boolean, tickets: number): string {
  if (!code) {
    return 'Вы ещё не получили промокод. Нажмите «Участвовать» — и я его выдам.';
  }
  const head = `Ваш промокод: <code>${code}</code>\n\n`;
  if (!activated) {
    return (
      head +
      '⏳ Пока не вижу активации.\n' +
      'Введите код в приложении Bala Stories — билет засчитается сам, в течение минуты.\n\n' +
      `До конца приёма заявок: ${timeLeft(campaign)}.`
    );
  }
  return (
    head +
    `✅ Участие подтверждено. Билетов: <b>${tickets}</b>\n\n` +
    `Розыгрыш ${almatyDate(campaign.endsAt)} — осталось ${timeLeft(campaign)}. ` +
    'Победителям я напишу в этом же чате.'
  );
}

export function activationConfirmed(campaign: TgCampaign, tickets: number): string {
  return (
    '✅ <b>Участие подтверждено!</b>\n\n' +
    `Билетов у вас: <b>${tickets}</b>.\n` +
    `Розыгрыш ${almatyDate(campaign.endsAt)} — победителям напишу прямо сюда.`
  );
}

export function terms(campaign: TgCampaign): string {
  const winners = winnersTotal(campaign);
  const fund = prizeFund(campaign);
  return (
    '📄 <b>Условия розыгрыша</b>\n\n' +
    (fund
      ? `Призовой фонд — ${money(fund)}, ${winners} ${plural(winners, 'победитель', 'победителя', 'победителей')}.\n`
      : '') +
    `Приём заявок: до ${almatyDate(campaign.endsAt)}.\n\n` +
    '<b>Как получить билет</b>\n' +
    'Установить приложение Bala Stories и ввести в нём личный промокод из этого бота. ' +
    'Один человек — один код и одна заявка.\n\n' +
    '<b>Как определяются победители</b>\n' +
    'После закрытия приёма заявок список участников фиксируется, и победители ' +
    'выбираются случайным образом. Чем больше у вас билетов, тем выше шанс. ' +
    'Организатор публикует список участников и случайное число, по которому шёл ' +
    'выбор, — розыгрыш можно перепроверить.\n\n' +
    '<b>Что не засчитывается</b>\n' +
    'Повторные заявки с одного человека, чужие промокоды и накрутка установок. ' +
    'Организатор вправе снять такого участника с розыгрыша.\n\n' +
    'Организатор — Bala Stories. Apple и Google к розыгрышу отношения не имеют.'
  );
}

export function inviteText(campaign: TgCampaign, link: string): string {
  return (
    '👥 <b>Позовите друга</b>\n\n' +
    'Отправьте ему эту ссылку:\n' +
    `${link}\n\n` +
    'Когда друг установит приложение и введёт свой код, вам начислятся ' +
    'дополнительные билеты.\n\n' +
    `До конца приёма заявок: ${timeLeft(campaign)}.`
  );
}

export const help =
  'Что я умею:\n\n' +
  '/start — условия розыгрыша\n' +
  '/status — мой промокод и билеты\n' +
  '/help — это сообщение\n\n' +
  'Если код не принимается в приложении — проверьте, что вы не вводили ' +
  'другой промокод раньше: он бывает только один на аккаунт.';

export const unknown =
  'Я понимаю только кнопки и команды: /start, /status, /help.';

/** Кампании нет в базе — это ошибка настройки, а не состояние для человека. */
export const noCampaign =
  '🐣 Розыгрыш ещё настраивается. Загляните чуть позже.';
