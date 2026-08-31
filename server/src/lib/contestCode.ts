import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

/**
 * Личный промокод участника конкурса.
 *
 * Четыре символа — решение заказчика: код диктуют голосом в видео и набирают
 * с телефона. Алфавит без 0 O 1 I L, иначе «ноль или буква О» станет самой
 * частой причиной «код не работает». 31^4 ≈ 923 000 комбинаций.
 *
 * Короткий код перебираем, и это лечится не длиной, а лимитом на стороне
 * Fairy (`/api/promo/check`): см. rateLimit в routes/promo.js.
 */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const LEN = 4;
const MAX_TRIES = 50;

/** Набор по умолчанию — как у действующих блогерских кодов, две сказки. */
const FALLBACK_TALES = ['baursak', 'magic_bird'];

function randomCode(): string {
  let out = '';
  for (let i = 0; i < LEN; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

/**
 * Код ищется в приложении в трёх местах, и ник блогера проверяется ПЕРВЫМ.
 * Поэтому мало проверить свою таблицу: совпадение с ником дало бы участнику
 * код, который «сработал», но не открыл ничего — а он бы этого не увидел.
 * Сравнение регистронезависимое, как и поиск в /api/promo/check.
 */
async function isTaken(code: string): Promise<boolean> {
  const where = { equals: code, mode: 'insensitive' as const };
  const [talePromo, premium, blogger, participant] = await Promise.all([
    prisma.talePromo.findFirst({ where: { code: where }, select: { id: true } }),
    prisma.premiumPromo.findFirst({ where: { code: where }, select: { id: true } }),
    prisma.blogger.findFirst({ where: { promoCode: where }, select: { id: true } }),
    prisma.participant.findFirst({ where: { code: where }, select: { id: true } }),
  ]);
  return !!(talePromo || premium || blogger || participant);
}

/**
 * Какие сказки открывает конкурсный код. Порядок: явная настройка → как у
 * действующих блогеров → запасной набор. Список можно поменять и потом:
 * сказки живут в TalePromo, а не в коде, поэтому смена набора не требует
 * перевыпуска уже розданных кодов.
 */
export async function contestTaleIds(): Promise<string[]> {
  const fromEnv = (process.env.CONTEST_TALE_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromEnv.length) return fromEnv;

  const newest = await prisma.talePromo.findFirst({
    where: { bloggerId: { not: null }, taleIds: { isEmpty: false } },
    orderBy: { createdAt: 'desc' },
    select: { taleIds: true },
  });
  return newest?.taleIds?.length ? newest.taleIds : FALLBACK_TALES;
}

export interface IssuedCode {
  code: string;
  talePromoId: string;
}

/**
 * Выдать участнику код. Идемпотентно: код выдаётся один раз и не меняется —
 * его уже назвали в опубликованных видео.
 */
export async function issueCodeFor(participantId: string): Promise<IssuedCode> {
  const existing = await prisma.participant.findUnique({
    where: { id: participantId },
    select: { code: true, talePromoId: true },
  });
  if (!existing) throw new Error('participant_not_found');
  if (existing.code && existing.talePromoId) {
    return { code: existing.code, talePromoId: existing.talePromoId };
  }

  const taleIds = await contestTaleIds();

  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const code = randomCode();
    if (await isTaken(code)) continue;

    let promoId: string;
    try {
      const promo = await prisma.talePromo.create({
        data: {
          code,
          taleIds,
          app: 'BALA_STORIES',
          maxUses: null,                 // безлимит: чем больше активаций, тем лучше
          label: 'Конкурс UGC',
          bloggerId: null,
        },
        select: { id: true },
      });
      promoId = promo.id;
    } catch {
      // Гонка генератора упирается в UNIQUE — берём следующий код.
      continue;
    }

    // Второй участник мог получить код в параллельном запросе. Условие
    // `code: null` и есть защита: обновится ноль строк, и мы уберём лишний промо.
    const claimed = await prisma.participant.updateMany({
      where: { id: participantId, code: null },
      data: { code, talePromoId: promoId, codeIssuedAt: new Date() },
    });

    if (claimed.count === 1) {
      console.log(`[UGC] выдан код ${code} участнику ${participantId} сказки=[${taleIds.join(', ')}]`);
      return { code, talePromoId: promoId };
    }

    await prisma.talePromo.delete({ where: { id: promoId } }).catch(() => undefined);
    const winner = await prisma.participant.findUnique({
      where: { id: participantId },
      select: { code: true, talePromoId: true },
    });
    if (winner?.code && winner.talePromoId) {
      return { code: winner.code, talePromoId: winner.talePromoId };
    }
  }

  throw new Error('code_generation_failed');
}
