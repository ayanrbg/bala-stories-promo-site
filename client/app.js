const API = '/api';

function togglePassword() {
  const input = document.getElementById('password-input');
  const btn = input.nextElementSibling;
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = '🙈';
  } else {
    input.type = 'password';
    btn.textContent = '👁';
  }
}
let accessToken = localStorage.getItem('accessToken');
let currentRole = localStorage.getItem('role');

// --- API Helper ---
async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

  const res = await fetch(API + path, { ...options, headers });

  if (res.status === 403 || res.status === 401) {
    logout();
    throw new Error('Unauthorized');
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка');
  return data;
}

// --- Navigation ---
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(pageId).classList.add('active');
}

function switchTab(tabName) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + tabName).classList.add('active');
  document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
}

// --- Auth ---
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const login = document.getElementById('login-input').value;
  const password = document.getElementById('password-input').value;
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';

  try {
    const data = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login, password })
    });

    accessToken = data.accessToken;
    currentRole = data.role;
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    localStorage.setItem('role', currentRole);

    initApp();
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

function logout() {
  accessToken = null;
  currentRole = null;
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('role');
  showPage('login-page');
}

document.getElementById('logout-btn').addEventListener('click', logout);
document.getElementById('blogger-logout-btn').addEventListener('click', logout);

// --- Init ---
function initApp() {
  if (!accessToken) {
    showPage('login-page');
    return;
  }

  if (currentRole === 'admin') {
    showPage('admin-page');
    loadAdminData();
  } else if (currentRole === 'blogger') {
    showPage('blogger-page');
    loadBloggerData();
  }
}

// --- Admin ---
async function loadAdminData() {
  try {
    const [stats, bloggers, promos] = await Promise.all([
      api('/admin/stats'),
      api('/admin/bloggers'),
      api('/admin/premium-promos')
    ]);

    document.getElementById('stat-bloggers').textContent = stats.totalBloggers;
    document.getElementById('stat-entered').textContent = stats.totalEntered;
    document.getElementById('stat-purchased').textContent = stats.totalPurchased;
    document.getElementById('stat-conversion').textContent = stats.conversion + '%';

    renderAppStats(stats.appStats || {}, 'app-stats-section');
    renderBloggers(bloggers);
    renderPremiumPromos(promos);
  } catch (err) {
    console.error('Failed to load admin data:', err);
  }
}

const APP_LABELS = {
  BALA_STORIES: 'Bala Stories',
  ISLAMIC_TALES: 'Исламские сказки'
};

function renderAppStats(appStats, containerId) {
  const container = document.getElementById(containerId);
  const apps = Object.keys(appStats);
  if (!apps.length) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = apps.map(app => {
    const s = appStats[app];
    return `
      <h3 class="section-title">${esc(APP_LABELS[app] || app)}</h3>
      <div class="stats-grid">
        <div class="stat-card">
          <span class="stat-value">${s.entered}</span>
          <span class="stat-label">Вводов</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">${s.purchased}</span>
          <span class="stat-label">Покупок</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">${s.conversion}%</span>
          <span class="stat-label">Конверсия</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderBloggers(bloggers) {
  const tbody = document.getElementById('bloggers-table-body');
  tbody.innerHTML = bloggers.map(b => {
    const apps = (b.apps || []).map(a => APP_LABELS[a] || a);
    const appStatsHtml = Object.entries(b.appStats || {}).map(([app, s]) =>
      `<span class="app-stat-line">${esc(APP_LABELS[app] || app)}: ${s.entered}/${s.purchased}</span>`
    ).join('');
    return `
    <tr>
      <td>${esc(b.name)}</td>
      <td>${esc(b.login)}</td>
      <td><code>${esc(b.promoCode)}</code></td>
      <td>${apps.map(a => `<span class="badge badge-app">${esc(a)}</span>`).join(' ')}</td>
      <td>${b.entered}${appStatsHtml ? '<div class="app-stats-detail">' + appStatsHtml + '</div>' : ''}</td>
      <td>${b.purchased}</td>
      <td>${b.conversion}%</td>
      <td>${new Date(b.createdAt).toLocaleDateString('ru')}</td>
      <td><button class="btn btn-danger" onclick="deleteBlogger('${b.id}')">Удалить</button></td>
    </tr>
  `}).join('');
}

async function renderPremiumPromos(promos) {
  const tbody = document.getElementById('premium-table-body');
  const ids = Array.from(new Set(promos.filter(function (p) { return p.usedBy; }).map(function (p) { return p.usedBy; })));
  let names = {};
  if (ids.length) {
    try { names = await api('/users/names', { method: 'POST', body: JSON.stringify({ userIds: ids }) }); } catch (e) { names = {}; }
  }
  tbody.innerHTML = promos.map(function (p) {
    let usedBy = '—';
    if (p.usedBy) {
      const info = names[p.usedBy];
      const nm = info && info.name ? info.name : null;
      usedBy = (nm ? '<b>' + esc(nm) + '</b><br>' : '') + '<span class="muted-id">' + esc(p.usedBy) + '</span>';
    }
    const unlimited = p.maxUses == null;
    let statusBadge, statusText;
    if (unlimited) {
      statusBadge = 'badge-available'; statusText = 'Многоразовый';
    } else if (p.used) {
      statusBadge = 'badge-used'; statusText = 'Исчерпан';
    } else {
      statusBadge = 'badge-available'; statusText = 'Доступен';
    }
    const uses = (p.useCount || 0) + ' / ' + (unlimited ? '∞' : p.maxUses);
    return '<tr>' +
      '<td><code>' + esc(p.code) + '</code></td>' +
      '<td>' + (p.label ? esc(p.label) : '—') + '</td>' +
      '<td>' + p.durationDays + ' дней</td>' +
      '<td><span class="badge ' + statusBadge + '">' + statusText + '</span></td>' +
      '<td>' + uses + '</td>' +
      '<td>' + usedBy + '</td>' +
      '<td>' + new Date(p.createdAt).toLocaleDateString('ru') + '</td>' +
      '<td><button class="btn btn-danger" onclick="deletePremiumPromo(\'' + p.id + '\')">Удалить</button></td>' +
      '</tr>';
  }).join('');
}

async function deletePremiumPromo(id) {
  if (!confirm('Удалить промокод?')) return;
  try {
    await api('/admin/premium-promos/' + id, { method: 'DELETE' });
    loadAdminData();
  } catch (err) {
    alert(err.message);
  }
}

async function deleteBlogger(id) {
  if (!confirm('Удалить блогера?')) return;
  try {
    await api('/admin/bloggers/' + id, { method: 'DELETE' });
    loadAdminData();
  } catch (err) {
    alert(err.message);
  }
}

// Tab switching
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// Create blogger modal
const modal = document.getElementById('modal-overlay');
document.getElementById('add-blogger-btn').addEventListener('click', () => {
  modal.classList.add('active');
  document.getElementById('create-blogger-form').reset();
  document.getElementById('cb-credentials').style.display = 'none';
  document.getElementById('cb-error').textContent = '';
});
document.getElementById('modal-close').addEventListener('click', () => modal.classList.remove('active'));
modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });

document.getElementById('create-blogger-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('cb-error');
  errorEl.textContent = '';

  const name = document.getElementById('cb-name').value;
  const login = document.getElementById('cb-login').value;
  const password = document.getElementById('cb-password').value;
  const promoCode = document.getElementById('cb-promo').value;

  const apps = [];
  if (document.getElementById('cb-app-bala').checked) apps.push('BALA_STORIES');
  if (document.getElementById('cb-app-islamic').checked) apps.push('ISLAMIC_TALES');

  if (apps.length === 0) {
    errorEl.textContent = 'Выберите хотя бы одно приложение';
    return;
  }

  try {
    await api('/admin/bloggers', {
      method: 'POST',
      body: JSON.stringify({ name, login, password, promoCode, apps })
    });

    document.getElementById('cb-cred-login').textContent = login;
    document.getElementById('cb-cred-password').textContent = password;
    document.getElementById('cb-credentials').style.display = 'block';

    loadAdminData();
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

// Generate random values
function generateField(fieldId) {
  const el = document.getElementById(fieldId);
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) result += chars[Math.floor(Math.random() * chars.length)];
  if (fieldId === 'cb-promo') result = result.toUpperCase();
  el.value = result;
}

// Create premium promo
document.getElementById('create-premium-btn').addEventListener('click', async () => {
  const code = document.getElementById('premium-code-input').value || undefined;
  const label = document.getElementById('premium-label-input').value || undefined;
  const reusable = document.getElementById('premium-reusable-input').checked;
  const durationDays = parseInt(document.getElementById('premium-days-input').value);

  if (!durationDays || durationDays < 1) { alert('Укажите количество дней'); return; }

  try {
    await api('/admin/premium-promos', {
      method: 'POST',
      body: JSON.stringify({ code, durationDays, label, reusable })
    });
    document.getElementById('premium-code-input').value = '';
    document.getElementById('premium-label-input').value = '';
    document.getElementById('premium-reusable-input').checked = false;
    loadAdminData();
  } catch (err) {
    alert(err.message);
  }
});

// --- Blogger ---
async function loadBloggerData() {
  try {
    const [me, stats] = await Promise.all([
      api('/blogger/me'),
      api('/blogger/stats')
    ]);

    document.getElementById('blogger-name-header').textContent = me.name;
    document.getElementById('blogger-promo-code').textContent = me.promoCode;
    document.getElementById('blogger-entered').textContent = stats.totalEntered;
    document.getElementById('blogger-purchased').textContent = stats.totalPurchased;
    document.getElementById('blogger-conversion').textContent = stats.conversion + '%';

    renderAppStats(stats.appStats || {}, 'blogger-app-stats-section');
    renderChart(stats.daily || []);
    loadBloggerReferrals();
  } catch (err) {
    console.error('Failed to load blogger data:', err);
  }
}

document.getElementById('copy-promo-btn').addEventListener('click', () => {
  const code = document.getElementById('blogger-promo-code').textContent;
  navigator.clipboard.writeText(code);
});

function renderChart(daily) {
  const container = document.getElementById('chart-area');
  if (!daily.length) {
    container.innerHTML = '<p style="color:var(--text-muted);margin:auto">Нет данных</p>';
    return;
  }

  const maxVal = Math.max(...daily.map(d => Math.max(d.entered, d.purchased)), 1);

  container.innerHTML = daily.map(d => {
    const enteredH = Math.max((d.entered / maxVal) * 150, 2);
    const purchasedH = Math.max((d.purchased / maxVal) * 150, 2);
    const dateStr = d.date.slice(5);
    return `
      <div class="chart-bar-group">
        <div class="chart-bars">
          <div class="chart-bar entered" style="height:${enteredH}px" title="Вводы: ${d.entered}"></div>
          <div class="chart-bar purchased" style="height:${purchasedH}px" title="Покупки: ${d.purchased}"></div>
        </div>
        <span class="chart-date">${dateStr}</span>
      </div>
    `;
  }).join('');
}

// --- Helpers ---
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Start ---
initApp();

// ============ Catalog (tales) — library management (added) ============
const CATALOG_LANGS = ['ru', 'kz', 'uz', 'en'];
let catalogById = {};
let taleDetailPages = {};

// Upload with progress (XHR — fetch has no upload progress). onProgress(loaded,total).
function catalogUpload(path, file, onProgress) {
  return new Promise(function (resolve, reject) {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', API + path);
    if (accessToken) xhr.setRequestHeader('Authorization', 'Bearer ' + accessToken);
    if (xhr.upload) {
      xhr.upload.onprogress = function (e) { if (e.lengthComputable && onProgress) onProgress(e.loaded, e.total); };
    }
    xhr.onload = function () {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch (_) { data = {}; }
      if (xhr.status === 401 || xhr.status === 403) { logout(); reject(new Error('Unauthorized')); return; }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || ('Ошибка загрузки (HTTP ' + xhr.status + ')')));
    };
    xhr.onerror = function () { reject(new Error('Сетевая ошибка при загрузке')); };
    const fd = new FormData();
    fd.append('file', file);
    xhr.send(fd);
  });
}

function showProgress(pct, label) {
  const wrap = document.getElementById('tale-upload-progress');
  if (!wrap) return;
  wrap.style.display = 'block';
  const bar = wrap.querySelector('.bar');
  const txt = wrap.querySelector('.pct');
  if (pct == null) { bar.classList.add('indeterminate'); txt.textContent = label || 'Обработка…'; }
  else { bar.classList.remove('indeterminate'); bar.style.width = pct + '%'; txt.textContent = (label || 'Загрузка') + ' ' + pct + '%'; }
}
function hideProgress() {
  const wrap = document.getElementById('tale-upload-progress');
  if (!wrap) return;
  wrap.style.display = 'none';
  const bar = wrap.querySelector('.bar');
  bar.style.width = '0%';
  bar.classList.remove('indeterminate');
}
function uploadProgress(loaded, total) {
  const pct = total ? Math.round(loaded / total * 100) : 0;
  if (pct >= 100) showProgress(null, 'Обработка на сервере…');
  else showProgress(pct, 'Загрузка');
}

async function loadCatalog() {
  try {
    const tales = await api('/catalog');
    catalogById = {};
    tales.forEach(function (t) { catalogById[t.id] = t; });
    renderCatalog(tales);
  } catch (e) { console.error('catalog load failed', e); }
}

function fmtDate(s) { return s ? new Date(s).toLocaleDateString('ru') : '—'; }

function renderCatalog(tales) {
  const tbody = document.getElementById('catalog-table-body');
  if (!tbody) return;
  tbody.innerHTML = tales.map(function (t) {
    const title = (t.titles && (t.titles.ru || Object.values(t.titles)[0])) || t.id;
    const langs = (t.langs || []).join(', ');
    return '<tr>' +
      '<td><code>' + esc(t.id) + '</code></td>' +
      '<td>' + esc(title) + '</td>' +
      '<td><span class="badge badge-' + esc(t.status) + '">' + esc(t.status) + '</span></td>' +
      '<td>' + (t.comingSoon ? '🕓' : '—') + '</td>' +
      '<td>' + fmtDate(t.createdAt) + '</td>' +
      '<td>' + esc(langs) + '</td>' +
      '<td><button class="btn btn-sm" onclick="checkTaleRow(\'' + esc(t.id) + '\', this)">проверить</button></td>' +
      '<td><button class="btn btn-sm" onclick="openTale(\'' + esc(t.id) + '\')">Ред.</button> ' +
      '<button class="btn btn-danger btn-sm" onclick="removeTale(\'' + esc(t.id) + '\')">Удалить</button></td>' +
      '</tr>';
  }).join('');
}

function setTaleMsg(msg, ok) {
  const el = document.getElementById('tale-msg');
  el.textContent = msg || '';
  el.style.color = ok ? '#2ecc71' : '';
}
function taleModal() { return document.getElementById('tale-modal-overlay'); }

// One upload row per language; translations are optional.
function renderScenarioRows() {
  const wrap = document.getElementById('tale-scenario-rows');
  if (!wrap) return;
  wrap.innerHTML = CATALOG_LANGS.map(function (l) {
    const n = (taleDetailPages && taleDetailPages[l]) ? taleDetailPages[l].length : 0;
    const status = n > 0
      ? '<span class="scenario-count ok">✓ ' + n + ' стр.</span>'
      : '<span class="scenario-count">— не загружен</span>';
    return '<div class="scenario-row">' +
      '<span class="scenario-lang">' + l + '</span>' +
      status +
      '<input type="file" id="scen-file-' + l + '" accept=".json,application/json">' +
      '<button class="btn btn-sm" onclick="uploadScenarioLang(\'' + l + '\')">Загрузить</button>' +
      '</div>';
  }).join('');
}

function renderIllMissing(d) {
  const el = document.getElementById('tale-ill-missing');
  if (!el) return;
  const textPages = Math.max(0, ...CATALOG_LANGS.map(function (l) {
    return (d.pagesByLang && d.pagesByLang[l]) ? d.pagesByLang[l].length : 0;
  }));
  const map = {};
  (d.illustrations || []).forEach(function (x) { map[x.page] = x; });
  const illCount = (d.illustrations || []).length;
  if (!textPages) {
    el.style.color = '';
    el.textContent = 'Загружено иллюстрированных страниц: ' + illCount + '. (Загрузите сценарий, чтобы увидеть, каких страниц не хватает.)';
    return;
  }
  const missing = [];
  for (let p = 0; p < textPages; p++) {
    const v = map[p];
    if (!v) missing.push('стр.' + p + ' (нет)');
    else if ((v.boy || v.girl) && !(v.boy && v.girl)) missing.push('стр.' + p + ' (только ' + (v.boy ? 'boy' : 'girl') + ')');
  }
  if (missing.length) {
    el.style.color = '';
    el.innerHTML = '⚠️ Не хватает (' + missing.length + '): ' + missing.map(esc).join(', ');
  } else {
    el.style.color = '#2ecc71';
    el.textContent = '✅ Все ' + textPages + ' страниц с иллюстрациями.';
  }
}

async function refreshTaleAssets(id) {
  try {
    const d = await api('/catalog/' + encodeURIComponent(id));
    taleDetailPages = d.pagesByLang || {};
    renderScenarioRows();
    renderIllMissing(d);
  } catch (e) { /* ignore */ }
}

function clearTaleForm() {
  document.getElementById('tale-id').value = '';
  CATALOG_LANGS.forEach(function (l) { document.getElementById('tale-title-' + l).value = ''; });
  document.getElementById('tale-status').value = 'active';
  document.getElementById('tale-free').checked = false;
  document.getElementById('tale-coming').checked = false;
  document.getElementById('tale-cover-preview').innerHTML = '';
  document.getElementById('tale-ill-preview').innerHTML = '';
  document.getElementById('tale-check-result').innerHTML = '';
  const zf = document.getElementById('tale-ill-zip'); if (zf) zf.value = '';
  const mi = document.getElementById('tale-ill-missing'); if (mi) mi.textContent = '';
  hideProgress();
  setTaleMsg('');
  taleDetailPages = {};
  renderScenarioRows();
}

async function openTale(id) {
  clearTaleForm();
  if (id) {
    document.getElementById('tale-modal-title').textContent = 'Сказка: ' + id;
    document.getElementById('tale-id').value = id;
    document.getElementById('tale-id').readOnly = true;
    try {
      const d = await api('/catalog/' + encodeURIComponent(id));
      document.getElementById('tale-status').value = d.status || 'active';
      document.getElementById('tale-free').checked = !!d.free;
      document.getElementById('tale-coming').checked = !!d.comingSoon;
      CATALOG_LANGS.forEach(function (l) { document.getElementById('tale-title-' + l).value = (d.titles && d.titles[l]) || ''; });
      taleDetailPages = d.pagesByLang || {};
      renderScenarioRows();
      renderIllMissing(d);
      if (d.cover) document.getElementById('tale-cover-preview').innerHTML = '<span class="hint">Обложка загружена ✓</span>';
    } catch (e) { setTaleMsg(e.message); }
  } else {
    document.getElementById('tale-modal-title').textContent = 'Новая сказка';
    document.getElementById('tale-id').readOnly = false;
  }
  taleModal().classList.add('active');
}

async function saveTaleBasic() {
  const id = document.getElementById('tale-id').value.trim();
  if (!id) { setTaleMsg('Укажите ID'); return; }
  const titles = {};
  CATALOG_LANGS.forEach(function (l) { const v = document.getElementById('tale-title-' + l).value.trim(); if (v) titles[l] = v; });
  const free = document.getElementById('tale-free').checked;
  const comingSoon = document.getElementById('tale-coming').checked;
  const status = document.getElementById('tale-status').value;
  const isEdit = document.getElementById('tale-id').readOnly;
  try {
    if (isEdit) {
      await api('/catalog/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({ titles: titles, free: free, comingSoon: comingSoon, status: status }) });
    } else {
      if (Object.keys(titles).length === 0) { setTaleMsg('Добавьте хотя бы одно название'); return; }
      await api('/catalog', { method: 'POST', body: JSON.stringify({ id: id, titles: titles, free: free, comingSoon: comingSoon }) });
      document.getElementById('tale-id').readOnly = true;
      if (status !== 'active') await api('/catalog/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({ status: status }) });
      document.getElementById('tale-modal-title').textContent = 'Сказка: ' + id;
    }
    setTaleMsg('Сохранено ✓', true);
    loadCatalog();
  } catch (e) { setTaleMsg(e.message); }
}

async function uploadScenarioLang(lang) {
  const id = document.getElementById('tale-id').value.trim();
  const input = document.getElementById('scen-file-' + lang);
  const f = input ? input.files[0] : null;
  if (!id) { setTaleMsg('Сначала сохраните основное (ID)'); return; }
  if (!f) { setTaleMsg('Выберите файл сценария для ' + lang); return; }
  showProgress(0, 'Загрузка');
  try {
    const r = await catalogUpload('/catalog/' + encodeURIComponent(id) + '/scenario?lang=' + encodeURIComponent(lang), f, uploadProgress);
    hideProgress();
    if (!taleDetailPages) taleDetailPages = {};
    taleDetailPages[r.lang || lang] = new Array(r.pages || 0);
    renderScenarioRows();
    setTaleMsg('Сценарий ' + (r.lang || lang) + ': ' + (r.pages || 0) + ' стр.' + (r.warning ? ' — ' + r.warning : ''), true);
    loadCatalog();
  } catch (e) { hideProgress(); setTaleMsg(e.message); }
}

async function uploadTaleCover() {
  const id = document.getElementById('tale-id').value.trim();
  const f = document.getElementById('tale-cover-file').files[0];
  if (!id) { setTaleMsg('Сначала сохраните основное (ID)'); return; }
  if (!f) { setTaleMsg('Выберите файл обложки'); return; }
  showProgress(0, 'Загрузка');
  try {
    const r = await catalogUpload('/catalog/' + encodeURIComponent(id) + '/cover', f, uploadProgress);
    hideProgress();
    document.getElementById('tale-cover-preview').innerHTML = '<img src="' + URL.createObjectURL(f) + '" class="thumb"><span class="hint">Загружено ' + r.width + 'x' + r.height + '</span>';
    setTaleMsg('Обложка загружена ✓', true);
  } catch (e) { hideProgress(); setTaleMsg(e.message); }
}

async function uploadTaleIllustration() {
  const id = document.getElementById('tale-id').value.trim();
  const page = document.getElementById('tale-ill-page').value;
  const gender = document.getElementById('tale-ill-gender').value;
  const f = document.getElementById('tale-ill-file').files[0];
  if (!id) { setTaleMsg('Сначала сохраните основное (ID)'); return; }
  if (page === '') { setTaleMsg('Укажите номер страницы'); return; }
  if (!f) { setTaleMsg('Выберите файл иллюстрации'); return; }
  const query = gender ? ('?gender=' + gender) : '';
  showProgress(0, 'Загрузка');
  try {
    const r = await catalogUpload('/catalog/' + encodeURIComponent(id) + '/illustration/' + encodeURIComponent(page) + query, f, uploadProgress);
    hideProgress();
    document.getElementById('tale-ill-preview').innerHTML = '<img src="' + URL.createObjectURL(f) + '" class="thumb"><span class="hint">Стр. ' + r.page + ' ' + (gender || 'plain') + ' — ' + r.width + 'x' + r.height + '</span>';
    setTaleMsg('Иллюстрация загружена ✓', true);
    await refreshTaleAssets(id);
  } catch (e) { hideProgress(); setTaleMsg(e.message); }
}

async function uploadIllustrationsZip() {
  const id = document.getElementById('tale-id').value.trim();
  const f = document.getElementById('tale-ill-zip').files[0];
  if (!id) { setTaleMsg('Сначала сохраните основное (ID)'); return; }
  if (!f) { setTaleMsg('Выберите zip-архив'); return; }
  setTaleMsg('');
  showProgress(0, 'Загрузка');
  try {
    const r = await catalogUpload('/catalog/' + encodeURIComponent(id) + '/illustrations-zip', f, uploadProgress);
    hideProgress();
    const up = (r.uploaded || []).length;
    const sk = (r.skipped || []).length;
    setTaleMsg('Архив: загружено ' + up + ' файлов' + (sk ? (', пропущено ' + sk + ' (' + (r.skipped || []).slice(0, 5).join(', ') + (sk > 5 ? '…' : '') + ')') : ''), true);
    await refreshTaleAssets(id);
    loadCatalog();
  } catch (e) { hideProgress(); setTaleMsg(e.message); }
}

async function runContentCheck() {
  const id = document.getElementById('tale-id').value.trim();
  if (!id) { setTaleMsg('Укажите ID'); return; }
  try { renderCheck(await api('/catalog/' + encodeURIComponent(id) + '/content-check')); }
  catch (e) { setTaleMsg(e.message); }
}

function renderCheck(r) {
  const el = document.getElementById('tale-check-result');
  const badge = r.ok ? '<span class="badge badge-available">Контент OK</span>' : '<span class="badge badge-used">Есть проблемы</span>';
  const issues = (r.issues || []).map(function (i) { return '<li>❌ ' + esc(i) + '</li>'; }).join('');
  const warns = (r.warnings || []).map(function (i) { return '<li>⚠️ ' + esc(i) + '</li>'; }).join('');
  el.innerHTML = badge +
    (issues ? '<ul class="check-issues">' + issues + '</ul>' : '') +
    (warns ? '<ul class="check-warn">' + warns + '</ul>' : '') +
    '<p class="hint">Иллюстраций: ' + (r.illustratedPages || []).length + ', обложка: ' + (r.cover ? 'да' : 'нет') + ', размер: ' + ((r.downloadSize || 0) / 1048576).toFixed(1) + ' MB</p>';
}

async function checkTaleRow(id, btn) {
  btn.textContent = '...';
  try {
    const r = await api('/catalog/' + encodeURIComponent(id) + '/content-check');
    btn.textContent = r.ok ? '✓ ок' : ('✗ ' + (r.issues || []).length);
    btn.title = (r.issues || []).join('; ');
    btn.className = 'btn btn-sm ' + (r.ok ? 'btn-outline' : 'btn-danger');
  } catch (e) { btn.textContent = 'ошибка'; }
}

async function removeTale(id) {
  if (!confirm('Мягко удалить сказку "' + id + '"? Клиент подчистит локальный кэш.')) return;
  try { await api('/catalog/' + encodeURIComponent(id), { method: 'DELETE' }); loadCatalog(); }
  catch (e) { alert(e.message); }
}

(function wireCatalog() {
  const q = function (id) { return document.getElementById(id); };
  const navBtn = document.querySelector('[data-tab="catalog"]');
  if (navBtn) navBtn.addEventListener('click', loadCatalog);
  if (q('catalog-refresh-btn')) q('catalog-refresh-btn').addEventListener('click', loadCatalog);
  if (q('add-tale-btn')) q('add-tale-btn').addEventListener('click', function () { openTale(null); });
  if (q('tale-modal-close')) q('tale-modal-close').addEventListener('click', function () { taleModal().classList.remove('active'); });
  if (taleModal()) taleModal().addEventListener('click', function (e) { if (e.target === taleModal()) taleModal().classList.remove('active'); });
  if (q('tale-save-btn')) q('tale-save-btn').addEventListener('click', saveTaleBasic);
  if (q('tale-cover-upload')) q('tale-cover-upload').addEventListener('click', uploadTaleCover);
  if (q('tale-ill-upload')) q('tale-ill-upload').addEventListener('click', uploadTaleIllustration);
  if (q('tale-ill-zip-upload')) q('tale-ill-zip-upload').addEventListener('click', uploadIllustrationsZip);
  if (q('tale-check-btn')) q('tale-check-btn').addEventListener('click', runContentCheck);
})();

// ============ Device logs (remote log mirror + kill-switch) — added ============
// Reads the mirrored Unity log stream and drives the server-side kill-switch
// through our BFF (/api/logs/* → Fairy /api/debug/logs + /api/admin/debug/log-config).

async function loadLogsConfig() {
  const statusEl = document.getElementById('logs-cfg-status');
  try {
    const rows = await api('/logs/config');
    const global = (Array.isArray(rows) ? rows : []).find(function (r) { return r.user_id === '*'; });
    const enabled = document.getElementById('logs-enabled');
    const level = document.getElementById('logs-level');
    if (global) {
      if (enabled) enabled.checked = !!global.enabled;
      if (level) level.value = global.level || 'all';
      if (statusEl) statusEl.textContent = 'сейчас: ' + (global.enabled ? 'ВКЛ' : 'ВЫКЛ') + ', ' + (global.level || 'all');
    } else {
      if (enabled) enabled.checked = true;
      if (level) level.value = 'all';
      if (statusEl) statusEl.textContent = 'политика не задана (дефолт: ВКЛ, all)';
    }
  } catch (e) { if (statusEl) statusEl.textContent = 'не удалось загрузить: ' + e.message; }
}

async function saveLogsConfig() {
  const statusEl = document.getElementById('logs-cfg-status');
  const enabled = document.getElementById('logs-enabled').checked;
  const level = document.getElementById('logs-level').value;
  try {
    await api('/logs/config', { method: 'PUT', body: JSON.stringify({ enabled: enabled, level: level }) });
    if (statusEl) statusEl.textContent = 'сохранено: ' + (enabled ? 'ВКЛ' : 'ВЫКЛ') + ', ' + level;
  } catch (e) { if (statusEl) statusEl.textContent = 'ошибка: ' + e.message; alert(e.message); }
}

// Map Unity log levels to a colour class.
const LOG_LEVELS = { Error: 'err', Exception: 'err', Assert: 'err', Warning: 'warn', Log: 'log' };

async function loadLogs() {
  const listEl = document.getElementById('logs-list');
  if (listEl) listEl.innerHTML = '<p class="hint">Загрузка…</p>';
  const params = new URLSearchParams();
  const u = document.getElementById('logs-user').value.trim();
  const s = document.getElementById('logs-session').value.trim();
  const lv = document.getElementById('logs-filter-level').value;
  const lim = document.getElementById('logs-limit').value;
  if (u) params.set('userId', u);
  if (s) params.set('session', s);
  if (lv) params.set('level', lv);
  if (lim) params.set('limit', lim);
  const qs = params.toString();
  try {
    const rows = await api('/logs' + (qs ? '?' + qs : ''));
    renderLogs(Array.isArray(rows) ? rows : []);
  } catch (e) {
    if (listEl) listEl.innerHTML = '<p class="hint">Ошибка: ' + esc(e.message) + '</p>';
  }
}

function renderLogs(list) {
  const el = document.getElementById('logs-list');
  if (!el) return;
  if (!list.length) { el.innerHTML = '<p class="hint">Строк лога нет. Укажи userId или session и нажми «Показать».</p>'; return; }
  el.innerHTML = list.map(function (r) {
    const cls = LOG_LEVELS[r.level] || 'log';
    const when = new Date(r.client_ts || r.received_at).toLocaleString('ru');
    const sess = r.session ? '<code>' + esc(String(r.session)) + '</code>' : '';
    const usr = r.user_id ? '<code>' + esc(String(r.user_id).slice(0, 12)) + '</code>' : '';
    const stack = r.stack ? '<pre class="log-stack">' + esc(r.stack) + '</pre>' : '';
    return '<div class="log-line log-' + cls + '">' +
      '<span class="log-lvl log-lvl-' + cls + '">' + esc(r.level || '?') + '</span>' +
      '<div class="log-body">' +
      '<div class="log-msg">' + esc(r.message || '') + '</div>' +
      stack +
      '<div class="log-meta">' + when + ' ' + sess + ' ' + usr + '</div>' +
      '</div></div>';
  }).join('');
}

(function wireLogs() {
  const q = function (id) { return document.getElementById(id); };
  const navBtn = document.querySelector('[data-tab="logs"]');
  if (navBtn) navBtn.addEventListener('click', function () { loadLogsConfig(); loadLogs(); });
  if (q('logs-refresh-btn')) q('logs-refresh-btn').addEventListener('click', function () { loadLogsConfig(); loadLogs(); });
  if (q('logs-apply-btn')) q('logs-apply-btn').addEventListener('click', loadLogs);
  if (q('logs-save-cfg')) q('logs-save-cfg').addEventListener('click', saveLogsConfig);
  // Enter in a filter field triggers a search.
  ['logs-user', 'logs-session', 'logs-limit'].forEach(function (id) {
    const inp = q(id);
    if (inp) inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') loadLogs(); });
  });
})();

// ============ Analytics (Firebase mirror via Fairy backend) — added ============
// Reads the read-only mirror through our own BFF (/api/analytics/* → Fairy).
// Firebase GA4 stays the source of truth; this is the quick in-site view.
const AN_EVENTS = {
  paywall_view:     'Показан пейволл',
  paywall_dismiss:  'Пейволл закрыт без покупки',
  purchase_start:   'Нажата кнопка покупки',
  purchase_success: 'Покупка подтверждена',
  purchase_error:   'Ошибка/отмена покупки',
  purchase_restore: 'Восстановление покупок',
  promo_redeem:     'Активирован промокод',
  tale_complete:    'Сказка дочитана до конца'
};
// Where paywalls are triggered from (source param) — readable labels.
const AN_SOURCE_LABELS = {
  tale_locked: 'Из закрытой сказки',
  library: 'Из библиотеки',
  narrate: 'Из озвучки',
  parent_voice: 'Клонирование голоса',
  first_read: 'Первое чтение',
  onboarding: 'Онбординг',
  settings: 'Настройки',
  deep_link: 'Deep link'
};
let anAutoTimer = null;
let anTitles = {};    // tale_id -> human title (from catalog)
let anCatalog = [];   // [{id, title, comingSoon}] — full catalog for the grid
let anTaleStats = {}; // tale_id -> {completions, avg_duration_ms} from insights

function anSince() {
  const h = parseInt(document.getElementById('an-range').value, 10) || 24;
  return new Date(Date.now() - h * 3600 * 1000).toISOString();
}
function anFmt(t) { return t ? new Date(t).toLocaleString('ru') : '—'; }
function anFmtDur(ms) {
  if (!ms) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return s + ' с';
  return Math.floor(s / 60) + ' мин ' + (s % 60) + ' с';
}
function anMoney(rev) {
  const parts = Object.keys(rev || {});
  if (!parts.length) return '0';
  return parts.map(function (c) { return (Math.round(rev[c] * 100) / 100) + ' ' + c; }).join(' + ');
}
function anMax(arr) { return Math.max.apply(null, [1].concat(arr)); }

async function loadAnalytics() {
  const status = document.getElementById('an-status');
  if (status) status.textContent = 'Загрузка…';
  const since = encodeURIComponent(anSince());
  try {
    const platform = document.getElementById('an-platform').value;
    const platQ = platform ? '&platform=' + encodeURIComponent(platform) : '';
    const nameF = document.getElementById('an-f-name').value.trim();
    const sessF = document.getElementById('an-f-session').value.trim();
    const userF = document.getElementById('an-f-user').value.trim();
    const evQuery = '/analytics/events?limit=200&since=' + since + platQ +
      (nameF ? '&name=' + encodeURIComponent(nameF) : '') +
      (sessF ? '&session=' + encodeURIComponent(sessF) : '') +
      (userF ? '&userId=' + encodeURIComponent(userF) : '');
    const results = await Promise.all([
      api('/analytics/insights?since=' + since + platQ),
      api(evQuery)
    ]);
    const ins = results[0] || {};
    const events = results[1] || [];
    renderAnKpi(ins.totals || {});
    renderAnFunnel(ins.funnel || {});
    renderAnDaily(ins.daily || []);
    renderAnSources(ins.sources || []);
    renderAnPlatProducts(ins.platforms || [], ins.products || []);
    setTaleStats(ins.topTales || []);
    renderAllTales();
    renderAnEvents(events);
    const total = (ins.totals && ins.totals.events) || 0;
    if (status) status.textContent = 'Обновлено ' + new Date().toLocaleTimeString('ru') + ' · ' + total + ' событий за период';
  } catch (e) {
    if (status) status.textContent = 'Ошибка: ' + e.message;
  }
}

function anKpiCard(icon, val, label) {
  return '<div class="kpi-card"><div class="kpi-icon">' + icon + '</div>' +
    '<div class="kpi-val">' + esc(String(val)) + '</div>' +
    '<div class="kpi-label">' + esc(label) + '</div></div>';
}
function renderAnKpi(t) {
  const el = document.getElementById('an-kpi');
  if (!el) return;
  el.innerHTML =
    anKpiCard('💰', anMoney(t.revenue), 'Доход за период') +
    anKpiCard('🛒', t.purchases || 0, 'Покупок') +
    anKpiCard('🎁', t.trials || 0, 'из них пробных') +
    anKpiCard('📖', t.completions || 0, 'Сказок дочитано') +
    anKpiCard('👤', t.sessions || 0, 'Сессий') +
    anKpiCard('📊', t.events || 0, 'Всего событий');
}

function anFunnelRow(label, count, max, sub, cls) {
  const w = max > 0 ? Math.max(count / max * 100, 3) : 3;
  return '<div class="funnel-row">' +
    '<div class="funnel-head"><span class="funnel-name">' + esc(label) + '</span>' +
    (sub ? '<span class="funnel-pct">' + esc(sub) + '</span>' : '') + '</div>' +
    '<div class="funnel-bar-wrap"><div class="funnel-bar ' + (cls || '') + '" style="width:' + w + '%">' + count + '</div></div>' +
    '</div>';
}
function renderAnFunnel(f) {
  const el = document.getElementById('an-funnel');
  if (!el) return;
  const view = f.paywall_view || 0, start = f.purchase_start || 0, ok = f.purchase_success || 0;
  const max = anMax([view, start, ok]);
  const pct = function (a, b) { return b > 0 ? Math.round(a / b * 100) + '%' : '—'; };
  el.innerHTML =
    anFunnelRow('Показан пейволл', view, max, null, 'f1') +
    anFunnelRow('Нажали «купить»', start, max, pct(start, view) + ' от показов', 'f2') +
    anFunnelRow('Купили', ok, max, pct(ok, start) + ' от нажатий · ' + pct(ok, view) + ' общая', 'f3') +
    '<div class="funnel-secondary">' +
      '<span>Закрыли пейволл: <b>' + (f.paywall_dismiss || 0) + '</b></span>' +
      '<span>Ошибки/отмены: <b>' + (f.purchase_error || 0) + '</b></span>' +
      '<span>Восстановления: <b>' + (f.purchase_restore || 0) + '</b></span>' +
      '<span>Промокоды: <b>' + (f.promo_redeem || 0) + '</b></span>' +
    '</div>';
}

function renderAnDaily(daily) {
  const el = document.getElementById('an-daily');
  if (!el) return;
  if (!daily.length) { el.innerHTML = '<p class="hint">Нет данных за период</p>'; return; }
  const max = anMax(daily.map(function (d) { return Math.max(d.paywall_view, d.purchase_success); }));
  el.innerHTML = daily.map(function (d) {
    const h1 = Math.max(d.paywall_view / max * 120, d.paywall_view ? 3 : 0);
    const h2 = Math.max(d.purchase_success / max * 120, d.purchase_success ? 3 : 0);
    return '<div class="daily-col" title="' + d.date + ' — показы: ' + d.paywall_view + ', покупки: ' + d.purchase_success + '">' +
      '<div class="daily-bars">' +
        '<div class="daily-bar dot-purple" style="height:' + h1 + 'px"></div>' +
        '<div class="daily-bar dot-green" style="height:' + h2 + 'px"></div>' +
      '</div><span class="daily-date">' + esc(d.date.slice(5)) + '</span></div>';
  }).join('');
}

function anBarList(items, labelFn) {
  if (!items.length) return '<p class="hint">Нет данных</p>';
  const max = anMax(items.map(function (i) { return i.count; }));
  return items.map(function (it) {
    const w = Math.max(it.count / max * 100, 3);
    return '<div class="bar-row"><span class="bar-label">' + esc(labelFn(it)) + '</span>' +
      '<div class="bar-track"><div class="bar-fill" style="width:' + w + '%"></div></div>' +
      '<span class="bar-count">' + it.count + '</span></div>';
  }).join('');
}
function renderAnSources(sources) {
  const el = document.getElementById('an-sources');
  if (!el) return;
  el.innerHTML = anBarList(sources, function (s) { return AN_SOURCE_LABELS[s.source] || s.source || '—'; });
}
function renderAnPlatProducts(platforms, products) {
  const el = document.getElementById('an-platproducts');
  if (!el) return;
  const prodItems = products.map(function (p) { return { count: p.count, _p: p }; });
  el.innerHTML =
    '<div class="sub-title">Платформы</div>' +
    anBarList(platforms, function (p) { return p.platform; }) +
    '<div class="sub-title" style="margin-top:14px">Продукты</div>' +
    (prodItems.length
      ? anBarList(prodItems, function (x) { return x._p.product_id + ' · ' + (Math.round(x._p.revenue * 100) / 100) + ' ' + x._p.currency; })
      : '<p class="hint">Покупок пока нет</p>');
}

// Locally-cached first-illustration thumbnail (generated by gen-tale-thumbs.js).
function anThumb(id) { return '/tale-thumbs/' + encodeURIComponent(id) + '.jpg'; }

// Reading stats (completions/avg) from the latest insights, keyed by tale_id.
function setTaleStats(top) {
  anTaleStats = {};
  (top || []).forEach(function (t) { anTaleStats[t.tale_id] = t; });
}

// Full tale grid (all tales, searchable) — the whole catalog, most-read first.
function renderAllTales() {
  const el = document.getElementById('an-tales');
  if (!el) return;
  const searchEl = document.getElementById('an-tale-search');
  const needle = (searchEl ? searchEl.value : '').trim().toLowerCase();
  let list = anCatalog.slice();
  if (needle) {
    list = list.filter(function (t) {
      return (t.title || '').toLowerCase().indexOf(needle) >= 0 || t.id.toLowerCase().indexOf(needle) >= 0;
    });
  }
  list.sort(function (a, b) {
    const ca = (anTaleStats[a.id] && anTaleStats[a.id].completions) || 0;
    const cb = (anTaleStats[b.id] && anTaleStats[b.id].completions) || 0;
    if (cb !== ca) return cb - ca;
    return (a.title || '').localeCompare(b.title || '', 'ru');
  });
  if (!anCatalog.length) { el.innerHTML = '<p class="hint">Загрузка каталога…</p>'; return; }
  if (!list.length) { el.innerHTML = '<p class="hint">Ничего не найдено.</p>'; return; }
  el.innerHTML = list.map(function (t) {
    const st = anTaleStats[t.id];
    const stat = st && st.completions
      ? '<div class="tale-stat">📖 ' + st.completions + ' дочит. · ⏱ ' + anFmtDur(st.avg_duration_ms) + '</div>'
      : '<div class="tale-stat muted-id">нет дочитываний</div>';
    const soon = t.comingSoon ? '<span class="tale-badge">скоро</span>' : '';
    return '<div class="tale-card" onclick="openTaleAnalytics(\'' + esc(t.id) + '\')" title="Открыть детальную аналитику">' +
      '<div class="tale-cover" style="background-image:url(\'' + anThumb(t.id) + '\')">' + soon + '</div>' +
      '<div class="tale-info"><div class="tale-title">' + esc(t.title) + '</div>' + stat + '</div></div>';
  }).join('');
}

async function anLoadTitles() {
  try {
    const tales = await api('/catalog');
    anTitles = {};
    anCatalog = tales
      .filter(function (t) { return t.status !== 'removed'; })
      .map(function (t) {
        const title = (t.titles && (t.titles.ru || Object.values(t.titles)[0])) || t.id;
        anTitles[t.id] = title;
        return { id: t.id, title: title, comingSoon: !!t.comingSoon };
      });
    renderAllTales();
  } catch (_) { /* ignore */ }
}

// ---- Per-tale deep dive ----
async function openTaleAnalytics(id) {
  if (!id) return;
  const modal = document.getElementById('an-tale-modal');
  document.getElementById('an-tale-mtitle').textContent = 'Аналитика: ' + (anTitles[id] || id);
  document.getElementById('an-tale-cover').style.backgroundImage = "url('" + anThumb(id) + "')";
  document.getElementById('an-tale-kpis').innerHTML = '';
  document.getElementById('an-tale-retention').innerHTML = '';
  document.getElementById('an-tale-exits').innerHTML = '';
  document.getElementById('an-tale-dwell').innerHTML = '';
  document.getElementById('an-tale-status').textContent = 'Загрузка…';
  modal.classList.add('active');
  try {
    const since = encodeURIComponent(anSince());
    const platform = document.getElementById('an-platform').value;
    const platQ = platform ? '&platform=' + encodeURIComponent(platform) : '';
    const d = await api('/analytics/tale/' + encodeURIComponent(id) + '?since=' + since + platQ);
    renderTaleAnalytics(d);
  } catch (e) {
    document.getElementById('an-tale-status').textContent = 'Ошибка: ' + e.message;
  }
}

function renderTaleAnalytics(d) {
  const t = d.totals || {};
  document.getElementById('an-tale-status').textContent = '';
  document.getElementById('an-tale-kpis').innerHTML =
    anKpiCard('👀', t.opens || 0, 'Открытий') +
    anKpiCard('📖', t.completions || 0, 'Дочитано') +
    anKpiCard('✅', (t.completionRate != null ? t.completionRate + '%' : '—'), 'Доля дочитавших') +
    anKpiCard('⏱', anFmtDur(t.avgDurationMs), 'Ср. время чтения');

  // Retention curve
  const reach = d.pageReach || [];
  const retEl = document.getElementById('an-tale-retention');
  if (!reach.length) {
    retEl.innerHTML = '<p class="hint">Нет постраничных событий за период. Появится, когда клиент начнёт слать <code>tale_open</code> / <code>tale_page_view</code> / <code>tale_abandon</code> в зеркало (добавлено в тикет клиенту).</p>';
  } else {
    const map = {};
    reach.forEach(function (r) { map[r.page] = r.sessions; });
    const maxPage = Math.max.apply(null, reach.map(function (r) { return r.page; }));
    const pages = t.totalPages || (maxPage + 1);
    const base = map[0] || Math.max.apply(null, reach.map(function (r) { return r.sessions; })) || 1;
    let html = '';
    for (let p = 0; p < pages; p++) {
      const s = map[p] || 0;
      const pct = base > 0 ? Math.round(s / base * 100) : 0;
      const w = Math.max(s / base * 100, s ? 2 : 0);
      const drop = p > 0 && (map[p - 1] || 0) > 0 && s < (map[p - 1] || 0);
      html += '<div class="ret-row"><span class="ret-page">стр. ' + p + '</span>' +
        '<div class="ret-track"><div class="ret-fill' + (drop ? ' ret-drop' : '') + '" style="width:' + w + '%"></div></div>' +
        '<span class="ret-val">' + s + ' <span class="muted-id">(' + pct + '%)</span></span></div>';
    }
    retEl.innerHTML = html;
  }

  // Exit pages
  const exEl = document.getElementById('an-tale-exits');
  exEl.innerHTML = (d.exits && d.exits.length)
    ? anBarList(d.exits.map(function (e) { return { count: e.exits, page: e.page }; }), function (x) { return 'стр. ' + x.page; })
    : '<p class="hint">Нет данных о выходах (tale_abandon).</p>';

  // Dwell per page (time, not count → custom render)
  const dwEl = document.getElementById('an-tale-dwell');
  if (d.dwell && d.dwell.length) {
    const dmax = Math.max.apply(null, [1].concat(d.dwell.map(function (x) { return x.avg_dwell_ms; })));
    dwEl.innerHTML = d.dwell.map(function (x) {
      const w = Math.max(x.avg_dwell_ms / dmax * 100, 3);
      return '<div class="bar-row"><span class="bar-label">стр. ' + x.page + '</span>' +
        '<div class="bar-track"><div class="bar-fill" style="width:' + w + '%"></div></div>' +
        '<span class="bar-count">' + anFmtDur(x.avg_dwell_ms) + '</span></div>';
    }).join('');
  } else {
    dwEl.innerHTML = '<p class="hint">Нет данных о времени на странице.</p>';
  }
}

function renderAnEvents(rows) {
  const tbody = document.getElementById('an-events-body');
  if (!tbody) return;
  if (!rows.length) { tbody.innerHTML = '<tr><td colspan="5" class="hint">Нет событий по фильтру за период</td></tr>'; return; }
  tbody.innerHTML = rows.map(function (e) {
    const known = AN_EVENTS[e.name];
    const params = e.params ? esc(JSON.stringify(e.params)) : '—';
    return '<tr>' +
      '<td class="muted-id">' + anFmt(e.received_at) + '</td>' +
      '<td>' + (known ? '' : '<span class="badge badge-used">?</span> ') + '<code>' + esc(e.name) + '</code></td>' +
      '<td>' + esc(e.platform || '—') + ' <span class="muted-id">v' + esc(e.app_version || '?') + '</span></td>' +
      '<td><span class="muted-id">' + esc(e.user_id || 'anon') + '</span><br><code>' + esc(e.session || '—') + '</code></td>' +
      '<td class="an-params">' + params + '</td>' +
      '</tr>';
  }).join('');
}

function renderAnLegend() {
  const tbody = document.getElementById('an-legend-body');
  if (!tbody || tbody.children.length) return;
  tbody.innerHTML = Object.keys(AN_EVENTS).map(function (n) {
    return '<tr><td><code>' + esc(n) + '</code></td><td>' + esc(AN_EVENTS[n]) + '</td></tr>';
  }).join('');
}

(function wireAnalytics() {
  const q = function (id) { return document.getElementById(id); };
  const navBtn = document.querySelector('[data-tab="analytics"]');
  if (navBtn) navBtn.addEventListener('click', function () { renderAnLegend(); anLoadTitles(); loadAnalytics(); });
  if (q('an-refresh-btn')) q('an-refresh-btn').addEventListener('click', loadAnalytics);
  if (q('an-apply-btn')) q('an-apply-btn').addEventListener('click', loadAnalytics);
  if (q('an-range')) q('an-range').addEventListener('change', loadAnalytics);
  if (q('an-platform')) q('an-platform').addEventListener('change', loadAnalytics);
  if (q('an-auto')) q('an-auto').addEventListener('change', function (e) {
    if (anAutoTimer) { clearInterval(anAutoTimer); anAutoTimer = null; }
    if (e.target.checked) { anAutoTimer = setInterval(loadAnalytics, 10000); loadAnalytics(); }
  });
  // Tale grid search + per-tale modal (open on card click, close on ✕ / backdrop).
  if (q('an-tale-search')) q('an-tale-search').addEventListener('input', renderAllTales);
  const tm = q('an-tale-modal');
  if (q('an-tale-mclose')) q('an-tale-mclose').addEventListener('click', function () { tm.classList.remove('active'); });
  if (tm) tm.addEventListener('click', function (e) { if (e.target === tm) tm.classList.remove('active'); });
})();

// ============ Push notifications (user campaigns via Fairy backend) ============
function pq(id) { return document.getElementById(id); }
function pushModal() { return pq('push-modal-overlay'); }

var pushTales = [];
var PUSH_STATUS_RU = {
  draft: 'черновик', scheduled: 'запланирована', sending: 'отправка…',
  sent: 'отправлена', canceled: 'отменена', failed: 'ошибка'
};

async function loadPush() {
  try {
    var res = await Promise.all([api('/push/campaigns'), api('/push/tokens/stats')]);
    renderPushCampaigns(res[0]);
    renderPushTokenStats(res[1]);
  } catch (e) {
    console.error('Failed to load push:', e);
  }
}

async function pushLoadCatalog() {
  try { pushTales = (await api('/catalog')) || []; }
  catch (e) { pushTales = []; }
  pushFillTaleSelects();
}

function pushTaleLabel(t) {
  var title = t.title;
  if (!title && t.titles) title = t.titles.ru || t.titles.kz || t.titles.en || Object.values(t.titles)[0];
  return (title || t.id) + ' (' + t.id + ')';
}

function pushFillTaleSelects() {
  var opts = pushTales.map(function (t) {
    return '<option value="' + esc(t.id) + '">' + esc(pushTaleLabel(t)) + '</option>';
  }).join('');
  if (pq('push-dl-tale')) pq('push-dl-tale').innerHTML = opts;
  if (pq('push-seg-tale')) pq('push-seg-tale').innerHTML = opts;
}

function pushStatusBadge(s) {
  return '<span class="badge push-st push-st-' + esc(s) + '">' + esc(PUSH_STATUS_RU[s] || s) + '</span>';
}

function pushAudienceSummary(a) {
  if (!a || typeof a !== 'object') return 'все';
  if (a.userId) return 'user: <code>' + esc(String(a.userId)) + '</code>';
  var parts = [];
  if (a.premium === 'paid') parts.push('платящие');
  else if (a.premium === 'free') parts.push('бесплатные');
  if (a.langs && a.langs.length) parts.push('яз: ' + esc(a.langs.join('/')));
  if (a.platforms && a.platforms.length) parts.push(esc(a.platforms.join('/')));
  if (a.genders && a.genders.length) parts.push(a.genders.indexOf('boy') >= 0 ? 'мальчики' : 'девочки');
  if (a.inactiveDays) parts.push('неактив ' + esc(String(a.inactiveDays)) + 'дн');
  if (a.taleRead && a.taleRead.taleId) parts.push((a.taleRead.read ? 'прочит. ' : 'не прочит. ') + esc(a.taleRead.taleId));
  return parts.length ? parts.join(', ') : 'все';
}

function renderPushCampaigns(list) {
  var tb = pq('push-table-body');
  if (!list || !list.length) {
    tb.innerHTML = '<tr><td colspan="6" class="hint">Кампаний пока нет</td></tr>';
    return;
  }
  tb.innerHTML = list.map(function (c) {
    var st = c.stats || {};
    var sent = (c.status === 'sent')
      ? ((st.sent || 0) + ' / ' + (st.targeted || 0) + (st.failed ? (' · ошибок ' + st.failed) : '') + (st.opened ? (' · открыто ' + st.opened) : ''))
      : '—';
    var actions = '';
    if (c.status === 'draft' || c.status === 'scheduled') {
      actions =
        '<button class="btn btn-sm" onclick="pushSend(\'' + esc(String(c.id)) + '\')">Отправить</button> ' +
        '<button class="btn btn-danger btn-sm" onclick="pushCancel(\'' + esc(String(c.id)) + '\')">Отмена</button>';
    }
    return '<tr>' +
      '<td>' + esc(c.title || '—') + '</td>' +
      '<td>' + pushStatusBadge(c.status) + '</td>' +
      '<td class="push-aud">' + pushAudienceSummary(c.audience) + '</td>' +
      '<td>' + sent + '</td>' +
      '<td>' + new Date(c.created_at).toLocaleString('ru') + '</td>' +
      '<td>' + actions + '</td>' +
      '</tr>';
  }).join('');
}

function renderPushTokenStats(stats) {
  var el = pq('push-token-stats');
  if (!stats) { el.textContent = ''; return; }
  var cfg = stats.configured ? '✅ FCM подключён' : '⚠️ FCM не настроен (отправка недоступна)';
  var plats = (stats.platforms || []).map(function (p) {
    return esc(p.platform) + ': ' + p.active + ' активных' + (p.disabled ? (' (' + p.disabled + ' отключены)') : '');
  });
  el.innerHTML = esc(cfg) + (plats.length ? ' · ' + plats.join(' · ') : ' · токенов пока нет');
}

// ----- composer -----
function openPushModal() {
  ['push-title', 'push-ru-title', 'push-ru-body', 'push-kz-title', 'push-kz-body',
   'push-en-title', 'push-en-body', 'push-uz-title', 'push-uz-body', 'push-dl-url', 'push-seg-inactive',
   'push-seg-user', 'push-test-user'].forEach(function (id) { if (pq(id)) pq(id).value = ''; });
  pq('push-dl-type').value = 'home';
  pq('push-dl-tale').style.display = 'none';
  pq('push-dl-url').style.display = 'none';
  pq('push-seg-premium').value = '';
  pq('push-seg-gender').value = '';
  document.querySelectorAll('.push-seg-lang, .push-seg-plat').forEach(function (c) { c.checked = false; });
  pq('push-seg-adv-tale').checked = false;
  pq('push-seg-tale').style.display = 'none';
  pq('push-seg-tale-read').style.display = 'none';
  var def = document.querySelector('input[name="push-default"][value="ru"]');
  if (def) def.checked = true;
  pq('push-preview-result').textContent = '';
  pq('push-test-result').textContent = '';
  pq('push-msg').textContent = '';
  pushFillTaleSelects();
  pushModal().classList.add('active');
}

function pushCollectContent() {
  var content = {};
  var any = false;
  ['ru', 'kz', 'en', 'uz'].forEach(function (l) {
    var t = (pq('push-' + l + '-title').value || '').trim();
    var b = (pq('push-' + l + '-body').value || '').trim();
    if (t || b) { content[l] = { title: t, body: b }; any = true; }
  });
  if (!any) return null;
  var def = document.querySelector('input[name="push-default"]:checked');
  content.default = def ? def.value : 'ru';
  if (!content[content.default]) {
    content.default = Object.keys(content).filter(function (k) { return k !== 'default'; })[0];
  }
  return content;
}

function pushCollectDeeplink() {
  var type = pq('push-dl-type').value;
  if (type === 'tale') {
    var id = pq('push-dl-tale').value;
    return id ? { type: 'tale', taleId: id } : { type: 'home' };
  }
  if (type === 'paywall') return { type: 'paywall' };
  if (type === 'url') {
    var u = (pq('push-dl-url').value || '').trim();
    return u ? { type: 'url', url: u } : { type: 'home' };
  }
  return { type: 'home' };
}

function pushCollectAudience() {
  var user = (pq('push-seg-user').value || '').trim();
  if (user) return { userId: user };
  var a = {};
  var prem = pq('push-seg-premium').value; if (prem) a.premium = prem;
  var gender = pq('push-seg-gender').value; if (gender) a.genders = [gender];
  var langs = Array.prototype.map.call(document.querySelectorAll('.push-seg-lang:checked'), function (c) { return c.value; });
  if (langs.length) a.langs = langs;
  var plats = Array.prototype.map.call(document.querySelectorAll('.push-seg-plat:checked'), function (c) { return c.value; });
  if (plats.length) a.platforms = plats;
  var inactive = parseInt(pq('push-seg-inactive').value, 10);
  if (inactive > 0) a.inactiveDays = inactive;
  if (pq('push-seg-adv-tale').checked) {
    var tid = pq('push-seg-tale').value;
    if (tid) a.taleRead = { taleId: tid, read: pq('push-seg-tale-read').value === 'true' };
  }
  return a;
}

async function pushPreview() {
  var el = pq('push-preview-result');
  el.textContent = 'Считаю…';
  try {
    var r = await api('/push/preview-audience', {
      method: 'POST', body: JSON.stringify({ audience: pushCollectAudience() })
    });
    el.textContent = 'Охват: ' + r.users + ' польз. / ' + r.tokens + ' устройств';
  } catch (e) { el.textContent = 'Ошибка: ' + e.message; }
}

async function pushTest() {
  var el = pq('push-test-result');
  var user = (pq('push-test-user').value || '').trim();
  if (!user) { el.textContent = 'Укажи userId'; return; }
  var content = pushCollectContent();
  if (!content) { el.textContent = 'Заполни текст хотя бы на одном языке'; return; }
  el.textContent = 'Отправляю…';
  try {
    var r = await api('/push/test', {
      method: 'POST',
      body: JSON.stringify({ userId: user, content: content, deeplink: pushCollectDeeplink() })
    });
    el.textContent = 'Готово: отправлено ' + (r.sent || 0) + ', ошибок ' + (r.failed || 0) +
      (r.targeted === 0 ? ' (нет активных токенов у этого userId)' : '');
  } catch (e) { el.textContent = 'Ошибка: ' + e.message; }
}

async function pushCreate(sendNow) {
  var msg = pq('push-msg');
  msg.textContent = '';
  var content = pushCollectContent();
  if (!content) { msg.textContent = 'Заполни текст пуша хотя бы на одном языке'; return; }
  var payload = {
    title: (pq('push-title').value || '').trim() || null,
    content: content,
    deeplink: pushCollectDeeplink(),
    audience: pushCollectAudience()
  };
  try {
    var c = await api('/push/campaigns', { method: 'POST', body: JSON.stringify(payload) });
    if (sendNow) {
      if (!confirm('Отправить пуш сейчас реальным пользователям выбранного сегмента?')) {
        pushModal().classList.remove('active');
        loadPush();
        return;
      }
      await api('/push/campaigns/' + encodeURIComponent(c.id) + '/send', { method: 'POST' });
    }
    pushModal().classList.remove('active');
    loadPush();
  } catch (e) { msg.textContent = 'Ошибка: ' + e.message; }
}

async function pushSend(id) {
  if (!confirm('Отправить кампанию сейчас?')) return;
  try { await api('/push/campaigns/' + encodeURIComponent(id) + '/send', { method: 'POST' }); loadPush(); }
  catch (e) { alert('Ошибка: ' + e.message); }
}

async function pushCancel(id) {
  if (!confirm('Отменить кампанию?')) return;
  try { await api('/push/campaigns/' + encodeURIComponent(id) + '/cancel', { method: 'POST' }); loadPush(); }
  catch (e) { alert('Ошибка: ' + e.message); }
}

(function () {
  var navBtn = document.querySelector('[data-tab="push"]');
  if (navBtn) navBtn.addEventListener('click', function () { loadPush(); pushLoadCatalog(); });
  if (pq('push-refresh-btn')) pq('push-refresh-btn').addEventListener('click', loadPush);
  if (pq('push-new-btn')) pq('push-new-btn').addEventListener('click', openPushModal);
  if (pq('push-modal-close')) pq('push-modal-close').addEventListener('click', function () { pushModal().classList.remove('active'); });
  if (pushModal()) pushModal().addEventListener('click', function (e) { if (e.target === pushModal()) pushModal().classList.remove('active'); });
  if (pq('push-dl-type')) pq('push-dl-type').addEventListener('change', function () {
    pq('push-dl-tale').style.display = (this.value === 'tale') ? '' : 'none';
    pq('push-dl-url').style.display = (this.value === 'url') ? '' : 'none';
  });
  if (pq('push-seg-adv-tale')) pq('push-seg-adv-tale').addEventListener('change', function () {
    var on = this.checked;
    pq('push-seg-tale').style.display = on ? '' : 'none';
    pq('push-seg-tale-read').style.display = on ? '' : 'none';
  });
  if (pq('push-preview-btn')) pq('push-preview-btn').addEventListener('click', pushPreview);
  if (pq('push-test-btn')) pq('push-test-btn').addEventListener('click', pushTest);
  if (pq('push-save-draft')) pq('push-save-draft').addEventListener('click', function () { pushCreate(false); });
  if (pq('push-send-now')) pq('push-send-now').addEventListener('click', function () { pushCreate(true); });
})();

// ============ Промокоды на сказки (реферальные) — added ============
// Код блогера бесплатный: сказки к нему прилагаются как причина его ввести, а
// сам код закрепляет пользователя за блогером. Связки и оплаты живут в Fairy,
// коды и статистика — здесь.

var tpCatalog = [];        // [{id, titles, ...}] — каталог сказок из Fairy
var tpBloggers = [];       // список блогеров для выпадающего списка
var tpSelected = {};       // id сказки -> true (черновик кода)
var tpEditingId = null;    // редактируем существующий код, а не создаём новый
var tpPromos = [];

function tq(id) { return document.getElementById(id); }

function tpTitle(t) {
  return (t.titles && (t.titles.ru || Object.values(t.titles)[0])) || t.id;
}

function renderTalePicker() {
  var box = tq('tp-tales-picker');
  if (!box) return;
  if (!tpCatalog.length) { box.innerHTML = '<span class="hint">каталог не загрузился</span>'; return; }
  box.innerHTML = tpCatalog.map(function (t) {
    var checked = tpSelected[t.id] ? ' checked' : '';
    return '<label class="tp-tale"><input type="checkbox" data-tale="' + esc(t.id) + '"' + checked + '> ' +
      esc(tpTitle(t)) + ' <span class="muted-id">' + esc(t.id) + '</span></label>';
  }).join('');
  box.querySelectorAll('input[data-tale]').forEach(function (cb) {
    cb.addEventListener('change', function () {
      if (this.checked) tpSelected[this.dataset.tale] = true;
      else delete tpSelected[this.dataset.tale];
    });
  });
}

function renderBloggerSelect() {
  var sel = tq('tp-blogger-input');
  if (!sel) return;
  sel.innerHTML = '<option value="">Без блогера</option>' + tpBloggers.map(function (b) {
    return '<option value="' + esc(b.id) + '">' + esc(b.name) + '</option>';
  }).join('');
}

function renderTalePromos(promos) {
  var tbody = tq('tale-promos-table-body');
  if (!tbody) return;
  if (!promos.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="hint">кодов пока нет</td></tr>';
    return;
  }
  var byId = {};
  tpCatalog.forEach(function (t) { byId[t.id] = tpTitle(t); });
  tbody.innerHTML = promos.map(function (p) {
    var tales = (p.taleIds || []).map(function (id) { return esc(byId[id] || id); }).join(', ');
    var uses = (p.useCount || 0) + ' / ' + (p.maxUses == null ? '∞' : p.maxUses);
    return '<tr>' +
      '<td><code>' + esc(p.code) + '</code></td>' +
      '<td>' + (p.label ? esc(p.label) : '—') + '</td>' +
      '<td>' + (p.bloggerName ? esc(p.bloggerName) : '—') + '</td>' +
      '<td>' + (tales || '—') + '</td>' +
      '<td>' + uses + '</td>' +
      '<td>' + new Date(p.createdAt).toLocaleDateString('ru') + '</td>' +
      '<td><button class="btn btn-sm" onclick="editTalePromo(\'' + esc(p.id) + '\')">Сказки</button> ' +
      '<button class="btn btn-danger btn-sm" onclick="deleteTalePromo(\'' + esc(p.id) + '\')">Удалить</button></td>' +
      '</tr>';
  }).join('');
}

function renderReferralSummary(data) {
  var tbody = tq('referrals-table-body');
  if (!tbody) return;
  var rows = (data && data.bloggers) || [];
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="hint">пока никого не закрепили</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(function (b) {
    return '<tr>' +
      '<td>' + (b.bloggerName ? esc(b.bloggerName) : '<span class="hint">без блогера</span>') + '</td>' +
      '<td>' + b.bindings + '</td>' +
      '<td>' + b.initial + '</td>' +
      '<td>' + b.renewals + '</td>' +
      '<td>' + b.counted + '</td>' +
      '<td>' + b.conversion + '%</td>' +
      '</tr>';
  }).join('');
}

async function loadTalePromos() {
  try {
    var results = await Promise.all([
      api('/admin/tale-promos'),
      api('/admin/bloggers'),
      api('/catalog').catch(function () { return []; }),
      api('/admin/referral-settings'),
      api('/admin/referrals').catch(function () { return { bloggers: [] }; })
    ]);
    tpPromos = results[0];
    tpBloggers = results[1];
    tpCatalog = (results[2] || []).filter(function (t) { return t.status !== 'removed'; });
    var settings = results[3];
    renderBloggerSelect();
    renderTalePicker();
    renderTalePromos(tpPromos);
    if (tq('rs-days-input')) tq('rs-days-input').value = settings.attributionDays == null ? '' : settings.attributionDays;
    if (tq('rs-renewals-input')) tq('rs-renewals-input').checked = !!settings.showRenewals;
    renderReferralSummary(results[4]);
  } catch (e) {
    console.error('tale promos load failed', e);
  }
}

// Редактирование существующего кода: сам код не меняем — он уже роздан
// аудитории. Меняется набор сказок, метка, блогер и лимит.
function editTalePromo(id) {
  var p = tpPromos.filter(function (x) { return x.id === id; })[0];
  if (!p) return;
  tpEditingId = id;
  tpSelected = {};
  (p.taleIds || []).forEach(function (t) { tpSelected[t] = true; });
  renderTalePicker();
  if (tq('tp-code-input')) { tq('tp-code-input').value = p.code; tq('tp-code-input').disabled = true; }
  if (tq('tp-label-input')) tq('tp-label-input').value = p.label || '';
  if (tq('tp-blogger-input')) tq('tp-blogger-input').value = p.bloggerId || '';
  if (tq('tp-maxuses-input')) tq('tp-maxuses-input').value = p.maxUses == null ? '' : p.maxUses;
  if (tq('tp-create-btn')) tq('tp-create-btn').textContent = 'Сохранить';
  window.scrollTo(0, 0);
}

function tpResetForm() {
  tpEditingId = null;
  tpSelected = {};
  if (tq('tp-code-input')) { tq('tp-code-input').value = ''; tq('tp-code-input').disabled = false; }
  if (tq('tp-label-input')) tq('tp-label-input').value = '';
  if (tq('tp-maxuses-input')) tq('tp-maxuses-input').value = '';
  if (tq('tp-blogger-input')) tq('tp-blogger-input').value = '';
  if (tq('tp-create-btn')) tq('tp-create-btn').textContent = 'Создать';
  renderTalePicker();
}

async function saveTalePromo() {
  var taleIds = Object.keys(tpSelected);
  if (!taleIds.length) { alert('Отметьте галочками хотя бы одну сказку'); return; }

  var body = {
    label: tq('tp-label-input').value || undefined,
    bloggerId: tq('tp-blogger-input').value || null,
    maxUses: tq('tp-maxuses-input').value || null,
    taleIds: taleIds
  };

  try {
    if (tpEditingId) {
      await api('/admin/tale-promos/' + tpEditingId, { method: 'PATCH', body: JSON.stringify(body) });
    } else {
      body.code = tq('tp-code-input').value || undefined;
      await api('/admin/tale-promos', { method: 'POST', body: JSON.stringify(body) });
    }
    tpResetForm();
    loadTalePromos();
  } catch (e) {
    alert(e.message);
  }
}

async function deleteTalePromo(id) {
  if (!confirm('Удалить код? Уже открытые сказки у пользователей останутся.')) return;
  try {
    await api('/admin/tale-promos/' + id, { method: 'DELETE' });
    if (tpEditingId === id) tpResetForm();
    loadTalePromos();
  } catch (e) {
    alert(e.message);
  }
}

async function saveReferralSettings() {
  var status = tq('rs-status');
  try {
    var days = tq('rs-days-input').value;
    await api('/admin/referral-settings', {
      method: 'PUT',
      body: JSON.stringify({
        attributionDays: days === '' ? null : days,
        showRenewals: tq('rs-renewals-input').checked
      })
    });
    if (status) status.textContent = 'сохранено — сводка пересчитана';
    loadTalePromos();
  } catch (e) {
    if (status) status.textContent = 'не сохранилось: ' + e.message;
  }
}

(function wireTalePromos() {
  var navBtn = document.querySelector('[data-tab="tale-promos"]');
  if (navBtn) navBtn.addEventListener('click', loadTalePromos);
  if (tq('tp-create-btn')) tq('tp-create-btn').addEventListener('click', saveTalePromo);
  if (tq('tp-refresh-btn')) tq('tp-refresh-btn').addEventListener('click', function () { tpResetForm(); loadTalePromos(); });
  if (tq('rs-save-btn')) tq('rs-save-btn').addEventListener('click', saveReferralSettings);
})();

// Кабинет блогера: цифры по реферальным кодам приходят из Fairy — там оплаты
// видны по факту, а не по тому, сходил ли клиент на сервер после покупки.
async function loadBloggerReferrals() {
  var section = document.getElementById('blogger-referrals-section');
  if (!section) return;
  try {
    var data = await api('/blogger/referrals');
    var row = (data.bloggers || [])[0];
    if (!row || (!row.bindings && !row.counted)) { section.style.display = 'none'; return; }
    section.style.display = '';
    document.getElementById('blogger-ref-bindings').textContent = row.bindings;
    document.getElementById('blogger-ref-counted').textContent = row.counted;
    document.getElementById('blogger-ref-conversion').textContent = row.conversion + '%';
    var note = [];
    if (data.attributionDays != null) note.push('засчитываются оплаты в первые ' + data.attributionDays + ' дней после ввода кода');
    else note.push('оплаты засчитываются без ограничения по сроку');
    note.push(data.includeRenewals ? 'продления входят в счёт' : 'продления не входят в счёт');
    document.getElementById('blogger-ref-note').textContent = note.join('; ');
  } catch (e) {
    section.style.display = 'none';
  }
}

// ─────────────────────────── Вкладка «Конкурс» ───────────────────────────
// Кабинет участника живёт на /ugc и считает активации из Fairy. Здесь — то,
// чего там быть не должно: контакты для выплат, дисквалификация и фиксация.

var ctData = null;

function ctq(id) { return document.getElementById(id); }

// Казахстан живёт без перехода на летнее время, поэтому сдвиг один и навсегда.
// Поля datetime-local показывают алматинское время, а сервер хранит UTC.
var CT_OFFSET_MS = 5 * 60 * 60 * 1000;

function ctIsoToInput(iso) {
  if (!iso) return '';
  return new Date(Date.parse(iso) + CT_OFFSET_MS).toISOString().slice(0, 16);
}

function ctInputToIso(v) {
  if (!v) return undefined;
  return new Date(Date.parse(v + ':00Z') - CT_OFFSET_MS).toISOString();
}

function ctFmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Almaty'
  });
}

function ctNum(n) { return Number(n || 0).toLocaleString('ru-RU'); }

async function loadContest() {
  var banner = ctq('ct-banner');
  if (!banner) return;
  try {
    ctData = await api('/admin/contest');
    renderContest();
  } catch (e) {
    banner.textContent = 'Не удалось загрузить конкурс: ' + e.message;
  }
}

function renderContest() {
  var d = ctData;
  if (!d) return;

  var now = Date.parse(d.serverTime);
  var starts = Date.parse(d.contest.startsAt);
  var ends = Date.parse(d.contest.endsAt);

  var banner = ctq('ct-banner');
  if (d.finalized) {
    banner.textContent = 'Итоги зафиксированы ' + ctFmtDate(d.contest.finalizedAt) +
      '. Цифры больше не меняются — страница участника читает снимок, а не живую статистику.';
  } else if (now < starts) {
    banner.textContent = 'Конкурс ещё не начался. Старт ' + ctFmtDate(d.contest.startsAt) +
      '. Коды уже работают, но активации в зачёт пойдут только со старта.';
  } else if (now < ends) {
    var hoursLeft = Math.floor((ends - now) / 3600000);
    banner.textContent = 'Конкурс идёт. До окончания ' + Math.floor(hoursLeft / 24) + ' дн. ' +
      (hoursLeft % 24) + ' ч. Цифры обновлены ' + ctFmtDate(d.computedAt) + ' (кэш — минута).';
  } else {
    banner.textContent = 'Конкурс закончился, итоги ещё не зафиксированы. Таймер сделает это сам ' +
      'в течение пяти минут — или нажмите «Зафиксировать итоги».';
  }

  var t = d.totals;
  ctq('ct-totals').innerHTML =
    ctCard(t.participants, 'Участников') +
    ctCard(t.withCode, 'С промокодом') +
    ctCard(ctNum(t.activations), 'Активаций всего') +
    ctCard(t.qualified, 'Прошли порог') +
    ctCard(t.disqualified, 'Снято с конкурса');

  ctq('ct-starts').value = ctIsoToInput(d.contest.startsAt);
  ctq('ct-ends').value = ctIsoToInput(d.contest.endsAt);
  ctq('ct-min').value = d.contest.minActivations;

  var rows = d.participants || [];
  ctq('ct-empty').style.display = rows.length ? 'none' : '';
  ctq('ct-table-body').innerHTML = rows.map(ctRow).join('');
}

function ctCard(value, label) {
  return '<div class="stat-card"><span class="stat-value">' + value +
         '</span><span class="stat-label">' + label + '</span></div>';
}

function ctEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function ctRow(p) {
  var place = p.disqualified ? '—' : (p.rank || '—');
  var medal = !p.disqualified && p.rank <= 3 ? ['🥇', '🥈', '🥉'][p.rank - 1] + ' ' : '';
  var social = p.socialUrl
    ? '<a href="' + ctEsc(p.socialUrl) + '" target="_blank" rel="noopener">' + ctEsc(p.nickname || 'профиль') + '</a>'
    : ctEsc(p.nickname || '—');
  var contacts = [p.phone, p.email].filter(Boolean).map(ctEsc).join('<br>');

  var status = p.disqualified
    ? '<span title="' + ctEsc(p.dqReason || '') + '">снят</span>'
    : (p.qualified ? 'да' : 'нет');

  var action =
    (p.code ? '<button class="btn btn-outline btn-sm" onclick="ctActivity(\'' + p.id + '\')">Активность</button> ' : '') +
    (p.disqualified
      ? '<button class="btn btn-outline btn-sm" onclick="ctRestore(\'' + p.id + '\')">Вернуть</button>'
      : '<button class="btn btn-outline btn-sm" onclick="ctDisqualify(\'' + p.id + '\')">Снять</button>');

  return '<tr' + (p.disqualified ? ' style="opacity:.55"' : '') + '>' +
    '<td>' + medal + place + '</td>' +
    '<td><b>' + ctEsc(p.code || '—') + '</b></td>' +
    '<td>' + ctNum(p.activations) + '</td>' +
    '<td>' + status + '</td>' +
    '<td>' + (p.prizeAmount ? ctNum(p.prizeAmount) + ' ₸' : '—') + '</td>' +
    '<td>' + ctEsc(p.name || '—') + '</td>' +
    '<td>' + social + '</td>' +
    '<td class="hint">' + (contacts || '—') + '</td>' +
    '<td>' + action + '</td>' +
    '</tr>';
}

async function ctSaveSettings() {
  var status = ctq('ct-status');
  status.textContent = '';
  try {
    await api('/admin/contest', {
      method: 'PATCH',
      body: JSON.stringify({
        startsAt: ctInputToIso(ctq('ct-starts').value),
        endsAt: ctInputToIso(ctq('ct-ends').value),
        minActivations: ctq('ct-min').value
      })
    });
    status.textContent = 'сохранено — рейтинг пересчитан';
    loadContest();
  } catch (e) {
    status.textContent = 'не сохранилось: ' + e.message;
  }
}

async function ctFinalize(force) {
  var status = ctq('ct-finalize-status');
  if (force && !confirm('Пересчитать итоги заново? Места будут переписаны по текущим активациям.')) return;
  if (!force && !confirm('Зафиксировать итоги? После этого страница участника перестанет обновляться.')) return;
  status.textContent = '';
  try {
    var r = await api('/admin/contest/finalize', {
      method: 'POST',
      body: JSON.stringify({ force: !!force })
    });
    status.textContent = 'готово, записано строк: ' + r.rows;
    loadContest();
  } catch (e) {
    status.textContent = e.message;
  }
}

async function ctReopen() {
  if (!confirm('Снять фиксацию? Рейтинг снова станет живым и будет меняться.')) return;
  try {
    await api('/admin/contest/reopen', { method: 'POST' });
    ctq('ct-finalize-status').textContent = 'фиксация снята';
    loadContest();
  } catch (e) {
    ctq('ct-finalize-status').textContent = e.message;
  }
}

// Разбор накрутки: активации по дням и по адресам. Приговора здесь нет и быть
// не должно — у общежития или школы один внешний адрес на всех, и решать,
// накрутка это или большая семья, может только человек.
async function ctActivity(id) {
  var box = ctq('ct-detail');
  box.style.display = '';
  box.innerHTML = '<p class="hint">Загружаем…</p>';
  try {
    var d = await api('/admin/contest/participants/' + id + '/activity');

    var days = d.daily.length
      ? '<table class="data-table"><thead><tr><th>День</th><th>Активаций</th></tr></thead><tbody>' +
        d.daily.map(function (x) {
          return '<tr><td>' + x.date + '</td><td>' + x.bindings + '</td></tr>';
        }).join('') + '</tbody></table>'
      : '<p class="hint">Активаций за период конкурса нет.</p>';

    var ips = d.ipStats.topIps.length
      ? '<table class="data-table"><thead><tr><th>Адрес</th><th>Активаций</th><th>Первая</th><th>Последняя</th></tr></thead><tbody>' +
        d.ipStats.topIps.map(function (x) {
          var alarm = x.count >= 5 ? ' style="color:#e06c6c;font-weight:600"' : '';
          return '<tr' + alarm + '><td>' + ctEsc(x.ip) + '</td><td>' + x.count + '</td><td>' +
                 ctFmtDate(x.firstAt) + '</td><td>' + ctFmtDate(x.lastAt) + '</td></tr>';
        }).join('') + '</tbody></table>'
      : '<p class="hint">Адресов нет: либо активаций нет, либо они старше, чем запись адресов (с 31.08.2026).</p>';

    var unknown = d.bindings - d.ipStats.withIp;

    box.innerHTML =
      '<h3 class="section-title">Активность кода ' + ctEsc(d.code) +
        (d.nickname ? ' <span class="hint">' + ctEsc(d.nickname) + '</span>' : '') + '</h3>' +
      '<p class="hint">Всего активаций: ' + d.bindings +
        ' · разных адресов: ' + d.ipStats.distinctIps +
        (unknown > 0 ? ' · без адреса: ' + unknown : '') + '</p>' +
      '<p class="hint">Много активаций с одного адреса — повод посмотреть внимательнее, ' +
        'но не доказательство: у одного мобильного оператора или общежития адрес общий на многих.</p>' +
      days + ips +
      '<button class="btn btn-outline btn-sm" onclick="ctq(\'ct-detail\').style.display=\'none\'">Свернуть</button>';
  } catch (e) {
    box.innerHTML = '<p class="hint">Не удалось получить активность: ' + ctEsc(e.message) + '</p>';
  }
}

async function ctDisqualify(id) {
  // Причину спрашиваем здесь и требуем на сервере: через неделю никто не
  // вспомнит, за что сняли, а объясняться с участником придётся.
  var reason = prompt('Причина дисквалификации (её увидит только админ):');
  if (!reason) return;
  try {
    await api('/admin/contest/participants/' + id + '/disqualify', {
      method: 'POST',
      body: JSON.stringify({ reason: reason })
    });
    loadContest();
  } catch (e) {
    alert(e.message);
  }
}

async function ctRestore(id) {
  try {
    await api('/admin/contest/participants/' + id + '/restore', { method: 'POST' });
    loadContest();
  } catch (e) {
    alert(e.message);
  }
}

// Ссылкой файл не забрать: выгрузка под админским токеном, а <a download>
// заголовки не отправляет. Поэтому качаем как blob.
async function ctExport() {
  try {
    var res = await fetch(API + '/admin/contest/export', {
      headers: { 'Authorization': 'Bearer ' + accessToken }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var blob = await res.blob();
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'ugc-participants.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('Не выгрузилось: ' + e.message);
  }
}

(function wireContest() {
  var navBtn = document.querySelector('[data-tab="contest"]');
  if (navBtn) navBtn.addEventListener('click', loadContest);
  if (ctq('ct-refresh-btn')) ctq('ct-refresh-btn').addEventListener('click', loadContest);
  if (ctq('ct-save-btn')) ctq('ct-save-btn').addEventListener('click', ctSaveSettings);
  if (ctq('ct-finalize-btn')) ctq('ct-finalize-btn').addEventListener('click', function () { ctFinalize(false); });
  if (ctq('ct-recount-btn')) ctq('ct-recount-btn').addEventListener('click', function () { ctFinalize(true); });
  if (ctq('ct-reopen-btn')) ctq('ct-reopen-btn').addEventListener('click', ctReopen);
  if (ctq('ct-export-btn')) ctq('ct-export-btn').addEventListener('click', ctExport);
})();
