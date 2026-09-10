import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface ReferralRules {
  attributionDays: number | null;
  showRenewals: boolean;
}

const DEFAULTS: ReferralRules = { attributionDays: null, showRenewals: false };

/** Настройки награждения. Строки ещё нет — действуют умолчания, не ошибка. */
export async function getReferralRules(): Promise<ReferralRules> {
  const row = await prisma.referralSettings.findUnique({ where: { id: 'default' } });
  if (!row) return { ...DEFAULTS };
  return { attributionDays: row.attributionDays, showRenewals: row.showRenewals };
}

/**
 * Параметры отчёта для Fairy. Правило живёт здесь, а факты — там; поэтому
 * смена окна атрибуции пересчитывает и прошлые месяцы, ничего не мигрируя.
 * `extra` добавляет фильтры вызывающего (bloggerId, from, to).
 */
export async function referralQuery(extra: Record<string, string | undefined> = {}): Promise<string> {
  const rules = await getReferralRules();
  const q = new URLSearchParams();
  if (rules.attributionDays != null) q.set('attributionDays', String(rules.attributionDays));
  if (rules.showRenewals) q.set('includeRenewals', 'true');
  for (const [k, v] of Object.entries(extra)) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}
