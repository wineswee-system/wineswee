import {
  LayoutDashboard, BarChart3, Users, ClipboardList,
  GitBranch, Clock, CalendarOff, CalendarPlus,
  DollarSign, Calendar, CalendarDays, Workflow, Star,
  UserSearch, FolderOpen, ArrowRightLeft, Plane, Receipt,
  Eye, ListChecks, CheckSquare, Building, MapPin, Network,
  UserCircle, FileText, Zap, Settings, BookOpen, Bot, Award,
  Warehouse, PackageOpen, Truck, BarChart2, Package,
  Handshake, TrendingUp, Megaphone, HeadphonesIcon, Sparkles,
  ShoppingCart, CreditCard, BookText, FileCheck,
  FileEdit, Tag, Monitor, RotateCcw, PieChart, AlertTriangle,
  Layout, Factory, ShoppingBag, Calculator,
  UserCheck, Shield, ShieldCheck, Send, Search, UserPlus, Layers,
  Brain, ClipboardCheck, Heart, Scale, MessageSquare, FileBarChart, Gift,
  FolderTree, UserMinus, PauseCircle, RefreshCcw, GraduationCap, PlayCircle,
  Globe, Trash2, Upload,
  ConciergeBell, TableProperties, Timer, Map, ClipboardEdit,
  QrCode, ChefHat,
  Mail, Inbox, CalendarClock, Link2, Contact,
} from 'lucide-react'

// ── Major Groups for top bar ──
// color 只被 CSS 消費（Sidebar.jsx inline style 的 --group-color 自訂屬性與 style.color），
// var(...) 可正常解析，故改用 src/index.css 的 --accent-* token（亮/暗主題自動切換）。
// 例外：project(#6366f1 indigo)、comms(#2dd4bf teal) 在 index.css 無對應 token，
// 且 CLAUDE.md 禁止新增色系；為保留群組視覺辨識度暫留 hex。
export const majorGroups = [
  { key: 'dashboard', icon: LayoutDashboard, label: '儀表板', color: 'var(--accent-cyan)', path: '/' },
  { key: 'reservations', icon: ConciergeBell, label: '訂位管理', color: 'var(--accent-blue)' },
  { key: 'people', icon: Users, label: '人員組織', color: 'var(--accent-purple)' },
  { key: 'project', icon: Workflow, label: '專案流程', color: '#6366f1' }, // indigo：無對應 token，見上註
  { key: 'comms', icon: Mail, label: '通訊協作', color: '#2dd4bf' }, // teal：無對應 token，見上註
  { key: 'analytics', icon: BarChart3, label: '數據分析', color: 'var(--accent-pink)' },
]

// ── Mega menu + sidebar content for each group ──
export const groupNav = {
  reservations: [
    {
      label: '訂位管理',
      icon: ConciergeBell,
      children: [
        { icon: Eye, label: '今日總覽', path: '/reservations/overview' },
        { icon: ClipboardList, label: '訂位清單', path: '/reservations/list' },
        { icon: Map, label: '座位地圖', path: '/reservations/seating' },
        { icon: TableProperties, label: '桌位設定', path: '/reservations/tables' },
        { icon: ClipboardEdit, label: '訂位規則', path: '/reservations/rules' },
      ]
    },
  ],

  people: [
    {
      label: '組織架構',
      icon: Building,
      children: [
        { icon: Eye, label: '總覽', path: '/org/overview' },
        { icon: Building, label: '組織', path: '/org/organizations' },
        { icon: Network, label: '組織圖', path: '/org/chart' },
        { icon: Building, label: '公司', path: '/org/companies' },
        { icon: ClipboardList, label: '部門', path: '/org/departments' },
        { icon: MapPin, label: '門市', path: '/org/locations' },
        { icon: UserCircle, label: '員工', path: '/org/employees' },
      ]
    },
    {
      label: '出勤與請假',
      icon: Clock,
      children: [
        { icon: Clock, label: '打卡追蹤', path: '/hr/attendance' },
        { icon: ClipboardCheck, label: '打卡規則設定', path: '/hr/clock-rules' },
        { icon: ClipboardCheck, label: '月結核對報表', path: '/hr/attendance-diff-report', title: '比對排班 vs 打卡，找出待員工申請的差異（補卡/請假/加班）' },
        { icon: RotateCcw, label: '補登申請', path: '/hr/punch-correction' },
        { icon: CalendarPlus, label: '加班申請', path: '/hr/overtime' },
        { icon: CalendarOff, label: '請假管理', path: '/hr/leave' },
        { icon: Calendar, label: '請假日曆', path: '/hr/leave-calendar' },
        { icon: CalendarDays, label: '假別餘額', path: '/hr/leave-balances' },
        { icon: CalendarDays, label: '補休餘額', path: '/hr/comp-time-balance', title: '加班選補休後累積的時數；FIFO 扣，過期月結自動兌現' },
        { icon: AlertTriangle, label: '天災管理', path: '/hr/disaster', title: '颱風/天災停班宣告、天災津貼匯入、當日出勤' },
        { icon: Upload, label: '資料匯入', path: '/hr/import' },
      ]
    },
    {
      label: '排班管理',
      icon: Calendar,
      children: [
        { icon: Calendar, label: '排班', path: '/hr/schedule' },
        { icon: CalendarDays, label: '我的班表', path: '/hr/my-schedule' },
        { icon: CalendarOff, label: '希望休', path: '/hr/off-requests' },
        { icon: RefreshCcw, label: '換班', path: '/hr/shift-swaps' },
        { icon: Workflow, label: '排班規則', path: '/hr/schedule-rules' },
        { icon: Workflow, label: '工時/假別單位', path: '/hr/work-unit-settings' },
        { icon: CalendarDays, label: '假日管理', path: '/hr/holidays' },
        { icon: Upload, label: '排班總表匯入', path: '/hr/schedule-xlsx-import' },
        { icon: ShieldCheck, label: '門市權責', path: '/org/store-responsibility' },
      ]
    },
    {
      label: 'HR 表單',
      icon: FileText,
      children: [
        { icon: FileText, label: 'HR 表單中心', path: '/hr/forms' },
        { icon: ClipboardCheck, label: '表單查詢', path: '/hr/form-query', title: '跨所有 HR 表單統一查詢（假勤/異動…），可篩選狀態/日期/姓名，管理員可強制通過/抽單' },
        { icon: ClipboardCheck, label: '我的提交', path: '/hr/forms/submissions' },
        { icon: UserMinus, label: '離職申請', path: '/hr/forms/resignation' },
        { icon: PauseCircle, label: '留職停薪', path: '/hr/forms/loa' },
        { icon: ArrowRightLeft, label: '人事異動', path: '/hr/forms/transfer' },
        { icon: UserPlus, label: '人力需求', path: '/hr/forms/headcount' },
        // 表單建立器已搬到「系統設定 → 表單建立器」
        { icon: FileText, label: '文件範本', path: '/org/templates' },
        { icon: Trash2, label: '最近刪除', path: '/hr/recently-deleted' },
      ]
    },
    {
      label: '薪酬與福利',
      icon: DollarSign,
      children: [
        { icon: DollarSign, label: '薪資管理', path: '/hr/salary' },
        { icon: DollarSign, label: '薪資結構', path: '/hr/salary-structures' },
        { icon: CreditCard, label: '薪資發放', path: '/hr/payroll' },
        { icon: Scale, label: '資遣管理', path: '/hr/severance' },
        { icon: Scale, label: '法扣管理', path: '/hr/legal-deductions' },
        { icon: FileBarChart, label: '扣繳憑單', path: '/hr/tax-forms' },
        { icon: DollarSign, label: '門市業績獎金', path: '/hr/store-bonus' },
        { icon: Gift, label: '福利政策', path: '/hr/benefit-settings' },
        { icon: Scale, label: '法令工資設定', path: '/hr/labor-law-rates' },
        { icon: Scale, label: '投保級距表', path: '/hr/insurance-brackets', title: '維護每年度 勞保/健保/勞退 級距表(帶入/計薪自動吃當年度)' },
        // ── 以下 6 項已從側欄隱藏(頁面/路由保留,要救回把該行加回即可)──
        //   薪資統整 /hr/salary-summary、二代健保補充保費 /hr/nhi-supplement、績效管理 /hr/performance、
        //   績效獎金 /hr/bonus、薪酬基準 /hr/compensation、健保級距監控 /hr/insurance-grade
      ]
    },
    {
      label: '人才發展',
      icon: UserSearch,
      children: [
        { icon: UserSearch, label: '招募管理', path: '/hr/recruitment' },
        { icon: FileText, label: '通知書範本', path: '/system/offer-letter-templates' },
        { icon: GraduationCap, label: '課程管理', path: '/lms/admin' },
        { icon: PlayCircle, label: '我的學習', path: '/lms/courses' },
        { icon: TrendingUp, label: '學習進度', path: '/lms/progress' },
        { icon: Award, label: '結業證書', path: '/lms/certificates' },
        { icon: ClipboardCheck, label: '測驗批閱', path: '/lms/review' },
        { icon: ClipboardCheck, label: '試用期管理', path: '/hr/probation' },
        { icon: ArrowRightLeft, label: '轉調紀錄', path: '/hr/transfer' },
        { icon: FileCheck, label: '約聘管理', path: '/hr/contract-employees' },
        { icon: Globe, label: '外籍移工', path: '/hr/foreign-workers' },
      ]
    },
    {
      label: '員工體驗',
      icon: Heart,
      children: [
        { icon: UserCircle, label: '員工自助', path: '/hr/self-service' },
        { icon: MessageSquare, label: '滿意度調查', path: '/hr/surveys' },
        { icon: Bot, label: 'HR AI 助理', path: '/hr/assistant' },
        { icon: Brain, label: 'AI 離職預測', path: '/hr/attrition' },
      ]
    },
    {
      label: '行政庶務',
      icon: FolderOpen,
      children: [
        { icon: BarChart3, label: 'HR 報表', path: '/hr/report' },
        { icon: Plane, label: '公出差旅', path: '/hr/travel' },
        // 費用申請 / 費用報銷 已移到「專案流程 → 表單設定」
        { icon: FolderOpen, label: '文件管理', path: '/hr/documents' },
        { icon: FileCheck, label: '勞檢報表', path: '/hr/labor-inspection' },
      ]
    },
  ],

  project: [
    {
      label: '工作管理',
      icon: ListChecks,
      children: [
        { icon: Eye, label: '總覽', path: '/process/overview', title: '所有專案、流程、任務的儀表板總覽' },
        { icon: FolderOpen, label: '專案', path: '/process/projects', title: '專案管理：建立和追蹤多步驟的工作（例：新店開幕、系統上線）' },
        { icon: Workflow, label: '流程', path: '/process/workflows', title: '流程設計：定義可重複的標準作業流程（例：新進報到流程）' },
        { icon: Layout, label: 'SOP 範本庫', path: '/process/sop', title: 'SOP 標準作業範本：建立、管理、部署可重複使用的流程模板' },
        // 「簽核」(自訂簽核單/簽核管理) 選單隱藏 — 2026-08-03 停用;路由 /process/approvals 與資料保留,要恢復把此行取消註解即可
        // { icon: ClipboardCheck, label: '簽核', path: '/process/approvals', title: '簽核中心：管理需要核可的單據（HR / 費用 / 採購 等）' },
        { icon: ClipboardList, label: '表單設定', path: '/process/applications', title: '費用 / 非費用類表單（門市報修、叫貨驗收、費用申請、費用報銷、線上預購）' },
        { icon: ClipboardCheck, label: '門市稽核', path: '/process/store-audits', title: '門市稽核：填寫稽核表 → 簽核 → 缺失/小過自動寫入業績獎金' },
        { icon: ListChecks, label: '任務', path: '/process/tasks', title: '任務清單：個人和團隊的待辦事項' },
        { icon: CheckSquare, label: '任務確認', path: '/process/task-confirmations', title: '任務 chain 步驟確認' },
        { icon: CheckSquare, label: '查核清單', path: '/process/checklists', title: '標準作業檢查表（例：每日開店清單）' },
      ]
    },
    {
      label: '設定管理',
      icon: Settings,
      children: [
        { icon: FileCheck, label: '簽核規則', path: '/system/approval-rules', title: '簽核規則：定義「什麼條件觸發什麼簽核流程」（例：金額>1萬走 3 關）' },
        { icon: Workflow, label: '簽核鏈設定', path: '/process/settings/chains', title: '簽核鏈：定義「一條簽核路徑有哪些關卡、誰簽」' },
        { icon: DollarSign, label: '費用簽核設定', path: '/process/settings/expense-chains', title: '依費用金額分組設定不同簽核鏈（例：< 1 萬走簡易、>= 1 萬走完整）' },
        { icon: FolderTree, label: '分類管理', path: '/process/settings/categories', title: '專案 / 任務的分類標籤管理' },
        { icon: Tag, label: '標籤管理', path: '/process/settings/tags', title: '自訂標籤庫，給專案、任務貼標用' },
      ]
    },
  ],

  comms: [
    {
      label: '電子郵件',
      icon: Mail,
      children: [
        { icon: Inbox, label: '收件匣', path: '/comms/inbox' },
        { icon: FileEdit, label: '撰寫郵件', path: '/comms/compose' },
        { icon: FileText, label: '草稿', path: '/comms/drafts' },
        { icon: Send, label: '寄件備份', path: '/comms/sent' },
        { icon: Users, label: '共用信箱', path: '/comms/mailboxes' },
      ]
    },
    {
      label: '行事曆',
      icon: CalendarDays,
      children: [
        { icon: CalendarDays, label: '行事曆', path: '/comms/calendar' },
        { icon: Link2, label: '預約連結', path: '/comms/booking' },
        { icon: CalendarClock, label: '不在辦公室', path: '/comms/ooo' },
      ]
    },
    {
      label: '聯絡人',
      icon: Contact,
      children: [
        { icon: Contact, label: '聯絡人', path: '/comms/contacts' },
        { icon: Upload, label: '匯入聯絡人', path: '/comms/contacts/import' },
        { icon: RefreshCcw, label: '同步設定', path: '/comms/contacts/sync' },
      ]
    },
    {
      label: '自動化與設定',
      icon: Settings,
      children: [
        { icon: Sparkles, label: 'AI 技能', path: '/comms/skills' },
        { icon: Tag, label: '標籤管理', path: '/comms/labels' },
        { icon: Layers, label: '分類管理', path: '/comms/categories' },
        { icon: Zap, label: '郵件規則', path: '/comms/rules' },
        { icon: Settings, label: '帳號設定', path: '/comms/accounts' },
      ]
    },
  ],

  analytics: [
    {
      label: 'BI 分析',
      icon: BarChart3,
      children: [
        { icon: BarChart3, label: '營運總覽', path: '/analytics' },
        { icon: AlertTriangle, label: '預警中心', path: '/analytics/alerts' },
        { icon: Search, label: '跨系統分析', path: '/analytics/cross-system' },
        { icon: Layout, label: '自訂儀表板', path: '/analytics/builder' },
        { icon: GitBranch, label: '流程分析', path: '/analytics/process' },
      ]
    },
    {
      label: '模組報表',
      icon: PieChart,
      children: [
        { icon: Users, label: '人資分析', path: '/analytics/hr' },
      ]
    },
  ],
}

// ════════════════════════════════════════════════════════════════════════
// 逐入口權限 helper（對應 migration 20260806120000_nav_entry_permissions）
//   top tab → nav.top.<key>；leaf → nav.entry.<path 去斜線改點>
//   哨兵 nav.entry.system.enabled：全角色皆有 → 前端判斷新制是否上線
// ════════════════════════════════════════════════════════════════════════
export const NAV_SENTINEL = 'nav.entry.system.enabled'
export const navTopCode = (key) => 'nav.top.' + key
export const navEntryCode = (path) => 'nav.entry.' + String(path).replace(/^\//, '').replace(/\//g, '.')

// 扁平化所有 leaf（供權限頁列表 + 路由守門 prefix 比對用）
export const NAV_ENTRIES = Object.entries(groupNav).flatMap(([topKey, sections]) =>
  (sections || []).flatMap(sec => (sec.children || []).map(c => ({
    topKey, section: sec.label, path: c.path, label: c.label,
  })))
)
