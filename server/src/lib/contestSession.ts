import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

/**
 * Сессия участника конкурса. Отдельный механизм, а не Bearer-токен админки:
 *
 * 1. Кабинет открывают с телефона по ссылке из шапки профиля и возвращаются в
 *    него неделю подряд. Токен в localStorage переживает не всё (режим инкогнито,
 *    чистка сайта, «очистить данные» в iOS), а кука httpOnly — переживает и не
 *    читается чужим скриптом.
 * 2. Срок намеренно длинный и продлевается сам: за 12 дней конкурса человека не
 *    должно разлогинить ни разу, иначе он решит, что «сайт сломался».
 */

const COOKIE = 'bala_ugc';
const MAX_AGE_DAYS = 90;
// Продлеваем заранее, а не в последний день: иначе кука истечёт ровно у того,
// кто зашёл первый раз и вернулся через три месяца.
const RENEW_BELOW_DAYS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

// Отдельный секрет: утёкший админский JWT не должен открывать чужой кабинет, и
// наоборот. Если его не задали — не притворяемся, что всё хорошо.
const SECRET = process.env.CONTEST_SESSION_SECRET || '';

export interface ContestSession {
  pid: string;
  exp?: number;
}

declare global {
  namespace Express {
    interface Request {
      participantId?: string;
    }
  }
}

export function sessionConfigured(): boolean {
  return SECRET.length >= 16;
}

export function issueSession(res: Response, participantId: string): void {
  const token = jwt.sign({ pid: participantId }, SECRET, { expiresIn: `${MAX_AGE_DAYS}d` });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: true,          // сайт только по https, за nginx
    sameSite: 'lax',       // строгий 'strict' ломает возврат по внешней ссылке
    maxAge: MAX_AGE_DAYS * DAY_MS,
    path: '/',
  });
}

export function clearSession(res: Response): void {
  res.clearCookie(COOKIE, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
}

/** Своя разборка Cookie: ради одной куки тащить cookie-parser незачем. */
function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function verify(req: Request): ContestSession | null {
  const token = readCookie(req, COOKIE);
  if (!token || !SECRET) return null;
  try {
    return jwt.verify(token, SECRET) as ContestSession;
  } catch {
    return null;
  }
}

/**
 * Кладёт participantId в запрос, если сессия жива, и молча продлевает её.
 * Не отвечает ошибкой: страница условий открыта и без входа.
 */
export function readSession(req: Request, res: Response, next: NextFunction): void {
  const s = verify(req);
  if (s) {
    req.participantId = s.pid;
    const leftMs = s.exp ? s.exp * 1000 - Date.now() : 0;
    if (leftMs < RENEW_BELOW_DAYS * DAY_MS) issueSession(res, s.pid);
  }
  next();
}

/**
 * Требует вход. Код ошибки машинный (`no_session`), потому что клиент по нему
 * решает показать экран входа — и только по нему. Любая другая ошибка не должна
 * выкидывать человека из кабинета: связь в метро пропадает чаще, чем сессия.
 */
export function requireParticipant(req: Request, res: Response, next: NextFunction): void {
  if (!req.participantId) {
    res.status(401).json({ error: 'no_session' });
    return;
  }
  next();
}
