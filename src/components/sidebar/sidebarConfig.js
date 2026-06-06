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
  UserCheck, Shield, Send, Search, UserPlus, Layers,
  Brain, ClipboardCheck, Heart, Scale, MessageSquare, FileBarChart, Gift,
  FolderTree, UserMinus, PauseCircle, RefreshCcw, GraduationCap, PlayCircle,
  Globe, Trash2, Upload,
} from 'lucide-react'

// ── Major Groups for top bar ──
export const majorGroups = [
  { key: 'dashboard', icon: LayoutDashboard, label: '儀表板', color: '#22d3ee', path: '/' },
  { key: 'commerce', icon: Handshake, label: '商務營運', color: '#3b82f6' },
  { key: 'supply', icon: Warehouse, label: '供應鏈', color: '#34d399' },
  { key: 'finance', icon: CreditCard, label: '財務會計', color: '#fbbf24' },
  { key: 'people', icon: Users, label: '人員組織', color: '#a78bfa' },
  { key: 'project', icon: Workflow, label: '專案流程', color: '#6366f1' },
  { key: 'analytics', icon: BarChart3, label: '數據分析', color: '#f472b6' },
]

// ── Mega menu + sidebar content for each group ──
export const groupNav = {
  commerce: [
    {
      label: 'CRM 客戶管理',
      icon: Handshake,
      children: [
        { icon: Eye, label: '總覽', path: '/crm/overview' },
        { icon: UserPlus, label: '線索管理', path: '/crm/leads' },
        { icon: Users, label: '客戶管理', path: '/crm/customers' },
        { icon: UserCheck, label: '聯絡人', path: '/crm/contacts' },
        { icon: UserCircle, label: '客戶 360', path: '/crm/customer-360' },
        { icon: Users, label: '客戶分群', path: '/crm/segments' },
        { icon: TrendingUp, label: '銷售漏斗', path: '/crm/pipeline' },
        { icon: Calendar, label: '活動排程', path: '/crm/activities' },
        { icon: Award, label: '會員管理', path: '/crm/members' },
      ]
    },
    {
      label: '行銷自動化',
      icon: Megaphone,
      children: [
        { icon: Megaphone, label: '行銷活動', path: '/crm/marketing' },
        { icon: Sparkles, label: 'Drip Campaign', path: '/crm/drip-campaigns' },
        { icon: FileText, label: '表單建立器', path: '/crm/forms' },
        { icon: Zap, label: '工作流程', path: '/crm/workflows' },
        { icon: Send, label: '發送紀錄', path: '/crm/messages' },
        { icon: HeadphonesIcon, label: '客服工單', path: '/crm/service' },
        { icon: BarChart2, label: 'CRM 報表', path: '/crm/reports' },
      ]
    },
    {
      label: '銷售管理',
      icon: FileEdit,
      children: [
        { icon: PieChart, label: '銷售總覽', path: '/sales' },
        { icon: FileText, label: '報價管理', path: '/sales/quotations' },
        { icon: ClipboardList, label: '銷售訂單', path: '/sales/orders' },
        { icon: Tag, label: '促銷活動', path: '/sales/promotions' },
        { icon: Tag, label: '價格規則', path: '/sales/pricing' },
        { icon: DollarSign, label: '業務佣金', path: '/sales/commission' },
        { icon: RotateCcw, label: '銷售退貨', path: '/sales/returns' },
        { icon: Truck, label: '物流追蹤', path: '/sales/shipments' },
      ]
    },
    {
      label: '門市 / POS',
      icon: Monitor,
      children: [
        { icon: PieChart, label: '營運總覽', path: '/pos' },
        { icon: Monitor, label: '收銀台', path: '/pos/terminal' },
        { icon: DollarSign, label: '交班日結', path: '/pos/shifts' },
      ]
    },
  ],

  supply: [
    {
      label: '採購管理',
      icon: ShoppingCart,
      children: [
        { icon: Users, label: '供應商', path: '/purchase/suppliers' },
        { icon: Tag, label: '供應商分類', path: '/purchase/categories' },
        { icon: BarChart2, label: '供應商績效', path: '/purchase/performance' },
        { icon: UserCheck, label: '廠商入駐', path: '/purchase/onboarding' },
        { icon: ClipboardList, label: '採購申請', path: '/purchase/requests' },
        { icon: FileText, label: '採購單', path: '/purchase/orders' },
        { icon: FileCheck, label: '進貨驗收', path: '/purchase/receipts' },
        { icon: FileText, label: '合約管理', path: '/purchase/contracts' },
        { icon: FileText, label: '長期採購協議', path: '/purchase/blanket' },
        { icon: GitBranch, label: '採購管線', path: '/purchase/pipeline' },
        { icon: Workflow, label: '採購流程', path: '/purchase/workflow' },
        { icon: Shield, label: '三方比對', path: '/purchase/matching' },
      ]
    },
    {
      label: '倉儲管理',
      icon: Warehouse,
      children: [
        { icon: BarChart2, label: '倉庫總覽', path: '/wms/overview' },
        { icon: Package, label: '商品主檔', path: '/wms/skus' },
        { icon: Package, label: '儲位管理', path: '/wms/bins' },
        { icon: PackageOpen, label: '進貨管理', path: '/wms/inbound' },
        { icon: BarChart3, label: '庫存管理', path: '/wms/inventory' },
        { icon: Truck, label: '出貨管理', path: '/wms/outbound' },
        { icon: Truck, label: '揀貨/包裝/出貨', path: '/wms/pick-pack-ship' },
        { icon: ArrowRightLeft, label: '倉庫調撥', path: '/wms/transfers' },
        { icon: RotateCcw, label: 'RMA / 倉退', path: '/wms/returns' },
        { icon: Layers, label: '組合商品', path: '/wms/kitting' },
      ]
    },
    {
      label: '庫存與盤點',
      icon: CheckSquare,
      children: [
        { icon: Package, label: '批號追蹤', path: '/wms/lots' },
        { icon: CheckSquare, label: '盤點作業', path: '/wms/stock-count' },
        { icon: Calculator, label: '庫存估價', path: '/wms/valuation' },
        { icon: BarChart2, label: '異常與報表', path: '/wms/reports' },
        { icon: Sparkles, label: 'AI 庫存管理', path: '/wms/ai' },
      ]
    },
    {
      label: '製造管理',
      icon: Factory,
      children: [
        { icon: ClipboardList, label: 'BOM 物料清單', path: '/manufacturing/bom' },
        { icon: BarChart3, label: 'MRP 需求計畫', path: '/manufacturing/mrp' },
        { icon: ClipboardList, label: '製令管理', path: '/manufacturing/orders' },
        { icon: BarChart3, label: '生產排程', path: '/manufacturing/scheduling' },
        { icon: Monitor, label: '生產現場', path: '/manufacturing/shop-floor' },
        { icon: ClipboardList, label: '工作中心', path: '/manufacturing/work-centers' },
        { icon: CheckSquare, label: '品質管理', path: '/manufacturing/qm' },
        { icon: ClipboardList, label: '託外加工', path: '/manufacturing/subcontracting' },
      ]
    },
  ],

  finance: [
    {
      label: '日常作業',
      icon: CreditCard,
      children: [
        { icon: Eye, label: '財務總覽', path: '/finance/overview' },
        { icon: BookText, label: '傳票管理', path: '/finance/journal' },
        { icon: TrendingUp, label: '應收帳款', path: '/finance/ar' },
        { icon: Receipt, label: '應付帳款', path: '/finance/ap' },
        { icon: FileText, label: '電子發票', path: '/finance/invoices' },
        { icon: CreditCard, label: '銀行對帳', path: '/finance/bank' },
      ]
    },
    {
      label: '財務報表',
      icon: BarChart3,
      children: [
        { icon: BarChart3, label: '試算表', path: '/finance/trial-balance' },
        { icon: FileText, label: '資產負債表', path: '/finance/balance-sheet' },
        { icon: TrendingUp, label: '損益表', path: '/finance/profit-loss' },
        { icon: TrendingUp, label: '現金流量表', path: '/finance/cash-flow' },
      ]
    },
    {
      label: '稅務',
      icon: Receipt,
      children: [
        { icon: Receipt, label: '稅務申報', path: '/finance/tax-reports' },
        { icon: FileText, label: '營業稅申報', path: '/finance/tax-filing' },
        { icon: Receipt, label: '401 營業稅報表', path: '/finance/tax-report' },
      ]
    },
    {
      label: '管理會計',
      icon: DollarSign,
      children: [
        { icon: BookText, label: '會計科目', path: '/finance/chart-of-accounts' },
        { icon: BarChart3, label: '預算管理', path: '/finance/budgets' },
        { icon: BarChart3, label: '成本中心', path: '/finance/cost-centers' },
        { icon: Package, label: '固定資產', path: '/finance/fixed-assets' },
        { icon: ArrowRightLeft, label: '匯率管理', path: '/finance/exchange-rates' },
        { icon: FileText, label: '期間關帳', path: '/finance/period-close' },
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
      ]
    },
    {
      label: 'HR 表單',
      icon: FileText,
      children: [
        { icon: FileText, label: 'HR 表單中心', path: '/hr/forms' },
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
        { icon: Star, label: '績效管理', path: '/hr/performance' },
        { icon: DollarSign, label: '績效獎金', path: '/hr/bonus' },
        { icon: DollarSign, label: '門市業績獎金', path: '/hr/store-bonus' },
        // 門市稽核已搬到「專案流程 → 門市稽核」
        { icon: Scale, label: '薪酬基準', path: '/hr/compensation' },
        { icon: Gift, label: '福利政策', path: '/hr/benefit-settings' },
        { icon: Scale, label: '法令工資設定', path: '/hr/labor-law-rates' },
        { icon: FileBarChart, label: '健保級距監控', path: '/hr/insurance-grade' },
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
        { icon: ClipboardCheck, label: '簽核', path: '/process/approvals', title: '簽核中心：管理需要核可的單據（HR / 費用 / 採購 等）' },
        { icon: ClipboardList, label: '表單設定', path: '/process/applications', title: '費用 / 非費用類表單（門市報修、叫貨驗收、費用申請、費用報銷）' },
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
    {
      label: 'AI 助理中心',
      icon: Sparkles,
      children: [
        { icon: Sparkles, label: '導覽助理', path: '/ai/nav-assistant', title: 'AI 導覽：問它「如何申請假單」之類問題，跳到對應功能' },
        { icon: Bot, label: 'Agent 控制台', path: '/ai/agent', title: 'AI Agent：執行多步驟自動化任務' },
        { icon: BookOpen, label: '說明中心', path: '/ai/help', title: '系統使用說明文件' },
        { icon: BookOpen, label: '教學中心', path: '/ai/tutorial', title: '操作教學影片與步驟指引' },
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
        { icon: DollarSign, label: '財務分析', path: '/analytics/finance' },
        { icon: Award, label: '銷售績效', path: '/analytics/sales' },
        { icon: Users, label: '人資分析', path: '/analytics/hr' },
        { icon: Package, label: '庫存分析', path: '/analytics/inventory' },
        { icon: ShoppingBag, label: 'POS 分析', path: '/analytics/pos' },
        { icon: Factory, label: '製造分析', path: '/analytics/manufacturing' },
        { icon: Users, label: 'CRM 分析', path: '/analytics/crm' },
      ]
    },
  ],
}
