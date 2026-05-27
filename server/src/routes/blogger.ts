import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, requireRole } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

router.use(authenticateToken, requireRole('blogger'));

// Get blogger profile
router.get('/me', async (req: Request, res: Response): Promise<void> => {
  const blogger = await prisma.blogger.findUnique({
    where: { id: req.user!.id }
  });

  if (!blogger) {
    res.status(404).json({ error: 'Блогер не найден' });
    return;
  }

  res.json({
    id: blogger.id,
    name: blogger.name,
    login: blogger.login,
    promoCode: blogger.promoCode,
    createdAt: blogger.createdAt
  });
});

// Get blogger stats
router.get('/stats', async (req: Request, res: Response): Promise<void> => {
  const blogger = await prisma.blogger.findUnique({
    where: { id: req.user!.id }
  });

  if (!blogger) {
    res.status(404).json({ error: 'Блогер не найден' });
    return;
  }

  const [entered, purchased] = await Promise.all([
    prisma.promoUse.count({ where: { bloggerId: blogger.id, action: 'ENTERED' } }),
    prisma.promoUse.count({ where: { bloggerId: blogger.id, action: 'PURCHASED' } }),
  ]);

  // Stats by day (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const dailyStats = await prisma.promoUse.groupBy({
    by: ['action', 'createdAt'],
    where: {
      bloggerId: blogger.id,
      createdAt: { gte: thirtyDaysAgo }
    },
    _count: true
  });

  // Aggregate by date string
  const byDay: Record<string, { entered: number; purchased: number }> = {};
  for (const stat of dailyStats) {
    const day = stat.createdAt.toISOString().split('T')[0];
    if (!byDay[day]) byDay[day] = { entered: 0, purchased: 0 };
    if (stat.action === 'ENTERED') byDay[day].entered += stat._count;
    else byDay[day].purchased += stat._count;
  }

  const daily = Object.entries(byDay)
    .map(([date, counts]) => ({ date, ...counts }))
    .sort((a, b) => a.date.localeCompare(b.date));

  res.json({
    totalEntered: entered,
    totalPurchased: purchased,
    conversion: entered > 0 ? Math.round((purchased / entered) * 100) : 0,
    daily
  });
});

export default router;
