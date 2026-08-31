import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { OAuth2Client } from 'google-auth-library';
import {
  readSession,
  requireParticipant,
  issueSession,
  clearSession,
  sessionConfigured,
} from '../lib/contestSession';
import { issueCodeFor } from '../lib/contestCode';
import { consumeInvite, issueInviteLink, sendInviteMail, mailConfigured } from '../lib/contestInvite';
import { getContest, getStandings, StandingRow } from '../lib/contestStandings';

/**
 * Кабинет участника UGC-конкурса. Публичная часть сайта: логина админки здесь
 * нет, вход через Google, сессия в куке.
 *
 * Три правила, и все три держатся здесь, а не в вёрстке:
 * 1. Рейтинг анонимный. Наружу уходят только место и число активаций — ни имён,
 *    ни чужих промокодов. Свою строку человек узнаёт по флагу isMe.
 * 2. Свой код участник получает только после анкеты: код открывает платные
 *    сказки, и контакт для выплаты приза нужен до, а не после.
 * 3. Частоту запросов задаёт улица — отсюда лимит на вход и кэш рейтинга.
 */

const router = Router();
const prisma = new PrismaClient();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

/** Сколько строк рейтинга показываем. Своя строка добавляется отдельно. */
const TOP_LIMIT = 10;

// ─────────────────────────── лимит на вход ───────────────────────────

const WINDOW_MS = 60_000;
const MAX_HITS = 30;
const hits = new Map<string, { n: number; reset: number }>();

function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const now = Date.now();
  const ip = String(req.headers['x-real-ip'] || req.ip || 'unknown');
  const cur = hits.get(ip);

  if (!cur || cur.reset <= now) {
    hits.set(ip, { n: 1, reset: now + WINDOW_MS });
  } else {
    cur.n += 1;
    if (cur.n > MAX_HITS) {
      res.status(429).json({ error: 'too_many_requests' });
      return;
    }
  }
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }
  next();
}

router.use(readSession);

// ─────────────────────────── вход ───────────────────────────

// POST /api/contest/auth/google { credential } — ID-токен от кнопки Google.
router.post('/auth/google', rateLimit, async (req: Request, res: Response): Promise<void> => {
  if (!GOOGLE_CLIENT_ID || !sessionConfigured()) {
    console.error('[UGC] вход не настроен: нет GOOGLE_CLIENT_ID или CONTEST_SESSION_SECRET');
    res.status(503).json({ error: 'auth_not_configured' });
    return;
  }

  const credential = String(req.body?.credential || '');
  if (!credential) {
    res.status(400).json({ error: 'no_credential' });
    return;
  }

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch (e) {
    console.warn(`[UGC] отклонён токен Google: ${(e as Error).message}`);
    res.status(401).json({ error: 'bad_credential' });
    return;
  }

  if (!payload?.sub || !payload.email) {
    res.status(401).json({ error: 'bad_credential' });
    return;
  }
  // Непроверенная почта — это чужая почта: Google так помечает адреса, владение
  // которыми не подтверждено. Пускать по ней нельзя, иначе приз уедет не туда.
  if (payload.email_verified === false) {
    res.status(403).json({ error: 'email_not_verified' });
    return;
  }

  const email = payload.email.toLowerCase();

  try {
    const existing =
      (await prisma.participant.findUnique({ where: { googleSub: payload.sub } })) ||
      (await prisma.participant.findUnique({ where: { email } }));

    const participant = existing
      ? await prisma.participant.update({
          where: { id: existing.id },
          data: {
            googleSub: payload.sub,
            email,
            name: payload.name || existing.name,
            avatarUrl: payload.picture || existing.avatarUrl,
            lastSeenAt: new Date(),
          },
        })
      : await prisma.participant.create({
          data: {
            googleSub: payload.sub,
            email,
            name: payload.name || null,
            avatarUrl: payload.picture || null,
          },
        });

    if (!existing) console.log(`[UGC] новый участник ${participant.id} ${email}`);

    issueSession(res, participant.id);
    res.json({ ok: true, participant: publicParticipant(participant) });
  } catch (e) {
    console.error(`[UGC] вход не удался ${email}: ${(e as Error).message}`);
    res.status(500).json({ error: 'internal_error' });
  }
});

// POST /api/contest/auth/invite { token } — вход по одноразовой ссылке.
// Запасной путь для тех, у кого Google не открывается; ссылку выдаёт админ
// или присылает письмо. Ссылка гаснет при первом успешном входе.
router.post('/auth/invite', rateLimit, async (req: Request, res: Response): Promise<void> => {
  const participantId = await consumeInvite(String(req.body?.token || ''));
  if (!participantId) {
    // Причину не уточняем: «ссылка уже использована» помогает только тому,
    // кто перебирает чужие.
    res.status(401).json({ error: 'bad_invite', message: 'Ссылка недействительна. Попросите новую.' });
    return;
  }

  const p = await prisma.participant.findUnique({ where: { id: participantId } });
  if (!p) {
    res.status(401).json({ error: 'bad_invite' });
    return;
  }

  issueSession(res, p.id);
  console.log(`[UGC] вход по ссылке ${p.email}`);
  res.json({ ok: true, participant: publicParticipant(p) });
});

// POST /api/contest/auth/magic { email } — прислать ссылку письмом.
// Работает, только когда в .env есть SMTP; иначе честно отвечаем «нельзя»,
// а не делаем вид, что письмо ушло.
router.post('/auth/magic', rateLimit, async (req: Request, res: Response): Promise<void> => {
  if (!mailConfigured()) {
    res.status(503).json({ error: 'mail_not_configured', message: 'Вход по почте пока не подключён' });
    return;
  }

  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) {
    res.status(400).json({ error: 'bad_email', message: 'Проверьте адрес' });
    return;
  }

  try {
    const p =
      (await prisma.participant.findUnique({ where: { email } })) ||
      (await prisma.participant.create({ data: { email } }));
    await sendInviteMail(email, await issueInviteLink(p.id));
  } catch (e) {
    console.error(`[UGC] письмо со ссылкой не ушло ${email}: ${(e as Error).message}`);
  }

  // Ответ одинаковый в любом случае: иначе по нему можно проверять, кто
  // участвует в конкурсе.
  res.json({ ok: true });
});

router.post('/auth/logout', (_req: Request, res: Response): void => {
  clearSession(res);
  res.json({ ok: true });
});

// ─────────────────────────── профиль ───────────────────────────

type ParticipantRow = Awaited<ReturnType<typeof prisma.participant.findUniqueOrThrow>>;

function publicParticipant(p: ParticipantRow) {
  return {
    id: p.id,
    name: p.name,
    email: p.email,
    avatarUrl: p.avatarUrl,
    instagram: p.instagram,
    tiktok: p.tiktok,
    telegram: p.telegram,
    youtube: p.youtube,
    phone: p.phone,
    code: p.code,
    // Анкета считается заполненной, если названа хотя бы одна сеть: автор
    // снимает не везде, и требовать все — значит требовать выдуманное.
    profileComplete: !!(p.instagram || p.tiktok || p.telegram || p.youtube),
    disqualified: p.disqualified,
  };
}

/**
 * Ник без @ и без адреса. Половина людей вставит `@mama.blog`, вторая —
 * `https://instagram.com/mama.blog/?hl=ru`, и обе правы: просили ник, а под
 * рукой кнопка «скопировать ссылку на профиль».
 */
function normalizeHandle(raw: unknown): string | null {
  let s = String(raw ?? '').trim();
  if (!s) return null;

  s = s.split(/[?#]/)[0].replace(/\/+$/, '');
  if (/^(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}\//i.test(s)) {
    const parts = s.split('/').filter(Boolean);
    s = parts[parts.length - 1] || '';
  }
  s = s.replace(/^@+/, '').trim();
  return s ? s.slice(0, 60) : null;
}

/** У YouTube ссылка: канал по @-нику опознать труднее, чем по адресу. */
function normalizeYoutube(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s.slice(0, 300);
  return ('https://youtube.com/@' + s.replace(/^@+/, '')).slice(0, 300);
}

router.get('/me', requireParticipant, async (req: Request, res: Response): Promise<void> => {
  const p = await prisma.participant.findUnique({ where: { id: req.participantId! } });
  if (!p) {
    // Сессия жива, а участника нет — например, его удалили. Гасим куку, иначе
    // человек будет бесконечно получать 404 и не сможет войти заново.
    clearSession(res);
    res.status(401).json({ error: 'no_session' });
    return;
  }
  prisma.participant
    .update({ where: { id: p.id }, data: { lastSeenAt: new Date() } })
    .catch(() => undefined);
  res.json({ participant: publicParticipant(p) });
});

// PATCH /api/contest/profile — анкета. Здесь же выдаётся код: заполненная
// анкета и есть условие его получения.
router.patch('/profile', requireParticipant, async (req: Request, res: Response): Promise<void> => {
  const instagram = normalizeHandle(req.body?.instagram);
  const tiktok = normalizeHandle(req.body?.tiktok);
  const telegram = normalizeHandle(req.body?.telegram);
  const youtube = normalizeYoutube(req.body?.youtube);
  const phone = String(req.body?.phone || '').trim();

  // Хватает одной сети. Требовать больше нечестно: у одного всё в TikTok,
  // у другого только канал на YouTube, и выдуманные ники нам не нужны.
  if (!instagram && !tiktok && !telegram && !youtube) {
    res.status(400).json({
      error: 'social_required',
      message: 'Напишите хотя бы один аккаунт',
    });
    return;
  }
  if (phone.length > 32) {
    res.status(400).json({ error: 'bad_phone', message: 'Слишком длинный номер' });
    return;
  }

  try {
    await prisma.participant.update({
      where: { id: req.participantId! },
      data: { instagram, tiktok, telegram, youtube, phone: phone || null },
    });

    await issueCodeFor(req.participantId!);

    const p = await prisma.participant.findUniqueOrThrow({ where: { id: req.participantId! } });
    res.json({ ok: true, participant: publicParticipant(p) });
  } catch (e) {
    console.error(`[UGC] анкета не сохранилась ${req.participantId}: ${(e as Error).message}`);
    res.status(500).json({ error: 'internal_error' });
  }
});

// ─────────────────────────── конкурс и рейтинг ───────────────────────────

// GET /api/contest/info — сроки, порог, призы. Открыто без входа: страница
// условий должна открываться по ссылке из шапки профиля сразу.
router.get('/info', async (_req: Request, res: Response): Promise<void> => {
  const contest = await getContest();
  if (!contest) {
    res.status(404).json({ error: 'no_contest' });
    return;
  }
  res.json({
    id: contest.id,
    title: contest.title,
    startsAt: contest.startsAt.toISOString(),
    endsAt: contest.endsAt.toISOString(),
    minActivations: contest.minActivations,
    finalized: !!contest.finalizedAt,
    // Отдаём сюда, а не зашиваем в страницу: ключ живёт в .env одним экземпляром,
    // и смена OAuth-клиента не требует правки вёрстки.
    googleClientId: GOOGLE_CLIENT_ID || null,
    // Показывать ли поле «прислать ссылку на почту»: обещать то, чего сервер
    // не умеет, хуже, чем не предлагать вовсе.
    mailLogin: mailConfigured(),
    // Часы на телефоне врут — обратный отсчёт синхронизируется по серверу.
    serverTime: new Date().toISOString(),
    prizes: [
      { place: '1 место', winners: 1, amount: 50000 },
      { place: '2–6 места', winners: 5, amount: 20000 },
      { place: '7–16 места', winners: 10, amount: 5000 },
    ],
    prizeFund: 200000,
    winnersTotal: 16,
  });
});

// GET /api/contest/standings — топ и своя строка.
router.get('/standings', async (req: Request, res: Response): Promise<void> => {
  const contest = await getContest();
  if (!contest) {
    res.status(404).json({ error: 'no_contest' });
    return;
  }

  try {
    const standings = await getStandings(contest);
    const meId = req.participantId || null;

    const strip = (r: StandingRow) => ({
      rank: r.rank,
      activations: r.activations,
      qualified: r.qualified,
      prizeAmount: r.prizeAmount,
      isMe: !!meId && r.participantId === meId,
    });

    const mine = meId ? standings.rows.find((r) => r.participantId === meId) || null : null;

    res.json({
      finalized: standings.finalized,
      computedAt: standings.computedAt,
      minActivations: contest.minActivations,
      totalParticipants: standings.rows.length,
      // В таблице только те, у кого есть место: строка «0 активаций» ничего не
      // говорит и лишь разбавляет рейтинг теми, кто ещё не начал.
      top: standings.rows.filter((r) => r.rank !== null).slice(0, TOP_LIMIT).map(strip),
      me: mine
        ? {
            ...strip(mine),
            code: mine.code,
            remaining: Math.max(0, contest.minActivations - mine.activations),
          }
        : null,
    });
  } catch (e) {
    // Лучше честное «не смогли», чем нули: нарисованный ноль человек примет за
    // потерянные активации и придёт в поддержку.
    console.error(`[UGC] рейтинг не построился: ${(e as Error).message}`);
    res.status(502).json({ error: 'standings_unavailable' });
  }
});

export default router;
