import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireApiKey } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

router.use(requireApiKey);

// Коды заводятся в админке в разном регистре (Bau01, Snezhana01), а диктуют их
// голосом и набирают с телефона, где первая буква норовит стать заглавной.
// Поэтому ищем без учёта регистра и обрамляющих пробелов: раньше BAU01 просто
// не находился. Уникальность в базе регистрозависимая, так что теоретическую
// пару «Bau01 / BAU01» разводим по дате — выигрывает заведённый первым.
const insensitive = (code: string) => ({ equals: code.trim(), mode: 'insensitive' as const });

// Check/apply promo code (unified endpoint)
router.post('/check', async (req: Request, res: Response): Promise<void> => {
  const { code, externalUserId, app, alreadyBound } = req.body;

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
  const blogger = await prisma.blogger.findFirst({
    where: { promoCode: insensitive(code) },
    orderBy: { createdAt: 'asc' }
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
  const premiumPromo = await prisma.premiumPromo.findFirst({
    where: { code: insensitive(code) },
    orderBy: { createdAt: 'asc' }
  });

  if (premiumPromo) {
    // Одним запросом: и проверка лимита, и инкремент. Раньше это были чтение и
    // запись по отдельности, и аудитория блогера, зашедшая пачкой, уводила
    // счётчик за maxUses.
    // maxUses null => unlimited (reusable reviewer code); otherwise cap by useCount.
    const taken = await prisma.$executeRaw`
      UPDATE "PremiumPromo"
         SET "useCount" = "useCount" + 1,
             "usedBy"   = ${externalUserId ? String(externalUserId) : null},
             "usedAt"   = now(),
             "used"     = CASE WHEN "maxUses" IS NULL THEN false
                               ELSE "useCount" + 1 >= "maxUses" END
       WHERE "id" = ${premiumPromo.id}
         AND ("maxUses" IS NULL OR "useCount" < "maxUses")`;

    if (taken === 0) {
      res.status(410).json({ error: 'Промокод уже использован' });
      return;
    }

    res.json({
      type: 'premium',
      durationDays: premiumPromo.durationDays
    });
    return;
  }

  // Реферальный промокод на сказки: открывает набор сказок и закрепляет
  // человека за блогером. Связку хранит Fairy — он один знает про оплаты.
  const talePromo = await prisma.talePromo.findFirst({
    where: { code: insensitive(code) },
    include: { blogger: true },
    orderBy: { createdAt: 'asc' }
  });

  if (talePromo) {
    if (talePromo.app !== app) {
      res.status(404).json({ error: 'Промокод не найден' });
      return;
    }

    const uid = externalUserId ? String(externalUserId) : null;

    // Fairy сообщает, что связка у человека уже занята. Решает сайт, потому что
    // счётчик использований его: иначе отказ 409 сжигал бы чужое использование.
    // Свой прошлый ввод этого же кода отсеивает Fairy, сюда он не доходит.
    if (alreadyBound) {
      res.status(409).json({ error: 'promo_already_used', message: 'Вы уже вводили промокод' });
      return;
    }

    const already = uid
      ? await prisma.talePromoUse.findUnique({
          where: { promoId_externalUserId: { promoId: talePromo.id, externalUserId: uid } }
        })
      : null;

    if (!already) {
      const taken = await prisma.$executeRaw`
        UPDATE "TalePromo" SET "useCount" = "useCount" + 1
         WHERE "id" = ${talePromo.id}
           AND ("maxUses" IS NULL OR "useCount" < "maxUses")`;

      if (taken === 0) {
        res.status(410).json({ error: 'code_exhausted', message: 'Промокод больше не действует' });
        return;
      }

      if (uid) {
        try {
          await prisma.talePromoUse.create({
            data: { promoId: talePromo.id, externalUserId: uid, app }
          });
        } catch {
          // Тот же человек ударил дважды одновременно — считаем ввод состоявшимся.
        }
      }

      // Зеркало для старого кабинета блогера: он считает вводы по PromoUse.
      if (talePromo.bloggerId) {
        await prisma.promoUse.create({
          data: { bloggerId: talePromo.bloggerId, action: 'ENTERED', app, externalUserId: uid }
        });
      }
    }

    res.json({
      type: 'tale',
      taleIds: talePromo.taleIds,
      bloggerId: talePromo.bloggerId,
      bloggerName: talePromo.blogger ? talePromo.blogger.name : null
    });
    return;
  }

  res.status(404).json({ error: 'Промокод не найден' });
});

// Record purchase for a promo code.
//
// Источников два. Fairy присылает сюда оплаты, которые видел сам (серверная
// атрибуция, с transactionId и kind) — это основной путь. Вышедшие сборки
// клиента продолжают дёргать этот маршрут для легаси-кодов блогеров.
router.post('/purchase', async (req: Request, res: Response): Promise<void> => {
  const { code, externalUserId, app, kind, transactionId } = req.body;

  if (!code) {
    res.status(400).json({ error: 'Код обязателен' });
    return;
  }

  const validApps = ['BALA_STORIES', 'ISLAMIC_TALES'];
  if (!app || !validApps.includes(app)) {
    res.status(400).json({ error: 'Поле app обязательно: BALA_STORIES или ISLAMIC_TALES' });
    return;
  }

  let bloggerId: string | null = null;

  const blogger = await prisma.blogger.findFirst({
    where: { promoCode: insensitive(code) },
    orderBy: { createdAt: 'asc' }
  });
  if (blogger) {
    bloggerId = blogger.id;
  } else {
    const talePromo = await prisma.talePromo.findFirst({
      where: { code: insensitive(code) },
      orderBy: { createdAt: 'asc' }
    });
    if (!talePromo) {
      res.status(404).json({ error: 'Промокод не найден' });
      return;
    }
    // Код без блогера награждать некого. Отвечаем успехом: событие принято,
    // и Fairy не будет вечно досылать то, что здесь никому не нужно.
    if (!talePromo.bloggerId) {
      res.json({ success: true, ignored: 'no_blogger' });
      return;
    }
    bloggerId = talePromo.bloggerId;
  }

  // Кабинет блогера показывает пока только первую оплату. Продления лежат в
  // Fairy и включаются переключателем в настройках — пересобирать их заново не
  // придётся. Приняли, но не записали — тоже успех, иначе досылка не кончится.
  if (kind && kind !== 'initial') {
    res.json({ success: true, ignored: 'renewal' });
    return;
  }

  try {
    await prisma.promoUse.create({
      data: {
        bloggerId,
        action: 'PURCHASED',
        app,
        externalUserId: externalUserId || null,
        transactionId: transactionId ? String(transactionId) : null
      }
    });
  } catch (e: any) {
    // Уникальность transactionId: повторная нотификация Apple или ретрай
    // доставки. Ровно то, ради чего колонка и заведена.
    if (e && e.code === 'P2002') {
      res.json({ success: true, deduped: true });
      return;
    }
    throw e;
  }

  res.json({ success: true });
});

export default router;
