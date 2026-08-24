// Витрина промокодов блогеров. Страница открыта, токена у неё нет и быть не
// должно: всё, что она умеет, — прочитать /api/public/promos.

const state = { data: null, search: '', period: 'all', sort: 'payments' };

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function fromParam() {
  if (state.period === 'all') return '';
  const d = new Date();
  d.setDate(d.getDate() - Number(state.period));
  return `?from=${encodeURIComponent(d.toISOString())}`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

async function load() {
  $('rows').innerHTML = '<tr><td colspan="9" class="muted">Загружаю…</td></tr>';
  try {
    const res = await fetch('/api/public/promos' + fromParam());
    if (!res.ok) throw new Error(res.status === 429 ? 'Слишком часто — подождите минуту' : 'Сервис недоступен');
    state.data = await res.json();
    render();
  } catch (e) {
    state.data = null;
    $('rows').innerHTML = `<tr><td colspan="9" class="muted">${esc(e.message)}</td></tr>`;
    $('totals').innerHTML = '';
  }
}

function visibleRows() {
  const q = state.search.trim().toLowerCase();
  let rows = state.data.promos.filter((p) => !q
    || p.code.toLowerCase().includes(q)
    || (p.bloggerName || '').toLowerCase().includes(q)
    || (p.label || '').toLowerCase().includes(q));

  const by = {
    payments: (a, b) => b.payments - a.payments || b.entered - a.entered,
    entered: (a, b) => b.entered - a.entered || b.payments - a.payments,
    conversion: (a, b) => b.conversion - a.conversion || b.payments - a.payments,
    code: (a, b) => a.code.localeCompare(b.code, 'ru'),
    blogger: (a, b) => (a.bloggerName || 'я').localeCompare(b.bloggerName || 'я', 'ru'),
  };
  return rows.sort(by[state.sort] || by.payments);
}

function render() {
  const d = state.data;

  $('updated').textContent = 'Обновлено ' + fmtDateTime(d.updatedAt);

  $('totals').innerHTML = [
    ['Промокодов', d.totals.codes],
    ['Вводов', d.totals.entered],
    ['Привязок', d.totals.bindings],
    ['Оплат', d.totals.payments],
  ].map(([k, v]) => `<div class="card"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');

  const rows = visibleRows();
  $('empty').hidden = rows.length > 0;
  $('rows').innerHTML = rows.map((p) => `
    <tr data-code="${esc(p.code)}">
      <td><span class="code">${esc(p.code)}</span>${p.label ? `<div class="muted" style="font-size:12px">${esc(p.label)}</div>` : ''}</td>
      <td>${p.bloggerName ? esc(p.bloggerName) : '<span class="muted">без блогера</span>'}</td>
      <td><span class="tag ${p.kind === 'tale' ? 'tale' : ''}">${p.kind === 'tale' ? 'на сказки' : 'обычный'}</span></td>
      <td class="num">${p.entered}${p.maxUses ? `<span class="muted"> / ${p.maxUses}</span>` : ''}</td>
      <td class="num">${p.bindings == null ? '<span class="muted">—</span>' : p.bindings}</td>
      <td class="num">${p.payments}</td>
      <td class="num"><span class="conv ${p.conversion >= 20 ? 'good' : ''}">${p.conversion}%</span></td>
      <td class="tales">${p.taleTitles.length ? esc(p.taleTitles.join(', ')) : '<span class="muted">—</span>'}</td>
      <td class="muted">${fmtDate(p.lastPaymentAt)}</td>
    </tr>`).join('');

  const rule = d.attributionDays == null
    ? 'оплата засчитывается независимо от того, сколько прошло после ввода кода'
    : `засчитываются оплаты в первые ${d.attributionDays} дн. после ввода кода`;
  $('rule').textContent = `Правило подсчёта: ${rule}; продления подписки ${d.includeRenewals ? 'учитываются' : 'не учитываются'}.`;
}

// ─────────────────────────── карточка кода ───────────────────────────

function chart(daily) {
  const days = daily.slice(-30);
  if (!days.length) return '<p class="muted">Пока ничего не происходило</p>';

  const max = Math.max(...days.map((d) => Math.max(d.bindings, d.initial + d.renewals)), 1);
  const h = (n) => Math.round((n / max) * 100);

  return `
    <div class="chart">${days.map((d) => `
      <div class="col" title="${d.date}: привязок ${d.bindings}, оплат ${d.initial + d.renewals}">
        <div class="b bind" style="height:${h(d.bindings)}%"></div>
        <div class="b pay" style="height:${h(d.initial + d.renewals)}%"></div>
      </div>`).join('')}
    </div>
    <div class="chart-x"><span>${days[0].date}</span>${days.length > 1 ? `<span>${days[days.length - 1].date}</span>` : ''}</div>
    <div class="chart-key">
      <span><i style="background:#3f3a63"></i>привязки</span>
      <span><i style="background:#8b5cf6"></i>оплаты</span>
    </div>`;
}

async function openCode(code) {
  // Код в адресе: блогеру можно дать ссылку сразу на его карточку, а не
  // объяснять, что надо найти себя в списке.
  if (decodeURIComponent(location.hash.slice(1)) !== code) location.hash = encodeURIComponent(code);
  $('overlay').hidden = false;
  $('detail').innerHTML = '<p class="muted">Загружаю…</p>';
  try {
    const res = await fetch(`/api/public/promos/${encodeURIComponent(code)}` + fromParam());
    if (!res.ok) throw new Error(res.status === 404 ? 'Код не найден' : 'Сервис недоступен');
    renderDetail(await res.json());
  } catch (e) {
    $('detail').innerHTML = `<p class="muted">${esc(e.message)}</p>`;
  }
}

function renderDetail(p) {
  const paid = (p.payments || []).filter((x) => x.counted).length;
  const mini = [
    ['Вводов', p.entered],
    ['Уникальных', p.users == null ? '—' : p.users],
    ['Привязок', p.bindings == null ? '—' : p.bindings],
    ['Оплат', p.counted == null ? paid : p.counted],
    ['Конверсия', (p.conversion || 0) + '%'],
  ];

  $('detail').innerHTML = `
    <h2><span class="code">${esc(p.code)}</span></h2>
    <p class="who">
      ${p.bloggerName ? esc(p.bloggerName) : 'без блогера'} ·
      ${p.kind === 'tale' ? 'код на сказки' : 'обычный код'} ·
      создан ${fmtDate(p.createdAt)}
      ${p.label ? ' · ' + esc(p.label) : ''}
    </p>

    <div class="mini">
      ${mini.map(([k, v]) => `<div><div class="k">${k}</div><div class="v">${v}</div></div>`).join('')}
    </div>

    ${p.taleTitles && p.taleTitles.length ? `
      <h3>Открывает сказки</h3>
      <div class="tale-list">${p.taleTitles.map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}

    <h3>По дням</h3>
    ${chart(p.daily || [])}

    ${p.payments && p.payments.length ? `
      <h3>Оплаты</h3>
      <div class="feed">${p.payments.map((x) => `
        <div>
          <span>${fmtDateTime(x.occurredAt)} · ${x.kind === 'initial' ? 'первая' : 'продление'} · ${esc(x.source)}</span>
          <span class="${x.counted ? '' : 'off'}">${x.daysSinceBind == null ? '' : x.daysSinceBind + ' дн. после ввода'}${x.counted ? '' : ' · вне окна'}</span>
        </div>`).join('')}
      </div>` : ''}

    ${p.note ? `<p class="note">${esc(p.note)}</p>` : ''}`;
}

function closeModal() {
  $('overlay').hidden = true;
  $('detail').innerHTML = '';
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
}

// ─────────────────────────── события ───────────────────────────

$('search').addEventListener('input', (e) => { state.search = e.target.value; if (state.data) render(); });
$('sort').addEventListener('change', (e) => { state.sort = e.target.value; if (state.data) render(); });
$('period').addEventListener('change', (e) => { state.period = e.target.value; load(); });
$('rows').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-code]');
  if (tr) openCode(tr.dataset.code);
});
$('close').addEventListener('click', closeModal);
$('overlay').addEventListener('click', (e) => { if (e.target === $('overlay')) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

load();
if (location.hash.length > 1) openCode(decodeURIComponent(location.hash.slice(1)));
