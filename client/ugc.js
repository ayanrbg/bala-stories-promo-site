/* Кабинет участника UGC-конкурса.
 *
 * Одна страница на два экрана: переход между «Условиями» и «Моим результатом»
 * не перезагружает документ — сессия не должна зависеть даже от теоретической
 * возможности потерять куку на переходе.
 */

const $ = (id) => document.getElementById(id);

const state = {
  info: null,
  me: null,          // участник или null
  standings: null,
  timeOffset: 0,     // серверное время минус часы телефона
  pollTimer: null,
};

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

// ─────────────────────────── формат ───────────────────────────

const nf = new Intl.NumberFormat('ru-RU');

function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

const acts = (n) => `${nf.format(n)} ${plural(n, 'активация', 'активации', 'активаций')}`;

function dateRu(iso) {
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'long', timeZone: 'Asia/Almaty',
  });
}

// ─────────────────────────── обратный отсчёт ───────────────────────────

function now() { return Date.now() + state.timeOffset; }

function tickTimer() {
  if (!state.info) return;
  const start = Date.parse(state.info.startsAt);
  const end = Date.parse(state.info.endsAt);
  const t = now();

  let target, label;
  if (t < start) { target = start; label = 'До старта конкурса'; }
  else if (t < end) { target = end; label = 'До окончания конкурса'; }
  else {
    $('timerLabel').textContent = 'Конкурс завершён';
    $('timer').classList.add('is-over');
    $('tDays').textContent = $('tHours').textContent = $('tMins').textContent = '0';
    return;
  }

  const left = Math.max(0, target - t);
  const mins = Math.floor(left / 60000);
  $('timerLabel').textContent = label;
  $('tDays').textContent = Math.floor(mins / 1440);
  $('tHours').textContent = Math.floor((mins % 1440) / 60);
  $('tMins').textContent = mins % 60;
}

// ─────────────────────────── экран условий ───────────────────────────

function renderInfo(info) {
  $('prizeFund').textContent = nf.format(info.prizeFund);
  $('minAct').textContent = info.minActivations;
  $('winnersTotal').textContent = info.winnersTotal;
  $('dates').textContent = `${dateRu(info.startsAt)} — ${dateRu(info.endsAt)}`;

  const medals = ['🥇', '🥈', '🥉'];
  $('prizes').innerHTML = info.prizes.map((p, i) => `
    <li>
      <span class="medal">${medals[i] || '🎁'}</span>
      <span class="place">${p.place}
        <span class="who">${p.winners > 1 ? `${p.winners} победителей × ${nf.format(p.amount)} ₸` : 'один победитель'}</span>
      </span>
      <span class="amount">${nf.format(p.amount)} ₸</span>
    </li>`).join('');
}

// ─────────────────────────── экран результата ───────────────────────────

function showState(which) {
  for (const id of ['stateLogin', 'stateForm', 'stateResult']) {
    $(id).hidden = id !== which;
  }
}

function renderMe() {
  if (!state.me) { showState('stateLogin'); return; }
  if (!state.me.code) { showState('stateForm'); return; }

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

  if (me) {
    $('rankMedal').textContent = medalFor(me.rank);
    $('rankPlace').textContent = s.finalized ? `Итог: ${me.rank} место` : `Вы на ${me.rank} месте`;
    $('myActs').textContent = nf.format(me.activations);

    const pct = Math.min(100, Math.round((me.activations / min) * 100));
    $('progressFill').style.width = pct + '%';
    $('progressText').textContent = `${nf.format(me.activations)} из ${min}`;
    $('progressGoal').textContent = 'минимум для участия';

    card.classList.toggle('is-done', me.qualified);
    const st = $('status');
    if (me.qualified) {
      st.className = 'status good';
      st.innerHTML = me.prizeAmount
        ? `🟢 Условие выполнено. При текущем месте ваш приз — <b>${nf.format(me.prizeAmount)} ₸</b>.`
        : '🟢 Условие выполнено — вы участвуете в конкурсе. Призовые места: с 1 по 16.';
    } else {
      st.className = 'status bad';
      const left = me.remaining;
      st.innerHTML = `🔴 Условие не выполнено. Осталось <b>${acts(left)}</b> до допуска.`;
    }
  } else {
    $('rankMedal').textContent = '🌱';
    $('rankPlace').textContent = 'Активаций пока нет';
    $('myActs').textContent = '0';
    $('progressFill').style.width = '0%';
    $('progressText').textContent = `0 из ${min}`;
    $('progressGoal').textContent = 'минимум для участия';
    card.classList.remove('is-done');
    const st = $('status');
    st.className = 'status bad';
    if (state.me && state.me.disqualified) {
      // Молчать нельзя: иначе человек видит ноль активаций и идёт в поддержку
      // выяснять, куда делись его цифры.
      st.innerHTML = '⚠️ Ваш результат снят с конкурса. Напишите нам, если считаете это ошибкой.';
    } else if (state.info && now() < Date.parse(state.info.startsAt)) {
      st.innerHTML = '⏳ Конкурс ещё не начался. Код уже работает — активации начнут считаться со старта.';
    } else {
      st.innerHTML = `🔴 Условие не выполнено. Нужно ${acts(min)}.`;
    }
  }

  // Таблица. Наружу отдаются только места и цифры — имён здесь нет и не будет.
  const rows = s.top.slice();
  if (me && !rows.some((r) => r.isMe)) rows.push(me);

  const max = Math.max(1, ...rows.map((r) => r.activations));
  $('boardEmpty').hidden = rows.length > 0;
  $('board').innerHTML = rows.map((r) => `
    <li class="${r.isMe ? 'me' : ''}">
      <span class="bg" style="width:${Math.max(4, (r.activations / max) * 100)}%"></span>
      <span class="pos">${r.rank <= 3 ? medalFor(r.rank) : r.rank}</span>
      <span class="name">${r.isMe ? 'ВЫ' : ''}</span>
      <span class="val">${nf.format(r.activations)}</span>
    </li>`).join('');

  $('updated').textContent = s.finalized
    ? 'итоги зафиксированы'
    : 'обновлено ' + new Date(s.computedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
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

function initGoogle(clientId) {
  if (!clientId) { $('loginNote').hidden = false; return; }
  const ready = () => window.google && window.google.accounts && window.google.accounts.id;

  const start = () => {
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: onCredential,
      auto_select: false,
    });
    window.google.accounts.id.renderButton($('gbtn'), {
      theme: 'filled_black',
      size: 'large',
      shape: 'pill',
      text: 'continue_with',
      locale: 'ru',
      width: 280,
    });
  };

  if (ready()) return start();
  // Скрипт грузится с defer — ждём его, но не бесконечно.
  let waited = 0;
  const t = setInterval(() => {
    if (ready()) { clearInterval(t); start(); }
    else if ((waited += 200) > 8000) { clearInterval(t); $('loginNote').hidden = false; }
  }, 200);
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
    $('loginNote').hidden = false;
    $('loginNote').textContent = e.data && e.data.error === 'email_not_verified'
      ? 'Почта в этом Google-аккаунте не подтверждена.'
      : 'Не удалось войти. Попробуйте ещё раз.';
  }
}

// ─────────────────────────── анкета ───────────────────────────

$('profileForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('formSubmit');
  const err = $('formError');
  err.hidden = true;
  btn.disabled = true;
  btn.textContent = 'Выдаём код…';

  try {
    const data = await api('/profile', {
      method: 'PATCH',
      body: JSON.stringify({
        nickname: $('fNickname').value,
        socialUrl: $('fSocial').value,
        phone: $('fPhone').value,
      }),
    });
    state.me = data.participant;
    renderMe();
    loadStandings();
  } catch (e2) {
    err.hidden = false;
    err.textContent = (e2.data && e2.data.message) || 'Не получилось сохранить. Проверьте поля.';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Получить промокод';
  }
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
  $('copyHint').textContent = 'скопировано ✓';
  setTimeout(() => {
    ticket.classList.remove('copied');
    $('copyHint').textContent = 'нажмите, чтобы скопировать';
  }, 1800);
});

$('logout').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
  state.me = null;
  renderMe();
});

// ─────────────────────────── вкладки ───────────────────────────

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

// ─────────────────────────── встроенный браузер ───────────────────────────

function checkInApp() {
  const ua = navigator.userAgent || '';
  if (!/Instagram|FBAN|FBAV|FB_IAB|TikTok|musical_ly|Line\/|VKAndroidApp|OKApp/i.test(ua)) return;
  $('inapp').hidden = false;
  $('copyLink').addEventListener('click', async () => {
    const url = location.origin + '/ugc';
    try { await navigator.clipboard.writeText(url); $('copyLink').textContent = 'Ссылка скопирована ✓'; }
    catch { $('copyLink').textContent = url; }
  });
}

// ─────────────────────────── старт ───────────────────────────

async function boot() {
  checkInApp();

  try {
    state.info = await api('/info');
    state.timeOffset = Date.parse(state.info.serverTime) - Date.now();
    renderInfo(state.info);
    tickTimer();
    setInterval(tickTimer, 1000);
    initGoogle(state.info.googleClientId);
  } catch (e) {
    console.error('info:', e.message);
  }

  try {
    const data = await api('/me');
    state.me = data.participant;
  } catch (e) {
    if (e.status !== 401) console.warn('me:', e.message);
    state.me = null;
  }

  await loadStandings();
  renderMe();

  // Обновляем цифры, пока вкладка открыта. Сервер всё равно кэширует минуту,
  // поэтому чаще спрашивать бессмысленно.
  setInterval(() => {
    if (!document.hidden && !$('screenMe').hidden) loadStandings();
  }, 60_000);
}

boot();
