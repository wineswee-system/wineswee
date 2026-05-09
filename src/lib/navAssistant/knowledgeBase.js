/**
 * Navigation Assistant Knowledge Base
 *
 * Task-oriented map of HR and Workflow (process) features.
 * Each entry describes one actionable task, the exact page that
 * performs it, and step-by-step instructions.
 *
 * Used both as:
 *   1. Context passed to the Gemini model so it can answer accurately.
 *   2. Offline-capable keyword fallback when the AI key is missing.
 */

export const KNOWLEDGE_BASE = [
  // ── HR: Attendance ────────────────────────────────────────────
  {
    id: 'hr.clock-in',
    module: 'HR',
    category: '出勤管理',
    title: '每日打卡',
    path: '/hr/attendance',
    keywords: ['打卡', '上班', '下班', '簽到', '出勤', 'clock in', 'clock out', 'attendance'],
    steps: [
      '左上導覽列 → 人員組織 → 出勤管理 → 打卡追蹤',
      '在頁面上方點擊「上班打卡」或「下班打卡」',
      '也可透過 LINE LIFF（/liff/clock）在手機打卡',
    ],
    tip: '若漏打卡，請走「補登申請」流程。',
  },
  {
    id: 'hr.punch-correction',
    module: 'HR',
    category: '出勤管理',
    title: '補登打卡',
    path: '/hr/punch-correction',
    keywords: ['補登', '漏打卡', '補打卡', '忘記打卡', 'punch correction'],
    steps: [
      '進入「出勤管理 → 補登申請」',
      '點「新增補登」，選日期、時段，填寫原因',
      '送出後由主管審核（依簽核鏈）',
    ],
  },
  {
    id: 'hr.leave',
    module: 'HR',
    category: '出勤管理',
    title: '請假申請',
    path: '/hr/leave',
    keywords: ['請假', '特休', '病假', '事假', '喪假', '產假', '陪產假', 'leave', 'vacation', 'pto'],
    steps: [
      '進入「出勤管理 → 請假管理」',
      '點「新增請假」，選擇假別、起訖時間、備註',
      '系統會自動檢查假別餘額、排班衝突、勞基法合規',
      '送出後依設定的簽核鏈自動派發給主管',
    ],
    tip: '可先到「假別餘額」(/hr/leave-balances) 查看剩餘時數。',
  },
  {
    id: 'hr.leave-balances',
    module: 'HR',
    category: '出勤管理',
    title: '查看假別餘額',
    path: '/hr/leave-balances',
    keywords: ['假別餘額', '剩餘特休', '年假剩多少', '休假天數', 'leave balance'],
    steps: [
      '進入「出勤管理 → 假別餘額」',
      '系統列出本人各假別（特休、病假、事假…）的剩餘時數',
      '管理職可切換員工檢視全員餘額',
    ],
  },
  {
    id: 'hr.leave-calendar',
    module: 'HR',
    category: '出勤管理',
    title: '請假日曆',
    path: '/hr/leave-calendar',
    keywords: ['請假日曆', '誰請假', '團隊休假', 'leave calendar'],
    steps: [
      '進入「出勤管理 → 請假日曆」',
      '以月曆檢視部門/全公司的請假狀況',
      '可篩選部門、假別',
    ],
  },
  {
    id: 'hr.overtime',
    module: 'HR',
    category: '出勤管理',
    title: '加班申請',
    path: '/hr/overtime',
    keywords: ['加班', '加班申請', '延時', 'overtime', 'ot'],
    steps: [
      '進入「出勤管理 → 加班申請」',
      '選加班日期、起訖時間、事由',
      '送出後依簽核鏈審核',
      '系統會套用勞基法時數上限與加班費倍率規則',
    ],
  },
  {
    id: 'hr.schedule',
    module: 'HR',
    category: '出勤管理',
    title: '排班（主管）',
    path: '/hr/schedule',
    keywords: ['排班', '班表', '派班', '員工班表', 'schedule', 'shift'],
    steps: [
      '進入「出勤管理 → 排班」',
      '選擇門市/部門與週期',
      '拖曳員工或使用「AI 自動排班」產生草稿',
      '檢查衝突、送出發佈；員工可於「我的班表」查看',
    ],
    tip: '排班規則（一例一休、間隔休息）在 /hr/schedule-rules 設定。',
  },
  {
    id: 'hr.my-schedule',
    module: 'HR',
    category: '出勤管理',
    title: '查看我的班表',
    path: '/hr/my-schedule',
    keywords: ['我的班表', '個人班表', '本週上班', 'my schedule'],
    steps: [
      '進入「出勤管理 → 我的班表」',
      '以週/月檢視本人排班',
      '可下載 ics 或匯入行動裝置行事曆',
    ],
  },
  {
    id: 'hr.schedule-rules',
    module: 'HR',
    category: '出勤管理',
    title: '排班規則設定',
    path: '/hr/schedule-rules',
    keywords: ['排班規則', '一例一休', '間隔休息', 'schedule rule'],
    steps: [
      '進入「出勤管理 → 排班規則」',
      '設定每日最長工時、連續工作日上限、間隔休息時數',
      '套用範圍：全公司或特定部門',
    ],
  },
  {
    id: 'hr.holidays',
    module: 'HR',
    category: '出勤管理',
    title: '假日管理（國定假日）',
    path: '/hr/holidays',
    keywords: ['國定假日', '放假日', '行事曆', 'holiday'],
    steps: [
      '進入「出勤管理 → 假日管理」',
      '每年匯入政府公告的行事曆或手動調整補班日',
    ],
  },

  // ── HR: Salary / Payroll ──────────────────────────────────────
  {
    id: 'hr.salary',
    module: 'HR',
    category: '薪酬績效',
    title: '查看/調整薪資',
    path: '/hr/salary',
    keywords: ['薪資', '月薪', '調薪', '薪水', 'salary'],
    steps: [
      '進入「薪酬績效 → 薪資管理」',
      '依員工檢視目前薪資組成（底薪、加給、津貼）',
      '需要調整時建立新版薪資紀錄，生效日系統自動套用',
    ],
  },
  {
    id: 'hr.salary-structures',
    module: 'HR',
    category: '薪酬績效',
    title: '薪資結構設定',
    path: '/hr/salary-structures',
    keywords: ['薪資結構', '薪資項目', '加給', '津貼', 'salary structure'],
    steps: [
      '進入「薪酬績效 → 薪資結構」',
      '新增/編輯薪資項目（本薪、伙食津貼、交通津貼等）',
      '設定計算公式、是否計入勞健保、是否計稅',
    ],
  },
  {
    id: 'hr.payroll',
    module: 'HR',
    category: '薪酬績效',
    title: '薪資發放（月結）',
    path: '/hr/payroll',
    keywords: ['薪資發放', '出薪水', '月結', 'payroll', '發薪'],
    steps: [
      '進入「薪酬績效 → 薪資發放」',
      '選擇月份，點「計算薪資」產出草稿',
      '核對加減項、扣繳稅額、勞健保',
      '確認後發送薪資單（可 Email/LINE 通知）並匯出銀行轉帳檔',
    ],
  },
  {
    id: 'hr.bonus',
    module: 'HR',
    category: '薪酬績效',
    title: '績效獎金計算',
    path: '/hr/bonus',
    keywords: ['獎金', '績效獎金', '年終', 'bonus'],
    steps: [
      '進入「薪酬績效 → 績效獎金」',
      '選擇考核期間，系統依績效分數與獎金公式計算',
      '可手動調整後發放',
    ],
  },
  {
    id: 'hr.performance',
    module: 'HR',
    category: '薪酬績效',
    title: '績效考核',
    path: '/hr/performance',
    keywords: ['績效', '考核', 'KPI', 'OKR', 'performance review'],
    steps: [
      '進入「薪酬績效 → 績效管理」',
      '建立考核週期、選擇考核表單',
      '指派自評/主管評，完成後匯出結果',
    ],
  },

  // ── HR: Talent ────────────────────────────────────────────────
  {
    id: 'hr.recruitment',
    module: 'HR',
    category: '人才發展',
    title: '招募/職缺管理',
    path: '/hr/recruitment',
    keywords: ['招募', '徵才', '職缺', '面試', 'recruitment', 'hiring'],
    steps: [
      '進入「人才發展 → 招募管理」',
      '建立職缺、設定面試流程',
      '管理候選人、安排面試、發 Offer',
    ],
  },
  {
    id: 'hr.training',
    module: 'HR',
    category: '人才發展',
    title: '教育訓練',
    path: '/hr/training',
    keywords: ['教育訓練', '上課', '課程', '訓練紀錄', 'training'],
    steps: [
      '進入「人才發展 → 教育訓練」',
      '建立課程、指派對象、登記上課時數',
      '可匯出勞檢所需的訓練紀錄',
    ],
  },
  {
    id: 'hr.transfer',
    module: 'HR',
    category: '人才發展',
    title: '轉調紀錄',
    path: '/hr/transfer',
    keywords: ['轉調', '調職', '職務異動', 'transfer'],
    steps: [
      '進入「人才發展 → 轉調紀錄」',
      '建立異動單（部門/職稱/薪資）',
      '依簽核鏈審核後生效',
    ],
  },
  {
    id: 'hr.probation',
    module: 'HR',
    category: '人才發展',
    title: '試用期管理',
    path: '/hr/probation',
    keywords: ['試用期', '轉正', 'probation'],
    steps: [
      '進入「人才發展 → 試用期管理」',
      '系統自動列出試用期即將結束的員工',
      '完成評估後一鍵轉正或延長',
    ],
  },

  // ── HR: Self-service & analytics ──────────────────────────────
  {
    id: 'hr.self-service',
    module: 'HR',
    category: '人才分析',
    title: '員工自助服務',
    path: '/hr/self-service',
    keywords: ['員工自助', '個人資料', '修改密碼', '查薪資單', 'self service'],
    steps: [
      '進入「人才分析 → 員工自助」',
      '可查看/更新本人基本資料、下載薪資單、查看個人出勤',
    ],
  },
  {
    id: 'hr.assistant',
    module: 'HR',
    category: '人才分析',
    title: 'HR AI 助理（資料分析）',
    path: '/hr/assistant',
    keywords: ['hr ai', '人資 AI', '勞檢分析', '薪資分析'],
    steps: [
      '進入「人才分析 → HR AI 助理」',
      '輸入自然語言問題（例：本月平均加班時數、離職率）',
      'AI 會以現有資料產出分析',
    ],
  },
  {
    id: 'hr.attrition',
    module: 'HR',
    category: '人才分析',
    title: 'AI 離職預測',
    path: '/hr/attrition',
    keywords: ['離職預測', '流失率', 'attrition'],
    steps: [
      '進入「人才分析 → AI 離職預測」',
      '查看高風險員工清單與建議挽留策略',
    ],
  },
  {
    id: 'hr.surveys',
    module: 'HR',
    category: '人才分析',
    title: '員工滿意度調查',
    path: '/hr/surveys',
    keywords: ['滿意度', '調查', '問卷', 'survey', 'enps'],
    steps: [
      '進入「人才分析 → 滿意度調查」',
      '建立問卷、發送給指定對象',
      '收集結果後查看統計圖表',
    ],
  },

  // ── HR: Admin / reports ───────────────────────────────────────
  {
    id: 'hr.report',
    module: 'HR',
    category: '行政庶務',
    title: 'HR 報表',
    path: '/hr/report',
    keywords: ['hr 報表', '人事報表', '統計', 'hr report'],
    steps: ['進入「行政庶務 → HR 報表」', '選擇報表類型與期間後下載 PDF/Excel'],
  },
  {
    id: 'hr.travel',
    module: 'HR',
    category: '行政庶務',
    title: '公出/差旅',
    path: '/hr/travel',
    keywords: ['公出', '出差', '差旅', 'travel'],
    steps: [
      '進入「行政庶務 → 公出差旅」',
      '建立差旅單（地點、交通、住宿、預算）',
      '回來後補上實際費用送核銷',
    ],
  },
  {
    id: 'hr.expenses',
    module: 'HR',
    category: '行政庶務',
    title: '費用核銷',
    path: '/hr/expenses',
    keywords: ['核銷', '報帳', '費用', 'expense reimbursement'],
    steps: [
      '進入「行政庶務 → 費用核銷」',
      '上傳發票、填入金額與科目',
      '送出後依「費用簽核設定」自動派簽',
    ],
  },
  {
    id: 'hr.documents',
    module: 'HR',
    category: '行政庶務',
    title: '員工文件管理',
    path: '/hr/documents',
    keywords: ['文件', '合約', '在職證明', '離職證明', 'document'],
    steps: [
      '進入「行政庶務 → 文件管理」',
      '上傳/簽署合約、列印在職證明',
    ],
  },
  {
    id: 'hr.labor-inspection',
    module: 'HR',
    category: '行政庶務',
    title: '勞檢報表',
    path: '/hr/labor-inspection',
    keywords: ['勞檢', '勞動檢查', 'labor inspection'],
    steps: [
      '進入「行政庶務 → 勞檢報表」',
      '選擇期間，一鍵匯出出勤、薪資、加班、休假符合勞基法規格的報表',
    ],
  },

  // ── Org (related to HR/People) ────────────────────────────────
  {
    id: 'org.employees',
    module: 'Org',
    category: '組織架構',
    title: '員工建檔/修改',
    path: '/org/employees',
    keywords: ['員工', '新進員工', '建檔', '人員資料', 'employee'],
    steps: [
      '進入「組織架構 → 員工」',
      '點「新增員工」，輸入基本資料、到職日、部門、職稱、薪資級距',
      '儲存後可綁定 LINE、指派權限角色',
    ],
  },
  {
    id: 'org.line',
    module: 'Org',
    category: '組織架構',
    title: 'LINE 綁定',
    path: '/org/line',
    keywords: ['line', '綁定', 'line 打卡', 'line notify'],
    steps: [
      '進入「組織架構 → LINE」',
      '產生 QRCode 讓員工掃描，或發送綁定連結',
      '綁定後即可用 LINE LIFF 打卡、收通知',
    ],
  },
  {
    id: 'org.departments',
    module: 'Org',
    category: '組織架構',
    title: '部門管理',
    path: '/org/departments',
    keywords: ['部門', '單位', 'department'],
    steps: ['進入「組織架構 → 部門」', '新增/調整部門層級'],
  },

  // ── Workflow / Process ────────────────────────────────────────
  {
    id: 'process.overview',
    module: 'Workflow',
    category: '工作管理',
    title: '流程總覽',
    path: '/process/overview',
    keywords: ['流程總覽', '任務看板', 'overview'],
    steps: [
      '進入「專案流程 → 總覽」',
      '一眼看到今日任務、進行中流程、待我簽核項目',
    ],
  },
  {
    id: 'process.projects',
    module: 'Workflow',
    category: '工作管理',
    title: '建立/管理專案',
    path: '/process/projects',
    keywords: ['專案', '新增專案', '專案管理', 'project'],
    steps: [
      '進入「專案流程 → 專案」',
      '點「新增專案」填入名稱、負責人、起迄日、預算',
      '進入專案可新增任務、指派成員、追蹤進度',
    ],
    tip: '若不想從零開始，可改用「AI 設定專案」一次產出專案骨架。',
  },
  {
    id: 'process.setup-assistant',
    module: 'Workflow',
    category: '工作管理',
    title: 'AI 設定專案助理',
    path: '/process/setup-assistant',
    keywords: ['ai 專案', '自動建立專案', 'setup assistant'],
    steps: [
      '進入「專案流程 → AI 設定專案」',
      '描述專案目標、範圍、期限（也可上傳文件）',
      'AI 會產出專案、任務清單、簽核鏈、檢核清單，確認後一鍵提交',
    ],
  },
  {
    id: 'process.workflows',
    module: 'Workflow',
    category: '工作管理',
    title: '建立自訂流程',
    path: '/process/workflows',
    keywords: ['流程', '自訂流程', '工作流', 'workflow'],
    steps: [
      '進入「專案流程 → 流程」',
      '點「新增流程」命名、描述',
      '拖曳節點：開始 → 步驟 → 條件分支 → 簽核 → 結束',
      '為每個節點指派負責人、工具、SLA',
      '儲存並啟用後，可在「任務」或專案內觸發',
    ],
  },
  {
    id: 'process.tasks',
    module: 'Workflow',
    category: '工作管理',
    title: '任務管理',
    path: '/process/tasks',
    keywords: ['任務', 'todo', '工單', 'task'],
    steps: [
      '進入「專案流程 → 任務」',
      '新增任務：標題、指派對象、截止日、優先級、所屬專案',
      '可批次指派、拖曳看板更換狀態',
    ],
  },
  {
    id: 'process.checklists',
    module: 'Workflow',
    category: '工作管理',
    title: '查核清單',
    path: '/process/checklists',
    keywords: ['查核清單', 'checklist', '檢核'],
    steps: [
      '進入「專案流程 → 查核清單」',
      '建立檢核項目清單（可重複使用的 SOP 勾選表）',
      '指派到任務或流程節點',
    ],
  },
  {
    id: 'process.sop',
    module: 'Workflow',
    category: '工作管理',
    title: 'SOP 範本',
    path: '/process/sop',
    keywords: ['sop', '標準作業', '範本', 'standard operating procedure'],
    steps: [
      '進入「專案流程 → SOP 範本」',
      '撰寫或匯入 SOP，設定步驟、負責角色',
      '可被流程/任務引用',
    ],
  },
  // 老頁面已下架（2026-05-08）：
  //   /process/approval-chains 及 /process/expense-approval 已從 sidebar / route 拆除
  //   各表單的簽核流程設定改至各表單頁面右上「⚙ 簽核設定」按鈕（透過 ChainConfigModal）
  {
    id: 'forms.chain-settings',
    module: 'HR',
    category: '設定管理',
    title: '簽核流程設定（各表單）',
    path: '/hr/forms',
    keywords: ['簽核鏈', '簽核設定', '核准流程', '簽核流程', 'approval chain', 'expense approval', '費用簽核'],
    steps: [
      '進入「HR 表單中心」找到要設定的表單（請假/加班/出差/離職/異動/留停/補打卡/費用報銷）',
      '進入該表單頁面，admin 會看到右上「⚙ 簽核設定」按鈕',
      '在彈出的設定視窗加關卡，每關可選：固定員工/角色/部門 或 申請人主管/部門主管/門市店長/課別督導 等動態目標',
      '申請費用 (兩階段) 為例外：在 /hr/expense-requests 頁設定，可建多組金額區間',
      '自訂表單 (FormBuilder) 編輯模板時內建設定按鈕',
    ],
    tip: '更細的條件式規則 (例：金額分流以外的條件) 在 /system/approval-rules。',
  },
  {
    id: 'process.categories',
    module: 'Workflow',
    category: '設定管理',
    title: '分類管理',
    path: '/process/settings/categories',
    keywords: ['分類', '類別', 'category'],
    steps: ['進入「專案流程 → 設定管理 → 分類管理」'],
  },
  {
    id: 'process.tags',
    module: 'Workflow',
    category: '設定管理',
    title: '標籤管理',
    path: '/process/settings/tags',
    keywords: ['標籤', 'tag'],
    steps: ['進入「專案流程 → 設定管理 → 標籤管理」'],
  },

  // ── System approval rules (related) ───────────────────────────
  {
    id: 'system.approval-rules',
    module: 'Workflow',
    category: '設定管理',
    title: '簽核規則（進階條件式）',
    path: '/system/approval-rules',
    keywords: ['簽核規則', '條件式簽核', 'approval rule'],
    steps: [
      '進入「系統設定 → 簽核規則」',
      '以條件 IF/THEN 設定複雜簽核路徑（金額、來源、部門、假別組合）',
    ],
  },
]

/**
 * Compact string version used to seed the LLM.
 * Kept short to keep token cost low.
 */
export function buildKbContext() {
  return KNOWLEDGE_BASE
    .map(k => `- [${k.module}/${k.category}] ${k.title} → ${k.path}\n  關鍵字: ${k.keywords.join(', ')}\n  步驟: ${k.steps.join(' / ')}${k.tip ? `\n  小技巧: ${k.tip}` : ''}`)
    .join('\n')
}

/**
 * Keyword-based fallback scoring. Returns top-N entries most likely
 * relevant to the user's query.
 */
export function keywordSearch(query, limit = 3) {
  const q = (query || '').toLowerCase().trim()
  if (!q) return []
  const tokens = q.split(/\s+/).filter(Boolean)

  const scored = KNOWLEDGE_BASE.map(entry => {
    let score = 0
    const hay = [
      entry.title,
      entry.category,
      entry.module,
      ...entry.keywords,
    ].join(' ').toLowerCase()

    for (const t of tokens) {
      if (!t) continue
      if (entry.keywords.some(k => k.toLowerCase() === t)) score += 8
      else if (hay.includes(t)) score += 3
    }
    // boost if query substring appears in title
    if (entry.title.toLowerCase().includes(q)) score += 5
    if (entry.keywords.some(k => q.includes(k.toLowerCase()))) score += 6

    return { entry, score }
  })

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.entry)
}

export const QUICK_PROMPTS = [
  { icon: '🏝️', label: '我要請特休', query: '我要請特休，怎麼申請？' },
  { icon: '⏰', label: '漏打卡怎麼辦', query: '今天忘記打卡，怎麼補登？' },
  { icon: '🌙', label: '如何申請加班', query: '怎麼申請加班？' },
  { icon: '💰', label: '查薪資單', query: '我要下載薪資單' },
  { icon: '📅', label: '排班給員工', query: '主管怎麼幫員工排班？' },
  { icon: '🧾', label: '報銷費用', query: '如何核銷費用？' },
  { icon: '🧩', label: '建立新流程', query: '我想建立一個自訂工作流程' },
  { icon: '✅', label: '新增任務', query: '怎麼新增任務並指派給同事？' },
  { icon: '🪜', label: '設定簽核鏈', query: '如何設定簽核鏈？' },
  { icon: '🤖', label: 'AI 幫我建專案', query: 'AI 設定專案怎麼用？' },
]
