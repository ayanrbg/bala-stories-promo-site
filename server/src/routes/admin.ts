import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { PrismaClient, AppType } from '@prisma/client';
import { authenticateToken, requireRole } from '../middleware/auth';
import { fairyProxy } from '../lib/fairyProxy';
import { referralQuery } from '../lib/referralSettings';

const router = Router();
const prisma = new PrismaClient();

router.use(authenticateToken, requireRole('admin'));

// Get all bloggers with stats
router.get('/bloggers', async (_req: Request, res: Response): Promise<void> => {
  const bloggers = await prisma.blogger.findMany({
    include: {
      promoUses: {
        select: { action: true, app: true }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  const result = bloggers.map(b => {
    const entered = b.promoUses.filter(u => u.action === 'ENTERED').length;
    const purchased = b.promoUses.filter(u => u.action === 'PURCHASED').length;

    // Per-app stats
    const appStats: Record<string, { entered: number; purchased: number }> = {};
    for (const u of b.promoUses) {
      if (!appStats[u.app]) appStats[u.app] = { entered: 0, purchased: 0 };
      if (u.action === 'ENTERED') appStats[u.app].entered++;
      else appStats[u.app].purchased++;
    }

    return {
      id: b.id,
      login: b.login,
      name: b.name,
      promoCode: b.promoCode,
      apps: b.apps,
      entered,
      purchased,
      conversion: entered > 0 ? Math.round((purchased / entered) * 100) : 0,
      appStats,
      createdAt: b.createdAt
    };
  });

  res.json(result);
});

// Create blogger
router.post('/bloggers', async (req: Request, res: Response): Promise<void> => {
  const { name, login, password, promoCode, apps } = req.body;

  if (!name || !login || !password || !promoCode) {
    res.status(400).json({ error: 'Все поля обязательны: name, login, password, promoCode' });
    return;
  }

  const validApps: AppType[] = ['BALA_STORIES', 'ISLAMIC_TALES'];
  const bloggerApps: AppType[] = Array.isArray(apps) && apps.length > 0
    ? apps.filter((a: string) => validApps.includes(a as AppType)) as AppType[]
    : ['BALA_STORIES'];

  if (bloggerApps.length === 0) {
    res.status(400).json({ error: 'Нужно выбрать хотя бы одно приложение' });
    return;
  }

  const existing = await prisma.blogger.findFirst({
    where: { OR: [{ login }, { promoCode }] }
  });

  if (existing) {
    res.status(409).json({ error: 'Блогер с таким логином или промокодом уже существует' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const blogger = await prisma.blogger.create({
    data: { name, login, passwordHash, promoCode, apps: bloggerApps }
  });

  res.status(201).json({
    id: blogger.id,
    name: blogger.name,
    login: blogger.login,
    promoCode: blogger.promoCode,
    apps: blogger.apps,
    createdAt: blogger.createdAt
  });
});

// Delete blogger
router.delete('/bloggers/:id', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    await prisma.blogger.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: 'Блогер не найден' });
  }
});

// Overall stats
router.get('/stats', async (_req: Request, res: Response): Promise<void> => {
  const [totalBloggers, entered, purchased] = await Promise.all([
    prisma.blogger.count(),
    prisma.promoUse.count({ where: { action: 'ENTERED' } }),
    prisma.promoUse.count({ where: { action: 'PURCHASED' } }),
  ]);

  // Per-app stats
  const appStatsRaw = await prisma.promoUse.groupBy({
    by: ['app', 'action'],
    _count: true
  });

  const appStats: Record<string, { entered: number; purchased: number; conversion: number }> = {};
  for (const row of appStatsRaw) {
    if (!appStats[row.app]) appStats[row.app] = { entered: 0, purchased: 0, conversion: 0 };
    if (row.action === 'ENTERED') appStats[row.app].entered = row._count;
    else appStats[row.app].purchased = row._count;
  }
  for (const app of Object.keys(appStats)) {
    const s = appStats[app];
    s.conversion = s.entered > 0 ? Math.round((s.purchased / s.entered) * 100) : 0;
  }

  res.json({
    totalBloggers,
    totalEntered: entered,
    totalPurchased: purchased,
    conversion: entered > 0 ? Math.round((purchased / entered) * 100) : 0,
    appStats
  });
});

// Create premium promo
router.post('/premium-promos', async (req: Request, res: Response): Promise<void> => {
  const { durationDays, code, label, reusable } = req.body;

  if (!durationDays || durationDays < 1) {
    res.status(400).json({ error: 'durationDays обязателен и должен быть >= 1' });
    return;
  }

  // maxUses: reusable (reviewer) code => null (unlimited); otherwise a positive cap
  // (defaults to 1 = single-use, backward compatible). `reusable: true` wins.
  let maxUses: number | null;
  if (reusable === true) {
    maxUses = null;
  } else if (req.body.maxUses != null) {
    const n = parseInt(req.body.maxUses, 10);
    if (!Number.isInteger(n) || n < 1) {
      res.status(400).json({ error: 'maxUses должен быть целым >= 1' });
      return;
    }
    maxUses = n;
  } else {
    maxUses = 1;
  }

  // Reusable codes are auto-generated longer & harder to guess (kept secret in-panel).
  const autoBytes = maxUses === null ? 12 : 4;
  const promoCode = code || crypto.randomBytes(autoBytes).toString('hex').toUpperCase();

  const existing = await prisma.premiumPromo.findUnique({ where: { code: promoCode } });
  if (existing) {
    res.status(409).json({ error: 'Промокод с таким кодом уже существует' });
    return;
  }

  const promo = await prisma.premiumPromo.create({
    data: { code: promoCode, durationDays, maxUses, label: label || null }
  });

  res.status(201).json(promo);
});

// List premium promos
router.get('/premium-promos', async (_req: Request, res: Response): Promise<void> => {
  const promos = await prisma.premiumPromo.findMany({
    orderBy: { createdAt: 'desc' }
  });
  res.json(promos);
});

// Delete premium promo
router.delete('/premium-promos/:id', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    await prisma.premiumPromo.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: 'Промокод не найден' });
  }
});

// ─────────────────── Промокоды на сказки (реферальные) ───────────────────

// Казахстан живёт без перехода на летнее время, поэтому сдвиг один и навсегда.
const ALMATY_OFFSET_MS = 5 * 60 * 60 * 1000;

/**
 * Срок действия кода из тела запроса. Пусто/null = бессрочно (так у всех кодов,
 * заведённых до появления колонки).
 *
 * Голая дата «2026-09-30» означает «действует по 30 сентября включительно»:
 * админ вводит последний рабочий день, а не момент отключения. Поэтому она
 * разворачивается в конец этого дня по Алматы, а не в его полночь UTC — иначе
 * код умирал бы за пять часов до начала обещанного дня.
 *
 * @returns Date | null — разобранное значение, либо undefined при ошибке
 */
function parseExpiresAt(raw: unknown): Date | null | undefined {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  if (!s) return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s)
    ? new Date(Date.parse(s + 'T23:59:59.999Z') - ALMATY_OFFSET_MS)
    : new Date(s);
  return isNaN(d.getTime()) ? undefined : d;
}

// List tale promos
router.get('/tale-promos', async (_req: Request, res: Response): Promise<void> => {
  const promos = await prisma.talePromo.findMany({
    include: { blogger: { select: { id: true, name: true } }, _count: { select: { uses: true } } },
    orderBy: { createdAt: 'desc' }
  });

  res.json(promos.map(p => ({
    id: p.id,
    code: p.code,
    label: p.label,
    taleIds: p.taleIds,
    app: p.app,
    maxUses: p.maxUses,
    useCount: p.useCount,
    uniqueUsers: p._count.uses,
    bloggerId: p.bloggerId,
    bloggerName: p.blogger ? p.blogger.name : null,
    expiresAt: p.expiresAt,
    // Считает сервер, а не таблица в браузере: у админа могут быть свои часы
    // и своя зона, и «истёк ли» должно решаться там же, где решается ввод кода.
    expired: !!p.expiresAt && p.expiresAt.getTime() <= Date.now(),
    createdAt: p.createdAt
  })));
});

// Create tale promo
router.post('/tale-promos', async (req: Request, res: Response): Promise<void> => {
  const { code, label, bloggerId, app } = req.body;

  // Слаги приходят галочками из реального каталога Fairy. Руками их не вводят:
  // опечатка дала бы код, который «сработал», но не открыл ничего.
  const taleIds: string[] = Array.isArray(req.body.taleIds)
    ? Array.from(new Set(req.body.taleIds.map((t: unknown) => String(t)).filter(Boolean)))
    : [];

  if (taleIds.length === 0) {
    res.status(400).json({ error: 'Выберите хотя бы одну сказку' });
    return;
  }

  let maxUses: number | null = null;
  if (req.body.maxUses != null && req.body.maxUses !== '') {
    const n = parseInt(req.body.maxUses, 10);
    if (!Number.isInteger(n) || n < 1) {
      res.status(400).json({ error: 'Лимит вводов должен быть целым >= 1' });
      return;
    }
    maxUses = n;
  }

  const expiresAt = parseExpiresAt(req.body.expiresAt);
  if (expiresAt === undefined) {
    res.status(400).json({ error: 'Неверная дата окончания' });
    return;
  }

  const validApps: AppType[] = ['BALA_STORIES', 'ISLAMIC_TALES'];
  const promoApp: AppType = validApps.includes(app as AppType) ? (app as AppType) : 'BALA_STORIES';

  if (bloggerId) {
    const blogger = await prisma.blogger.findUnique({ where: { id: String(bloggerId) } });
    if (!blogger) {
      res.status(404).json({ error: 'Блогер не найден' });
      return;
    }
  }

  const promoCode = (code && String(code).trim())
    || crypto.randomBytes(4).toString('hex').toUpperCase();

  // Код один на все виды промокодов: /check ищет его во всех трёх таблицах, и
  // совпадение с чужим сделало бы поведение зависящим от порядка проверок.
  const [taleClash, premiumClash, bloggerClash] = await Promise.all([
    prisma.talePromo.findUnique({ where: { code: promoCode } }),
    prisma.premiumPromo.findUnique({ where: { code: promoCode } }),
    prisma.blogger.findUnique({ where: { promoCode } }),
  ]);
  if (taleClash || premiumClash || bloggerClash) {
    res.status(409).json({ error: 'Такой промокод уже существует' });
    return;
  }

  const promo = await prisma.talePromo.create({
    data: {
      code: promoCode,
      label: label || null,
      taleIds,
      bloggerId: bloggerId ? String(bloggerId) : null,
      app: promoApp,
      maxUses,
      expiresAt
    },
    include: { blogger: { select: { name: true } } }
  });

  res.status(201).json({ ...promo, bloggerName: promo.blogger ? promo.blogger.name : null });
});

// Update tale promo (набор сказок, лимит и срок меняются, код — нет: он уже роздан)
router.patch('/tale-promos/:id', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const data: {
    taleIds?: string[]; label?: string | null; maxUses?: number | null;
    bloggerId?: string | null; expiresAt?: Date | null;
  } = {};

  if (Array.isArray(req.body.taleIds)) {
    const taleIds: string[] = Array.from(new Set(req.body.taleIds.map((t: unknown) => String(t)).filter(Boolean)));
    if (taleIds.length === 0) {
      res.status(400).json({ error: 'Выберите хотя бы одну сказку' });
      return;
    }
    data.taleIds = taleIds;
  }
  if (req.body.label !== undefined) data.label = req.body.label || null;
  if (req.body.bloggerId !== undefined) data.bloggerId = req.body.bloggerId || null;
  if (req.body.maxUses !== undefined) {
    if (req.body.maxUses == null || req.body.maxUses === '') data.maxUses = null;
    else {
      const n = parseInt(req.body.maxUses, 10);
      if (!Number.isInteger(n) || n < 1) {
        res.status(400).json({ error: 'Лимит вводов должен быть целым >= 1' });
        return;
      }
      data.maxUses = n;
    }
  }
  if (req.body.expiresAt !== undefined) {
    const d = parseExpiresAt(req.body.expiresAt);
    if (d === undefined) {
      res.status(400).json({ error: 'Неверная дата окончания' });
      return;
    }
    data.expiresAt = d;
  }

  try {
    const promo = await prisma.talePromo.update({ where: { id: req.params.id }, data });
    res.json(promo);
  } catch {
    res.status(404).json({ error: 'Промокод не найден' });
  }
});

// Delete tale promo. Связки и уже открытые сказки живут в Fairy и остаются:
// человек не должен терять подарок оттого, что код убрали из админки.
router.delete('/tale-promos/:id', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    await prisma.talePromo.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: 'Промокод не найден' });
  }
});

// ─────────────────── Настройки рефералки ───────────────────

router.get('/referral-settings', async (_req: Request, res: Response): Promise<void> => {
  const row = await prisma.referralSettings.findUnique({ where: { id: 'default' } });
  res.json({
    attributionDays: row ? row.attributionDays : null,
    showRenewals: row ? row.showRenewals : false,
    updatedAt: row ? row.updatedAt : null
  });
});

router.put('/referral-settings', async (req: Request, res: Response): Promise<void> => {
  let attributionDays: number | null = null;
  if (req.body.attributionDays != null && req.body.attributionDays !== '') {
    const n = parseInt(req.body.attributionDays, 10);
    if (!Number.isInteger(n) || n < 0) {
      res.status(400).json({ error: 'Окно атрибуции — целое число дней (пусто = бессрочно)' });
      return;
    }
    attributionDays = n;
  }
  const showRenewals = req.body.showRenewals === true;

  const row = await prisma.referralSettings.upsert({
    where: { id: 'default' },
    create: { id: 'default', attributionDays, showRenewals },
    update: { attributionDays, showRenewals }
  });
  res.json(row);
});

// Сводка по рефералке. Считает Fairy — он один знает про настоящие оплаты;
// правило (окно, продления) подставляем отсюда, из настроек.
router.get('/referrals', async (req: Request, res: Response): Promise<void> => {
  const query = await referralQuery({
    bloggerId: req.query.bloggerId as string | undefined,
    from: req.query.from as string | undefined,
    to: req.query.to as string | undefined,
  });
  fairyProxy(req, res, '/api/admin/referrals/summary', query);
});

// Разбор жалобы: чья связка, какие оплаты, какие сказки открыты.
router.get('/referrals/user/:userId', (req: Request<{ userId: string }>, res: Response): void => {
  fairyProxy(req, res, `/api/admin/referrals/user/${encodeURIComponent(req.params.userId)}`, '');
});

// Снять ошибочную связку (поддержка).
router.delete('/referrals/user/:userId', (req: Request<{ userId: string }>, res: Response): void => {
  fairyProxy(req, res, `/api/admin/referrals/${encodeURIComponent(req.params.userId)}`, '');
});

export default router;
