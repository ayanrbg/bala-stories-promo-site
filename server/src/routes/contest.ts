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
    nickname: p.nickname,
    socialUrl: p.socialUrl,
    phone: p.phone,
    code: p.code,
    profileComplete: !!(p.nickname && p.socialUrl),
    disqualified: p.disqualified,
  };
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
  const nickname = String(req.body?.nickname || '').trim();
  const socialUrl = String(req.body?.socialUrl || '').trim();
  const phone = String(req.body?.phone || '').trim();

  if (nickname.length < 2 || nickname.length > 40) {
    res.status(400).json({ error: 'bad_nickname', message: 'Ник — от 2 до 40 символов' });
    return;
  }
  if (!/^https?:\/\/\S+$/i.test(socialUrl) || socialUrl.length > 300) {
    res.status(400).json({ error: 'bad_social_url', message: 'Ссылка должна начинаться с https://' });
    return;
  }
  if (phone.length > 32) {
    res.status(400).json({ error: 'bad_phone', message: 'Слишком длинный номер' });
    return;
  }

  try {
    await prisma.participant.update({
      where: { id: req.participantId! },
      data: { nickname, socialUrl, phone: phone || null },
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
