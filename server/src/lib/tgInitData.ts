import crypto from 'crypto';

/**
 * Проверка `initData` из Telegram Mini App.
 *
 * Telegram отдаёт странице строку с данными пользователя и подписью на секрете
 * бота. Проверив её, сервер знает, кто открыл страницу, — без Google, без пароля
 * и без всякого «а вы точно тот, за кого себя выдаёте». Это и есть причина, по
 * которой кабинет в Telegram проще сайтового входа.
 *
 * Схема из документации: ключ = HMAC-SHA256("WebAppData", токен бота), затем
 * HMAC-SHA256(этим ключом, строка проверки) сравнивается с полем hash. В строку
 * проверки входят все поля кроме hash, отсортированные по имени.
 */

export interface TgWebAppUser {
  id: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  languageCode: string | null;
}

/** Сколько живёт подпись. Сутки — как в примерах Telegram. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type InitDataResult =
  | { ok: true; user: TgWebAppUser }
  | { ok: false; reason: 'no_token' | 'malformed' | 'bad_hash' | 'expired' | 'no_user' };

export function verifyInitData(initData: string, botToken = process.env.TG_BOT_TOKEN || ''): InitDataResult {
  if (!botToken) return { ok: false, reason: 'no_token' };
  if (!initData || initData.length > 4096) return { ok: false, reason: 'malformed' };

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'malformed' };

  const checkString = [...params.entries()]
    .filter(([k]) => k !== 'hash')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = crypto.createHmac('sha256', secret).update(checkString).digest('hex');

  // Сравнение постоянного времени: подпись сравнивают именно так, иначе по
  // времени ответа её можно подбирать побайтно.
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(hash, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad_hash' };

  // Подпись вечна, поэтому срок проверяем отдельно: перехваченная однажды
  // строка не должна открывать кабинет и через месяц.
  const authDate = Number(params.get('auth_date') || 0) * 1000;
  if (!authDate || Date.now() - authDate > MAX_AGE_MS) return { ok: false, reason: 'expired' };

  let raw: any;
  try {
    raw = JSON.parse(params.get('user') || 'null');
  } catch {
    return { ok: false, reason: 'no_user' };
  }
  if (!raw?.id) return { ok: false, reason: 'no_user' };

  return {
    ok: true,
    user: {
      id: String(raw.id),
      username: raw.username || null,
      firstName: raw.first_name || null,
      lastName: raw.last_name || null,
      languageCode: raw.language_code || null,
    },
  };
}
