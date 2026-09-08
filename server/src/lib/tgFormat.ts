/**
 * Мелочи для бота: деньги, даты, склонения и допуск до публикации.
 * Всё, что касается самого конкурса — сроки, порог, призы, рейтинг, — живёт в
 * `contestStandings.ts` и здесь не дублируется.
 */

/** Алматы без перехода на летнее время — тот же фиксированный сдвиг, что в админке. */
const ALMATY_OFFSET_MS = 5 * 60 * 60 * 1000;

/** «210 000 ₸» — узкие пробелы, потому что обычные телефон переносит по строкам. */
export function money(amount: number): string {
  return `${amount.toLocaleString('ru-RU').replace(/ /g, ' ')} ₸`;
}

/** «16 сентября, 23:59» по Алматы. */
export function almatyDate(d: Date): string {
  const shifted = new Date(d.getTime() + ALMATY_OFFSET_MS);
  const months = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
  ];
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${shifted.getUTCDate()} ${months[shifted.getUTCMonth()]}, ${hh}:${mm}`;
}

/** «4 дня 6 часов» — сколько осталось до момента. */
export function timeLeft(until: Date, now = new Date()): string {
  const ms = until.getTime() - now.getTime();
  if (ms <= 0) return 'время вышло';

  const totalHours = Math.floor(ms / 3_600_000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days > 0) return `${days} ${plural(days, 'день', 'дня', 'дней')} ${hours} ${plural(hours, 'час', 'часа', 'часов')}`;
  if (hours > 0) return `${hours} ${plural(hours, 'час', 'часа', 'часов')}`;
  return `${Math.max(1, Math.floor(ms / 60_000))} мин`;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

/**
 * Пока бот не объявлен, его видят только свои. Это не режим отладки, а способ
 * пройти всю воронку живьём до того, как ссылка на бота ушла людям: случайная
 * регистрация до анонса попала бы в боевой рейтинг, где раздаются деньги.
 */
export function botIsPublic(): boolean {
  return process.env.TG_BOT_PUBLIC === '1';
}

export function isAdmin(tgUserId: string): boolean {
  return (process.env.TG_ADMIN_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(String(tgUserId));
}

/**
 * Телефон к одному виду: +7XXXXXXXXXX. По нему бот узнаёт человека, который уже
 * зарегистрирован на сайте, — иначе он получил бы второй код и вторую строку в
 * рейтинге. «8 777 123-45-67», «+7 (777) 1234567» и «77771234567» — одно число.
 *
 * @returns null, если это не похоже на казахстанский или российский номер.
 */
export function normalizePhone(raw: string): string | null {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 11 && (digits[0] === '8' || digits[0] === '7')) {
    return `+7${digits.slice(1)}`;
  }
  if (digits.length === 10 && digits[0] === '7') return `+7${digits}`;
  // Прочие страны: оставляем как есть, лишь бы длина была правдоподобной.
  if (digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  return null;
}
