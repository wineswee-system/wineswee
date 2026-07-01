import { useState, useEffect, useRef, useCallback } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  Building2,
  ChevronLeft, ChevronRight, ChevronDown,
  MessageCircle, Zap, Bell, UserCog,
  ScrollText, Settings, LogOut, Sun, Moon,
  Upload,
  Shield, Search, Activity, AlertOctagon,
  Sparkles,
  // ── 補 systemItems / superAdminItems 需要的 icon（老闆 refactor 時漏掉）──
  Award, BarChart3, FileText, Truck,
  Package, Monitor, GitBranch, Smartphone,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import FontSizeControl from './FontSizeControl'
import { prefetchGroup } from '../modules/prefetch'
import { majorGroups, groupNav } from './sidebar/sidebarConfig'
import { usePendingApprovals } from '../lib/usePendingApprovals'
import { useMentionCount } from '../lib/useMentionCount'
import NotificationPanel from './NotificationPanel'

// Init theme from localStorage (default to light) — runs at module load to prevent FOUC
const savedTheme = typeof window !== 'undefined' ? localStorage.getItem('theme') : null
if (typeof window !== 'undefined') {
  document.documentElement.setAttribute('data-theme', savedTheme || 'light')
}

// ── Sidebar tooltip：滑鼠 hover 後在 item 右側顯示，不擋游標 ──
// 用一個 global state 記目前 hover 的提示（text + 錨點 rect），
// render 時用 position:fixed 放在 rect 旁邊；rect 來自 getBoundingClientRect()，
// 螢幕右側不夠就換到左側顯示。
function SidebarTooltipLayer({ tip }) {
  if (!tip || !tip.text) return null
  // getBoundingClientRect() 在 body zoom 下回傳縮放後的座標，position:fixed 需要除以 scale
  const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-font-scale')) || 1
  const tooltipWidth = 280
  const margin = 10
  const r = tip.rect
  const top  = r.top  / scale + (r.height / scale) / 2
  const left = r.left  / scale
  const right = r.right / scale
  const showRight = (right + margin + tooltipWidth) < window.innerWidth
  const style = {
    position: 'fixed',
    top,
    transform: 'translateY(-50%)',
    maxWidth: tooltipWidth,
    background: 'rgba(31, 41, 55, 0.95)',
    color: '#fff',
    padding: '8px 12px',
    borderRadius: 6,
    fontSize: 12,
    lineHeight: 1.5,
    zIndex: 99999,
    pointerEvents: 'none',
    boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
  }
  if (showRight) style.left = right + margin
  else style.right = window.innerWidth - left + margin
  return <div style={style}>{tip.text}</div>
}

// System nav for sidebar
const systemItems = [
  { icon: Settings, label: '系統設定', path: '/system/settings' },
  { icon: FileText, label: '表單建立器', path: '/system/form-builder' },
  { icon: UserCog, label: '使用者管理', path: '/system/users' },
  { icon: Shield, label: '員工個別權限', path: '/system/employee-permissions' },
  { icon: UserCog, label: '簽核代理', path: '/system/approval-delegations', perm: 'approval.delegate_manage' },
  { icon: Building2, label: '租戶管理', path: '/system/tenants', perm: 'system.tenant_manage' },
  { icon: Zap, label: '觸發器', path: '/system/triggers' },
  { icon: Bell, label: '通知管理', path: '/system/notifications' },
  { icon: ScrollText, label: '操作紀錄', path: '/system/audit' },
  { icon: Award, label: '系統效能', path: '/system/performance' },
  { icon: BarChart3, label: '資料庫管理', path: '/system/database' },
  { icon: FileText, label: '匯入匯出', path: '/system/import-export' },
  { icon: FileText, label: '電商串接', path: '/integration/ecommerce' },
  { icon: Upload, label: '文件匯入', path: '/integration/wenzhong' },
  { icon: Settings, label: 'API 文件', path: '/integration/api' },
  { icon: Truck, label: '物流整合', path: '/integration/carriers' },
  { icon: MessageCircle, label: 'LINE 整合', path: '/org/line' },
]

// Super admin sidebar items
const superAdminItems = [
  { icon: Building2, label: '組織管理', path: '/super-admin/orgs' },
  { icon: UserCog, label: '使用者配置', path: '/super-admin/users' },
  { icon: Package, label: '模組配置', path: '/super-admin/modules' },
  { icon: Monitor, label: '系統日誌', path: '/super-admin/system-logs' },
  { icon: AlertOctagon, label: '錯誤日誌', path: '/super-admin/error-logs' },
  { icon: Activity, label: '使用者活動', path: '/super-admin/user-activity' },
  { icon: GitBranch, label: '變更日誌', path: '/super-admin/changelog' },
  { icon: Sparkles, label: 'AI 使用量', path: '/super-admin/ai-usage' },
  { icon: Smartphone, label: '會員 App', path: '/super-admin/member-app' },
]

// ── Route prefix → group key mapping ──
const routeToGroup = (pathname) => {
  if (pathname === '/') return 'dashboard'
  if (pathname.startsWith('/crm') || pathname.startsWith('/sales') || pathname.startsWith('/pos') || pathname.startsWith('/reservations')) return 'commerce'
  if (pathname.startsWith('/purchase') || pathname.startsWith('/wms') || pathname.startsWith('/manufacturing')) return 'supply'
  if (pathname.startsWith('/finance')) return 'finance'
  if (pathname.startsWith('/process')) return 'project'
  if (pathname.startsWith('/org/line')) return 'system' // LINE integration lives in System sidebar
  if (pathname.startsWith('/hr') || pathname.startsWith('/org')) return 'people'
  if (pathname.startsWith('/analytics')) return 'analytics'
  if (pathname.startsWith('/super-admin')) return 'super-admin'
  if (pathname.startsWith('/system') || pathname.startsWith('/ai') || pathname.startsWith('/integration')) return 'system'
  return 'dashboard'
}

export default function Sidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { totalPending } = usePendingApprovals()  // 我的待簽件數（給頂部紅點）
  const { mentionCount, markSeen } = useMentionCount()
  const [showNotifPanel, setShowNotifPanel] = useState(false)
  const { profile, signOut, isSuperAdmin, hasPermission } = useAuth()
  const [activeGroup, setActiveGroup] = useState(() => routeToGroup(location.pathname))
  const [openMenus, setOpenMenus] = useState({})
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('sidebar-collapsed') === 'true')
  const [searchQuery, setSearchQuery] = useState('')
  const [openDropdown, setOpenDropdown] = useState(null)
  const dropdownRef = useRef(null)
  const btnRefs = useRef({})
  // Sidebar tooltip：{ text, rect } or null
  const [tooltip, setTooltip] = useState(null)
  const showTooltip = (e, text) => {
    if (!text) return
    setTooltip({ text, rect: e.currentTarget.getBoundingClientRect() })
  }
  const hideTooltip = () => setTooltip(null)

  // Sync active group when route changes
  useEffect(() => {
    setActiveGroup(routeToGroup(location.pathname))
  }, [location.pathname])

  // Auto-expand only the section containing active route (accordion: close others)
  useEffect(() => {
    const sections = groupNav[activeGroup] || []
    const matchSection = sections
      .filter(s => s.children)
      .find(s => s.children.some(c => location.pathname === c.path || location.pathname.startsWith(c.path + '/')))
    if (matchSection) {
      setOpenMenus({ [matchSection.label]: true })
    }
  }, [location.pathname, activeGroup])

  // Close mega dropdown on route change
  useEffect(() => { setOpenDropdown(null) }, [location.pathname])
  // Clear tooltip on route change（防卡住）
  useEffect(() => { setTooltip(null) }, [location.pathname])
  // Clear tooltip when dropdown closes（item 元素消失時 mouseleave 不會觸發）
  useEffect(() => { if (!openDropdown) setTooltip(null) }, [openDropdown])

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
    setOpenMenus(prev => {
      const alreadyOpen = prev[key] === true
      if (alreadyOpen) return { ...prev, [key]: false }
      return { [key]: true }  // accordion: close all others implicitly
    })
  }

  const toggleSidebarCollapse = () => {
    const next = !sidebarCollapsed
    setSidebarCollapsed(next)
    localStorage.setItem('sidebar-collapsed', String(next))
  }

  const handleNavClick = () => {
    setTooltip(null)  // 點擊立刻清 tooltip，避免元素消失後卡住
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
    setTooltip(null)  // 點擊立刻清 tooltip
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

  // ──────────────────────────────────────────────────────────
  // Phase 2 (2026-05-15)：Sidebar 改 DB perm 驅動
  // 取代寫死的 ROLE_GROUPS / ROLE_ALLOWED_PATHS。
  // perm 對照 + role_permissions 預設值在 migration
  // 20260515130000_nav_permissions_phase1.sql 設好，
  // 行為跟原本 ROLE_ALLOWED_PATHS 等同；admin 可透過權限頁
  // 個別 grant nav.* 給單一員工，立刻多出該 sidebar 項。
  // ──────────────────────────────────────────────────────────

  // Major group → required perm（null = 全員可見）
  const GROUP_REQUIRES = {
    dashboard: null,                 // 全員可見
    commerce:  'nav.group.crm',
    supply:    'nav.group.supply',
    finance:   'finance.view',       // 既有舊 perm
    people:    null,                 // 大家都有「個人 HR」section
    project:   'nav.project.work',   // 有專案工作就能看到 group
    analytics: 'nav.group.analytics',
  }
  const roleFiltered = majorGroups.filter(g => {
    const required = GROUP_REQUIRES[g.key]
    if (!required) return true
    return hasPermission(required)
  })

  // 各 path → required perm（缺項 = 全員可見，Tier 1 個人 HR 都在這）
  const PATH_REQUIRES = {
    // ── 組織架構 ──
    '/org/overview':       'nav.org.full',
    '/org/organizations':  'nav.org.full',
    '/org/chart':          'nav.org.full',
    '/org/companies':      'nav.org.full',
    '/org/departments':    'nav.org.departments',
    '/org/employees':      'nav.org.employees',
    '/org/locations':      'nav.org.locations',
    '/org/templates':      'nav.hr_form.builder',
    // ── 排班管理 ──
    '/hr/clock-rules':            'nav.schedule.config',  // admin/super_admin
    '/hr/attendance-diff-report': 'nav.schedule.basic',   // manager+
    '/hr/import':                 'nav.hr_form.builder',  // manager/admin（批次匯入）
    '/hr/schedule':               'nav.schedule.basic',
    '/hr/holidays':               'nav.schedule.basic',
    '/hr/schedule-rules':         'nav.schedule.config',
    '/hr/work-unit-settings':     'nav.schedule.config',
    '/hr/schedule-xlsx-import':   'nav.schedule.basic',   // manager+（排班匯入）
    // ── 薪酬與福利 ──
    '/hr/salary':            'nav.salary.basic',
    '/hr/salary-structures': 'nav.salary.basic',
    '/hr/payroll':           'nav.salary.basic',
    '/hr/severance':         'nav.salary.advanced',
    '/hr/legal-deductions':  'nav.salary.advanced',
    '/hr/tax-forms':         'nav.salary.advanced',
    '/hr/performance':       'nav.salary.advanced',
    '/hr/bonus':             'nav.salary.advanced',
    '/hr/store-bonus':       'bonus.store.compute',
    '/hr/compensation':      'nav.salary.advanced',
    '/hr/benefit-settings':  'nav.salary.advanced',
    '/hr/labor-law-rates':   'nav.salary.law',
    '/hr/insurance-grade':   'nav.salary.law',
    // ── HR 表單（管理功能） ──
    '/hr/forms/transfer':     'nav.schedule.basic',   // 人事異動：manager/office_staff+
    '/hr/forms/headcount':    'nav.schedule.basic',   // 人力需求：manager/office_staff+
    '/hr/recently-deleted':   'nav.org.full',         // 最近刪除：manager/admin+
    // ── 人才發展 ──
    '/hr/recruitment':        'nav.talent',
    '/hr/training':           'nav.talent',
    '/hr/probation':          'nav.talent',
    '/hr/transfer':           'nav.talent',
    '/hr/contract-employees': 'nav.talent',
    '/hr/foreign-workers':    'nav.talent',
    // ── LMS ──
    '/system/offer-letter-templates': 'nav.lms.admin', // admin/super_admin
    '/lms/admin':             'nav.lms.admin',          // admin/super_admin
    '/lms/progress':          'nav.schedule.basic',     // 全員進度：manager/office_staff+
    // ── 員工體驗（除員工自助）──
    '/hr/surveys':   'nav.experience_mgr',
    '/hr/assistant': 'nav.experience_mgr',
    '/hr/attrition': 'nav.experience_mgr',
    // ── HR 表單建立器 ──
    '/hr/form-builder': 'nav.hr_form.builder',
    // ── 行政庶務 ──
    '/hr/report':           'nav.admin_office',
    '/hr/travel':           'nav.admin_office',
    '/hr/expense-requests': 'nav.admin_office',
    '/hr/expenses':         'nav.admin_office',
    '/hr/documents':        'nav.admin_office',
    '/hr/labor-inspection': 'nav.admin_office',
    // ── 專案流程 ──
    '/process/overview':                'nav.project.work',
    '/process/projects':                'nav.project.work',
    '/process/workflows':               'nav.project.work',
    '/process/approvals':               'nav.project.work',
    '/process/tasks':                   'nav.project.tasks',
    '/process/checklists':              'nav.project.work',
    '/system/approval-rules':           'nav.project.admin',
    '/process/settings/chains':         'nav.project.admin',
    '/process/settings/expense-chains': 'nav.project.admin',
    '/process/settings/categories':     'nav.project.admin',
    '/process/settings/tags':           'nav.project.admin',
    '/ai/nav-assistant': 'nav.project.admin',
    '/ai/agent':         'nav.project.admin',
    '/ai/help':          'nav.project.admin',
    '/ai/tutorial':      'nav.project.admin',
  }

  const filterSections = (sections) => {
    return sections
      .map(s => ({
        ...s,
        children: s.children?.filter(c => {
          const required = PATH_REQUIRES[c.path]
          if (!required) return true        // 缺項 = 全員可見（Tier 1）
          return hasPermission(required)
        })
      }))
      .filter(s => s.children?.length > 0)
  }
  const currentSections = filterSections(groupNav[activeGroup] || [])
  const isSystemGroup = activeGroup === 'system'
  const isSuperAdminGroup = activeGroup === 'super-admin'

  // Calculate dropdown position anchored to the button
  const getDropdownStyle = () => {
    const btnEl = btnRefs.current[openDropdown]
    if (!btnEl) return {}
    const rect = btnEl.getBoundingClientRect()
    // getBoundingClientRect() 傳回的是縮放後座標（body zoom 影響）
    // position:fixed 使用 viewport 原始座標，需除以縮放比例修正
    const scale = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--app-font-scale')
    ) || 1
    const centerX = (rect.left + rect.width / 2) / scale
    const topY = rect.bottom / scale + 6
    // 防止右側溢出：保留 20px 邊距
    const clampedLeft = Math.max(20, Math.min(centerX, window.innerWidth - 20))
    return {
      top: topY,
      left: clampedLeft,
      transform: 'translateX(-50%)',
    }
  }

  // Build all dropdown groups including super-admin
  const showSuperAdmin = isSuperAdmin
  const allGroups = showSuperAdmin
    ? [...roleFiltered, { key: 'super-admin', icon: Shield, label: '超管', color: '#ef4444' }]
    : roleFiltered

  return (
    <>
    {/* Sidebar 自訂 tooltip（顯示在 item 右側，不擋游標）*/}
    <SidebarTooltipLayer tip={tooltip} />
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
        {/* 鈴鐺：常駐顯示，待簽紅點 + @mention 藍點 */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowNotifPanel(p => !p)}
            className="topnav-theme-btn"
            title={`待簽 ${totalPending} 件 · 未讀標記 ${mentionCount} 則`}
            style={{ position: 'relative' }}
          >
            <Bell size={15} />
            {totalPending > 0 && (
              <span style={{
                position: 'absolute', top: -3, right: mentionCount > 0 ? 10 : -3,
                minWidth: 15, height: 15, padding: '0 3px',
                borderRadius: 8, background: 'var(--accent-red)', color: '#fff',
                fontSize: 9, fontWeight: 700, lineHeight: '15px', textAlign: 'center',
              }}>{totalPending > 99 ? '99+' : totalPending}</span>
            )}
            {mentionCount > 0 && (
              <span style={{
                position: 'absolute', top: -3, right: -3,
                minWidth: 15, height: 15, padding: '0 3px',
                borderRadius: 8, background: 'var(--accent-blue)', color: '#fff',
                fontSize: 9, fontWeight: 700, lineHeight: '15px', textAlign: 'center',
              }}>@{mentionCount > 99 ? '99+' : mentionCount}</span>
            )}
          </button>
          {showNotifPanel && (
            <NotificationPanel
              onClose={() => setShowNotifPanel(false)}
              markSeen={markSeen}
            />
          )}
        </div>
        <button
          onClick={() => navigate('/demo')}
          className="topnav-demo-btn"
          title="Demo 展示頁"
        >
          <Sparkles size={12} />
          Demo
        </button>
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
                  <Shield size={14} className="mega-col-icon" style={{ color: 'var(--accent-red)' }} />
                  <span>超級管理員</span>
                </div>
                <div className="mega-col-items">
                  {superAdminItems.map((item) => {
                    const Icon = item.icon
                    return (
                      <button
                        key={item.path}
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
              filterSections(groupNav[openDropdown] || []).map((section, si) => {
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
                            onMouseEnter={e => showTooltip(e, child.title)}
                            onMouseLeave={hideTooltip}
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
    <aside className={`sidebar ${mobileOpen ? 'open' : ''} ${activeGroup === 'dashboard' && !isSystemGroup && !isSuperAdminGroup ? 'sidebar-hidden' : ''} ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      {/* Collapse toggle button */}
      <button
        className="sidebar-toggle-btn"
        onClick={toggleSidebarCollapse}
        title={sidebarCollapsed ? '展開側欄' : '收合側欄'}
      >
        {sidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>

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
          const isOpen = openMenus[section.label] === true
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
                      onMouseEnter={e => showTooltip(e, child.title)}
                      onMouseLeave={hideTooltip}
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
            {systemItems.filter(item => !item.perm || hasPermission(item.perm)).map((item) => {
              const Icon = item.icon
              return (
                <NavLink
                  to={item.path}
                  key={item.path}
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
            {superAdminItems.map((item) => {
              const Icon = item.icon
              return (
                <NavLink
                  to={item.path}
                  key={item.path}
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
        {/* System settings link — only for roles with system.admin permission */}
        {!isSystemGroup && hasPermission('system.admin') && (
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
          <FontSizeControl />
          <button onClick={signOut} title="登出" className="sidebar-logout-btn">
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </aside>
    </>
  )
}
