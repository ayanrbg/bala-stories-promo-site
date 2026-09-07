import { PrismaClient, TgCampaign } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Кампания розыгрыша: сроки, правила билетов, призы.
 *
 * Всё это лежит в базе, а не в коде, по той же причине, что и у конкурса: даты
 * сдвигаются, а призовая сетка на старте вообще не определена. Правка условий
 * не должна быть деплоем.
 */

export const CAMPAIGN_ID = process.env.TG_CAMPAIGN_ID || 'tg-2026-09';

/** Алматы без перехода на летнее время — тот же фиксированный сдвиг, что в админке. */
const ALMATY_OFFSET_MS = 5 * 60 * 60 * 1000;

export type RuleId = 'install' | 'subscription' | 'friend' | 'channel';

export interface TicketRule {
  id: RuleId;
  tickets: number;
  enabled: boolean;
  /** Только для `friend`: сколько друзей максимум засчитывается. */
  cap?: number;
}

export interface PrizeTier {
  tier: number;
  amount: number;
  count: number;
}

/** Правила по умолчанию — на случай пустого или испорченного JSON в базе. */
const DEFAULT_RULES: TicketRule[] = [
  { id: 'install', tickets: 1, enabled: true },
  { id: 'subscription', tickets: 5, enabled: false },
  { id: 'friend', tickets: 2, enabled: false, cap: 5 },
  { id: 'channel', tickets: 1, enabled: false },
];

export function getCampaign(): Promise<TgCampaign | null> {
  return prisma.tgCampaign.findUnique({ where: { id: CAMPAIGN_ID } });
}

/**
 * Правила билетов. Разбор терпимый: строка с опечаткой не должна валить бота —
 * человек в этот момент стоит перед экраном «Участвовать».
 */
export function rulesOf(campaign: TgCampaign): TicketRule[] {
  const raw = campaign.rules;
  if (!Array.isArray(raw)) return DEFAULT_RULES;

  const parsed: TicketRule[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const id = String(r.id || '') as RuleId;
    if (!DEFAULT_RULES.some((d) => d.id === id)) continue;
    parsed.push({
      id,
      tickets: Number(r.tickets) || 0,
      enabled: r.enabled === true,
      cap: r.cap == null ? undefined : Number(r.cap) || undefined,
    });
  }
  return parsed.length ? parsed : DEFAULT_RULES;
}

export function ruleOf(campaign: TgCampaign, id: RuleId): TicketRule | null {
  return rulesOf(campaign).find((r) => r.id === id && r.enabled) || null;
}

export function prizeTiers(campaign: TgCampaign): PrizeTier[] {
  const raw = campaign.prizeGrid;
  if (!Array.isArray(raw)) return [];

  const tiers: PrizeTier[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const t = item as Record<string, unknown>;
    const amount = Number(t.amount) || 0;
    const count = Number(t.count) || 0;
    if (amount <= 0 || count <= 0) continue;
    tiers.push({ tier: Number(t.tier) || tiers.length + 1, amount, count });
  }
  return tiers.sort((a, b) => b.amount - a.amount);
}

/** Фонд и число победителей считаются из сетки — второго списка быть не должно. */
export function prizeFund(campaign: TgCampaign): number {
  return prizeTiers(campaign).reduce((sum, t) => sum + t.amount * t.count, 0);
}

export function winnersTotal(campaign: TgCampaign): number {
  return prizeTiers(campaign).reduce((sum, t) => sum + t.count, 0);
}

export type CampaignPhase = 'before' | 'running' | 'ended';

export function phaseOf(campaign: TgCampaign, now = new Date()): CampaignPhase {
  if (now < campaign.startsAt) return 'before';
  if (now > campaign.endsAt) return 'ended';
  return 'running';
}

/** «210 000 ₸» — узкие пробелы, потому что обычные телефон переносит по строкам. */
export function money(amount: number): string {
  return `${amount.toLocaleString('ru-RU').replace(/ /g, ' ')} ₸`;
}

/** «16 сентября, 23:59» по Алматы. */
export function almatyDate(d: Date): string {
  const shifted = new Date(d.getTime() + ALMATY_OFFSET_MS);
  const months = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
  ];
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${shifted.getUTCDate()} ${months[shifted.getUTCMonth()]}, ${hh}:${mm}`;
}

/** «осталось 4 дня 6 часов» — счёт до конца кампании словами. */
export function timeLeft(campaign: TgCampaign, now = new Date()): string {
  const ms = campaign.endsAt.getTime() - now.getTime();
  if (ms <= 0) return 'розыгрыш завершён';

  const totalHours = Math.floor(ms / 3_600_000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days > 0) return `${days} ${plural(days, 'день', 'дня', 'дней')} ${hours} ${plural(hours, 'час', 'часа', 'часов')}`;
  if (hours > 0) return `${hours} ${plural(hours, 'час', 'часа', 'часов')}`;
  return `${Math.max(1, Math.floor(ms / 60_000))} мин`;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

/**
 * Кто видит бота до публикации. Это не «режим отладки на проде», а способ
 * прогнать всю воронку живьём до того, как названы призы и даты.
 */
export function isAdmin(tgUserId: string): boolean {
  return (process.env.TG_ADMIN_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(String(tgUserId));
}
