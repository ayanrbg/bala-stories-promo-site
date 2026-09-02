/* Кабинет участника UGC-конкурса.
 *
 * Одна страница на два экрана: переход между «Условиями» и «Моим профилем»
 * не перезагружает документ — сессия не должна зависеть даже от теоретической
 * возможности потерять куку на переходе.
 *
 * Язык переключается без перезагрузки: строки лежат в ugc.i18n.js, разметка
 * помечена data-i18n, а всё посчитанное перерисовывается заново.
 */

const $ = (id) => document.getElementById(id);

const state = {
  info: null,
  me: null,          // участник или null
  standings: null,
  timeOffset: 0,     // серверное время минус часы телефона
  editing: false,    // открыта анкета, хотя код уже выдан
};

// ─────────────────────────── язык ───────────────────────────

const LANGS = ['ru', 'kk'];

function detectLang() {
  const saved = localStorage.getItem('ugc_lang');
  if (LANGS.includes(saved)) return saved;
  const nav = (navigator.languages || [navigator.language || '']).join(',').toLowerCase();
  return nav.includes('kk') ? 'kk' : 'ru';
}

let lang = detectLang();

/** Недостающий ключ возвращает сам себя: пропущенный перевод видно сразу. */
function t(key, vars) {
  const dict = window.I18N[lang] || window.I18N.ru;
  let s = dict[key] || window.I18N.ru[key] || key;
  if (vars) for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(vars[k]);
  return s;
}

const locale = () => (lang === 'kk' ? 'kk-KZ' : 'ru-RU');

function setLang(next) {
  if (!LANGS.includes(next) || next === lang) return;
  lang = next;
  localStorage.setItem('ugc_lang', next);
  applyI18n();
}

function applyI18n() {
  document.documentElement.lang = lang;

  for (const el of document.querySelectorAll('[data-i18n]')) el.innerHTML = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-ph]')) el.placeholder = t(el.dataset.i18nPh);
  for (const b of document.querySelectorAll('.lang-btn')) {
    b.classList.toggle('is-active', b.dataset.lang === lang);
  }

  // Всё посчитанное собирается заново: подписи там вперемешку с цифрами.
  if (state.info) renderInfo(state.info);
  tickTimer();
  if (state.me) renderMe();
  if (googleClientId && !$('stateLogin').hidden) renderGoogleButton();
}

// ─────────────────────────── сеть ───────────────────────────

async function api(path, options = {}) {
  const res = await fetch('/api/contest' + path, {
    credentials: 'same-origin',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });
  let data = null;
  try { data = await res.json(); } catch { /* пустое тело — не ошибка */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || 'http_' + res.status);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/**
 * Текст ошибки берём по машинному коду, а не из ответа: сервер отвечает
 * по-русски, а страница может быть на казахском.
 */
function errText(e, fallbackKey) {
  const code = e && e.data && e.data.error;
  const dict = window.I18N[lang] || window.I18N.ru;
  if (code && dict['err.' + code]) return t('err.' + code);
  if (e && e.data && e.data.message) return e.data.message;
  return t(fallbackKey);
}

// ─────────────────────────── формат ───────────────────────────

const num = (n) => new Intl.NumberFormat(locale()).format(n);

function pluralRu(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

/** В казахском после числительного существительное не меняется. */
function acts(n) {
  if (lang === 'kk') return `${num(n)} ${t('rank.acts')}`;
  return `${num(n)} ${pluralRu(n, 'активация', 'активации', 'активаций')}`;
}

function dateLong(iso) {
  return new Date(iso).toLocaleDateString(locale(), {
    day: 'numeric', month: 'long', timeZone: 'Asia/Almaty',
  });
}

// ─────────────────────────── обратный отсчёт ───────────────────────────

function now() { return Date.now() + state.timeOffset; }

function tickTimer() {
  if (!state.info) return;
  const start = Date.parse(state.info.startsAt);
  const end = Date.parse(state.info.endsAt);
  const time = now();

  let target, label;
  if (time < start) { target = start; label = t('timer.toStart'); }
  else if (time < end) { target = end; label = t('timer.toEnd'); }
  else {
    $('timerLabel').textContent = t('timer.over');
    $('timer').classList.add('is-over');
    $('tDays').textContent = $('tHours').textContent = $('tMins').textContent = '0';
    return;
  }

  const mins = Math.floor(Math.max(0, target - time) / 60000);
  $('timerLabel').textContent = label;
  $('tDays').textContent = Math.floor(mins / 1440);
  $('tHours').textContent = Math.floor((mins % 1440) / 60);
  $('tMins').textContent = mins % 60;
}

// ─────────────────────────── экран условий ───────────────────────────

function renderInfo(info) {
  $('prizeFund').textContent = num(info.prizeFund);
  $('minAct').textContent = info.minActivations;
  $('winnersTotal').textContent = info.winnersTotal;
  $('dates').textContent = `${dateLong(info.startsAt)} — ${dateLong(info.endsAt)}`;

  // Подписи мест собираем из границ ступени, а не берём готовыми: сетка может
  // поменяться, а страница ещё и бывает на казахском.
  const medals = ['🥇', '🥈', '🥉'];
  $('prizes').innerHTML = info.prizes.map((p, i) => {
    const place = p.fromRank === p.toRank
      ? t('prizes.placeOne', { n: p.fromRank })
      : t('prizes.placeRange', { a: p.fromRank, b: p.toRank });
    return `
    <li>
      <span class="medal">${medals[i] || '🎁'}</span>
      <span class="place">${place}
        <span class="who">${p.winners > 1 ? t('prizes.many', { n: p.winners, sum: num(p.amount) }) : t('prizes.one')}</span>
      </span>
      <span class="amount">${num(p.amount)} ₸</span>
    </li>`;
  }).join('');
}

// ─────────────────────────── экран профиля ───────────────────────────

function showState(which) {
  for (const id of ['stateLogin', 'stateForm', 'stateResult']) {
    $(id).hidden = id !== which;
  }
}

function fillForm() {
  const p = state.me || {};
  $('fInstagram').value = p.instagram || '';
  $('fTiktok').value = p.tiktok || '';
  $('fTelegram').value = p.telegram || '';
  $('fYoutube').value = p.youtube || '';
  $('fPhone').value = p.phone || '';
  // Код уже выдан — значит человек пришёл поправить контакты, а не получить код.
  $('formSubmit').textContent = p.code ? t('form.save') : t('form.submit');
}

function renderMe() {
  if (!state.me) { showState('stateLogin'); return; }
  if (!state.me.code || state.editing) { fillForm(); showState('stateForm'); return; }

  showState('stateResult');
  $('codeText').textContent = state.me.code;
  renderStandings();
}

function medalFor(rank) {
  return rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '🏆';
}

function renderStandings() {
  const s = state.standings;
  if (!s) return;

  const me = s.me;
  const card = $('rankCard');
  const min = s.minActivations;
  const st = $('status');

  // Место есть только с первой активацией: `rank: null` — это «ещё не начал»,
  // и рисовать ему «1 место с нулём» было бы враньём.
  if (me && me.rank) {
    $('rankMedal').textContent = medalFor(me.rank);
    $('rankPlace').textContent = s.finalized
      ? t('rank.final', { n: me.rank })
      : t('rank.place', { n: me.rank });
    $('myActs').textContent = num(me.activations);

    $('progressFill').style.width = Math.min(100, Math.round((me.activations / min) * 100)) + '%';
    $('progressText').textContent = t('rank.of', { n: num(me.activations), min });
    $('progressGoal').textContent = t('rank.goal');

    card.classList.toggle('is-done', me.qualified);
    if (me.qualified) {
      st.className = 'status good';
      st.innerHTML = me.prizeAmount
        ? t('status.goodPrize', { sum: num(me.prizeAmount) })
        : t('status.good', { n: (state.info && state.info.winnersTotal) || '' });
    } else {
      st.className = 'status bad';
      st.innerHTML = t('status.bad', { acts: acts(me.remaining) });
    }
  } else {
    $('rankMedal').textContent = '🌱';
    $('rankPlace').textContent = t('rank.none');
    $('myActs').textContent = '0';
    $('progressFill').style.width = '0%';
    $('progressText').textContent = t('rank.of', { n: 0, min });
    $('progressGoal').textContent = t('rank.goal');
    card.classList.remove('is-done');
    st.className = 'status bad';

    if (state.me && state.me.disqualified) {
      // Молчать нельзя: иначе человек видит ноль активаций и идёт в поддержку
      // выяснять, куда делись его цифры.
      st.innerHTML = t('status.dq');
    } else if (state.info && now() < Date.parse(state.info.startsAt)) {
      st.innerHTML = t('status.notStarted');
    } else {
      st.innerHTML = t('status.need', { acts: acts(min) });
    }
  }

  // Таблица. Наружу отдаются только места и цифры — имён здесь нет и не будет.
  const rows = s.top.slice();
  if (me && me.rank && !rows.some((r) => r.isMe)) rows.push(me);

  const max = Math.max(1, ...rows.map((r) => r.activations));
  $('boardEmpty').hidden = rows.length > 0;
  $('board').innerHTML = rows.map((r) => `
    <li class="${r.isMe ? 'me' : ''}">
      <span class="bg" style="width:${Math.max(4, (r.activations / max) * 100)}%"></span>
      <span class="pos">${r.rank <= 3 ? medalFor(r.rank) : r.rank}</span>
      <span class="name">${r.isMe ? t('board.you') : ''}</span>
      <span class="val">${num(r.activations)}</span>
    </li>`).join('');

  $('updated').textContent = s.finalized
    ? t('board.frozen')
    : t('board.updated', {
        time: new Date(s.computedAt).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }),
      });
}

async function loadStandings() {
  try {
    state.standings = await api('/standings');
    if (state.me && state.me.code) renderStandings();
  } catch (e) {
    // Молча: цифры важны, но не настолько, чтобы выкидывать человека из кабинета.
    console.warn('standings:', e.message);
  }
}

// ─────────────────────────── вход через Google ───────────────────────────

let googleClientId = null;

function renderGoogleButton() {
  if (!window.google || !window.google.accounts || !window.google.accounts.id) return;
  window.google.accounts.id.renderButton($('gbtn'), {
    theme: 'filled_black',
    size: 'large',
    shape: 'pill',
    text: 'continue_with',
    locale: lang === 'kk' ? 'kk' : 'ru',
    width: 280,
  });
}

function initGoogle(clientId) {
  if (!clientId) { showLoginNote(t('login.unavailable')); return; }
  googleClientId = clientId;

  const ready = () => window.google && window.google.accounts && window.google.accounts.id;

  const start = () => {
    // Режим входа выбирает сервер. Всплывающее окно отдаёт токен обратно в
    // страницу — и на айфоне иногда не отдаёт вовсе: окно остаётся белым.
    // Redirect уводит и возвращает саму вкладку, терять токен там негде.
    const opts = { client_id: clientId, auto_select: false };
    if (state.info && state.info.googleRedirect) {
      opts.ux_mode = 'redirect';
      opts.login_uri = state.info.googleLoginUri || location.origin + '/api/contest/auth/google/redirect';
    } else {
      opts.callback = onCredential;
    }
    window.google.accounts.id.initialize(opts);
    renderGoogleButton();
  };

  if (ready()) return start();
  // Скрипт грузится с defer — ждём его, но не бесконечно.
  let waited = 0;
  const timer = setInterval(() => {
    if (ready()) { clearInterval(timer); start(); }
    else if ((waited += 200) > 8000) { clearInterval(timer); showLoginNote(t('login.unavailable')); }
  }, 200);
}

function showLoginNote(text) {
  $('loginNote').hidden = false;
  $('loginNote').textContent = text;
}

async function onCredential(response) {
  try {
    const data = await api('/auth/google', {
      method: 'POST',
      body: JSON.stringify({ credential: response.credential }),
    });
    state.me = data.participant;
    renderMe();
    loadStandings();
  } catch (e) {
    showLoginNote(errText(e, 'login.failed'));
  }
}

/**
 * Возврат из Google в режиме redirect: сервер приводит человека обратно с
 * пометкой в адресе. Пометку сразу вычищаем — обновление страницы не должно
 * показывать вчерашнюю ошибку и не должно снова прыгать на «Мой профиль».
 */
function readLoginReturn() {
  const q = new URLSearchParams(location.search);
  const ok = q.get('login') === 'ok';
  const err = q.get('login_error');
  if (ok || err) history.replaceState(null, '', location.pathname);
  return { ok, err };
}

// ─────────────────────────── вход по ссылке ───────────────────────────

/**
 * Отрабатывает до всего остального: человек пришёл по ссылке именно затем,
 * чтобы оказаться внутри. Токен сразу вычищается из адресной строки — иначе
 * он останется в истории браузера и в «поделиться».
 */
async function tryInvite() {
  const token = new URLSearchParams(location.search).get('invite');
  if (!token) return false;

  history.replaceState(null, '', location.pathname);
  try {
    const data = await api('/auth/invite', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
    state.me = data.participant;
    return true;
  } catch (e) {
    showLoginNote(errText(e, 'err.bad_invite'));
    return false;
  }
}

async function requestMagic() {
  const note = $('magicNote');
  const email = $('magicEmail').value.trim();
  if (!email) return;
  note.hidden = false;
  note.textContent = t('magic.sending');
  try {
    await api('/auth/magic', { method: 'POST', body: JSON.stringify({ email }) });
    note.textContent = t('magic.sent');
  } catch (e) {
    note.textContent = errText(e, 'magic.failed');
  }
}

// ─────────────────────────── анкета ───────────────────────────

$('profileForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('formSubmit');
  const err = $('formError');
  err.hidden = true;
  btn.disabled = true;
  btn.textContent = t('form.sending');

  try {
    const data = await api('/profile', {
      method: 'PATCH',
      body: JSON.stringify({
        instagram: $('fInstagram').value,
        tiktok: $('fTiktok').value,
        telegram: $('fTelegram').value,
        youtube: $('fYoutube').value,
        phone: $('fPhone').value,
      }),
    });
    state.me = data.participant;
    state.editing = false;
    renderMe();
    loadStandings();
  } catch (e2) {
    err.hidden = false;
    err.textContent = errText(e2, 'form.error');
  } finally {
    btn.disabled = false;
    fillForm();
  }
});

// Контакты можно поправить и после выдачи кода: телефон человек часто
// добавляет позже, а опечатку в нике иначе пришлось бы чинить руками.
$('editContacts').addEventListener('click', () => {
  state.editing = true;
  renderMe();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ─────────────────────────── копирование кода ───────────────────────────

$('codeBtn').addEventListener('click', async () => {
  const code = state.me && state.me.code;
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
  } catch {
    // Встроенные браузеры часто не дают доступ к буферу — выделяем текст,
    // чтобы человек скопировал сам, а не остался ни с чем.
    const r = document.createRange();
    r.selectNodeContents($('codeText'));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }
  const ticket = document.querySelector('.ticket');
  ticket.classList.add('copied');
  $('copyHint').textContent = t('ticket.copied');
  setTimeout(() => {
    ticket.classList.remove('copied');
    $('copyHint').textContent = t('ticket.hint');
  }, 1800);
});

$('logout').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
  state.me = null;
  state.editing = false;
  renderMe();
});

// ─────────────────────────── вкладки и язык ───────────────────────────

function switchTab(which) {
  const isMe = which === 'me';
  $('screenRules').hidden = isMe;
  $('screenMe').hidden = !isMe;
  $('tabRules').classList.toggle('is-active', !isMe);
  $('tabMe').classList.toggle('is-active', isMe);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (isMe) loadStandings();
}

$('tabRules').addEventListener('click', () => switchTab('rules'));
$('tabMe').addEventListener('click', () => switchTab('me'));

for (const btn of document.querySelectorAll('.lang-btn')) {
  btn.addEventListener('click', () => setLang(btn.dataset.lang));
}

// ─────────────────────────── встроенный браузер ───────────────────────────

function checkInApp() {
  const ua = navigator.userAgent || '';
  if (!/Instagram|FBAN|FBAV|FB_IAB|TikTok|musical_ly|Line\/|VKAndroidApp|OKApp/i.test(ua)) return;
  $('inapp').hidden = false;
  $('copyLink').addEventListener('click', async () => {
    const url = location.origin + '/ugc';
    try { await navigator.clipboard.writeText(url); $('copyLink').textContent = t('inapp.copied'); }
    catch { $('copyLink').textContent = url; }
  });
}

// ─────────────────────────── старт ───────────────────────────

async function boot() {
  applyI18n();
  checkInApp();

  // Раньше всего, что трогает адресную строку: tryInvite её чистит.
  const back = readLoginReturn();
  const byInvite = await tryInvite();

  try {
    state.info = await api('/info');
    state.timeOffset = Date.parse(state.info.serverTime) - Date.now();
    renderInfo(state.info);
    tickTimer();
    setInterval(tickTimer, 1000);
    initGoogle(state.info.googleClientId);
    if (state.info.mailLogin) {
      $('magicBox').hidden = false;
      $('magicSend').addEventListener('click', requestMagic);
    }
  } catch (e) {
    console.error('info:', e.message);
  }

  // По ссылке уже вошли — второй запрос за тем же самым не нужен.
  if (!byInvite) {
    try {
      const data = await api('/me');
      state.me = data.participant;
    } catch (e) {
      if (e.status !== 401) console.warn('me:', e.message);
      state.me = null;
    }
  }

  await loadStandings();
  renderMe();
  // Пришёл по ссылке или вернулся от Google — показываем сразу его профиль,
  // а не условия. Про неудачный вход говорим на том же экране, где кнопка.
  if (byInvite || back.ok || back.err) switchTab('me');
  if (back.err) showLoginNote(errText({ data: { error: back.err } }, 'login.failed'));

  // Обновляем цифры, пока вкладка открыта. Сервер всё равно кэширует минуту,
  // поэтому чаще спрашивать бессмысленно.
  setInterval(() => {
    if (!document.hidden && !$('screenMe').hidden) loadStandings();
  }, 60_000);
}

boot();
