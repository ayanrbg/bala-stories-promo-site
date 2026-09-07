import { PrismaClient, TgCampaign, TgParticipant } from '@prisma/client';
import { rulesOf } from './tgCampaign';

const prisma = new PrismaClient();

/**
 * Сколько у участника билетов и из чего они сложились.
 *
 * Правила берутся из кампании, а не из кода: состав билетов на старте не
 * определён, и включение «+5 за подписку» должно быть настройкой, а не деплоем.
 * Здесь только счёт — заполнение колонок (activatedAt, paidAt, channelOk) живёт
 * в синхронизации с Fairy и в проверке канала.
 */

export interface Tickets {
  tickets: number;
  breakdown: Record<string, number>;
}

export async function ticketsFor(campaign: TgCampaign, p: TgParticipant): Promise<Tickets> {
  const breakdown: Record<string, number> = {};

  // Без подтверждённой активации участия нет вообще: билет за подписку или за
  // друга у человека, который не поставил приложение, противоречил бы смыслу
  // кампании. Поэтому это не «одно из правил», а условие для всех остальных.
  if (!p.activatedAt || p.disqualified) return { tickets: 0, breakdown };

  for (const rule of rulesOf(campaign)) {
    if (!rule.enabled || rule.tickets <= 0) continue;

    if (rule.id === 'install') {
      breakdown.install = rule.tickets;
    } else if (rule.id === 'subscription') {
      if (p.paidAt) breakdown.subscription = rule.tickets;
    } else if (rule.id === 'channel') {
      if (p.channelOk) breakdown.channel = rule.tickets;
    } else if (rule.id === 'friend') {
      // Считаются только друзья, дошедшие до активации: иначе накрутка сводится
      // к заведению телеграм-аккаунтов, а установок приложения не прибавляется.
      const friends = await prisma.tgParticipant.count({
        where: { invitedById: p.id, activatedAt: { not: null }, disqualified: false },
      });
      const counted = rule.cap ? Math.min(friends, rule.cap) : friends;
      if (counted > 0) breakdown.friend = counted * rule.tickets;
    }
  }

  const tickets = Object.values(breakdown).reduce((sum, n) => sum + n, 0);
  return { tickets, breakdown };
}
