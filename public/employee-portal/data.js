// ========== DEMO DATA ==========
const EMPLOYEE = {
  name: '洪伯嘉', empId: 'EMP-001', dept: '資訊部', position: '資深工程師',
  email: 'aska20021023@gmail.com', phone: '0903-***-318', joinDate: '2022-10-23',
  birthday: '2002-10-23', address: '台北市信義區', gender: '男',
  emergencyName: '洪大明', emergencyPhone: '0922-***-222', emergencyRel: '父親',
  bankName: '國泰世華', bankAccount: '****-****-****-3456',
  store: '威士威企業總部'
};

const SHIFTS = {
  M: { label: '11-20', tag: 'chip-morning', time: '11:00-20:00' },
  A: { label: '15-0', tag: 'chip-afternoon', time: '15:00-00:00' },
  N: { label: '16-1', tag: 'chip-night', time: '16:00-01:00' },
  F: { label: '1030-1930', tag: 'chip-full', time: '10:30-19:30' },
  O: { label: '休', tag: 'chip-off', time: '' }
};

function genSchedule(year, month) {
  const pattern = ['F','F','F','F','F','O','O','M','M','A','A','F','F','O','O','M','F','F','A','F','O','O','F','F','F','M','M','F','O','O','F'];
  const days = new Date(year, month + 1, 0).getDate();
  const schedule = {};
  for (let d = 1; d <= days; d++) schedule[d] = pattern[(d - 1) % pattern.length];
  return schedule;
}

const LEAVE_BALANCE = [
  { type: '特休', used: 3, total: 14 },
  { type: '事假', used: 1, total: 14 },
  { type: '病假', used: 2, total: 30 },
  { type: '家庭照顧假', used: 0, total: 7 }
];

const LEAVE_HISTORY = [
  { id: 'L-2026-0014', type: '特休', start: '2026-04-25', end: '2026-04-27', days: 3, reason: '家庭旅遊', status: 'pending' },
  { id: 'L-2026-0011', type: '特休', start: '2026-04-10', end: '2026-04-10', days: 1, reason: '個人事務', status: 'approved' },
  { id: 'L-2026-0008', type: '病假', start: '2026-03-22', end: '2026-03-23', days: 2, reason: '身體不適', status: 'approved' },
  { id: 'L-2026-0004', type: '事假', start: '2026-02-14', end: '2026-02-14', days: 1, reason: '搬家', status: 'approved' }
];

const OT_HISTORY = [
  { id: 'OT-2026-027', date: '2026-04-12', start: '18:00', end: '20:00', hours: 2, reason: '系統上線', status: 'pending' },
  { id: 'OT-2026-023', date: '2026-04-05', start: '18:00', end: '21:00', hours: 3, reason: '專案趕工', status: 'approved' },
  { id: 'OT-2026-017', date: '2026-03-28', start: '18:00', end: '22:00', hours: 4, reason: '季度結算', status: 'approved' }
];

const PUNCH_HISTORY = [
  { id: 'P-2026-012', date: '2026-04-15', time: '17:58', type: '下班', reason: '系統異常', status: 'pending' },
  { id: 'P-2026-009', date: '2026-04-08', time: '08:03', type: '上班', reason: '忘記打卡', status: 'approved' }
];

const SALARY_DATA = {
  month: '2026-03',
  income: [
    { item: '本薪', amount: 55000 },
    { item: '伙食津貼', amount: 2400 },
    { item: '交通津貼', amount: 1500 },
    { item: '加班費', amount: 3200 },
    { item: '績效獎金', amount: 5000 }
  ],
  deduction: [
    { item: '勞保', amount: 1100 },
    { item: '健保', amount: 820 },
    { item: '勞退自提', amount: 3300 },
    { item: '所得稅', amount: 3650 }
  ]
};

const ATTENDANCE_DATA = [
  { date: '04/01', weekday: '一', clockIn: '08:55', clockOut: '18:05', hours: '9.2', status: '正常' },
  { date: '04/02', weekday: '二', clockIn: '08:48', clockOut: '18:10', hours: '9.4', status: '正常' },
  { date: '04/03', weekday: '三', clockIn: '09:12', clockOut: '18:30', hours: '9.3', status: '遲到' },
  { date: '04/04', weekday: '四', clockIn: '-', clockOut: '-', hours: '-', status: '休假' },
  { date: '04/05', weekday: '五', clockIn: '-', clockOut: '-', hours: '-', status: '休假' },
  { date: '04/06', weekday: '一', clockIn: '08:50', clockOut: '18:00', hours: '9.2', status: '正常' },
  { date: '04/07', weekday: '二', clockIn: '08:58', clockOut: '18:02', hours: '9.1', status: '正常' },
  { date: '04/08', weekday: '三', clockIn: '08:03', clockOut: '18:15', hours: '10.2', status: '補卡' },
  { date: '04/09', weekday: '四', clockIn: '08:45', clockOut: '18:00', hours: '9.3', status: '正常' },
  { date: '04/10', weekday: '五', clockIn: '-', clockOut: '-', hours: '-', status: '特休' },
  { date: '04/11', weekday: '六', clockIn: '-', clockOut: '-', hours: '-', status: '休假' },
  { date: '04/12', weekday: '日', clockIn: '-', clockOut: '-', hours: '-', status: '休假' },
  { date: '04/13', weekday: '一', clockIn: '08:52', clockOut: '18:08', hours: '9.3', status: '正常' },
  { date: '04/14', weekday: '二', clockIn: '08:47', clockOut: '18:01', hours: '9.2', status: '正常' },
  { date: '04/15', weekday: '三', clockIn: '08:55', clockOut: '17:58', hours: '9.1', status: '補卡' },
  { date: '04/16', weekday: '四', clockIn: '08:50', clockOut: '18:05', hours: '9.3', status: '正常' },
  { date: '04/17', weekday: '五', clockIn: '08:53', clockOut: '-', hours: '-', status: '上班中' }
];

const ANNOUNCEMENTS = [
  { tag: '排班', tagBg: 'oklch(0.95 0.03 235)', tagColor: 'oklch(0.42 0.12 235)', title: '4月份排班表已發佈', date: '2026-04-18', pinned: true, detail: '各位同仁好，4月份排班表已正式發佈，請至「班表」頁面確認您的班次。\n\n注意事項：\n1. 本月因連假調整，部分班次有異動\n2. 請特別注意五一前後的出勤安排\n3. 如需換班請走流程中心申請' },
  { tag: '人事', tagBg: 'var(--amber-soft)', tagColor: 'oklch(0.45 0.14 75)', title: '五一勞動節放假公告', date: '2026-04-15', pinned: false, detail: '依據勞動基準法規定，5月1日（五）為勞動節，全體員工放假一日。\n\n放假日期：2026年5月1日（星期五）\n補班安排：無需補班\n\n請各部門提前完成工作交接。' },
  { tag: '福利', tagBg: 'var(--violet-soft)', tagColor: 'oklch(0.40 0.13 295)', title: '員工健康檢查通知', date: '2026-04-10', pinned: false, detail: '公司年度員工健康檢查即將開始：\n\n檢查日期：2026年5月5日～5月9日\n檢查地點：台北市立聯合醫院仁愛院區\n\n注意事項：\n1. 檢查前一天晚上10點後請勿進食\n2. 請攜帶健保卡及員工證\n3. 報名截止日：4/25' },
  { tag: '訓練', tagBg: 'var(--accent-soft)', tagColor: 'var(--accent-ink)', title: '新品上市教育訓練報名', date: '2026-04-08', pinned: false, detail: '課程資訊：\n日期：2026年4月22日（二）14:00-17:00\n地點：總部3F訓練教室\n講師：產品部 張經理\n\n課程內容：\n1. 新品特色及市場定位\n2. 銷售話術及FAQ\n3. 實機操作演練' }
];

const CONTACTS = [
  { name: 'Vicky', role: '區域主管', initials: 'V', status: 'on' },
  { name: 'SNOW', role: '資深工程師', initials: 'S', status: 'on' },
  { name: 'Zoey', role: '行銷專員', initials: 'Z', status: 'away' },
  { name: 'Ken', role: '門市人員', initials: 'K', status: 'off' }
];

const CONTACTS_FULL = [
  { name: '洪伯嘉', initials: '洪', position: '資深工程師', dept: '資訊部', store: '威士威企業總部', phone: '0903-***-318', bg: 'oklch(0.95 0.03 235)', fg: 'oklch(0.40 0.10 235)' },
  { name: 'SNOW', initials: 'S', position: '資深工程師', dept: '資訊部', store: '威士威企業總部', phone: '0912-***-678', bg: 'oklch(0.96 0.03 295)', fg: 'oklch(0.40 0.12 295)' },
  { name: 'Vicky', initials: 'V', position: '區域主管', dept: '營運部', store: '威士威企業總部', phone: '0912-***-001', bg: 'oklch(0.95 0.03 155)', fg: 'oklch(0.42 0.08 155)' },
  { name: 'Alicia', initials: 'A', position: '門市人員', dept: '營運部', store: '中山國小', phone: '0912-***-002', bg: 'oklch(0.96 0.03 25)', fg: 'oklch(0.42 0.14 25)' },
  { name: 'Anita', initials: 'A', position: '採購專員', dept: '採購部', store: '威士威企業總部', phone: '0912-***-003', bg: 'oklch(0.96 0.04 85)', fg: 'oklch(0.45 0.14 75)' },
  { name: 'Dave', initials: 'D', position: '門市人員', dept: '營運部', store: '中山國小', phone: '0912-***-004', bg: 'oklch(0.95 0.03 235)', fg: 'oklch(0.40 0.10 235)' },
  { name: 'Ken', initials: 'K', position: '門市人員', dept: '營運部', store: '中山國小', phone: '0912-***-005', bg: 'oklch(0.96 0.03 295)', fg: 'oklch(0.40 0.12 295)' },
  { name: 'Zoey', initials: 'Z', position: '行銷專員', dept: '品牌行銷部', store: '中山國小', phone: '0912-***-006', bg: 'oklch(0.95 0.03 155)', fg: 'oklch(0.42 0.08 155)' },
  { name: '學文', initials: '學', position: '總務專員', dept: '營運部', store: '威士威企業總部', phone: '0912-***-007', bg: 'oklch(0.96 0.04 85)', fg: 'oklch(0.45 0.14 75)' }
];

const EXPENSE_HISTORY = [
  { id: 'EX-2026-021', category: '交通', amount: 1250, date: '2026-04-14', desc: '拜訪客戶計程車費', status: 'pending' },
  { id: 'EX-2026-018', category: '餐飲', amount: 680, date: '2026-04-05', desc: '部門聚餐', status: 'approved' },
  { id: 'EX-2026-014', category: '設備', amount: 3500, date: '2026-03-28', desc: '鍵盤滑鼠更換', status: 'approved' },
  { id: 'EX-2026-009', category: '住宿', amount: 2800, date: '2026-03-15', desc: '出差高雄住宿', status: 'approved' }
];

const OUTING_RECORDS = [
  { time: '09:30', type: 'out', reason: '拜訪客戶', note: '台北101大樓', status: '已簽退' },
  { time: '11:45', type: 'in', reason: '拜訪客戶', note: '返回辦公室', status: '已簽退' },
  { time: '14:00', type: 'out', reason: '開會', note: '合作夥伴會議', status: '外出中' }
];

const FLOWS_MY = [
  { icon: 'calendar-off', iconBg: 'oklch(0.95 0.03 155)', iconColor: 'oklch(0.42 0.08 155)', title: '特休申請', sub: '4/25 - 4/27 · 3 天', status: 'pending', date: '04/16', chain: [{role:'送出',status:'done'},{role:'主管審核',status:'current'},{role:'HR 備查',status:'waiting'}] },
  { icon: 'timer', iconBg: 'oklch(0.96 0.04 85)', iconColor: 'oklch(0.45 0.14 75)', title: '加班申請', sub: '4/12 · 2 小時 · 系統上線', status: 'pending', date: '04/12', chain: [{role:'送出',status:'done'},{role:'主管審核',status:'current'},{role:'HR 備查',status:'waiting'}] },
  { icon: 'receipt', iconBg: 'oklch(0.96 0.03 25)', iconColor: 'oklch(0.42 0.14 25)', title: '費用申請 · 交通費', sub: '$1,250 · 拜訪客戶計程車費', status: 'pending', date: '04/14', chain: [{role:'送出',status:'done'},{role:'主管審核',status:'current'},{role:'財務審核',status:'waiting'}] },
  { icon: 'calendar-off', iconBg: 'oklch(0.95 0.03 155)', iconColor: 'oklch(0.42 0.08 155)', title: '特休申請', sub: '4/10 · 1 天 · 個人事務', status: 'approved', date: '04/08', chain: [{role:'送出',status:'done'},{role:'主管審核',status:'done'},{role:'HR 備查',status:'done'}] },
  { icon: 'receipt', iconBg: 'oklch(0.96 0.03 25)', iconColor: 'oklch(0.42 0.14 25)', title: '費用申請 · 餐飲費', sub: '$680 · 部門聚餐', status: 'approved', date: '04/05', chain: [{role:'送出',status:'done'},{role:'主管審核',status:'done'},{role:'財務審核',status:'done'}] }
];

const FLOWS_ASSIGNED = [
  { icon: 'refresh-cw', iconBg: 'oklch(0.96 0.03 295)', iconColor: 'oklch(0.40 0.12 295)', title: '陳小瑜 · 補打卡', sub: '04/14 下班卡 · 手機沒電', status: 'pending', date: '04/16' },
  { icon: 'calendar-off', iconBg: 'oklch(0.95 0.03 155)', iconColor: 'oklch(0.42 0.08 155)', title: '林小美 · 事假', sub: '04/22 · 1 天 · 家中有事', status: 'pending', date: '04/15' }
];

const REMINDERS = [
  { color: 'oklch(0.64 0.16 25)', time: '今天', title: '薪資單發放日', meta: '3 月薪資已入帳' },
  { color: 'oklch(0.72 0.14 75)', time: '4/25', title: '五月希望排休截止', meta: '尚未送出' },
  { color: 'oklch(0.60 0.10 235)', time: '14:00', title: '部門週會', meta: '會議室 B · 資訊部' },
  { color: 'oklch(0.42 0.08 155)', time: '4/20', title: '員工旅遊投票截止', meta: '3 個選項待投票' }
];
