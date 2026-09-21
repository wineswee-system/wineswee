// ========== SUPABASE CONNECTION ==========
const SUPABASE_URL = 'https://mvkvnuxeamahhfahclmi.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12a3ZudXhlYW1haGhmYWhjbG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1ODM3NDIsImV4cCI6MjA5MDE1OTc0Mn0.XdwpFEvels80p8A7u99hV-SChf_vu2jbb-28q8qJLoo'
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ========== DATA VARIABLES (same names as before) ==========
let EMPLOYEE = { name: '載入中...', empId: '', dept: '', position: '', email: '', phone: '', joinDate: '', birthday: '', address: '', gender: '', emergencyName: '', emergencyPhone: '', emergencyRel: '', bankName: '', bankAccount: '', store: '' };
let LEAVE_BALANCE = [];
let LEAVE_HISTORY = [];
let OT_HISTORY = [];
let PUNCH_HISTORY = [];
let SALARY_DATA = { month: '', income: [], deduction: [] };
let ATTENDANCE_DATA = [];
let CONTACTS = [];
let CONTACTS_FULL = [];
let EXPENSE_HISTORY = [];
let FLOWS_MY = [];
let FLOWS_ASSIGNED = [];
let REMINDERS = [];
let _schedules = []; // raw schedule_data rows

const ANNOUNCEMENTS = [
  { tag: '排班', tagBg: 'oklch(0.95 0.03 235)', tagColor: 'oklch(0.42 0.12 235)', title: '4月份排班表已發佈', date: '2026-04-18', pinned: true, detail: '各位同仁好，4月份排班表已正式發佈，請至「班表」頁面確認您的班次。\n\n注意事項：\n1. 本月因連假調整，部分班次有異動\n2. 請特別注意五一前後的出勤安排\n3. 如需換班請走流程中心申請' },
  { tag: '人事', tagBg: 'var(--amber-soft)', tagColor: 'oklch(0.45 0.14 75)', title: '五一勞動節放假公告', date: '2026-04-15', pinned: false, detail: '依據勞動基準法規定，5月1日（五）為勞動節，全體員工放假一日。\n\n放假日期：2026年5月1日（星期五）\n補班安排：無需補班\n\n請各部門提前完成工作交接。' },
  { tag: '福利', tagBg: 'var(--violet-soft)', tagColor: 'oklch(0.40 0.13 295)', title: '員工健康檢查通知', date: '2026-04-10', pinned: false, detail: '公司年度員工健康檢查即將開始：\n\n檢查日期：2026年5月5日～5月9日\n檢查地點：台北市立聯合醫院仁愛院區\n\n注意事項：\n1. 檢查前一天晚上10點後請勿進食\n2. 請攜帶健保卡及員工證\n3. 報名截止日：4/25' },
  { tag: '訓練', tagBg: 'var(--accent-soft)', tagColor: 'var(--accent-ink)', title: '新品上市教育訓練報名', date: '2026-04-08', pinned: false, detail: '課程資訊：\n日期：2026年4月22日（二）14:00-17:00\n地點：總部3F訓練教室\n講師：產品部 張經理\n\n課程內容：\n1. 新品特色及市場定位\n2. 銷售話術及FAQ\n3. 實機操作演練' }
];

const OUTING_RECORDS = [
  { time: '09:30', type: 'out', reason: '拜訪客戶', note: '台北101大樓', status: '已簽退' },
  { time: '11:45', type: 'in', reason: '拜訪客戶', note: '返回辦公室', status: '已簽退' },
  { time: '14:00', type: 'out', reason: '開會', note: '合作夥伴會議', status: '外出中' }
];

const SHIFTS = {
  M: { label: '11-20', tag: 'chip-morning', time: '11:00-20:00' },
  A: { label: '15-0', tag: 'chip-afternoon', time: '15:00-00:00' },
  N: { label: '16-1', tag: 'chip-night', time: '16:00-01:00' },
  F: { label: '1030-1930', tag: 'chip-full', time: '10:30-19:30' },
  O: { label: '休', tag: 'chip-off', time: '' }
};

// ========== SCHEDULE GENERATOR ==========
function genSchedule(year, month) {
  // Try to use actual schedule_data if available
  if (_schedules.length > 0) {
    const schedule = {};
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    // schedule_data has weekly rows: mon-sun columns
    // Try to map them to days
    for (const row of _schedules) {
      if (!row.week_start) continue;
      const ws = new Date(row.week_start);
      const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
      for (let i = 0; i < 7; i++) {
        const d = new Date(ws);
        // week_start is Monday-based, offset accordingly
        d.setDate(ws.getDate() + i);
        if (d.getFullYear() === year && d.getMonth() === month) {
          const dayNum = d.getDate();
          const colName = dayNames[d.getDay()];
          const val = row[colName] || '休';
          if (val === '休' || val === 'OFF' || val === 'off') {
            schedule[dayNum] = 'O';
          } else {
            // Map shift names to keys
            schedule[dayNum] = 'F'; // default to full shift
          }
        }
      }
    }
    if (Object.keys(schedule).length > 0) return schedule;
  }
  // Fallback: pattern-based schedule
  const pattern = ['F','F','F','F','F','O','O','M','M','A','A','F','F','O','O','M','F','F','A','F','O','O','F','F','F','M','M','F','O','O','F'];
  const days = new Date(year, month + 1, 0).getDate();
  const schedule = {};
  for (let d = 1; d <= days; d++) schedule[d] = pattern[(d - 1) % pattern.length];
  return schedule;
}

// ========== DATA LOADING ==========
let _dataLoaded = false;

async function loadAllData() {
  try {
    // 1. Get current auth session
    let employeeName = null;
    let employeeEmail = null;
    const { data: sessionData } = await sb.auth.getSession();
    if (sessionData?.session?.user) {
      employeeEmail = sessionData.session.user.email;
    }

    // 2. Load employee — by email if logged in, otherwise first employee
    let empQuery;
    if (employeeEmail) {
      empQuery = sb.from('employees').select('*').eq('email', employeeEmail).single();
    } else {
      // Demo mode: load first employee
      empQuery = sb.from('employees').select('*').order('id', { ascending: true }).limit(1).single();
    }
    const { data: empData, error: empError } = await empQuery;
    if (empData && !empError) {
      EMPLOYEE = {
        id: empData.id,
        name: empData.name || '',
        empId: 'EMP-' + String(empData.id).padStart(3, '0'),
        dept: empData.dept || '',
        position: empData.position || '',
        email: empData.email || '',
        phone: empData.phone || '',
        joinDate: empData.join_date || '',
        birthday: empData.birthday || '',
        address: empData.address || '',
        gender: empData.gender || '',
        emergencyName: empData.emergency_name || '',
        emergencyPhone: empData.emergency_phone || '',
        emergencyRel: empData.emergency_rel || '',
        bankName: empData.bank_name || '',
        bankAccount: empData.bank_account || '',
        store: empData.store || ''
      };
      employeeName = empData.name;
    }

    if (!employeeName) {
      console.warn('No employee found, using defaults');
      _dataLoaded = true;
      return;
    }

    // 3. Load all related data in parallel
    const [
      leaveRes,
      otRes,
      attendanceRes,
      salaryRes,
      expenseRes,
      contactsRes,
      scheduleRes
    ] = await Promise.all([
      sb.from('leave_requests').select('*').eq('employee', employeeName).order('created_at', { ascending: false }),
      sb.from('overtime_requests').select('*').eq('employee', employeeName).order('created_at', { ascending: false }),
      sb.from('attendance_records').select('*').eq('employee', employeeName).order('date', { ascending: false }).limit(30),
      sb.from('salary_records').select('*').eq('employee', employeeName).order('month', { ascending: false }).limit(1),
      sb.from('expenses').select('*').eq('employee', employeeName).order('created_at', { ascending: false }),
      sb.from('employees').select('*').eq('status', '在職').order('name'),
      sb.from('schedule_data').select('*').eq('employee', employeeName).order('week_start', { ascending: false }).limit(12)
    ]);

    // -- Leave History --
    if (leaveRes.data) {
      LEAVE_HISTORY = leaveRes.data.map(l => ({
        id: 'L-' + String(l.id).padStart(4, '0'),
        type: l.type,
        start: l.start_date,
        end: l.end_date,
        days: l.days,
        reason: l.reason || '',
        status: mapStatus(l.status)
      }));
    }

    // -- Leave Balance (compute from leave_requests) --
    const leaveTypes = ['特休', '事假', '病假', '家庭照顧假'];
    const leaveTotals = { '特休': 14, '事假': 14, '病假': 30, '家庭照顧假': 7 };
    LEAVE_BALANCE = leaveTypes.map(type => {
      const approved = (leaveRes.data || []).filter(l => l.type === type && (l.status === '已核准' || l.status === 'approved'));
      const used = approved.reduce((sum, l) => sum + (l.days || 0), 0);
      return { type, used, total: leaveTotals[type] || 14 };
    });

    // -- Overtime History --
    if (otRes.data) {
      OT_HISTORY = otRes.data.map(o => ({
        id: 'OT-' + String(o.id).padStart(4, '0'),
        date: o.date,
        start: o.start_time || '18:00',
        end: o.end_time || '',
        hours: o.hours,
        reason: o.reason || '',
        status: mapStatus(o.status)
      }));
    }

    // -- Attendance Data --
    if (attendanceRes.data) {
      const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
      ATTENDANCE_DATA = attendanceRes.data.map(a => {
        const d = new Date(a.date);
        return {
          date: `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`,
          weekday: weekdays[d.getDay()],
          clockIn: a.clock_in ? a.clock_in.slice(0, 5) : '-',
          clockOut: a.clock_out ? a.clock_out.slice(0, 5) : '-',
          hours: a.hours ? String(a.hours) : '-',
          status: a.status || '正常'
        };
      }).reverse(); // oldest first for display
    }

    // -- Salary Data --
    if (salaryRes.data && salaryRes.data.length > 0) {
      const s = salaryRes.data[0];
      SALARY_DATA = {
        month: s.month || '',
        income: [
          { item: '本薪', amount: s.base_salary || 0 },
          { item: '津貼', amount: s.allowance || 0 },
          { item: '加班費', amount: s.overtime || 0 }
        ].filter(i => i.amount > 0),
        deduction: [
          { item: '勞健保', amount: s.insurance || 0 },
          { item: '其他扣項', amount: s.deductions || 0 }
        ].filter(i => i.amount > 0)
      };
      // If all empty, provide fallback
      if (SALARY_DATA.income.length === 0) {
        SALARY_DATA.income = [{ item: '本薪', amount: 0 }];
      }
    }

    // -- Expenses --
    if (expenseRes.data) {
      EXPENSE_HISTORY = expenseRes.data.map(e => ({
        id: 'EX-' + String(e.id).padStart(4, '0'),
        category: e.category || '',
        amount: e.amount || 0,
        date: e.date || '',
        desc: e.description || '',
        status: mapStatus(e.status)
      }));
    }

    // -- Contacts --
    const bgColors = [
      { bg: 'oklch(0.95 0.03 235)', fg: 'oklch(0.40 0.10 235)' },
      { bg: 'oklch(0.96 0.03 295)', fg: 'oklch(0.40 0.12 295)' },
      { bg: 'oklch(0.95 0.03 155)', fg: 'oklch(0.42 0.08 155)' },
      { bg: 'oklch(0.96 0.03 25)', fg: 'oklch(0.42 0.14 25)' },
      { bg: 'oklch(0.96 0.04 85)', fg: 'oklch(0.45 0.14 75)' }
    ];
    if (contactsRes.data) {
      CONTACTS_FULL = contactsRes.data.map((c, i) => {
        const color = bgColors[i % bgColors.length];
        const initials = c.name_en ? c.name_en.charAt(0).toUpperCase() : c.name.charAt(0);
        return {
          name: c.name_en || c.name,
          initials,
          position: c.position || '',
          dept: c.dept || '',
          store: c.store || '',
          phone: c.phone || '',
          bg: color.bg,
          fg: color.fg
        };
      });
      CONTACTS = CONTACTS_FULL.slice(0, 4).map(c => ({
        name: c.name,
        role: c.position,
        initials: c.initials,
        status: 'on'
      }));
    }

    // -- Schedule Data --
    if (scheduleRes.data) {
      _schedules = scheduleRes.data;
    }

    // -- Punch corrections (no dedicated table, use empty) --
    PUNCH_HISTORY = [];

    // -- Build FLOWS_MY from leave_requests + overtime_requests --
    FLOWS_MY = [];
    if (leaveRes.data) {
      for (const l of leaveRes.data) {
        const st = mapStatus(l.status);
        const chain = buildChain(st, 'HR 備查');
        FLOWS_MY.push({
          icon: 'calendar-off',
          iconBg: 'oklch(0.95 0.03 155)',
          iconColor: 'oklch(0.42 0.08 155)',
          title: l.type + '申請',
          sub: `${l.start_date} - ${l.end_date} · ${l.days} 天`,
          status: st,
          date: formatShortDate(l.created_at),
          chain
        });
      }
    }
    if (otRes.data) {
      for (const o of otRes.data) {
        const st = mapStatus(o.status);
        const chain = buildChain(st, 'HR 備查');
        FLOWS_MY.push({
          icon: 'timer',
          iconBg: 'oklch(0.96 0.04 85)',
          iconColor: 'oklch(0.45 0.14 75)',
          title: '加班申請',
          sub: `${o.date} · ${o.hours} 小時`,
          status: st,
          date: formatShortDate(o.created_at),
          chain
        });
      }
    }
    if (expenseRes.data) {
      for (const e of expenseRes.data) {
        const st = mapStatus(e.status);
        const chain = buildChain(st, '財務審核');
        FLOWS_MY.push({
          icon: 'receipt',
          iconBg: 'oklch(0.96 0.03 25)',
          iconColor: 'oklch(0.42 0.14 25)',
          title: '費用申請 · ' + (e.category || ''),
          sub: `$${(e.amount || 0).toLocaleString()} · ${e.description || ''}`,
          status: st,
          date: formatShortDate(e.created_at),
          chain
        });
      }
    }

    // -- FLOWS_ASSIGNED (empty for now unless we have task data) --
    FLOWS_ASSIGNED = [];

    // -- Reminders --
    REMINDERS = [
      { color: 'oklch(0.60 0.10 235)', time: '今天', title: '查看班表', meta: '確認本週排班' }
    ];
    const pendingCount = FLOWS_MY.filter(f => f.status === 'pending').length;
    if (pendingCount > 0) {
      REMINDERS.push({ color: 'oklch(0.72 0.14 75)', time: '待處理', title: `${pendingCount} 筆待審核流程`, meta: '前往流程中心查看' });
    }

    _dataLoaded = true;
  } catch (err) {
    console.error('loadAllData error:', err);
    _dataLoaded = true;
  }
}

// ========== HELPERS ==========
function mapStatus(s) {
  if (!s) return 'pending';
  const lower = s.toLowerCase ? s.toLowerCase() : s;
  if (lower === '已核准' || lower === 'approved' || lower === '已通過') return 'approved';
  if (lower === '已駁回' || lower === 'rejected' || lower === '駁回') return 'rejected';
  return 'pending'; // 待審核 or anything else
}

function buildChain(status, lastStep) {
  if (status === 'approved') {
    return [
      { role: '送出', status: 'done' },
      { role: '主管審核', status: 'done' },
      { role: lastStep, status: 'done' }
    ];
  }
  if (status === 'rejected') {
    return [
      { role: '送出', status: 'done' },
      { role: '主管審核', status: 'done' },
      { role: lastStep, status: 'waiting' }
    ];
  }
  return [
    { role: '送出', status: 'done' },
    { role: '主管審核', status: 'current' },
    { role: lastStep, status: 'waiting' }
  ];
}

function formatShortDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}
