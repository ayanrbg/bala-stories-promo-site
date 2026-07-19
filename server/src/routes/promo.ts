import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireApiKey } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

router.use(requireApiKey);

// Check/apply promo code (unified endpoint)
router.post('/check', async (req: Request, res: Response): Promise<void> => {
  const { code, externalUserId, app } = req.body;

  if (!code) {
    res.status(400).json({ error: 'Код обязателен' });
    return;
  }

  const validApps = ['BALA_STORIES', 'ISLAMIC_TALES'];
  if (!app || !validApps.includes(app)) {
    res.status(400).json({ error: 'Поле app обязательно: BALA_STORIES или ISLAMIC_TALES' });
    return;
  }

  // Check if it's a blogger promo code
  const blogger = await prisma.blogger.findUnique({
    where: { promoCode: code }
  });

  if (blogger) {
    await prisma.promoUse.create({
      data: {
        bloggerId: blogger.id,
        action: 'ENTERED',
        app,
        externalUserId: externalUserId || null
      }
    });

    res.json({
      type: 'blogger',
      bloggerName: blogger.name
    });
    return;
  }

  // Check if it's a premium promo code
  const premiumPromo = await prisma.premiumPromo.findUnique({
    where: { code }
  });

  if (premiumPromo) {
    // Reusable codes (e.g. app-store review codes) can be redeemed unlimited
    // times and are never consumed. One-time codes keep the original behaviour.
    if (!premiumPromo.reusable) {
      if (premiumPromo.used) {
        res.status(410).json({ error: 'Промокод уже использован' });
        return;
      }

      await prisma.premiumPromo.update({
        where: { id: premiumPromo.id },
        data: {
          used: true,
          usedBy: externalUserId || null,
          usedAt: new Date()
        }
      });
    }

    res.json({
      type: 'premium',
      durationDays: premiumPromo.durationDays
    });
    return;
  }

  res.status(404).json({ error: 'Промокод не найден' });
});

// Record purchase for blogger promo code
router.post('/purchase', async (req: Request, res: Response): Promise<void> => {
  const { code, externalUserId, app } = req.body;

  if (!code) {
    res.status(400).json({ error: 'Код обязателен' });
    return;
  }

  const validApps = ['BALA_STORIES', 'ISLAMIC_TALES'];
  if (!app || !validApps.includes(app)) {
    res.status(400).json({ error: 'Поле app обязательно: BALA_STORIES или ISLAMIC_TALES' });
    return;
  }

  const blogger = await prisma.blogger.findUnique({
    where: { promoCode: code }
  });

  if (!blogger) {
    res.status(404).json({ error: 'Промокод блогера не найден' });
    return;
  }

  await prisma.promoUse.create({
    data: {
      bloggerId: blogger.id,
      action: 'PURCHASED',
      app,
      externalUserId: externalUserId || null
    }
  });

  res.json({ success: true });
});

export default router;
