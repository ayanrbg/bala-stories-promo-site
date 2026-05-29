import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { PrismaClient, AppType } from '@prisma/client';
import { authenticateToken, requireRole } from '../middleware/auth';

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
  const { durationDays, code } = req.body;

  if (!durationDays || durationDays < 1) {
    res.status(400).json({ error: 'durationDays обязателен и должен быть >= 1' });
    return;
  }

  const promoCode = code || crypto.randomBytes(4).toString('hex').toUpperCase();

  const existing = await prisma.premiumPromo.findUnique({ where: { code: promoCode } });
  if (existing) {
    res.status(409).json({ error: 'Промокод с таким кодом уже существует' });
    return;
  }

  const promo = await prisma.premiumPromo.create({
    data: { code: promoCode, durationDays }
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

export default router;
