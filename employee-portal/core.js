// ========== STATE ==========
let clockedIn = false;
let clockInTime = null;
let currentFlowTab = 'my';
let selectedOffDays = new Set();
let contactSearch = '';
let contactDeptFilter = '';
const _now = new Date();
let scheduleYear = _now.getFullYear();
let scheduleMonth = _now.getMonth();
let _clockInterval;

const ROUTE_META = {
  '/': { title: '首頁', crumb: '首頁' },
  '/clock': { title: '打卡', crumb: '打卡' },
  '/schedule': { title: '班表', crumb: '班表' },
  '/leave': { title: '請假', crumb: '請假' },
  '/overtime': { title: '加班申請', crumb: '加班申請' },
  '/punch': { title: '補打卡', crumb: '補打卡' },
  '/outing': { title: '外出登記', crumb: '外出登記' },
  '/salary': { title: '薪資單', crumb: '薪資單' },
  '/expense': { title: '費用申請', crumb: '費用申請' },
  '/attendance': { title: '出勤紀錄', crumb: '出勤紀錄' },
  '/off-request': { title: '希望排休', crumb: '希望排休' },
  '/flows': { title: '流程中心', crumb: '流程中心' },
  '/contacts': { title: '通訊錄', crumb: '通訊錄' },
  '/profile': { title: '個人資料', crumb: '個人資料' }
};

// ========== ROUTING ==========
function navigate(route) {
  window.location.hash = route;
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('open');
}

function getRoute() { return window.location.hash.slice(1) || '/'; }

window.addEventListener('hashchange', render);
window.addEventListener('load', () => {
  loadPrefs();
  render();
});

function render() {
  const route = getRoute();
  const app = document.getElementById('app');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.route === route));
  const meta = ROUTE_META[route] || ROUTE_META['/'];
  document.getElementById('crumbCurrent').textContent = meta.crumb;
  closeModal();

  const pages = {
    '/': renderDashboard, '/clock': renderClock, '/schedule': renderSchedule,
    '/leave': renderLeave, '/overtime': renderOvertime, '/punch': renderPunch,
    '/outing': renderOuting, '/salary': renderSalary, '/expense': renderExpense,
    '/attendance': renderAttendance, '/off-request': renderOffRequest,
    '/flows': renderFlows, '/contacts': renderContacts, '/profile': renderProfile
  };
  app.innerHTML = (pages[route] || renderDashboard)();
  if (window.lucide) lucide.createIcons();
  if (route === '/' || route === '/clock') startClock();
  window.scrollTo(0, 0);
}

// ========== UI helpers ==========
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebarOverlay').classList.toggle('open');
}
function toggleSidebarCollapse() {
  const sb = document.getElementById('sidebar');
  sb.classList.toggle('collapsed');
  localStorage.setItem('sb-collapsed', sb.classList.contains('collapsed') ? '1' : '0');
}

function openModal(html) {
  document.getElementById('modalContent').innerHTML = html;
  document.getElementById('modalOverlay').classList.add('show');
  if (window.lucide) lucide.createIcons();
}
function closeModal() { document.getElementById('modalOverlay').classList.remove('show'); }
document.getElementById('modalOverlay').addEventListener('click', function(e) { if (e.target === this) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

function showToast(msg, icon) {
  const t = document.getElementById('toast');
  const ic = t.querySelector('[data-lucide]');
  if (icon && ic) ic.setAttribute('data-lucide', icon);
  document.getElementById('toastText').textContent = msg;
  if (window.lucide) lucide.createIcons();
  t.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

function startClock() {
  clearInterval(_clockInterval);
  function tick() {
    const el = document.getElementById('liveTime');
    const el2 = document.getElementById('liveDate');
    if (!el) { clearInterval(_clockInterval); return; }
    const n = new Date();
    el.textContent = n.toLocaleTimeString('zh-TW', { hour12: false });
    if (el2) el2.textContent = n.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  }
  tick();
  _clockInterval = setInterval(tick, 1000);
}

function doPunchIn() { clockedIn = true; clockInTime = new Date(); showToast('上班打卡成功', 'check-circle-2'); render(); }
function doPunchOut() { clockedIn = false; clockInTime = null; showToast('下班打卡成功', 'check-circle-2'); render(); }

function statusBadge(s) {
  const map = { approved: ['已核准','badge-approved'], pending: ['待審核','badge-pending'], rejected: ['已駁回','badge-rejected'] };
  const [text, cls] = map[s] || ['未知','badge-info'];
  return `<span class="badge ${cls}">${text}</span>`;
}
function formatMoney(n) { return n.toLocaleString(); }

// ========== Preferences ==========
function loadPrefs() {
  const theme = localStorage.getItem('theme') || 'light';
  const density = localStorage.getItem('density') || 'default';
  const hue = localStorage.getItem('accent-hue') || '155';
  const sbCol = localStorage.getItem('sb-collapsed') === '1';
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.setAttribute('data-density', density);
  _applyHue(hue);
  if (sbCol) document.getElementById('sidebar').classList.add('collapsed');
  _syncTweaksUI();
}
function _syncTweaksUI() {
  const theme = document.documentElement.getAttribute('data-theme') || 'light';
  const density = document.documentElement.getAttribute('data-density') || 'default';
  const hue = localStorage.getItem('accent-hue') || '155';
  document.querySelectorAll('#themeSeg button').forEach(b => b.classList.toggle('active', b.dataset.v === theme));
  document.querySelectorAll('#densitySeg button').forEach(b => b.classList.toggle('active', b.dataset.v === density));
  document.querySelectorAll('#accentRow .tweak-sw').forEach(s => s.classList.toggle('active', s.dataset.hue === hue));
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') || 'light';
  setTheme(cur === 'light' ? 'dark' : 'light');
}
function setTheme(t) { document.documentElement.setAttribute('data-theme', t); localStorage.setItem('theme', t); _syncTweaksUI(); }
function setDensity(d) { document.documentElement.setAttribute('data-density', d); localStorage.setItem('density', d); _syncTweaksUI(); }
function _applyHue(h) {
  const root = document.documentElement;
  const isDark = root.getAttribute('data-theme') === 'dark';
  root.style.setProperty('--accent', `oklch(${isDark?'0.70':'0.42'} 0.08 ${h})`);
  root.style.setProperty('--accent-soft', `oklch(${isDark?'0.28':'0.95'} ${isDark?'0.05':'0.03'} ${h})`);
  root.style.setProperty('--accent-ink', `oklch(${isDark?'0.85':'0.30'} 0.08 ${h})`);
}
function setAccent(h) { localStorage.setItem('accent-hue', h); _applyHue(h); _syncTweaksUI(); }
function toggleTweaks() { document.getElementById('tweaksPanel').classList.toggle('show'); }

// ========== Calendar builder ==========
function buildCalendar(year, month, scheduleData, isOffSelect) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevDays = new Date(year, month, 0).getDate();
  const today = new Date();
  const isCurMonth = (month === today.getMonth() && year === today.getFullYear());
  const dayHeaders = ['日','一','二','三','四','五','六'];
  let html = '<div class="cal-grid">';
  dayHeaders.forEach(d => html += `<div class="cal-dow">${d}</div>`);

  for (let i = firstDay - 1; i >= 0; i--) html += `<div class="cal-day other"><span class="day-num">${prevDays - i}</span></div>`;

  for (let d = 1; d <= daysInMonth; d++) {
    const classes = ['cal-day'];
    if (isCurMonth && d === today.getDate()) classes.push('today');
    if (isOffSelect) {
      classes.push('selectable');
      if (selectedOffDays.has(d)) classes.push('selected');
    }
    let content = `<span class="day-num">${d}</span>`;
    if (scheduleData && scheduleData[d]) {
      const s = SHIFTS[scheduleData[d]];
      if (s) content += `<div><span class="shift-chip ${s.tag}">${s.label}</span></div>`;
    }
    const onclick = isOffSelect ? ` onclick="toggleOffDay(${d})"` : '';
    html += `<div class="${classes.join(' ')}"${onclick}>${content}</div>`;
  }
  const totalCells = firstDay + daysInMonth;
  const remaining = (7 - totalCells % 7) % 7;
  for (let i = 1; i <= remaining; i++) html += `<div class="cal-day other"><span class="day-num">${i}</span></div>`;
  html += '</div>';
  return html;
}

function monthLabel(y, m) { return `${y} 年 ${m + 1} 月`; }
function changeMonth(delta) {
  scheduleMonth += delta;
  if (scheduleMonth > 11) { scheduleMonth = 0; scheduleYear++; }
  if (scheduleMonth < 0) { scheduleMonth = 11; scheduleYear--; }
  render();
}
