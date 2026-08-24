import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { fairyFetch } from '../lib/fairyProxy';
import { referralQuery } from '../lib/referralSettings';

/**
 * Витрина промокодов блогеров — открыта, логина нет. Отсюда три правила, и все
 * три держатся здесь, а не в вёрстке:
 *
 * 1. Ни одного поля, которого не должен видеть посторонний. Никаких логинов,
 *    externalUserId и транзакций: разрез по коду в Fairy их и не отдаёт, а всё
 *    остальное собирается тут по именам полей, а не пересылается целиком.
 * 2. Денег нет. Пользователь выбрал показывать только счётчики; выручка и доли
 *    остаются в закрытой части админки.
 * 3. Частоту запросов задаёт улица, а не админ, — поэтому кэш и лимит.
 */

const router = Router();
const prisma = new PrismaClient();

const APP = 'BALA_STORIES' as const;

// ─────────────────────────── лимит и кэш ───────────────────────────

const WINDOW_MS = 60_000;
const MAX_HITS = 60;
const hits = new Map<string, { n: number; reset: number }>();

function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const now = Date.now();
  const ip = String(req.headers['x-real-ip'] || req.ip || 'unknown');
  const cur = hits.get(ip);

  if (!cur || cur.reset <= now) {
    hits.set(ip, { n: 1, reset: now + WINDOW_MS });
  } else {
    cur.n += 1;
    if (cur.n > MAX_HITS) {
      res.status(429).json({ error: 'too_many_requests' });
      return;
    }
  }

  // Карта чистится по ходу дела: отдельный таймер держал бы процесс живым
  // ради мусора, а без уборки словарь растёт на каждый новый адрес.
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }
  next();
}

const CACHE_TTL_MS = 60_000;
const CATALOG_TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; ttl: number; p: Promise<unknown> }>();

/**
 * Кэшируется обещание, а не результат: десять человек, открывших страницу
 * одновременно, дают один поход в Fairy, а не десять. Упавшее обещание из
 * кэша выбрасывается, иначе ошибка залипла бы на минуту.
 */
function cached<T>(key: string, ttl: number, build: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < hit.ttl) return hit.p as Promise<T>;

  const p = build().catch((e) => {
    cache.delete(key);
    throw e;
  });
  cache.set(key, { at: now, ttl, p });

  if (cache.size > 200) {
    for (const [k, v] of cache) if (now - v.at > v.ttl) cache.delete(k);
  }
  return p;
}

// ─────────────────────────── общее ───────────────────────────

interface CodeStat {
  code: string;
  bloggerId: string | null;
  bloggerName: string | null;
  bindings: number;
  initial: number;
  renewals: number;
  counted: number;
  conversion: number;
  firstBindAt: string | null;
  lastBindAt: string | null;
  lastPaymentAt: string | null;
}

/** Дата из адреса. Мусор молча игнорируется: период — не то, из-за чего стоит отказывать в странице. */
function parseDate(v: unknown): string | undefined {
  if (typeof v !== 'string' || !v) return undefined;
  const d = new Date(v);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}

function range(from?: string, to?: string): { gte?: Date; lt?: Date } | undefined {
  if (!from && !to) return undefined;
  const r: { gte?: Date; lt?: Date } = {};
  if (from) r.gte = new Date(from);
  if (to) r.lt = new Date(to);
  return r;
}

/** Слаг → название сказки. Каталог меняется редко, поэтому отдельный TTL. */
function taleTitles(): Promise<Record<string, string>> {
  return cached('catalog', CATALOG_TTL_MS, async () => {
    const tales = await fairyFetch<Array<{ id: string; titles?: Record<string, string> }>>('/api/admin/tales');
    const map: Record<string, string> = {};
    for (const t of tales || []) {
      const titles = t.titles || {};
      map[t.id] = titles.ru || titles.kk || titles.en || Object.values(titles)[0] || t.id;
    }
    return map;
  });
}

// ─────────────────────────── список кодов ───────────────────────────

async function buildList(from?: string, to?: string): Promise<unknown> {
  const query = await referralQuery({ from, to });
  const when = range(from, to);

  const [promos, bloggers, stats, titles, entered, mirrored, legacyPaid] = await Promise.all([
    // Только коды, за которыми стоит блогер. Витрина называется «промокоды
    // блогеров»: служебные и тестовые коды без владельца ей не принадлежат, и
    // объяснять постороннему строку «без блогера» пришлось бы зря.
    prisma.talePromo.findMany({
      where: { app: APP, bloggerId: { not: null } },
      include: { blogger: { select: { id: true, name: true } }, _count: { select: { uses: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.blogger.findMany({ orderBy: { createdAt: 'asc' } }),
    fairyFetch<{ attributionDays: number | null; includeRenewals: boolean; codes: CodeStat[] }>(
      '/api/admin/referrals/by-code', query
    ),
    taleTitles(),
    prisma.promoUse.groupBy({
      by: ['bloggerId'],
      where: { app: APP, action: 'ENTERED', ...(when ? { createdAt: when } : {}) },
      _count: { _all: true },
    }),
    prisma.talePromoUse.groupBy({
      by: ['promoId'],
      where: { app: APP, ...(when ? { createdAt: when } : {}) },
      _count: { _all: true },
    }),
    // Оплаты без transactionId пришли от старого клиента, то есть по обычному
    // коду блогера. С transactionId — серверная атрибуция Fairy, она про коды
    // на сказки и уже посчитана в их собственных строках.
    prisma.promoUse.groupBy({
      by: ['bloggerId'],
      where: { app: APP, action: 'PURCHASED', transactionId: null, ...(when ? { createdAt: when } : {}) },
      _count: { _all: true },
    }),
  ]);

  const byCode = new Map(stats.codes.map((c) => [c.code, c]));
  const promoBlogger = new Map(promos.map((p) => [p.id, p.bloggerId]));

  // Вводы кодов на сказки зеркалятся в PromoUse ради старого кабинета блогера.
  // Если их не вычесть, обычный код блогера покажет чужие вводы как свои.
  const mirroredByBlogger = new Map<string, number>();
  for (const m of mirrored) {
    const bid = promoBlogger.get(m.promoId);
    if (bid) mirroredByBlogger.set(bid, (mirroredByBlogger.get(bid) || 0) + m._count._all);
  }

  const enteredByBlogger = new Map(entered.map((e) => [e.bloggerId, e._count._all]));
  const paidByBlogger = new Map(legacyPaid.map((e) => [e.bloggerId, e._count._all]));

  const taleRows = promos.map((p) => {
    const s = byCode.get(p.code);
    return {
      kind: 'tale' as const,
      code: p.code,
      label: p.label,
      bloggerId: p.bloggerId,
      bloggerName: p.blogger ? p.blogger.name : null,
      taleIds: p.taleIds,
      taleTitles: p.taleIds.map((id) => titles[id] || id),
      maxUses: p.maxUses,
      // Вводов по счётчику сайта — он гасит использования; привязки считает
      // Fairy. Расхождение видно глазом, и это не баг витрины.
      entered: p.useCount,
      users: p._count.uses,
      bindings: s ? s.bindings : 0,
      initial: s ? s.initial : 0,
      renewals: s ? s.renewals : 0,
      payments: s ? s.counted : 0,
      conversion: s ? s.conversion : 0,
      lastPaymentAt: s ? s.lastPaymentAt : null,
      createdAt: p.createdAt,
    };
  });

  const legacyRows = bloggers.map((b) => {
    const mine = Math.max(0, (enteredByBlogger.get(b.id) || 0) - (mirroredByBlogger.get(b.id) || 0));
    const paid = paidByBlogger.get(b.id) || 0;
    return {
      kind: 'legacy' as const,
      code: b.promoCode,
      label: null,
      bloggerId: b.id,
      bloggerName: b.name,
      taleIds: [] as string[],
      taleTitles: [] as string[],
      maxUses: null,
      entered: mine,
      users: null,
      bindings: null,
      initial: paid,
      renewals: 0,
      payments: paid,
      conversion: mine > 0 ? Math.round((paid / mine) * 100) : 0,
      lastPaymentAt: null,
      createdAt: b.createdAt,
    };
  });

  const rows = [...taleRows, ...legacyRows].sort((a, b) => {
    if (b.payments !== a.payments) return b.payments - a.payments;
    if (b.entered !== a.entered) return b.entered - a.entered;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  const totals = rows.reduce(
    (acc, r) => ({
      codes: acc.codes + 1,
      entered: acc.entered + r.entered,
      bindings: acc.bindings + (r.bindings || 0),
      payments: acc.payments + r.payments,
    }),
    { codes: 0, entered: 0, bindings: 0, payments: 0 }
  );

  return {
    updatedAt: new Date().toISOString(),
    attributionDays: stats.attributionDays,
    includeRenewals: stats.includeRenewals,
    from: from || null,
    to: to || null,
    totals,
    promos: rows,
  };
}

// ─────────────────────────── карточка кода ───────────────────────────

async function buildDetail(code: string, from?: string, to?: string): Promise<unknown> {
  const promo = await prisma.talePromo.findUnique({
    where: { code },
    include: { blogger: { select: { id: true, name: true } }, _count: { select: { uses: true } } },
  });

  // Условие то же, что в списке: чего нет на витрине, того нет и по прямой
  // ссылке — иначе фильтр списка был бы украшением, а не правилом.
  if (promo && promo.app === APP && promo.bloggerId) {
    const query = await referralQuery({ from, to });
    const [detail, titles] = await Promise.all([
      fairyFetch<Record<string, unknown>>(`/api/admin/referrals/code/${encodeURIComponent(code)}`, query),
      taleTitles(),
    ]);
    // Сначала цифры Fairy, потом наши поля: имя блогера и набор сказок знает
    // сайт, и пустой отчёт (кодом ещё не пользовались) не должен их затирать.
    return {
      kind: 'tale',
      ...detail,
      code: promo.code,
      label: promo.label,
      bloggerId: promo.bloggerId,
      bloggerName: promo.blogger ? promo.blogger.name : null,
      taleIds: promo.taleIds,
      taleTitles: promo.taleIds.map((id) => titles[id] || id),
      maxUses: promo.maxUses,
      entered: promo.useCount,
      users: promo._count.uses,
      createdAt: promo.createdAt,
    };
  }

  const blogger = await prisma.blogger.findUnique({ where: { promoCode: code } });
  if (!blogger) return null;

  const when = range(from, to);
  const uses = await prisma.promoUse.findMany({
    where: { bloggerId: blogger.id, app: APP, ...(when ? { createdAt: when } : {}) },
    select: { action: true, createdAt: true, transactionId: true },
    orderBy: { createdAt: 'asc' },
  });

  const byDay: Record<string, { bindings: number; initial: number; renewals: number }> = {};
  let paid = 0;
  for (const u of uses) {
    const day = u.createdAt.toISOString().slice(0, 10);
    if (!byDay[day]) byDay[day] = { bindings: 0, initial: 0, renewals: 0 };
    if (u.action === 'ENTERED') byDay[day].bindings += 1;
    else if (u.transactionId === null) {
      byDay[day].initial += 1;
      paid += 1;
    }
  }

  const enteredCount = uses.filter((u) => u.action === 'ENTERED').length;

  return {
    kind: 'legacy',
    code: blogger.promoCode,
    label: null,
    bloggerId: blogger.id,
    bloggerName: blogger.name,
    taleIds: [],
    taleTitles: [],
    maxUses: null,
    entered: enteredCount,
    users: null,
    createdAt: blogger.createdAt,
    bindings: null,
    initial: paid,
    renewals: 0,
    counted: paid,
    conversion: enteredCount > 0 ? Math.round((paid / enteredCount) * 100) : 0,
    payments: [],
    daily: Object.entries(byDay)
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    // Обычный код блогера считается по журналу вводов, у которого нет колонки
    // с кодом: вводы его кодов на сказки попали в тот же журнал. В списке они
    // вычтены оценкой, в карточке — нет, и врать про точность не стоит.
    note: 'Обычный код блогера: счётчики берутся из общего журнала вводов, поэтому включают вводы его же кодов на сказки.',
  };
}

// ─────────────────────────── маршруты ───────────────────────────

router.use(rateLimit);

router.get('/promos', async (req: Request, res: Response): Promise<void> => {
  const from = parseDate(req.query.from);
  const to = parseDate(req.query.to);
  try {
    res.json(await cached(`list:${from || ''}:${to || ''}`, CACHE_TTL_MS, () => buildList(from, to)));
  } catch (e: any) {
    console.error(`[PUBLIC] promos error: ${e && e.message}`);
    res.status(502).json({ error: 'upstream_error' });
  }
});

router.get('/promos/:code', async (req: Request<{ code: string }>, res: Response): Promise<void> => {
  const code = String(req.params.code).slice(0, 64);
  const from = parseDate(req.query.from);
  const to = parseDate(req.query.to);
  try {
    const data = await cached(`code:${code}:${from || ''}:${to || ''}`, CACHE_TTL_MS, () => buildDetail(code, from, to));
    if (!data) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(data);
  } catch (e: any) {
    console.error(`[PUBLIC] promo detail error: ${e && e.message}`);
    res.status(502).json({ error: 'upstream_error' });
  }
});

export default router;
