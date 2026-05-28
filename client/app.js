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

    renderBloggers(bloggers);
    renderPremiumPromos(promos);
  } catch (err) {
    console.error('Failed to load admin data:', err);
  }
}

function renderBloggers(bloggers) {
  const tbody = document.getElementById('bloggers-table-body');
  tbody.innerHTML = bloggers.map(b => `
    <tr>
      <td>${esc(b.name)}</td>
      <td>${esc(b.login)}</td>
      <td><code>${esc(b.promoCode)}</code></td>
      <td>${b.entered}</td>
      <td>${b.purchased}</td>
      <td>${b.conversion}%</td>
      <td>${new Date(b.createdAt).toLocaleDateString('ru')}</td>
      <td><button class="btn btn-danger" onclick="deleteBlogger('${b.id}')">Удалить</button></td>
    </tr>
  `).join('');
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

  try {
    await api('/admin/bloggers', {
      method: 'POST',
      body: JSON.stringify({ name, login, password, promoCode })
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
