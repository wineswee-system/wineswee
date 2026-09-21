// ========== pages1b.js — Salary, Attendance, Off-Request, Flows, Outing ==========

// ========== SALARY PAGE ==========
function renderSalary() {
  const totalIncome = SALARY_DATA.income.reduce((s, i) => s + i.amount, 0);
  const totalDeduction = SALARY_DATA.deduction.reduce((s, i) => s + i.amount, 0);
  const net = totalIncome - totalDeduction;

  return `
    <div class="page-title"><i data-lucide="wallet"></i> 薪資單</div>

    <!-- Hero card -->
    <div class="card" style="background:var(--accent);color:#fff;text-align:center;padding:28px;margin-bottom:20px;border:none">
      <div style="font-size:.85rem;opacity:.85">${SALARY_DATA.month} 實發薪資</div>
      <div style="font-size:2.2rem;font-weight:800;margin:6px 0">NT$ ${formatMoney(net)}</div>
      <div style="display:flex;justify-content:center;gap:32px;margin-top:10px;font-size:.82rem;opacity:.8">
        <span>應發 $${formatMoney(totalIncome)}</span>
        <span>應扣 $${formatMoney(totalDeduction)}</span>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="form-group" style="max-width:200px;margin-bottom:0">
        <label>月份</label>
        <input type="month" value="${SALARY_DATA.month}">
      </div>
    </div>

    <div class="grid-3" style="margin-bottom:16px">
      <div class="card" style="text-align:center;padding:16px">
        <div style="font-size:.78rem;color:var(--fg-3)">應發合計</div>
        <div style="font-size:1.5rem;font-weight:700;color:oklch(0.55 0.15 145)">$${formatMoney(totalIncome)}</div>
      </div>
      <div class="card" style="text-align:center;padding:16px">
        <div style="font-size:.78rem;color:var(--fg-3)">應扣合計</div>
        <div style="font-size:1.5rem;font-weight:700;color:oklch(0.55 0.18 25)">$${formatMoney(totalDeduction)}</div>
      </div>
      <div class="card" style="text-align:center;padding:16px">
        <div style="font-size:.78rem;color:var(--fg-3)">實發金額</div>
        <div style="font-size:1.5rem;font-weight:700;color:var(--accent)">$${formatMoney(net)}</div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-hd" style="color:oklch(0.55 0.15 145)"><i data-lucide="trending-up"></i> 應發項目</div>
        ${SALARY_DATA.income.map(i => `
          <div class="salary-row"><span>${i.item}</span><span>$${formatMoney(i.amount)}</span></div>
        `).join('')}
        <div class="salary-row" style="font-weight:700;border-top:2px solid var(--border);margin-top:4px;padding-top:10px">
          <span>小計</span><span>$${formatMoney(totalIncome)}</span>
        </div>
      </div>
      <div class="card">
        <div class="card-hd" style="color:oklch(0.55 0.18 25)"><i data-lucide="trending-down"></i> 應扣項目</div>
        ${SALARY_DATA.deduction.map(d => `
          <div class="salary-row"><span>${d.item}</span><span>$${formatMoney(d.amount)}</span></div>
        `).join('')}
        <div class="salary-row" style="font-weight:700;border-top:2px solid var(--border);margin-top:4px;padding-top:10px">
          <span>小計</span><span>$${formatMoney(totalDeduction)}</span>
        </div>
      </div>
    </div>

    <div class="card" style="text-align:center;margin-top:16px">
      <button class="btn btn-primary" onclick="showToast('PDF 下載功能開發中','info')"><i data-lucide="download" style="width:16px;height:16px"></i> 下載薪資條 PDF</button>
    </div>
  `;
}

// ========== ATTENDANCE PAGE ==========
function renderAttendance() {
  const normal = ATTENDANCE_DATA.filter(a => a.status === '正常').length;
  const late = ATTENDANCE_DATA.filter(a => a.status === '遲到').length;
  const leave = ATTENDANCE_DATA.filter(a => a.status === '特休').length;
  const workDays = ATTENDANCE_DATA.filter(a => a.hours !== '-').length;

  return `
    <div class="page-title"><i data-lucide="bar-chart-3"></i> 出勤紀錄</div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px">
      <div class="card" style="text-align:center;padding:16px">
        <div style="font-size:1.5rem;font-weight:700">${workDays}</div>
        <div style="font-size:.78rem;color:var(--fg-3)">出勤天數</div>
      </div>
      <div class="card" style="text-align:center;padding:16px">
        <div style="font-size:1.5rem;font-weight:700;color:oklch(0.55 0.15 145)">${normal}</div>
        <div style="font-size:.78rem;color:var(--fg-3)">正常</div>
      </div>
      <div class="card" style="text-align:center;padding:16px">
        <div style="font-size:1.5rem;font-weight:700;color:oklch(0.55 0.18 25)">${late}</div>
        <div style="font-size:.78rem;color:var(--fg-3)">遲到</div>
      </div>
      <div class="card" style="text-align:center;padding:16px">
        <div style="font-size:1.5rem;font-weight:700;color:oklch(0.55 0.12 235)">${leave}</div>
        <div style="font-size:.78rem;color:var(--fg-3)">請假</div>
      </div>
    </div>
    <div class="card">
      <div class="card-hd">2026 年 4 月出勤明細</div>
      <table>
        <thead><tr><th>日期</th><th>星期</th><th>上班</th><th>下班</th><th>工時</th><th>狀態</th></tr></thead>
        <tbody>
          ${ATTENDANCE_DATA.map(a => `
            <tr>
              <td>${a.date}</td><td>${a.weekday}</td><td>${a.clockIn}</td><td>${a.clockOut}</td><td>${a.hours}</td>
              <td>${attStatusBadge(a.status)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ========== OFF REQUEST PAGE ==========
function renderOffRequest() {
  const nextMonth = scheduleMonth === 11 ? 0 : scheduleMonth + 1;
  const nextYear = scheduleMonth === 11 ? scheduleYear + 1 : scheduleYear;

  return `
    <div class="page-title"><i data-lucide="calendar-heart"></i> 希望排休</div>
    <div class="card">
      <p style="font-size:.88rem;color:var(--fg-2);margin-bottom:14px">
        請點選日曆中您希望排休的日期（最多可選 8 天），截止日：${nextYear}/${nextMonth + 1}/25
      </p>
      <div class="cal-header">
        <h3>${monthLabel(nextYear, nextMonth)}</h3>
      </div>
      <div id="offCalendar">
        ${buildCalendar(nextYear, nextMonth, null, true)}
      </div>
      <div style="margin-top:14px;display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:.85rem;color:var(--fg-3)">已選 <strong id="offCount">${selectedOffDays.size}</strong> / 8 天</div>
        <button class="btn btn-primary" onclick="submitOffRequest()"><i data-lucide="send" style="width:16px;height:16px"></i> 送出希望排休</button>
      </div>
    </div>
  `;
}

function toggleOffDay(d) {
  if (selectedOffDays.has(d)) {
    selectedOffDays.delete(d);
  } else {
    if (selectedOffDays.size >= 8) { showToast('最多選擇 8 天', 'alert-circle'); return; }
    selectedOffDays.add(d);
  }
  render();
}

function submitOffRequest() {
  if (selectedOffDays.size === 0) { showToast('請至少選擇一天', 'alert-circle'); return; }
  const days = [...selectedOffDays].sort((a,b) => a - b).join(', ');
  showToast(`已送出希望排休：第 ${days} 日`, 'check-circle-2');
  selectedOffDays.clear();
  render();
}

// ========== FLOWS PAGE ==========
function renderFlows() {
  return `
    <div class="page-title"><i data-lucide="git-pull-request-arrow"></i> 流程中心</div>
    <div class="card" style="margin-bottom:16px">
      <div class="card-hd">快速發起</div>
      <div class="quick-launch">
        <button class="btn btn-outline btn-sm" onclick="openLeaveModal()">+ 請假單</button>
        <button class="btn btn-outline btn-sm" onclick="openOTModal()">+ 加班單</button>
        <button class="btn btn-outline btn-sm" onclick="openPunchModal()">+ 補打卡</button>
        <button class="btn btn-outline btn-sm" onclick="openExpenseModal()">+ 費用申請</button>
        <button class="btn btn-outline btn-sm" onclick="openBizTripModal()">+ 出差申請</button>
        <button class="btn btn-outline btn-sm" onclick="openSwapShiftModal()">+ 換班申請</button>
      </div>
    </div>
    <div class="card">
      <div class="tabs" id="flowTabs">
        <button class="tab-btn ${currentFlowTab==='my'?'active':''}" onclick="switchFlowTab('my',this)">我發起的</button>
        <button class="tab-btn ${currentFlowTab==='assigned'?'active':''}" onclick="switchFlowTab('assigned',this)">指派給我的</button>
      </div>
      <div id="flowContent">
        ${renderFlowList(currentFlowTab === 'my' ? FLOWS_MY : FLOWS_ASSIGNED)}
      </div>
    </div>
  `;
}

function switchFlowTab(tab, el) {
  currentFlowTab = tab;
  document.querySelectorAll('#flowTabs .tab-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  const list = tab === 'my' ? FLOWS_MY : FLOWS_ASSIGNED;
  document.getElementById('flowContent').innerHTML = renderFlowList(list);
  if (window.lucide) lucide.createIcons();
}

// ========== OUTING PAGE ==========
function renderOuting() {
  return `
    <div class="page-title"><i data-lucide="map-pin"></i> 外出登記</div>
    <div class="grid-2">
      <div class="card">
        <div class="card-hd"><i data-lucide="map-pin"></i> 外出登記</div>
        <div style="padding:10px 0;font-size:.85rem;color:var(--fg-3);margin-bottom:10px">
          <span style="font-weight:600">目前位置：</span>25.0330, 121.5654（辦公室附近）
        </div>
        <div class="form-group"><label>外出原因</label><select id="outingReason"><option>拜訪客戶</option><option>開會</option><option>送貨</option><option>其他</option></select></div>
        <div class="form-group"><label>備註</label><textarea id="outingNote" rows="3" placeholder="請輸入備註..."></textarea></div>
        <div style="display:flex;gap:10px;margin-top:16px">
          <button class="btn btn-success" style="flex:1" onclick="showToast('外出簽到成功！','check-circle-2')"><i data-lucide="log-out" style="width:16px;height:16px"></i> 外出簽到</button>
          <button class="btn btn-danger" style="flex:1" onclick="showToast('外出簽退成功！','check-circle-2')"><i data-lucide="log-in" style="width:16px;height:16px"></i> 外出簽退</button>
        </div>
      </div>
      <div class="card">
        <div class="card-hd"><i data-lucide="clipboard-list"></i> 今日外出紀錄</div>
        ${OUTING_RECORDS.length === 0 ? '<div style="padding:16px;text-align:center;color:var(--fg-4);font-size:.85rem">尚無外出紀錄</div>' :
          OUTING_RECORDS.map(r => `
            <div class="outing-record">
              <div class="outing-time">${r.time}</div>
              <div class="outing-info">
                <div class="outing-reason">${r.type === 'out' ? '<i data-lucide="arrow-up-right" style="width:14px;height:14px;color:oklch(0.55 0.18 25)"></i> 外出' : '<i data-lucide="arrow-down-left" style="width:14px;height:14px;color:oklch(0.55 0.15 145)"></i> 返回'} — ${r.reason}</div>
                <div class="outing-note">${r.note}</div>
              </div>
              <span class="badge ${r.status === '外出中' ? 'badge-pending' : 'badge-approved'}">${r.status}</span>
            </div>
          `).join('')}
      </div>
    </div>
  `;
}
