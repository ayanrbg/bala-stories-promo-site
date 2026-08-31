import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, requireRole } from '../middleware/auth';
import { fairyFetch } from '../lib/fairyProxy';
import { issueInviteLink, sendInviteMail, mailConfigured } from '../lib/contestInvite';
import {
  getContest,
  getStandings,
  getActivationsMap,
  dropActivationsCache,
  finalize,
  CONTEST_ID,
} from '../lib/contestStandings';

/**
 * Админская часть конкурса: сроки, участники, дисквалификация, фиксация итогов.
 *
 * Отдельный файл, а не ветка в admin.ts: там всё про промокоды и блогеров, и
 * смешав, мы бы получили список участников конкурса рядом с выдачей премиума.
 *
 * Кнопки фиксации нужны не для подведения итогов — их подводит таймер сам, —
 * а для разбора накруток: дисквалификация обязана двигать места, а сделать это
 * можно только пересчётом снимка.
 */

const router = Router();
const prisma = new PrismaClient();

router.use(authenticateToken, requireRole('admin'));

// ─────────────────────────── обзор ───────────────────────────

router.get('/', async (_req: Request, res: Response): Promise<void> => {
  const contest = await getContest();
  if (!contest) {
    res.status(404).json({ error: 'no_contest' });
    return;
  }

  try {
    const [standings, participants, activations] = await Promise.all([
      getStandings(contest),
      prisma.participant.findMany({ orderBy: { createdAt: 'asc' } }),
      // Дисквалифицированных в рейтинге нет, но их цифры админ должен видеть:
      // иначе непонятно, за что человека сняли и не ошиблись ли.
      contest.finalizedAt ? Promise.resolve(null) : getActivationsMap(contest),
    ]);

    const byId = new Map(standings.rows.map((r) => [r.participantId, r]));

    const rows = participants.map((p) => {
      const s = p.code ? byId.get(p.id) : undefined;
      const raw = p.code && activations ? activations.get(p.code.toUpperCase()) : undefined;
      return {
        id: p.id,
        name: p.name,
        email: p.email,
        instagram: p.instagram,
        tiktok: p.tiktok,
        telegram: p.telegram,
        youtube: p.youtube,
        phone: p.phone,
        code: p.code,
        createdAt: p.createdAt,
        codeIssuedAt: p.codeIssuedAt,
        lastSeenAt: p.lastSeenAt,
        disqualified: p.disqualified,
        dqReason: p.dqReason,
        activations: s ? s.activations : raw ? Number(raw.bindings) || 0 : 0,
        rank: s ? s.rank : null,
        qualified: s ? s.qualified : false,
        prizeAmount: s ? s.prizeAmount : null,
      };
    });

    // Сортировка админского списка — по местам, потом по тем, у кого места нет.
    rows.sort((a, b) => {
      if (a.rank && b.rank) return a.rank - b.rank;
      if (a.rank) return -1;
      if (b.rank) return 1;
      return b.activations - a.activations;
    });

    res.json({
      contest: {
        id: contest.id,
        title: contest.title,
        startsAt: contest.startsAt.toISOString(),
        endsAt: contest.endsAt.toISOString(),
        minActivations: contest.minActivations,
        finalizedAt: contest.finalizedAt ? contest.finalizedAt.toISOString() : null,
      },
      serverTime: new Date().toISOString(),
      finalized: standings.finalized,
      computedAt: standings.computedAt,
      totals: {
        participants: rows.length,
        withCode: rows.filter((r) => r.code).length,
        qualified: rows.filter((r) => r.qualified).length,
        disqualified: rows.filter((r) => r.disqualified).length,
        activations: rows.reduce((n, r) => n + (r.disqualified ? 0 : r.activations), 0),
      },
      participants: rows,
    });
  } catch (e) {
    console.error(`[UGC-ADMIN] обзор не построился: ${(e as Error).message}`);
    res.status(502).json({ error: 'upstream_error', message: (e as Error).message });
  }
});

// ─────────────────────────── настройки ───────────────────────────

router.patch('/', async (req: Request, res: Response): Promise<void> => {
  const data: Record<string, unknown> = {};

  if (typeof req.body?.title === 'string' && req.body.title.trim()) data.title = req.body.title.trim();

  for (const key of ['startsAt', 'endsAt'] as const) {
    if (req.body?.[key] !== undefined) {
      const d = new Date(String(req.body[key]));
      if (isNaN(d.getTime())) {
        res.status(400).json({ error: 'bad_date', message: `Неверная дата: ${key}` });
        return;
      }
      data[key] = d;
    }
  }

  if (req.body?.minActivations !== undefined) {
    const n = Number(req.body.minActivations);
    if (!Number.isFinite(n) || n < 1) {
      res.status(400).json({ error: 'bad_min', message: 'Порог — целое число больше нуля' });
      return;
    }
    data.minActivations = Math.floor(n);
  }

  if (!Object.keys(data).length) {
    res.status(400).json({ error: 'nothing_to_update' });
    return;
  }

  const updated = await prisma.contest.update({ where: { id: CONTEST_ID }, data });
  // Цифры кэшируются на минуту вместе с окном дат: без сброса админ поменял бы
  // сроки и минуту смотрел на старые числа, решив, что правка не сработала.
  dropActivationsCache();

  console.log(`[UGC-ADMIN] настройки конкурса изменены: ${Object.keys(data).join(', ')}`);
  res.json({ ok: true, contest: updated });
});

// ─────────────────────────── фиксация ───────────────────────────

router.post('/finalize', async (req: Request, res: Response): Promise<void> => {
  const force = req.body?.force === true;
  const result = await finalize(force);
  if (!result.ok) {
    const human: Record<string, string> = {
      no_contest: 'Конкурс не найден',
      already_finalized: 'Итоги уже зафиксированы. Чтобы пересчитать — «Пересчитать итоги».',
      not_ended: 'Конкурс ещё идёт. Чтобы зафиксировать досрочно — «Пересчитать итоги».',
    };
    res.status(409).json({ error: result.reason, message: human[result.reason || ''] || 'Не удалось' });
    return;
  }
  res.json({ ok: true, rows: result.rows });
});

// Снять фиксацию. Нужна ровно для одного случая: зафиксировали раньше времени
// или с неверными сроками, и надо вернуть живой подсчёт.
router.post('/reopen', async (_req: Request, res: Response): Promise<void> => {
  await prisma.contest.update({ where: { id: CONTEST_ID }, data: { finalizedAt: null } });
  dropActivationsCache();
  console.log('[UGC-ADMIN] фиксация снята, конкурс снова считается вживую');
  res.json({ ok: true });
});

// ─────────────────────────── дисквалификация ───────────────────────────

router.post('/participants/:id/disqualify', async (req: Request, res: Response): Promise<void> => {
  const reason = String(req.body?.reason || '').trim().slice(0, 300);
  if (!reason) {
    // Причина обязательна: через неделю никто не вспомнит, за что сняли, а
    // объясняться с участником придётся.
    res.status(400).json({ error: 'reason_required', message: 'Укажите причину' });
    return;
  }
  const p = await prisma.participant.update({
    where: { id: String(req.params.id) },
    data: { disqualified: true, dqReason: reason },
  });
  console.log(`[UGC-ADMIN] дисквалифицирован ${p.email} (${p.code}): ${reason}`);
  res.json({ ok: true, participant: { id: p.id, disqualified: p.disqualified, dqReason: p.dqReason } });
});

router.post('/participants/:id/restore', async (req: Request, res: Response): Promise<void> => {
  const p = await prisma.participant.update({
    where: { id: String(req.params.id) },
    data: { disqualified: false, dqReason: null },
  });
  console.log(`[UGC-ADMIN] восстановлен ${p.email} (${p.code})`);
  res.json({ ok: true, participant: { id: p.id, disqualified: p.disqualified } });
});

// ─────────────────────────── ссылка для входа ───────────────────────────

/**
 * Выдать ссылку для входа тому, у кого не открывается Google. Ссылка
 * одноразовая и живёт трое суток; выданная ранее сразу перестаёт работать.
 * Отдаём её админу текстом, а не шлём письмом: почта на этой машине не
 * настроена, а WhatsApp у поддержки под рукой всегда.
 */
router.post('/participants/invite', async (req: Request, res: Response): Promise<void> => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    res.status(400).json({ error: 'bad_email', message: 'Проверьте адрес' });
    return;
  }

  const participant =
    (await prisma.participant.findUnique({ where: { email } })) ||
    (await prisma.participant.create({ data: { email, name: req.body?.name || null } }));

  const link = await issueInviteLink(participant.id);
  let mailed = false;
  if (req.body?.send === true && mailConfigured()) {
    try {
      await sendInviteMail(email, link);
      mailed = true;
    } catch (e) {
      console.error(`[UGC-ADMIN] письмо не ушло ${email}: ${(e as Error).message}`);
    }
  }

  console.log(`[UGC-ADMIN] выдана ссылка для входа ${email}${mailed ? ' (письмом)' : ''}`);
  res.json({ ok: true, email, mailed, mailAvailable: mailConfigured(), ...link });
});

router.post('/participants/:id/link', async (req: Request, res: Response): Promise<void> => {
  const p = await prisma.participant.findUnique({ where: { id: String(req.params.id) } });
  if (!p) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const link = await issueInviteLink(p.id);
  console.log(`[UGC-ADMIN] перевыдана ссылка для входа ${p.email}`);
  res.json({ ok: true, email: p.email, mailAvailable: mailConfigured(), ...link });
});

// ─────────────────────────── разбор накрутки ───────────────────────────

// GET /api/admin/contest/participants/:id/activity — по дням и по адресам.
// Отдаёт факты, а не приговор: у школы или общежития один внешний адрес на
// всех, и автоматический вывод «накрутка» снял бы с конкурса честного человека.
router.get('/participants/:id/activity', async (req: Request, res: Response): Promise<void> => {
  const [contest, participant] = await Promise.all([
    getContest(),
    prisma.participant.findUnique({ where: { id: String(req.params.id) } }),
  ]);

  if (!contest || !participant) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  if (!participant.code) {
    res.status(409).json({ error: 'no_code', message: 'У участника ещё нет промокода' });
    return;
  }

  const from = contest.startsAt.toISOString();
  const to = new Date(contest.endsAt.getTime() + 1000).toISOString();

  try {
    const detail = await fairyFetch<{
      bindings: number;
      daily: { date: string; bindings: number }[];
      ipStats: { withIp: number; distinctIps: number; topIps: { ip: string; count: number; firstAt: string; lastAt: string }[] };
    }>(
      '/api/admin/referrals/code/' + encodeURIComponent(participant.code),
      `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      'ugc-admin'
    );

    res.json({
      code: participant.code,
      // Для заголовка карточки: первая названная сеть — по ней человека и узнают.
      handle: participant.instagram || participant.tiktok || participant.telegram || participant.youtube,
      bindings: detail.bindings,
      daily: (detail.daily || []).filter((d) => d.bindings > 0),
      // Старые связки писались без адреса — «не знаем» и «один адрес» это
      // разное, поэтому показываем, у скольких активаций адрес вообще есть.
      ipStats: detail.ipStats || { withIp: 0, distinctIps: 0, topIps: [] },
    });
  } catch (e) {
    console.error(`[UGC-ADMIN] активность ${participant.code}: ${(e as Error).message}`);
    res.status(502).json({ error: 'upstream_error', message: (e as Error).message });
  }
});

// ─────────────────────────── выгрузка ───────────────────────────

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// GET /api/admin/contest/export — список для выплат.
router.get('/export', async (_req: Request, res: Response): Promise<void> => {
  const contest = await getContest();
  if (!contest) {
    res.status(404).json({ error: 'no_contest' });
    return;
  }

  const [standings, participants] = await Promise.all([
    getStandings(contest),
    prisma.participant.findMany(),
  ]);
  const byId = new Map(standings.rows.map((r) => [r.participantId, r]));

  const header = ['Место', 'Приз, ₸', 'Активации', 'Допущен', 'Код', 'Имя', 'Instagram', 'TikTok', 'Telegram', 'YouTube', 'Телефон', 'E-mail', 'Дисквалифицирован', 'Причина'];
  const lines = [header.join(';')];

  const sorted = participants
    .map((p) => ({ p, s: byId.get(p.id) }))
    .sort((a, b) => (a.s?.rank || 1e9) - (b.s?.rank || 1e9));

  for (const { p, s } of sorted) {
    lines.push([
      s?.rank ?? '',
      s?.prizeAmount ?? '',
      s?.activations ?? 0,
      s?.qualified ? 'да' : 'нет',
      p.code ?? '',
      p.name ?? '',
      p.instagram ?? '',
      p.tiktok ?? '',
      p.telegram ?? '',
      p.youtube ?? '',
      p.phone ?? '',
      p.email,
      p.disqualified ? 'да' : '',
      p.dqReason ?? '',
    ].map(csvCell).join(';'));
  }

  // BOM: без него Excel открывает кириллицу кракозябрами, а файл делается ради
  // того, чтобы его открыли в Excel.
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="ugc-${contest.id}.csv"`);
  res.send('﻿' + lines.join('\n'));
});

export default router;
