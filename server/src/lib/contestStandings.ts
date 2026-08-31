import { PrismaClient, Contest } from '@prisma/client';
import { fairyFetch } from './fairyProxy';

const prisma = new PrismaClient();

/**
 * Рейтинг участников конкурса.
 *
 * Активации живут в Fairy: строка `referral_bindings` появляется, когда человек
 * ввёл код в приложении. Здесь мы их только спрашиваем за окно дат и склеиваем
 * с нашими участниками. Поэтому «сколько у кого активаций» — это вопрос к Fairy,
 * а «кто участник и на каком он месте» — к нам.
 *
 * После окончания конкурса всё меняется на противоположное: читается снимок
 * ContestResult, а Fairy не спрашивается вовсе. Иначе снятая поддержкой связка
 * задним числом двигала бы уже объявленные места.
 */

export const CONTEST_ID = process.env.CONTEST_ID || 'ugc-2026-09';

/** Призовая сетка: 1 место, затем 2–6, затем 7–16. */
const PRIZES: { maxRank: number; tier: number; amount: number }[] = [
  { maxRank: 1, tier: 1, amount: 50000 },
  { maxRank: 6, tier: 2, amount: 20000 },
  { maxRank: 16, tier: 3, amount: 5000 },
];

export function prizeFor(rank: number, qualified: boolean): { tier: number | null; amount: number | null } {
  if (!qualified) return { tier: null, amount: null };
  for (const p of PRIZES) if (rank <= p.maxRank) return { tier: p.tier, amount: p.amount };
  return { tier: null, amount: null };
}

export interface StandingRow {
  participantId: string;
  code: string;
  activations: number;
  /** null = активаций нет, места ещё нет. Ноль — это не «последнее место». */
  rank: number | null;
  qualified: boolean;
  prizeTier: number | null;
  prizeAmount: number | null;
}

export interface Standings {
  finalized: boolean;
  rows: StandingRow[];
  /** Когда цифры в последний раз ходили в Fairy — для «обновлено N секунд назад». */
  computedAt: string;
}

export async function getContest(): Promise<Contest | null> {
  return prisma.contest.findUnique({ where: { id: CONTEST_ID } });
}

// ─────────────────────────── активации из Fairy ───────────────────────────

export interface FairyCodeRow {
  code: string;
  bindings: number;
  lastBindAt: string | null;
}

const CACHE_TTL_MS = 60_000;
let cache: { at: number; p: Promise<Map<string, FairyCodeRow>> } | null = null;

/**
 * Кэшируется обещание, а не результат: сто участников, одновременно нажавших
 * «обновить», дают один поход в Fairy, а не сто. Упавшее обещание из кэша
 * выбрасывается, иначе ошибка залипла бы на минуту.
 */
function activationsByCode(contest: Contest): Promise<Map<string, FairyCodeRow>> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.p;

  const from = contest.startsAt.toISOString();
  // В Fairy верхняя граница строгая (`bound_at < to`), а конкурс идёт по
  // последнюю секунду включительно — отсюда +1 секунда.
  const to = new Date(contest.endsAt.getTime() + 1000).toISOString();

  const p = fairyFetch<{ codes: FairyCodeRow[] }>(
    '/api/admin/referrals/by-code',
    `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    'ugc'
  )
    .then((data) => {
      const map = new Map<string, FairyCodeRow>();
      for (const row of data.codes || []) {
        if (row.code) map.set(String(row.code).toUpperCase(), row);
      }
      return map;
    })
    .catch((e) => {
      cache = null;
      throw e;
    });

  cache = { at: now, p };
  return p;
}

export function dropActivationsCache(): void {
  cache = null;
}

/**
 * Сырые активации по кодам. Нужны админке: дисквалифицированных в рейтинге нет,
 * но их цифры видеть надо — иначе непонятно, за что человека сняли.
 */
export function getActivationsMap(contest: Contest): Promise<Map<string, FairyCodeRow>> {
  return activationsByCode(contest);
}

// ─────────────────────────── расчёт ───────────────────────────

/** Живой расчёт: участники + активации из Fairy. Используется до фиксации. */
export async function computeStandings(contest: Contest): Promise<StandingRow[]> {
  const [participants, byCode] = await Promise.all([
    prisma.participant.findMany({
      where: { code: { not: null }, disqualified: false },
      select: { id: true, code: true },
    }),
    activationsByCode(contest),
  ]);

  const rows = participants.map((p) => {
    const hit = byCode.get(String(p.code).toUpperCase());
    return {
      participantId: p.id,
      code: p.code as string,
      activations: hit ? Number(hit.bindings) || 0 : 0,
      // Только для сортировки: наружу время чужих активаций не отдаём.
      lastBindAt: hit?.lastBindAt ? Date.parse(hit.lastBindAt) : Number.MAX_SAFE_INTEGER,
    };
  });

  // Мест 16, поэтому они обязаны быть уникальными: «делёж второго места»
  // здесь означал бы спор о деньгах. При равенстве выше тот, кто набрал раньше.
  rows.sort((a, b) => {
    if (b.activations !== a.activations) return b.activations - a.activations;
    if (a.lastBindAt !== b.lastBindAt) return a.lastBindAt - b.lastBindAt;
    return a.code.localeCompare(b.code);
  });

  // Место получает только тот, у кого есть хотя бы одна активация. Иначе
  // первый зарегистрировавшийся увидел бы «вы на 1 месте» с нулём активаций —
  // и решил бы, что сайт врёт. Ноль — это «места ещё нет», а не последнее место.
  let place = 0;
  return rows.map((r) => {
    const rank = r.activations > 0 ? ++place : null;
    const qualified = r.activations >= contest.minActivations;
    const prize = rank ? prizeFor(rank, qualified) : { tier: null, amount: null };
    return {
      participantId: r.participantId,
      code: r.code,
      activations: r.activations,
      rank,
      qualified,
      prizeTier: prize.tier,
      prizeAmount: prize.amount,
    };
  });
}

/** Снимок после фиксации. */
async function frozenStandings(contest: Contest): Promise<StandingRow[]> {
  const rows = await prisma.contestResult.findMany({
    where: { contestId: contest.id },
    orderBy: { rank: 'asc' },
  });
  return rows.map((r) => ({
    participantId: r.participantId,
    code: r.code,
    activations: r.activations,
    rank: r.rank,
    qualified: r.qualified,
    prizeTier: r.prizeTier,
    prizeAmount: r.prizeAmount,
  }));
}

export async function getStandings(contest: Contest): Promise<Standings> {
  if (contest.finalizedAt) {
    return {
      finalized: true,
      rows: await frozenStandings(contest),
      computedAt: contest.finalizedAt.toISOString(),
    };
  }
  return {
    finalized: false,
    rows: await computeStandings(contest),
    computedAt: new Date().toISOString(),
  };
}

// ─────────────────────────── фиксация итогов ───────────────────────────

/**
 * Записать снимок и закрыть конкурс. Идемпотентно: повторный запуск переписывает
 * снимок целиком, а не задваивает строки. `force` нужен для пересчёта после
 * дисквалификации — места ниже дисквалифицированного должны сдвинуться вверх.
 */
export async function finalize(force = false): Promise<{ ok: boolean; reason?: string; rows?: number }> {
  const contest = await getContest();
  if (!contest) return { ok: false, reason: 'no_contest' };
  if (contest.finalizedAt && !force) return { ok: false, reason: 'already_finalized' };
  if (Date.now() < contest.endsAt.getTime() && !force) return { ok: false, reason: 'not_ended' };

  dropActivationsCache();
  // В снимок попадают только те, у кого есть место. Строка «ноль активаций,
  // места нет» ничего не фиксирует, а в таблице итогов выглядела бы как
  // проигравший участник — хотя человек мог просто не начать.
  const rows = (await computeStandings(contest)).filter((r) => r.rank !== null);

  await prisma.$transaction([
    prisma.contestResult.deleteMany({ where: { contestId: contest.id } }),
    prisma.contestResult.createMany({
      data: rows.map((r) => ({
        contestId: contest.id,
        participantId: r.participantId,
        code: r.code,
        activations: r.activations,
        rank: r.rank as number,
        qualified: r.qualified,
        prizeTier: r.prizeTier,
        prizeAmount: r.prizeAmount,
      })),
    }),
    prisma.contest.update({
      where: { id: contest.id },
      data: { finalizedAt: contest.finalizedAt ?? new Date() },
    }),
  ]);

  console.log(`[UGC] итоги зафиксированы: участников=${rows.length} конкурс=${contest.id}${force ? ' (пересчёт)' : ''}`);
  return { ok: true, rows: rows.length };
}

/**
 * Фоновая проверка. Отдельного планировщика на сервере нет, а конкурс
 * заканчивается ночью — ждать, пока кто-то откроет админку, нельзя.
 */
export function startFinalizeTimer(): void {
  const tick = async () => {
    try {
      const contest = await getContest();
      if (!contest || contest.finalizedAt) return;
      if (Date.now() < contest.endsAt.getTime()) return;
      await finalize();
    } catch (e) {
      console.error(`[UGC] финализация не удалась: ${(e as Error).message}`);
    }
  };
  setInterval(tick, 5 * 60_000).unref();
  void tick();
}
