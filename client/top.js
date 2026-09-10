/* Открытая страница рейтинга: только таблица, условия и сроки.
 *
 * Отдельный маленький скрипт, а не кабинет без входа: у /ugc половина кода —
 * про сессию, анкету и Google, и ничего из этого здесь не нужно. Общее с
 * кабинетом — словарь (ugc.i18n.js) и разметка таблицы (board.js), то есть
 * ровно то, что нельзя допустить разъехаться.
 */

const $ = (id) => document.getElementById(id);
const LANGS = ['ru', 'kk'];

function detectLang() {
  const saved = localStorage.getItem('ugc_lang');
  if (LANGS.includes(saved)) return saved;
  const nav = (navigator.languages || [navigator.language || '']).join(',').toLowerCase();
  return nav.includes('kk') ? 'kk' : 'ru';
}

let lang = detectLang();
const locale = () => (lang === 'kk' ? 'kk-KZ' : 'ru-RU');

function t(key, vars) {
  const dict = window.I18N[lang] || window.I18N.ru;
  let s = dict[key] || window.I18N.ru[key] || key;
  if (vars) for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(vars[k]);
  return s;
}

const num = (n) => new Intl.NumberFormat(locale()).format(n);

const state = { info: null, standings: null, timeOffset: 0 };
const now = () => Date.now() + state.timeOffset;

function applyI18n() {
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll('[data-i18n]')) el.innerHTML = t(el.dataset.i18n);
  for (const b of document.querySelectorAll('.lang-btn')) b.classList.toggle('is-active', b.dataset.lang === lang);
  if (state.info) renderInfo(state.info);
  if (state.standings) paintBoard();
  tickTimer();
}

for (const btn of document.querySelectorAll('.lang-btn')) {
  btn.addEventListener('click', () => {
    if (!LANGS.includes(btn.dataset.lang) || btn.dataset.lang === lang) return;
    lang = btn.dataset.lang;
    localStorage.setItem('ugc_lang', lang);
    applyI18n();
  });
}

function dateLong(iso) {
  return new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'long', timeZone: 'Asia/Almaty' });
}

function renderInfo(info) {
  $('prizeFund').textContent = num(info.prizeFund);
  $('minAct').textContent = info.minActivations;
  $('winnersTotal').textContent = info.winnersTotal;
  $('dates').textContent = `${dateLong(info.startsAt)} — ${dateLong(info.endsAt)}`;

  $('prizes').innerHTML = info.prizes.map((p) => {
    const place = p.fromRank === p.toRank
      ? t('prizes.placeOne', { n: p.fromRank })
      : t('prizes.placeRange', { a: p.fromRank, b: p.toRank });
    const sum = p.winners === 1
      ? `${num(p.amount)} ₸`
      : t('prizes.many', { n: p.winners, sum: num(p.amount) });
    return `<li><span>${place}</span><b>${sum}</b></li>`;
  }).join('');
}

function tickTimer() {
  if (!state.info) return;
  const start = Date.parse(state.info.startsAt);
  const end = Date.parse(state.info.endsAt);
  const t0 = now();

  const target = t0 < start ? start : end;
  $('timerLabel').textContent = t0 < start ? t('timer.toStart') : t0 < end ? t('timer.toEnd') : t('timer.over');

  const left = Math.max(0, target - t0);
  $('tDays').textContent = Math.floor(left / 86400000);
  $('tHours').textContent = Math.floor((left % 86400000) / 3600000);
  $('tMins').textContent = Math.floor((left % 3600000) / 60000);
}

function paintBoard() {
  const s = state.standings;
  if (!s) return;
  BOARD.paint($('boardPublic'), $('boardPublicEmpty'), $('updatedPublic'), {
    rows: s.top,
    finalized: s.finalized,
    computedAt: s.computedAt,
    t, num, locale: locale(),
  });
}

async function load() {
  try {
    const res = await fetch('/api/contest/standings');
    if (!res.ok) throw new Error('http_' + res.status);
    state.standings = await res.json();
    paintBoard();
  } catch (e) {
    // Молча: пустая таблица честнее нарисованных нулей, а объяснять сетевую
    // ошибку случайному зрителю нечем.
    console.warn('standings:', e.message);
  }
}

async function boot() {
  applyI18n();

  try {
    const res = await fetch('/api/contest/info');
    state.info = await res.json();
    state.timeOffset = Date.parse(state.info.serverTime) - Date.now();
    renderInfo(state.info);
    tickTimer();
    setInterval(tickTimer, 1000);
  } catch (e) {
    console.error('info:', e.message);
  }

  await load();
  // Сервер кэширует рейтинг минуту — чаще спрашивать нечего.
  setInterval(() => { if (!document.hidden) load(); }, 60_000);
}

boot();
