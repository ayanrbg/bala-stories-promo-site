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

function renderPremiumPromos(promos) {
  const tbody = document.getElementById('premium-table-body');
  tbody.innerHTML = promos.map(p => `
    <tr>
      <td><code>${esc(p.code)}</code></td>
      <td>${p.durationDays} дней</td>
      <td><span class="badge ${p.used ? 'badge-used' : 'badge-available'}">${p.used ? 'Использован' : 'Доступен'}</span></td>
      <td>${p.usedBy ? esc(p.usedBy) : '—'}</td>
      <td>${new Date(p.createdAt).toLocaleDateString('ru')}</td>
    </tr>
  `).join('');
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
let talePagesByLang = {};

async function catalogUpload(path, file) {
  const fd = new FormData();
  fd.append('file', file);
  const headers = {};
  if (accessToken) headers['Authorization'] = 'Bearer ' + accessToken;
  const res = await fetch(API + path, { method: 'POST', headers, body: fd });
  if (res.status === 401 || res.status === 403) { logout(); throw new Error('Unauthorized'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Ошибка загрузки');
  return data;
}

async function loadCatalog() {
  try {
    const tales = await api('/catalog');
    catalogById = {};
    tales.forEach(function (t) { catalogById[t.id] = t; });
    renderCatalog(tales);
  } catch (e) { console.error('catalog load failed', e); }
}

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
      '<td>' + (t.sortOrder != null ? t.sortOrder : 0) + '</td>' +
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

function clearTaleForm() {
  document.getElementById('tale-id').value = '';
  document.getElementById('tale-sort').value = '0';
  document.getElementById('tale-pages').value = '';
  CATALOG_LANGS.forEach(function (l) { document.getElementById('tale-title-' + l).value = ''; });
  document.getElementById('tale-status').value = 'active';
  document.getElementById('tale-free').checked = false;
  document.getElementById('tale-coming').checked = false;
  document.getElementById('tale-cover-preview').innerHTML = '';
  document.getElementById('tale-ill-preview').innerHTML = '';
  document.getElementById('tale-check-result').innerHTML = '';
  setTaleMsg('');
  talePagesByLang = {};
}

function loadPagesIntoTextarea() {
  const lang = document.getElementById('tale-pages-lang').value;
  const pages = (talePagesByLang && talePagesByLang[lang]) || [];
  document.getElementById('tale-pages').value = pages.join('\n---\n');
}

async function openTale(id) {
  clearTaleForm();
  if (id) {
    document.getElementById('tale-modal-title').textContent = 'Сказка: ' + id;
    document.getElementById('tale-id').value = id;
    document.getElementById('tale-id').readOnly = true;
    try {
      const d = await api('/catalog/' + encodeURIComponent(id));
      document.getElementById('tale-sort').value = d.sortOrder || 0;
      document.getElementById('tale-status').value = d.status || 'active';
      document.getElementById('tale-free').checked = !!d.free;
      document.getElementById('tale-coming').checked = !!d.comingSoon;
      CATALOG_LANGS.forEach(function (l) { document.getElementById('tale-title-' + l).value = (d.titles && d.titles[l]) || ''; });
      talePagesByLang = d.pagesByLang || {};
      loadPagesIntoTextarea();
      if (d.cover) document.getElementById('tale-cover-preview').innerHTML = '<span class="hint">Обложка загружена ✓</span>';
      document.getElementById('tale-ill-preview').innerHTML = '<span class="hint">Иллюстрированных страниц: ' + (d.illustrations || []).length + '</span>';
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
  const sortOrder = parseInt(document.getElementById('tale-sort').value, 10) || 0;
  const status = document.getElementById('tale-status').value;
  const isEdit = document.getElementById('tale-id').readOnly;
  try {
    if (isEdit) {
      await api('/catalog/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({ titles: titles, free: free, comingSoon: comingSoon, sortOrder: sortOrder, status: status }) });
    } else {
      if (Object.keys(titles).length === 0) { setTaleMsg('Добавьте хотя бы одно название'); return; }
      await api('/catalog', { method: 'POST', body: JSON.stringify({ id: id, titles: titles, free: free, comingSoon: comingSoon, sortOrder: sortOrder }) });
      document.getElementById('tale-id').readOnly = true;
      if (status !== 'active') await api('/catalog/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({ status: status }) });
      document.getElementById('tale-modal-title').textContent = 'Сказка: ' + id;
    }
    setTaleMsg('Сохранено ✓', true);
    loadCatalog();
  } catch (e) { setTaleMsg(e.message); }
}

async function saveTalePages() {
  const id = document.getElementById('tale-id').value.trim();
  const lang = document.getElementById('tale-pages-lang').value;
  if (!id) { setTaleMsg('Сначала сохраните основное'); return; }
  const raw = document.getElementById('tale-pages').value;
  const pages = raw.split(/\n?---\n?/).map(function (s) { return s.trim(); }).filter(function (s) { return s.length; });
  try {
    await api('/catalog/' + encodeURIComponent(id) + '/pages?lang=' + encodeURIComponent(lang), { method: 'PUT', body: JSON.stringify({ pages: pages }) });
    talePagesByLang[lang] = pages;
    setTaleMsg('Текст сохранён: ' + pages.length + ' стр. (' + lang + ')', true);
  } catch (e) { setTaleMsg(e.message); }
}

async function uploadTaleCover() {
  const id = document.getElementById('tale-id').value.trim();
  const f = document.getElementById('tale-cover-file').files[0];
  if (!id) { setTaleMsg('Сначала сохраните основное (ID)'); return; }
  if (!f) { setTaleMsg('Выберите файл обложки'); return; }
  try {
    const r = await catalogUpload('/catalog/' + encodeURIComponent(id) + '/cover', f);
    document.getElementById('tale-cover-preview').innerHTML = '<img src="' + URL.createObjectURL(f) + '" class="thumb"><span class="hint">Загружено ' + r.width + 'x' + r.height + '</span>';
    setTaleMsg('Обложка загружена ✓', true);
  } catch (e) { setTaleMsg(e.message); }
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
  try {
    const r = await catalogUpload('/catalog/' + encodeURIComponent(id) + '/illustration/' + encodeURIComponent(page) + query, f);
    document.getElementById('tale-ill-preview').innerHTML = '<img src="' + URL.createObjectURL(f) + '" class="thumb"><span class="hint">Стр. ' + r.page + ' ' + (gender || 'plain') + ' — ' + r.width + 'x' + r.height + '</span>';
    setTaleMsg('Иллюстрация загружена ✓', true);
  } catch (e) { setTaleMsg(e.message); }
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
  if (q('tale-pages-load')) q('tale-pages-load').addEventListener('click', loadPagesIntoTextarea);
  if (q('tale-pages-save')) q('tale-pages-save').addEventListener('click', saveTalePages);
  if (q('tale-cover-upload')) q('tale-cover-upload').addEventListener('click', uploadTaleCover);
  if (q('tale-ill-upload')) q('tale-ill-upload').addEventListener('click', uploadTaleIllustration);
  if (q('tale-check-btn')) q('tale-check-btn').addEventListener('click', runContentCheck);
})();
