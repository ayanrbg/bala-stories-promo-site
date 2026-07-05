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
    return '<tr>' +
      '<td><code>' + esc(p.code) + '</code></td>' +
      '<td>' + p.durationDays + ' дней</td>' +
      '<td><span class="badge ' + (p.used ? 'badge-used' : 'badge-available') + '">' + (p.used ? 'Использован' : 'Доступен') + '</span></td>' +
      '<td>' + usedBy + '</td>' +
      '<td>' + new Date(p.createdAt).toLocaleDateString('ru') + '</td>' +
      '</tr>';
  }).join('');
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
  const durationDays = parseInt(document.getElementById('premium-days-input').value);

  if (!durationDays || durationDays < 1) { alert('Укажите количество дней'); return; }

  try {
    await api('/admin/premium-promos', {
      method: 'POST',
      body: JSON.stringify({ code, durationDays })
    });
    document.getElementById('premium-code-input').value = '';
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

// ============ Activity feed (admin alerts, on-site) — added ============
const ALERT_ICONS = { purchase: '💰', renewal: '🔁', refund: '⚠️', expire: '⌛', promo: '🎁', admin: '🛠️' };
let alertsPollTimer = null;

async function loadAlerts() {
  try {
    const data = await api('/alerts?limit=100');
    renderAlerts(data.alerts || []);
    updateAlertBadge(data.unread || 0);
  } catch (e) { console.error('alerts load failed', e); }
}

function updateAlertBadge(n) {
  const b = document.getElementById('activity-badge');
  if (!b) return;
  if (n > 0) { b.textContent = n; b.style.display = 'inline-block'; }
  else { b.textContent = ''; b.style.display = 'none'; }
}

function renderAlerts(list) {
  const el = document.getElementById('activity-feed');
  if (!el) return;
  if (!list.length) { el.innerHTML = '<p class="hint">Событий пока нет</p>'; return; }
  el.innerHTML = list.map(function (a) {
    const unread = !a.read_at;
    const icon = ALERT_ICONS[a.kind] || '•';
    const when = new Date(a.created_at).toLocaleString('ru');
    const user = a.user_id ? '<code>' + esc(String(a.user_id).slice(0, 12)) + '</code>' : '';
    return '<div class="alert-item' + (unread ? ' unread' : '') + '">' +
      '<span class="alert-icon">' + icon + '</span>' +
      '<div class="alert-body">' +
      '<div class="alert-msg">' + esc(a.message || a.kind) + '</div>' +
      '<div class="alert-meta">' + when + ' ' + user + '</div>' +
      '</div></div>';
  }).join('');
}

async function markAlertsRead() {
  try { await api('/alerts/read', { method: 'POST', body: JSON.stringify({}) }); loadAlerts(); }
  catch (e) { alert(e.message); }
}

function maybeLoadAlerts() {
  if (accessToken && currentRole === 'admin') loadAlerts();
}

function startAlertsPolling() {
  if (alertsPollTimer) return;
  alertsPollTimer = setInterval(maybeLoadAlerts, 30000);
}

(function wireActivity() {
  const q = function (id) { return document.getElementById(id); };
  const navBtn = document.querySelector('[data-tab="activity"]');
  if (navBtn) navBtn.addEventListener('click', loadAlerts);
  if (q('activity-refresh-btn')) q('activity-refresh-btn').addEventListener('click', loadAlerts);
  if (q('activity-read-btn')) q('activity-read-btn').addEventListener('click', markAlertsRead);
  // Refresh the unread badge shortly after a login and then on an interval.
  const loginForm = q('login-form');
  if (loginForm) loginForm.addEventListener('submit', function () { setTimeout(maybeLoadAlerts, 1500); });
  startAlertsPolling();
  maybeLoadAlerts();
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
let anTitles = {}; // tale_id -> human title (from catalog)

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
    renderAnTales(ins.topTales || []);
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

function renderAnTales(tales) {
  const el = document.getElementById('an-tales');
  if (!el) return;
  if (!tales.length) {
    el.innerHTML = '<p class="hint">Пока нет событий «сказка дочитана». Появятся, когда клиент начнёт слать <code>tale_complete</code> с ID сказки.</p>';
    return;
  }
  el.innerHTML = tales.map(function (t, i) {
    const title = anTitles[t.tale_id] || t.tale_id;
    return '<div class="tale-card">' +
      '<div class="tale-cover" id="an-cover-' + i + '"><span class="tale-rank">#' + (i + 1) + '</span></div>' +
      '<div class="tale-info"><div class="tale-title">' + esc(title) + '</div>' +
      '<div class="tale-stat">📖 ' + t.completions + ' дочит.</div>' +
      '<div class="tale-stat muted-id">⏱ ' + anFmtDur(t.avg_duration_ms) + ' в среднем</div>' +
      '</div></div>';
  }).join('');
  tales.forEach(function (t, i) { anSetCover(t.tale_id, 'an-cover-' + i); });
}
async function anSetCover(id, elId) {
  try {
    const res = await fetch(API + '/catalog/' + encodeURIComponent(id) + '/cover', { headers: { Authorization: 'Bearer ' + accessToken } });
    if (!res.ok) return;
    const url = URL.createObjectURL(await res.blob());
    const el = document.getElementById(elId);
    if (el) { el.style.backgroundImage = 'url(' + url + ')'; el.classList.add('has-cover'); }
  } catch (_) { /* no cover — keep placeholder */ }
}
async function anLoadTitles() {
  try {
    const tales = await api('/catalog');
    anTitles = {};
    tales.forEach(function (t) { anTitles[t.id] = (t.titles && (t.titles.ru || Object.values(t.titles)[0])) || t.id; });
  } catch (_) { /* ignore */ }
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
})();
