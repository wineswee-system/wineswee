import { useState, useEffect, useRef, useCallback } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, BarChart3, Users, ClipboardList, Building2,
  GitBranch, ChevronRight, ChevronDown, Clock, CalendarOff, CalendarPlus,
  DollarSign, Calendar, CalendarDays, Workflow, Star,
  UserSearch, FolderOpen, ArrowRightLeft, Plane, Receipt,
  Eye, ListChecks, CheckSquare, Building, MapPin, Network,
  UserCircle, MessageCircle, FileText, Zap, Bell, UserCog,
  ScrollText, Settings, BookOpen, Bot, Award, LogOut, Sun, Moon,
  Warehouse, PackageOpen, Truck, BarChart2, Package,
  Handshake, TrendingUp, Megaphone, HeadphonesIcon, Sparkles,
  ShoppingCart, CreditCard, BookText, FileCheck,
  FileEdit, Tag, Monitor, RotateCcw, PieChart, AlertTriangle,
  Share2, Layout, Mail, Factory, ShoppingBag, Calculator, Upload,
  UserCheck, Shield, Send, Search, Activity, AlertOctagon, UserPlus, Layers,
  Brain, ClipboardCheck, Heart, BarChart, Scale, MessageSquare, FileBarChart, Gift,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import NotificationCenter from './NotificationCenter'
import { prefetchGroup } from '../modules/prefetch'

// Init theme from localStorage (default to light)
const savedTheme = typeof window !== 'undefined' ? localStorage.getItem('theme') : null
document.documentElement.setAttribute('data-theme', savedTheme || 'light')

// ── Major Groups for top bar ──
const majorGroups = [
  { key: 'dashboard', icon: LayoutDashboard, label: '儀表板', color: '#22d3ee', path: '/' },
  { key: 'commerce', icon: Handshake, label: '商務營運', color: '#3b82f6' },
  { key: 'supply', icon: Warehouse, label: '供應鏈', color: '#34d399' },
  { key: 'finance', icon: CreditCard, label: '財務會計', color: '#fbbf24' },
  { key: 'people', icon: Users, label: '人員組織', color: '#a78bfa' },
  { key: 'analytics', icon: BarChart3, label: '數據分析', color: '#f472b6' },
]

// ── Mega menu + sidebar content for each group ──
const groupNav = {
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
      label: '行銷',
      icon: Megaphone,
      divider: true,
      children: [
        { icon: Megaphone, label: '行銷自動化', path: '/crm/marketing' },
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
        { icon: RotateCcw, label: '退貨管理', path: '/sales/returns' },
        { icon: Truck, label: '物流追蹤', path: '/sales/shipments' },
      ]
    },
    {
      label: 'POS 收銀',
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
      ]
    },
    {
      label: '採購作業',
      icon: ClipboardList,
      divider: true,
      children: [
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
      label: 'WMS 倉儲管理',
      icon: Warehouse,
      children: [
        { icon: BarChart2, label: '倉庫總覽', path: '/wms/overview' },
        { icon: Package, label: '商品主檔', path: '/wms/skus' },
        { icon: Package, label: '儲位管理', path: '/wms/bins' },
      ]
    },
    {
      label: '進出貨',
      icon: Truck,
      divider: true,
      children: [
        { icon: PackageOpen, label: '進貨管理', path: '/wms/inbound' },
        { icon: BarChart3, label: '庫存管理', path: '/wms/inventory' },
        { icon: Truck, label: '出貨管理', path: '/wms/outbound' },
        { icon: Truck, label: '揀貨/包裝/出貨', path: '/wms/pick-pack-ship' },
        { icon: ArrowRightLeft, label: '倉庫調撥', path: '/wms/transfers' },
        { icon: RotateCcw, label: '退貨管理 (RMA)', path: '/wms/returns' },
        { icon: Layers, label: '組合商品', path: '/wms/kitting' },
      ]
    },
    {
      label: '盤點與追蹤',
      icon: CheckSquare,
      divider: true,
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
      icon: Building2,
      children: [
        { icon: Eye, label: '總覽', path: '/org/overview' },
        { icon: Building2, label: '組織', path: '/org/organizations' },
        { icon: Network, label: '組織圖', path: '/org/chart' },
        { icon: Building, label: '公司', path: '/org/companies' },
        { icon: MapPin, label: '門市', path: '/org/locations' },
        { icon: ClipboardList, label: '部門', path: '/org/departments' },
        { icon: UserCircle, label: '員工', path: '/org/employees' },
        { icon: MessageCircle, label: 'LINE', path: '/org/line' },
        { icon: FileText, label: '模單', path: '/org/templates' },
      ]
    },
    {
      label: '出勤管理',
      icon: Clock,
      children: [
        { icon: Clock, label: '打卡追蹤', path: '/hr/attendance' },
        { icon: RotateCcw, label: '補登申請', path: '/hr/punch-correction' },
        { icon: CalendarOff, label: '請假管理', path: '/hr/leave' },
        { icon: Calendar, label: '請假日曆', path: '/hr/leave-calendar' },
        { icon: CalendarPlus, label: '加班申請', path: '/hr/overtime' },
        { icon: Calendar, label: '排班', path: '/hr/schedule' },
        { icon: CalendarDays, label: '我的班表', path: '/hr/my-schedule' },
        { icon: Workflow, label: '排班規則', path: '/hr/schedule-rules' },
        { icon: CalendarDays, label: '假日管理', path: '/hr/holidays' },
      ]
    },
    {
      label: '薪酬績效',
      icon: DollarSign,
      children: [
        { icon: DollarSign, label: '薪資管理', path: '/hr/salary' },
        { icon: Star, label: '績效管理', path: '/hr/performance' },
        { icon: DollarSign, label: '績效獎金', path: '/hr/bonus' },
        { icon: Gift, label: '福利政策', path: '/hr/benefit-settings' },
        { icon: Scale, label: '薪酬基準', path: '/hr/compensation' },
        { icon: FileBarChart, label: '扣繳憑單', path: '/hr/tax-forms' },
      ]
    },
    {
      label: '人才發展',
      icon: UserSearch,
      children: [
        { icon: UserSearch, label: '招募管理', path: '/hr/recruitment' },
        { icon: BookOpen, label: '教育訓練', path: '/hr/training' },
        { icon: ArrowRightLeft, label: '轉調紀��', path: '/hr/transfer' },
        { icon: ClipboardCheck, label: '試用期管理', path: '/hr/probation' },
      ]
    },
    {
      label: '人才分析',
      icon: Brain,
      children: [
        { icon: Bot, label: 'HR AI 助理', path: '/hr/assistant' },
        { icon: Brain, label: 'AI 離職預測', path: '/hr/attrition' },
        { icon: MessageSquare, label: '滿意度調查', path: '/hr/surveys' },
        { icon: UserCircle, label: '員工自助', path: '/hr/self-service' },
      ]
    },
    {
      label: '行政庶務',
      icon: FolderOpen,
      children: [
        { icon: BarChart3, label: 'HR 報表', path: '/hr/report' },
        { icon: Plane, label: '公出差旅', path: '/hr/travel' },
        { icon: Receipt, label: '費用核銷', path: '/hr/expenses' },
        { icon: FolderOpen, label: '文件管理', path: '/hr/documents' },
        { icon: FileCheck, label: '勞檢報表', path: '/hr/labor-inspection' },
      ]
    },
    {
      label: '流程管理',
      icon: GitBranch,
      children: [
        { icon: Eye, label: '總覽', path: '/process/overview' },
        { icon: Workflow, label: '流程', path: '/process/workflows' },
        { icon: ListChecks, label: '任務', path: '/process/tasks' },
        { icon: CheckSquare, label: '查核清單', path: '/process/checklists' },
        { icon: Shield, label: '簽核設定', path: '/process/approval-chains' },
      ]
    },
  ],

  analytics: [
    {
      label: 'BI 分析',
      icon: BarChart3,
      children: [
        { icon: BarChart3, label: 'BI 營運看板', path: '/analytics' },
        { icon: TrendingUp, label: '銷售預測', path: '/analytics/forecast' },
        { icon: AlertTriangle, label: '異常偵測', path: '/analytics/anomaly' },
        { icon: Layout, label: '自訂儀表板', path: '/analytics/builder' },
        { icon: GitBranch, label: '流程分析', path: '/analytics/process' },
        { icon: Search, label: '跨系統分析', path: '/analytics/cross-system' },
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
      ]
    },
    {
      label: '輸出與分享',
      icon: Share2,
      children: [
        { icon: Mail, label: '排程報表', path: '/analytics/reports' },
        { icon: Share2, label: '圖表分享', path: '/analytics/embed' },
      ]
    },
  ],
}

// System nav for sidebar
const systemItems = [
  { icon: Settings, label: '系統設定', path: '/system/settings' },
  { icon: UserCog, label: '使用者管理', path: '/system/users' },
  { icon: Building2, label: '租戶管理', path: '/system/tenants' },
  { icon: Zap, label: '觸發器', path: '/system/triggers' },
  { icon: Bell, label: '通知管理', path: '/system/notifications' },
  { icon: Shield, label: '簽核規則', path: '/system/approval-rules' },
  { icon: ScrollText, label: '操作紀錄', path: '/system/audit' },
  { icon: Award, label: '系統效能', path: '/system/performance' },
  { icon: BarChart3, label: '資料庫管理', path: '/system/database' },
  { icon: FileText, label: '匯入匯出', path: '/system/import-export' },
  { icon: Bot, label: 'Agent 控制台', path: '/ai/agent' },
  { icon: BookOpen, label: '說明中心', path: '/ai/help' },
  { icon: BookOpen, label: '教學中心', path: '/ai/tutorial' },
  { icon: FileText, label: '電商串接', path: '/integration/ecommerce' },
  { icon: Upload, label: '文中匯入', path: '/integration/wenzhong' },
  { icon: Settings, label: 'API 文件', path: '/integration/api' },
  { icon: Truck, label: '物流整合', path: '/integration/carriers' },
]

// Super admin sidebar items
const superAdminItems = [
  { icon: Building2, label: '組織管理', path: '/super-admin/orgs' },
  { icon: UserCog, label: '使用者配置', path: '/super-admin/users' },
  { icon: Package, label: '模組配置', path: '/super-admin/modules' },
  { icon: Monitor, label: '系統日誌', path: '/super-admin/system-logs' },
  { icon: AlertOctagon, label: '錯誤日誌', path: '/super-admin/error-logs' },
  { icon: Activity, label: '使用者活動', path: '/super-admin/user-activity' },
]

// ── Route prefix → group key mapping ──
const routeToGroup = (pathname) => {
  if (pathname === '/') return 'dashboard'
  if (pathname.startsWith('/crm') || pathname.startsWith('/sales') || pathname.startsWith('/pos')) return 'commerce'
  if (pathname.startsWith('/purchase') || pathname.startsWith('/wms') || pathname.startsWith('/manufacturing')) return 'supply'
  if (pathname.startsWith('/finance')) return 'finance'
  if (pathname.startsWith('/hr') || pathname.startsWith('/org') || pathname.startsWith('/process')) return 'people'
  if (pathname.startsWith('/analytics')) return 'analytics'
  if (pathname.startsWith('/super-admin')) return 'super-admin'
  if (pathname.startsWith('/system') || pathname.startsWith('/ai') || pathname.startsWith('/integration')) return 'system'
  return 'dashboard'
}

export default function Sidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { profile, signOut, isSuperAdmin } = useAuth()
  const [activeGroup, setActiveGroup] = useState(() => routeToGroup(location.pathname))
  const [openMenus, setOpenMenus] = useState({})
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [openDropdown, setOpenDropdown] = useState(null)
  const dropdownRef = useRef(null)
  const btnRefs = useRef({})

  // Sync active group when route changes
  useEffect(() => {
    setActiveGroup(routeToGroup(location.pathname))
  }, [location.pathname])

  // Auto-expand section containing active route
  useEffect(() => {
    const sections = groupNav[activeGroup] || []
    for (const section of sections) {
      if (section.children) {
        const match = section.children.some(c => location.pathname === c.path || location.pathname.startsWith(c.path + '/'))
        if (match) {
          setOpenMenus(prev => ({ ...prev, [section.label]: true }))
        }
      }
    }
  }, [location.pathname, activeGroup])

  // Close mega dropdown on route change
  useEffect(() => { setOpenDropdown(null) }, [location.pathname])

  // Close dropdown on click outside
  useEffect(() => {
    const handler = (e) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target) &&
        !Object.values(btnRefs.current).some(el => el && el.contains(e.target))
      ) {
        setOpenDropdown(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const toggleMenu = (key) => {
    setOpenMenus(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const handleNavClick = () => {
    if (window.innerWidth <= 768) setMobileOpen(false)
  }

  // Click to toggle dropdown, or navigate for dashboard
  const handleGroupClick = (group) => {
    if (group.path) {
      // Dashboard — just navigate, no dropdown
      setActiveGroup(group.key)
      navigate(group.path)
      setOpenDropdown(null)
      handleNavClick()
      return
    }
    // Toggle dropdown on click
    if (openDropdown === group.key) {
      setOpenDropdown(null)
    } else {
      setOpenDropdown(group.key)
      setActiveGroup(group.key)
    }
  }

  const handleMegaItemClick = (path) => {
    navigate(path)
    setOpenDropdown(null)
  }

  const toggleTheme = () => {
    const current = document.documentElement.getAttribute('data-theme')
    const next = current === 'light' ? 'dark' : 'light'
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem('theme', next)
    setTheme(next)
  }

  const isPathActive = (path) => {
    if (path === '/') return location.pathname === '/'
    return location.pathname === path || location.pathname.startsWith(path + '/')
  }

  // Search filter
  const q = searchQuery.trim().toLowerCase()
  const matchChild = (child) => !q || child.label.toLowerCase().includes(q)
  const matchSection = (section) => !q || section.label.toLowerCase().includes(q) || section.children?.some(matchChild)

  const currentSections = groupNav[activeGroup] || []
  const isSystemGroup = activeGroup === 'system'
  const isSuperAdminGroup = activeGroup === 'super-admin'

  // Calculate dropdown position anchored to the button
  const getDropdownStyle = () => {
    const btnEl = btnRefs.current[openDropdown]
    if (!btnEl) return {}
    const rect = btnEl.getBoundingClientRect()
    return {
      top: rect.bottom + 6,
      left: rect.left + rect.width / 2,
      transform: 'translateX(-50%)',
    }
  }

  // Role-based filtering: only explicitly 'staff' role is restricted
  const userRole = profile?.role || 'manager'
  const STAFF_GROUPS = ['dashboard', 'people']
  const roleFiltered = userRole === 'staff'
    ? majorGroups.filter(g => STAFF_GROUPS.includes(g.key))
    : majorGroups

  // Build all dropdown groups including super-admin (Demo mode: always show)
  const showSuperAdmin = isSuperAdmin || !profile
  const allGroups = showSuperAdmin
    ? [...roleFiltered, { key: 'super-admin', icon: Shield, label: '超管', color: '#ef4444' }]
    : roleFiltered

  return (
    <>
    {/* ═══════ Top Navigation Bar ═══════ */}
    <header className="topnav">
      <div className="topnav-brand" onClick={() => { navigate('/'); setOpenDropdown(null) }} role="button" tabIndex={0}>
        <div className="topnav-brand-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1.5"/>
            <rect x="14" y="3" width="7" height="7" rx="1.5"/>
            <rect x="3" y="14" width="7" height="7" rx="1.5"/>
            <rect x="14" y="14" width="7" height="7" rx="1.5"/>
          </svg>
        </div>
        <span className="topnav-brand-label">SME Ops</span>
      </div>

      <nav className="topnav-groups">
        {allGroups.map(group => {
          const Icon = group.icon
          const active = activeGroup === group.key
          const isOpen = openDropdown === group.key
          const hasMega = group.key !== 'dashboard'
          return (
            <button
              key={group.key}
              ref={el => { btnRefs.current[group.key] = el }}
              className={`topnav-group-btn ${active ? 'active' : ''} ${isOpen ? 'mega-open' : ''}`}
              onClick={() => handleGroupClick(group)}
              onMouseEnter={() => prefetchGroup(group.key)}
              style={{ '--group-color': group.color }}
            >
              <Icon size={16} />
              <span>{group.label}</span>
              {hasMega && <ChevronDown size={11} className={`topnav-chevron ${isOpen ? 'rotated' : ''}`} />}
            </button>
          )
        })}
      </nav>

      <div className="topnav-actions">
        <button
          onClick={() => navigate('/demo')}
          className="topnav-demo-btn"
          title="Demo 展示頁"
        >
          <Sparkles size={12} />
          Demo
        </button>
        <NotificationCenter />
        <button onClick={toggleTheme} className="topnav-theme-btn" title={theme === 'light' ? '深色模式' : '淺色模式'}>
          {theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
        </button>
      </div>
    </header>

    {/* ═══════ Mega Dropdown (portal-style, rendered outside topnav) ═══════ */}
    {openDropdown && (
      <>
        <div className="mega-scrim" onClick={() => setOpenDropdown(null)} />
        <div
          className="mega-dropdown"
          ref={dropdownRef}
          style={getDropdownStyle()}
        >
          <div className="mega-dropdown-inner">
            {openDropdown === 'super-admin' ? (
              <div className="mega-col">
                <div className="mega-col-header">
                  <Shield size={14} className="mega-col-icon" style={{ color: '#ef4444' }} />
                  <span>超級管理員</span>
                </div>
                <div className="mega-col-items">
                  {superAdminItems.map((item, i) => {
                    const Icon = item.icon
                    return (
                      <button
                        key={i}
                        className={`mega-item ${isPathActive(item.path) ? 'active' : ''}`}
                        onClick={() => handleMegaItemClick(item.path)}
                      >
                        <Icon size={13} className="mega-item-icon" />
                        <span>{item.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : (
              (groupNav[openDropdown] || []).map((section, si) => {
                const SIcon = section.icon
                const groupColor = allGroups.find(g => g.key === openDropdown)?.color
                return (
                  <div key={si} className="mega-col">
                    <div className="mega-col-header">
                      {SIcon && <SIcon size={14} className="mega-col-icon" style={{ color: groupColor }} />}
                      <span>{section.label}</span>
                    </div>
                    <div className="mega-col-items">
                      {section.children?.map((child, ci) => {
                        const CIcon = child.icon
                        return (
                          <button
                            key={ci}
                            className={`mega-item ${isPathActive(child.path) ? 'active' : ''}`}
                            onClick={() => handleMegaItemClick(child.path)}
                          >
                            <CIcon size={13} className="mega-item-icon" />
                            <span>{child.label}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </>
    )}

    {/* Mobile menu button */}
    <button className="mobile-menu-btn" onClick={() => setMobileOpen(!mobileOpen)}>
      {mobileOpen ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      )}
    </button>
    {/* Mobile overlay */}
    <div className={`sidebar-overlay ${mobileOpen ? 'active' : ''}`} onClick={() => setMobileOpen(false)} />

    {/* ═══════ Left Sidebar (contextual) ═══════ */}
    <aside className={`sidebar ${mobileOpen ? 'open' : ''} ${activeGroup === 'dashboard' && !isSystemGroup && !isSuperAdminGroup ? 'sidebar-hidden' : ''}`}>
      {/* Search */}
      <div className="sidebar-search">
        <div className="sidebar-search-wrapper">
          <Search className="sidebar-search-icon" />
          <input
            className="sidebar-search-input"
            type="text"
            placeholder="搜尋功能..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Contextual nav for the active group */}
      <nav className="sidebar-nav">
        {activeGroup !== 'dashboard' && !isSystemGroup && !isSuperAdminGroup && currentSections.map((section, si) => {
          const SectionIcon = section.icon
          const isOpen = openMenus[section.label] !== false // default open
          const visible = matchSection(section)

          return (
            <div key={si} className={`nav-section ${visible ? '' : 'hidden'}`}>
              {section.divider ? (
                <div className="nav-divider-label">{section.label}</div>
              ) : (
                <div
                  className="nav-section-header"
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleMenu(section.label)}
                >
                  {SectionIcon && <SectionIcon size={14} className="nav-section-icon" />}
                  <span>{section.label}</span>
                  <ChevronRight className={`nav-section-chevron ${isOpen ? 'open' : ''}`} />
                </div>
              )}
              <div className={`nav-section-children ${section.divider || isOpen ? 'open' : ''}`}>
                {section.children?.map((child, ci) => {
                  const ChildIcon = child.icon
                  const childVisible = matchChild(child)
                  return (
                    <NavLink
                      to={child.path}
                      key={ci}
                      className={({ isActive: active }) => `nav-sub-item ${active ? 'active' : ''} ${childVisible ? '' : 'hidden'}`}
                      onClick={handleNavClick}
                    >
                      <ChildIcon className="nav-sub-item-icon" />
                      <span>{child.label}</span>
                    </NavLink>
                  )
                })}
              </div>
            </div>
          )
        })}

        {/* System items shown when system group active */}
        {isSystemGroup && (
          <div className="nav-section">
            <div className="nav-section-label">系統與整合</div>
            {systemItems.map((item, i) => {
              const Icon = item.icon
              return (
                <NavLink
                  to={item.path}
                  key={i}
                  className={({ isActive: active }) => `nav-sub-item ${active ? 'active' : ''}`}
                  onClick={handleNavClick}
                >
                  <Icon className="nav-sub-item-icon" />
                  <span>{item.label}</span>
                </NavLink>
              )
            })}
          </div>
        )}

        {/* Super Admin items */}
        {isSuperAdminGroup && (
          <div className="nav-section">
            <div className="nav-section-label" style={{ color: 'var(--accent-red)' }}>
              <Shield size={12} style={{ marginRight: 4, verticalAlign: -1 }} />
              超級管理員
            </div>
            {superAdminItems.map((item, i) => {
              const Icon = item.icon
              return (
                <NavLink
                  to={item.path}
                  key={i}
                  className={({ isActive: active }) => `nav-sub-item ${active ? 'active' : ''}`}
                  onClick={handleNavClick}
                >
                  <Icon className="nav-sub-item-icon" />
                  <span>{item.label}</span>
                </NavLink>
              )
            })}
          </div>
        )}
      </nav>

      {/* ── Sidebar Footer: User + System ── */}
      <div className="sidebar-footer">
        {/* System settings link */}
        {!isSystemGroup && (
          <button
            className="sidebar-system-btn"
            onClick={() => { setActiveGroup('system'); handleNavClick() }}
          >
            <Settings size={14} />
            <span>系統設定</span>
          </button>
        )}

        {/* User profile */}
        <div className="sidebar-user">
          <div className="sidebar-user-avatar" style={{ background: profile?.avatar || 'var(--accent-cyan)' }}>
            {profile?.name?.[0]}
          </div>
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{profile?.name}</div>
            <div className="sidebar-user-role">{profile?.position}</div>
          </div>
          <button onClick={signOut} title="登出" className="sidebar-logout-btn">
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </aside>
    </>
  )
}
