import { PrismaClient, TgCampaign } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

/**
 * Личный промокод участника розыгрыша.
 *
 * Четыре символа — решение заказчика, как и на конкурсе. Но здесь кодов будет
 * не сотни, а тысячи, и это меняет арифметику перебора: 31^4 ≈ 923 000, поэтому
 * на 10 000 выданных кодов случайные четыре символа попадают в живой код примерно
 * раз на сто попыток. Отсюда две меры прямо здесь:
 *   1) у кода есть срок — он гаснет вместе с кампанией (expiresAt);
 *   2) набор сказок у кампании отдельный и маленький.
 * Третья — лимит на перебор — стоит в Fairy (services/promoGuard.js).
 * Подробности и порог перехода на 5 символов: DEV_PLAN_TG_BOT_RAFFLE.md §4.2.
 */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const LEN = 4;
const MAX_TRIES = 50;

/** Тот же запасной набор, что у конкурсных кодов. */
const FALLBACK_TALES = ['baursak', 'magic_bird'];

function randomCode(): string {
  let out = '';
  for (let i = 0; i < LEN; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

/**
 * Пять таблиц, а не четыре, как у конкурса: кампании идут одновременно и коды у
 * них одной длины в одной базе. Выданный дубль конкурсного кода отправил бы
 * активации зрителя в чужой рейтинг, где разыгрываются деньги.
 *
 * Ник блогера проверяется в Fairy ПЕРВЫМ, поэтому совпадение с ником дало бы
 * человеку код, который «сработал», но не открыл ничего.
 */
async function isTaken(code: string): Promise<boolean> {
  const where = { equals: code, mode: 'insensitive' as const };
  const [talePromo, premium, blogger, participant, tgParticipant] = await Promise.all([
    prisma.talePromo.findFirst({ where: { code: where }, select: { id: true } }),
    prisma.premiumPromo.findFirst({ where: { code: where }, select: { id: true } }),
    prisma.blogger.findFirst({ where: { promoCode: where }, select: { id: true } }),
    prisma.participant.findFirst({ where: { code: where }, select: { id: true } }),
    prisma.tgParticipant.findFirst({ where: { code: where }, select: { id: true } }),
  ]);
  return !!(talePromo || premium || blogger || participant || tgParticipant);
}

/**
 * Какие сказки открывает код розыгрыша. Лестница: настройка кампании → env →
 * как у действующих блогеров → запасной набор. Набор живёт в TalePromo, поэтому
 * его смена не требует перевыпуска уже розданных кодов.
 */
export async function campaignTaleIds(campaign: TgCampaign): Promise<string[]> {
  if (campaign.taleIds?.length) return campaign.taleIds;

  const fromEnv = (process.env.TG_TALE_IDS || '')
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
 * Выдать участнику код. Идемпотентно: повторное «Участвовать» возвращает тот же
 * код, а не заводит второй — человек уже мог записать его или ввести.
 */
export async function issueCodeFor(participantId: string, campaign: TgCampaign): Promise<IssuedCode> {
  const existing = await prisma.tgParticipant.findUnique({
    where: { id: participantId },
    select: { code: true, talePromoId: true },
  });
  if (!existing) throw new Error('participant_not_found');
  if (existing.code && existing.talePromoId) {
    return { code: existing.code, talePromoId: existing.talePromoId };
  }

  const taleIds = await campaignTaleIds(campaign);

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
          // Безлимит по использованиям: ожидается одна активация, но
          // переустановка приложения не должна упираться в «код исчерпан».
          maxUses: null,
          label: `Розыгрыш ${campaign.id}`,
          bloggerId: null,
          // Код гаснет вместе с кампанией: после неё четырёхзначное пространство
          // освобождается, и подбор чужого кода перестаёт открывать платное.
          expiresAt: campaign.endsAt,
        },
        select: { id: true },
      });
      promoId = promo.id;
    } catch {
      // Гонка генератора упирается в UNIQUE — берём следующий код.
      continue;
    }

    // Параллельное «Участвовать» из двух чатов: условие `code: null` и есть
    // защита — обновится ноль строк, и мы уберём лишний промо.
    const claimed = await prisma.tgParticipant.updateMany({
      where: { id: participantId, code: null },
      data: { code, talePromoId: promoId, codeIssuedAt: new Date() },
    });

    if (claimed.count === 1) {
      console.log(`[TG] выдан код ${code} участнику ${participantId} сказки=[${taleIds.join(', ')}]`);
      return { code, talePromoId: promoId };
    }

    await prisma.talePromo.delete({ where: { id: promoId } }).catch(() => undefined);
    const winner = await prisma.tgParticipant.findUnique({
      where: { id: participantId },
      select: { code: true, talePromoId: true },
    });
    if (winner?.code && winner.talePromoId) {
      return { code: winner.code, talePromoId: winner.talePromoId };
    }
  }

  throw new Error('code_generation_failed');
}
