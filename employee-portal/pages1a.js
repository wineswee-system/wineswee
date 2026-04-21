// ========== pages1a.js — Dashboard, Clock, Schedule, Leave, Overtime, Punch ==========

function renderDashboard() {
  const schedule = genSchedule(scheduleYear, scheduleMonth);
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? '早安' : hour < 18 ? '午安' : '晚安';

  return `
    <!-- Hero greeting -->
    <div class="hero-section" style="margin-bottom:24px">
      <h1 style="font-size:1.5rem;font-weight:800;margin-bottom:4px">${greeting}，${EMPLOYEE.name} 👋</h1>
      <p style="color:var(--fg-2);font-size:.9rem">${EMPLOYEE.dept} · ${EMPLOYEE.position} · ${EMPLOYEE.store}</p>
    </div>

    <!-- Stats row -->
    <div class="row" style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px">
      <div class="card" style="text-align:center;padding:16px">
        <div style="font-size:.78rem;color:var(--fg-3)">本週工時</div>
        <div style="font-size:1.6rem;font-weight:700">37.2<span style="font-size:.8rem;font-weight:400"> h</span></div>
      </div>
      <div class="card" style="text-align:center;padding:16px">
        <div style="font-size:.78rem;color:var(--fg-3)">特休餘額</div>
        <div style="font-size:1.6rem;font-weight:700">${LEAVE_BALANCE[0].total - LEAVE_BALANCE[0].used}<span style="font-size:.8rem;font-weight:400"> 天</span></div>
      </div>
      <div class="card" style="text-align:center;padding:16px">
        <div style="font-size:.78rem;color:var(--fg-3)">待審核</div>
        <div style="font-size:1.6rem;font-weight:700;color:oklch(0.72 0.14 75)">${FLOWS_MY.filter(f=>f.status==='pending').length}</div>
      </div>
      <div class="card" style="text-align:center;padding:16px">
        <div style="font-size:.78rem;color:var(--fg-3)">出勤率</div>
        <div style="font-size:1.6rem;font-weight:700;color:oklch(0.55 0.15 155)">96%</div>
      </div>
    </div>

    <div class="dash-grid">
      <!-- LEFT COLUMN -->
      <div>
        <!-- Clock widget small -->
        <div class="card" style="margin-bottom:20px">
          <div class="card-hd"><i data-lucide="clock"></i> 打卡</div>
          <div class="clock-display">
            <div class="clock-time" id="liveTime">--:--:--</div>
            <div class="clock-date" id="liveDate"></div>
            <div class="clock-btns">
              ${clockedIn
                ? '<button class="btn btn-punch-out" onclick="doPunchOut()"><i data-lucide="log-out" style="width:18px;height:18px"></i> 下班打卡</button>'
                : '<button class="btn btn-punch-in" onclick="doPunchIn()"><i data-lucide="log-in" style="width:18px;height:18px"></i> 上班打卡</button>'
              }
            </div>
            <div class="clock-status">${clockedIn ? '<span class="dot dot-on"></span> 已上班打卡 · ' + (clockInTime ? clockInTime.toLocaleTimeString('zh-TW', {hour12:false}) : '') : '<span class="dot dot-off"></span> 尚未打卡'}</div>
          </div>
        </div>

        <!-- Quick actions -->
        <div class="card" style="margin-bottom:20px">
          <div class="card-hd"><i data-lucide="zap"></i> 快速操作</div>
          <div class="quick-actions">
            <button class="qa-btn" onclick="navigate('/clock')"><i data-lucide="fingerprint"></i><span>打卡</span></button>
            <button class="qa-btn" onclick="navigate('/leave')"><i data-lucide="calendar-off"></i><span>請假</span></button>
            <button class="qa-btn" onclick="navigate('/overtime')"><i data-lucide="timer"></i><span>加班</span></button>
            <button class="qa-btn" onclick="navigate('/punch')"><i data-lucide="refresh-cw"></i><span>補打卡</span></button>
            <button class="qa-btn" onclick="navigate('/salary')"><i data-lucide="wallet"></i><span>薪資單</span></button>
            <button class="qa-btn" onclick="navigate('/off-request')"><i data-lucide="calendar-heart"></i><span>排休</span></button>
          </div>
        </div>

        <!-- Flow center -->
        <div class="card" style="margin-bottom:20px">
          <div class="card-hd"><i data-lucide="git-pull-request-arrow"></i> 流程中心</div>
          <div class="tabs" id="dashFlowTabs">
            <button class="tab-btn active" onclick="switchDashFlowTab('my',this)">我發起的</button>
            <button class="tab-btn" onclick="switchDashFlowTab('assigned',this)">指派給我的</button>
          </div>
          <div class="quick-launch">
            <button class="btn btn-outline btn-sm" onclick="navigate('/leave')">+ 請假</button>
            <button class="btn btn-outline btn-sm" onclick="navigate('/overtime')">+ 加班</button>
            <button class="btn btn-outline btn-sm" onclick="navigate('/punch')">+ 補打卡</button>
            <button class="btn btn-outline btn-sm" onclick="openExpenseModal()">+ 費用</button>
            <button class="btn btn-outline btn-sm" onclick="openSwapShiftModal()">+ 換班</button>
          </div>
          <div id="dashFlowContent" class="flow-list-scroll">
            ${renderFlowList(FLOWS_MY)}
          </div>
        </div>

        <!-- Calendar -->
        <div class="card">
          <div class="cal-header">
            <h3><i data-lucide="calendar" style="width:18px;height:18px;vertical-align:-3px"></i> ${monthLabel(scheduleYear, scheduleMonth)}</h3>
            <div class="cal-nav">
              <button onclick="changeMonth(-1)"><i data-lucide="chevron-left"></i></button>
              <button onclick="changeMonth(1)"><i data-lucide="chevron-right"></i></button>
            </div>
          </div>
          ${buildCalendar(scheduleYear, scheduleMonth, schedule, false)}
          <div class="legend">
            <div class="legend-item"><span class="legend-color chip-full"></span>1030-1930</div>
            <div class="legend-item"><span class="legend-color chip-morning"></span>11-20</div>
            <div class="legend-item"><span class="legend-color chip-afternoon"></span>15-0</div>
            <div class="legend-item"><span class="legend-color chip-night"></span>16-1</div>
            <div class="legend-item"><span class="legend-color chip-off"></span>休</div>
          </div>
        </div>
      </div>

      <!-- RIGHT COLUMN -->
      <div>
        <!-- Announcements -->
        <div class="card" style="margin-bottom:20px">
          <div class="card-hd"><i data-lucide="megaphone"></i> 公告</div>
          ${ANNOUNCEMENTS.map((a, i) => `
            <div class="announce-item" style="cursor:pointer" onclick="openAnnouncementDetail(${i})">
              ${a.pinned ? '<span class="announce-tag" style="background:oklch(0.93 0.05 25);color:oklch(0.50 0.18 25)">置頂</span>' : ''}
              <span class="announce-tag" style="background:${a.tagBg};color:${a.tagColor}">${a.tag}</span>
              <span class="announce-title">${a.title}</span>
              <div class="announce-date">${a.date}</div>
            </div>
          `).join('')}
        </div>

        <!-- Reminders -->
        <div class="card" style="margin-bottom:20px">
          <div class="card-hd"><i data-lucide="bell-ring"></i> 今日提醒</div>
          ${REMINDERS.map(r => `
            <div class="reminder-item">
              <div class="reminder-dot" style="background:${r.color}"></div>
              <div style="flex:1">
                <div style="font-size:.82rem;font-weight:600">${r.title}</div>
                <div style="font-size:.75rem;color:var(--fg-3)">${r.meta}</div>
              </div>
              <div style="font-size:.72rem;color:var(--fg-3);white-space:nowrap">${r.time}</div>
            </div>
          `).join('')}
        </div>

        <!-- Contacts -->
        <div class="card">
          <div class="card-hd"><i data-lucide="users"></i> 常用聯絡人</div>
          ${CONTACTS.map(c => {
            const statusColor = c.status === 'on' ? 'oklch(0.65 0.2 145)' : c.status === 'away' ? 'oklch(0.72 0.14 75)' : 'var(--fg-4)';
            return `<div class="contact-item">
              <div class="contact-avatar">${c.initials}</div>
              <div style="flex:1">
                <div class="contact-name">${c.name}</div>
                <div class="contact-role">${c.role}</div>
              </div>
              <div style="width:8px;height:8px;border-radius:50%;background:${statusColor}"></div>
            </div>`;
          }).join('')}
          <div style="text-align:center;margin-top:10px"><button class="btn btn-ghost btn-sm" onclick="navigate('/contacts')">查看全部聯絡人</button></div>
        </div>
      </div>
    </div>
  `;
}

function switchDashFlowTab(tab, el) {
  document.querySelectorAll('#dashFlowTabs .tab-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  const list = tab === 'my' ? FLOWS_MY : FLOWS_ASSIGNED;
  document.getElementById('dashFlowContent').innerHTML = renderFlowList(list);
}

function renderFlowList(items) {
  if (!items.length) return '<div style="padding:20px;text-align:center;color:var(--fg-4);font-size:.85rem">暫無資料</div>';
  return items.map(f => {
    let chainHtml = '';
    if (f.chain) {
      chainHtml = '<div class="approval-chain">';
      f.chain.forEach((step, i) => {
        const icon = step.status === 'done' ? '<i data-lucide="check" style="width:12px;height:12px"></i>' : step.status === 'current' ? '<i data-lucide="loader" style="width:12px;height:12px"></i>' : '&bull;';
        chainHtml += `<div class="approval-step ${step.status}"><div class="step-circle">${icon}</div><span class="step-label">${step.role}</span></div>`;
        if (i < f.chain.length - 1) {
          chainHtml += `<div class="approval-connector ${step.status === 'done' ? 'done' : ''}"></div>`;
        }
      });
      chainHtml += '</div>';
    }
    return `
      <div class="flow-item" style="flex-wrap:wrap">
        <div class="flow-icon" style="background:${f.iconBg};color:${f.iconColor}"><i data-lucide="${f.icon}"></i></div>
        <div class="flow-info">
          <div class="flow-title">${f.title}</div>
          <div class="flow-desc">${f.sub} &middot; ${f.date}</div>
        </div>
        <div class="flow-status">${statusBadge(f.status)}</div>
        ${chainHtml ? `<div style="width:100%;padding-left:48px">${chainHtml}</div>` : ''}
      </div>
    `;
  }).join('');
}

// ========== CLOCK PAGE ==========
function renderClock() {
  return `
    <div class="page-title"><i data-lucide="fingerprint"></i> 打卡</div>
    <div class="grid-2">
      <div class="card" style="text-align:center">
        <div class="big-clock" id="liveTime">--:--:--</div>
        <div class="big-date" id="liveDate"></div>
        <div style="margin-top:6px;font-size:.82rem;color:var(--fg-3)"><i data-lucide="map-pin" style="width:14px;height:14px;vertical-align:-2px"></i> GPS: 25.0330, 121.5654（辦公室）</div>
        <div style="margin-top:20px;display:flex;gap:12px;justify-content:center">
          ${clockedIn
            ? `<button class="btn btn-punch-out btn-lg" onclick="doPunchOut()"><i data-lucide="log-out" style="width:20px;height:20px"></i> 下班打卡</button>`
            : `<button class="btn btn-punch-in btn-lg" onclick="doPunchIn()"><i data-lucide="log-in" style="width:20px;height:20px"></i> 上班打卡</button>`
          }
        </div>
        <div style="margin-top:12px;font-size:.85rem;color:var(--fg-3)">${clockedIn ? '已上班打卡 ' + (clockInTime ? clockInTime.toLocaleTimeString('zh-TW',{hour12:false}) : '') : '尚未打卡'}</div>
      </div>
      <div>
        <div class="card" style="margin-bottom:16px">
          <div class="card-hd">今日紀錄</div>
          <table>
            <tr><th>類型</th><th>時間</th><th>狀態</th></tr>
            <tr><td>上班</td><td>${clockedIn && clockInTime ? clockInTime.toLocaleTimeString('zh-TW',{hour12:false}) : '08:53'}</td><td>${attStatusBadge('正常')}</td></tr>
            ${clockedIn ? '' : '<tr><td>下班</td><td>18:05</td><td>' + attStatusBadge('正常') + '</td></tr>'}
          </table>
        </div>
        <div class="card">
          <div class="card-hd">本週出勤</div>
          <table>
            <thead><tr><th>日期</th><th>上班</th><th>下班</th><th>時數</th><th>狀態</th></tr></thead>
            <tbody>
              ${ATTENDANCE_DATA.slice(-7).map(a => `
                <tr>
                  <td>${a.date} (${a.weekday})</td><td>${a.clockIn}</td><td>${a.clockOut}</td>
                  <td>${a.hours}</td><td>${attStatusBadge(a.status)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function attStatusBadge(s) {
  const map = {
    '正常': 'badge-approved', '上班中': 'badge-approved',
    '遲到': 'badge-rejected', '補卡': 'badge-info',
    '休假': 'badge-pending', '特休': 'badge-pending'
  };
  return `<span class="badge ${map[s] || 'badge-pending'}">${s}</span>`;
}

// ========== SCHEDULE PAGE ==========
function renderSchedule() {
  const schedule = genSchedule(scheduleYear, scheduleMonth);
  return `
    <div class="page-title"><i data-lucide="calendar-days"></i> 班表</div>
    <div class="card">
      <div class="cal-header">
        <h3>${monthLabel(scheduleYear, scheduleMonth)}</h3>
        <div class="cal-nav">
          <button onclick="changeMonth(-1)"><i data-lucide="chevron-left"></i></button>
          <button onclick="changeMonth(1)"><i data-lucide="chevron-right"></i></button>
        </div>
      </div>
      ${buildCalendar(scheduleYear, scheduleMonth, schedule, false)}
      <div class="legend">
        <div class="legend-item"><span class="legend-color chip-full"></span>1030-1930（${SHIFTS.F.time}）</div>
        <div class="legend-item"><span class="legend-color chip-morning"></span>11-20（${SHIFTS.M.time}）</div>
        <div class="legend-item"><span class="legend-color chip-afternoon"></span>15-0（${SHIFTS.A.time}）</div>
        <div class="legend-item"><span class="legend-color chip-night"></span>16-1（${SHIFTS.N.time}）</div>
        <div class="legend-item"><span class="legend-color chip-off"></span>休</div>
      </div>
    </div>
  `;
}

// ========== LEAVE PAGE ==========
function renderLeave() {
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
      <div class="page-title" style="margin-bottom:0"><i data-lucide="calendar-off"></i> 請假</div>
      <button class="btn btn-primary" onclick="openLeaveModal()"><i data-lucide="plus" style="width:16px;height:16px"></i> 新增請假</button>
    </div>
    <div class="leave-balances">
      ${LEAVE_BALANCE.map(b => {
        const remain = b.total - b.used;
        const pct = Math.round((remain / b.total) * 100);
        return `
        <div class="leave-bal-card">
          <div class="leave-bal-type">${b.type}</div>
          <div class="leave-bal-num">${remain}</div>
          <div class="leave-bal-total">剩餘 / ${b.total} 天</div>
          <div style="margin-top:6px;height:4px;background:var(--border);border-radius:2px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:var(--accent);border-radius:2px"></div>
          </div>
        </div>`;
      }).join('')}
    </div>
    <div class="card">
      <div class="card-hd">申請紀錄</div>
      <table>
        <thead><tr><th>單號</th><th>假別</th><th>起</th><th>迄</th><th>天數</th><th>事由</th><th>狀態</th></tr></thead>
        <tbody>
          ${LEAVE_HISTORY.map(l => `
            <tr><td>${l.id}</td><td>${l.type}</td><td>${l.start}</td><td>${l.end}</td><td>${l.days}</td><td>${l.reason}</td><td>${statusBadge(l.status)}</td></tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function openLeaveModal() {
  openModal(`
    <div class="modal-title">新增請假<span class="modal-close" onclick="closeModal()">&times;</span></div>
    <div class="form-group"><label>假別</label><select><option>特休</option><option>事假</option><option>病假</option><option>家庭照顧假</option><option>喪假</option><option>婚假</option></select></div>
    <div class="form-group"><label>起始日</label><input type="date" value="2026-04-21"></div>
    <div class="form-group"><label>結束日</label><input type="date" value="2026-04-21"></div>
    <div class="form-group"><label>事由</label><textarea rows="3" placeholder="請輸入請假事由..."></textarea></div>
    <div class="form-group"><label>職務代理人</label><select><option value="">請選擇代理人</option><option>Vicky</option><option>SNOW</option><option>Ken</option><option>Dave</option><option>Alicia</option><option>Zoey</option><option>學文</option></select></div>
    <div class="form-group"><label>附件</label><input type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" style="padding:6px"><div style="font-size:.75rem;color:var(--fg-4);margin-top:4px">上傳附檔（診斷證明等）</div></div>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" onclick="handleLeaveSubmit()">送出申請</button>
    </div>
  `);
}
async function handleLeaveSubmit() {
  const modal = document.getElementById('modalContent');
  const selects = modal.querySelectorAll('select');
  const inputs = modal.querySelectorAll('input[type=date]');
  const textarea = modal.querySelector('textarea');
  const form = { type: selects[0]?.value, startDate: inputs[0]?.value, endDate: inputs[1]?.value, reason: textarea?.value || '' };
  const d0 = new Date(form.startDate), d1 = new Date(form.endDate);
  form.days = Math.max(1, Math.round((d1 - d0) / 86400000) + 1);
  closeModal();
  if (isApiAvailable()) {
    const ok = await submitLeaveRequest(form);
    showToast(ok ? '請假單已送出並建立簽核流程！' : '請假單送出失敗，請稍後再試', ok ? 'check-circle-2' : 'alert-circle');
  } else {
    showToast('請假單已送出！（Demo 模式）', 'check-circle-2');
  }
}

// ========== OVERTIME PAGE ==========
function renderOvertime() {
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
      <div class="page-title" style="margin-bottom:0"><i data-lucide="timer"></i> 加班申請</div>
      <button class="btn btn-primary" onclick="openOTModal()"><i data-lucide="plus" style="width:16px;height:16px"></i> 新增加班</button>
    </div>
    <div class="card">
      <div class="card-hd">申請紀錄</div>
      <table>
        <thead><tr><th>單號</th><th>日期</th><th>開始</th><th>結束</th><th>時數</th><th>事由</th><th>狀態</th></tr></thead>
        <tbody>
          ${OT_HISTORY.map(o => `
            <tr><td>${o.id}</td><td>${o.date}</td><td>${o.start}</td><td>${o.end}</td><td>${o.hours}</td><td>${o.reason}</td><td>${statusBadge(o.status)}</td></tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function openOTModal() {
  openModal(`
    <div class="modal-title">新增加班申請<span class="modal-close" onclick="closeModal()">&times;</span></div>
    <div class="form-group"><label>加班日期</label><input type="date" value="2026-04-18"></div>
    <div class="form-group"><label>開始時間</label><input type="time" value="18:00"></div>
    <div class="form-group"><label>結束時間</label><input type="time" value="21:00"></div>
    <div class="form-group"><label>加班事由</label><textarea rows="3" placeholder="請輸入加班事由..."></textarea></div>
    <div class="form-group"><label>補償方式</label>
      <div style="display:flex;gap:20px;padding:6px 0">
        <label style="display:flex;align-items:center;gap:6px;font-size:.88rem;font-weight:400;cursor:pointer"><input type="radio" name="otComp" value="pay" checked style="width:auto"> 加班費</label>
        <label style="display:flex;align-items:center;gap:6px;font-size:.88rem;font-weight:400;cursor:pointer"><input type="radio" name="otComp" value="comp" style="width:auto"> 換補休</label>
      </div>
    </div>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" onclick="handleOTSubmit()">送出申請</button>
    </div>
  `);
}
async function handleOTSubmit() {
  const modal = document.getElementById('modalContent');
  const dateInput = modal.querySelector('input[type=date]');
  const timeInputs = modal.querySelectorAll('input[type=time]');
  const textarea = modal.querySelector('textarea');
  const start = timeInputs[0]?.value || '18:00', end = timeInputs[1]?.value || '21:00';
  const hours = Math.max(1, Math.round((new Date('2000-01-01T'+end) - new Date('2000-01-01T'+start)) / 3600000));
  const form = { date: dateInput?.value, hours, reason: textarea?.value || '' };
  closeModal();
  if (isApiAvailable()) {
    const ok = await submitOvertimeRequest(form);
    showToast(ok ? '加班單已送出並建立簽核流程！' : '加班單送出失敗，請稍後再試', ok ? 'check-circle-2' : 'alert-circle');
  } else {
    showToast('加班單已送出！（Demo 模式）', 'check-circle-2');
  }
}

// ========== PUNCH CORRECTION PAGE ==========
function renderPunch() {
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
      <div class="page-title" style="margin-bottom:0"><i data-lucide="refresh-cw"></i> 補打卡</div>
      <button class="btn btn-primary" onclick="openPunchModal()"><i data-lucide="plus" style="width:16px;height:16px"></i> 新增補打卡</button>
    </div>
    <div class="card">
      <div class="card-hd">申請紀錄</div>
      <table>
        <thead><tr><th>單號</th><th>日期</th><th>補卡時間</th><th>類型</th><th>事由</th><th>狀態</th></tr></thead>
        <tbody>
          ${PUNCH_HISTORY.map(p => `
            <tr><td>${p.id}</td><td>${p.date}</td><td>${p.time}</td><td>${p.type}</td><td>${p.reason}</td><td>${statusBadge(p.status)}</td></tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function openPunchModal() {
  openModal(`
    <div class="modal-title">新增補打卡<span class="modal-close" onclick="closeModal()">&times;</span></div>
    <div class="form-group"><label>補卡日期</label><input type="date" value="2026-04-17"></div>
    <div class="form-group"><label>補卡時間</label><input type="time" value="09:00"></div>
    <div class="form-group"><label>類型</label><select><option>上班</option><option>下班</option></select></div>
    <div class="form-group"><label>原因</label><textarea rows="3" placeholder="請輸入補打卡原因..."></textarea></div>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" onclick="closeModal();showToast('補打卡單已送出！','check-circle-2')">送出申請</button>
    </div>
  `);
}
