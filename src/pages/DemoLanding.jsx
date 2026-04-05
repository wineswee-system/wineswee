import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  Users, GitBranch, Building2, HeadphonesIcon, Warehouse, Settings,
  Bot, LayoutDashboard, BarChart3, ArrowRight, Send, CheckCircle,
  ShoppingCart, CreditCard, Wrench, TrendingUp, Plug
} from 'lucide-react'

// Animated counter hook
function useCounter(target, duration = 1800, start = false) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!start) return
    let startTime = null
    const step = (timestamp) => {
      if (!startTime) startTime = timestamp
      const progress = Math.min((timestamp - startTime) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setCount(Math.floor(eased * target))
      if (progress < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }, [target, duration, start])
  return count
}

// ── Intro section data ──
const 核心模組_INTRO = [
  {
    icon: '👥', title: '人事管理', color: 'var(--accent-cyan)', dim: 'var(--accent-cyan-dim)',
    features: ['GPS + WiFi 打卡驗證', '14 種假別（符合勞基法）', '薪資計算（含扣款明細）', '智慧排班（法規即時檢核）', '績效考核與獎金', '差旅報帳'], tag: '人事',
  },
  {
    icon: '🤝', title: '客戶經營', color: 'var(--accent-blue)', dim: 'var(--accent-blue-dim)',
    features: ['客戶 360° 完整檢視', '銷售漏斗追蹤', '行銷活動管理', '客服工單', '個資遮蔽保護', '贏單自動產生帳款'], tag: '客戶',
  },
  {
    icon: '📦', title: '倉儲物流', color: 'var(--accent-green)', dim: 'var(--accent-green-dim)',
    features: ['進貨 / 出貨管理', '即時庫存追蹤', '批號與效期管理', '盤點作業', '出貨自動拋帳款', '低庫存自動預警'], tag: '倉儲',
  },
  {
    icon: '🧾', title: '銷售管理', color: 'var(--accent-pink)', dim: 'var(--accent-pink-dim)',
    features: ['報價單（版本管理）', '報價轉訂單一鍵完成', '促銷活動引擎', '退貨與折讓管理', '信用額度管控', '銷售預測分析'], tag: '銷售',
  },
  {
    icon: '🖥️', title: 'POS 收銀', color: 'var(--accent-cyan)', dim: 'var(--accent-cyan-dim)',
    features: ['收銀台結帳介面', '多元支付（現金/卡/行動）', '交班日結（現金核對）', '會員點數折抵', '電子發票', '離線模式支援'], tag: 'POS',
  },
  {
    icon: '🛒', title: '採購管理', color: 'var(--accent-yellow)', dim: 'var(--accent-yellow-dim)',
    features: ['供應商管理與評等', '採購申請（動態簽核）', '採購單追蹤', '進貨驗收', '合約管理', '庫存不足自動建議'], tag: '採購',
  },
  {
    icon: '💰', title: '財務會計', color: 'var(--accent-cyan)', dim: 'var(--accent-cyan-dim)',
    features: ['資產負債總覽', '傳票管理', '應收應付帳款', '預算管理', '銀行對帳', '毛利分析'], tag: '財務',
  },
  {
    icon: '🔧', title: '生產品管', color: 'var(--accent-red)', dim: 'var(--accent-red-dim)',
    features: ['物料清單（零件展開）', '需求計畫（缺料預警）', '製令管理', '品質檢驗', '合格率追蹤', '不良率分析'], tag: '生產',
  },
  {
    icon: '⚙️', title: '流程管理', color: 'var(--accent-purple)', dim: 'var(--accent-purple-dim)',
    features: ['工作流程設計', '任務分派追蹤', '查核清單', 'SOP 範本', '部門任務篩選', '優先度管理'], tag: '流程',
  },
  {
    icon: '🏢', title: '組織管理', color: 'var(--accent-orange)', dim: 'var(--accent-orange-dim)',
    features: ['多公司管理', '門市管理（GPS）', '部門架構', '員工目錄', '組織圖', 'LINE 串接'], tag: '組織',
  },
  {
    icon: '📊', title: '數據分析', color: 'var(--accent-amber)', dim: 'var(--accent-amber-dim)',
    features: ['BI 營運看板', '銷售預測', '異常偵測', '自訂儀表板', '跨系統分析', '排程報表'], tag: '分析',
  },
  {
    icon: '🔌', title: '外部串接', color: 'var(--accent-orange)', dim: 'var(--accent-orange-dim)',
    features: ['電商平台串接', '文中匯入', 'API 開放介面', '物流整合'], tag: '串接',
  },
  {
    icon: '🔐', title: '系統管理', color: 'var(--accent-red)', dim: 'var(--accent-red-dim)',
    features: ['RBAC 角色權限', '操作紀錄追蹤', '個資遮蔽保護', '自動觸發器', '即時通知中心', '租戶管理'], tag: '系統',
  },
  {
    icon: '🤖', title: '智慧工具', color: 'var(--accent-pink)', dim: 'var(--accent-pink-dim)',
    features: ['AI 助理中心', '智慧 Agent 控制台', '營運數據儀表板', '報表 PDF 匯出', '新手引導精靈', '勞基法合規引擎'], tag: 'AI',
  },
  {
    icon: '📱', title: 'LINE 員工服務', color: '#34d399', dim: 'rgba(52,211,153,0.12)',
    features: ['LINE 打卡（雙重驗證）', '查薪資 / 請假 / 庫存', '出差申請', '排休月曆', '主管行動簽核', '推播通知'], tag: 'LINE',
  },
  {
    icon: '👤', title: '員工自助入口', color: 'var(--accent-blue)', dim: 'var(--accent-blue-dim)',
    features: ['個人出勤狀態', '待辦任務', '請假紀錄', '薪資查詢', '快速操作選單', '專屬簡化介面'], tag: '員工',
  },
]

const 跨系統串接S = [
  { from: '客戶贏單', to: '財務', desc: '商機成交後，系統自動建立應收帳款和會計傳票', icon: '⚡' },
  { from: '出貨完成', to: '財務', desc: '倉儲出貨後，自動拋轉應收帳款，不用手動建帳', icon: '📦' },
  { from: '庫存不足', to: '採購', desc: '庫存低於安全量，自動產生採購建議給主管審核', icon: '🛒' },
  { from: '進貨驗收', to: '財務', desc: '採購到貨驗收完成，自動建立應付帳款和傳票', icon: '🔗' },
  { from: '請假/遲到', to: '薪資', desc: '事假、病假扣薪自動連動到薪資明細，不用再對帳', icon: '💰' },
  { from: '組織架構', to: '全系統', desc: '員工、部門、門市資料統一維護，所有模組自動同步', icon: '🏢' },
  { from: '假單申請', to: 'LINE', desc: '員工請假後，直屬主管的 LINE 立刻收到簽核通知', icon: '📱' },
  { from: '成本數據', to: '儀表板', desc: '進貨成本 + 人工成本自動算出毛利，老闆一看就懂', icon: '📊' },
]

const STATS = [
  { label: '功能模組', value: 16, suffix: '' },
  { label: '功能頁面', value: 136, suffix: '+' },
  { label: '跨模組整合', value: 8, suffix: '項' },
  { label: '資料表串接', value: 52, suffix: '+' },
]

const 我們的優勢 = [
  {
    icon: '🔗', title: '組織系統統一來源',
    desc: '員工、部門、分店資料只需維護一次。HR、CRM、WMS、流程管理全部引用同一份資料，不再出現員工姓名打錯找不到的問題。',
    color: 'var(--accent-cyan)',
  },
  {
    icon: '📊', title: '獎金計算全自動',
    desc: '業務獎金從 CRM 成交數據直接計算；倉管獎金從 WMS 出貨量和錯誤率自動評分。不需要手動整理報表，減少爭議。',
    color: 'var(--accent-purple)',
  },
  {
    icon: '⚠️', title: '信用風險即時預警',
    desc: '出貨單建立時，系統自動比對客戶信用額度。超過 80% 顯示橘色警示，超過 100% 顯示紅色警告，業務主動管控應收帳款。',
    color: 'var(--accent-orange)',
  },
  {
    icon: '🏦', title: '薪資明細透明化',
    desc: '每筆扣款都有明確分類：事假扣薪、遲到扣薪、其他扣款（附備註）。點開薪資列即可看到完整計算過程，避免勞資糾紛。',
    color: 'var(--accent-green)',
  },
  {
    icon: '🌐', title: '分店 / 部門全域篩選',
    desc: '系統所有頁面均支援按分店或部門篩選，管理者可快速聚焦特定單位的數據，不需要匯出 Excel 再過濾。',
    color: 'var(--accent-blue)',
  },
  {
    icon: '👤', title: '員工自助 Portal',
    desc: '員工透過獨立 Portal 自助打卡、申請假單、報銷費用、查看績效目標，減少 HR 行政負擔，也讓員工掌握自己的資訊。',
    color: 'var(--accent-pink)',
  },
]

// ── System entry cards data ──
const systems = [
  {
    id: 'dashboard', title: '營運儀表板', subtitle: 'Operations Dashboard',
    description: '即時 KPI 數據總覽、出勤統計、任務進度追蹤，一目瞭然掌握全店營運狀況。',
    icon: LayoutDashboard, accent: 'var(--accent-cyan)', accentDim: 'var(--accent-cyan-dim)',
    glow: 'rgba(34, 211, 238, 0.2)', path: '/',
    features: ['KPI 總覽', '出勤統計', '任務追蹤', '流程監控'], moduleCount: 2,
  },
  {
    id: 'analytics', title: '數據分析中心', subtitle: 'Business Intelligence',
    description: '銷售預測、財務分析、庫存分析、異常偵測、自訂儀表板，用數據驅動決策。',
    icon: TrendingUp, accent: 'var(--accent-amber)', accentDim: 'var(--accent-amber-dim)',
    glow: 'rgba(245, 158, 11, 0.2)', path: '/analytics',
    features: ['BI 看板', '銷售預測', '異常偵測', '自訂儀表板', '跨系統分析', '排程報表'], moduleCount: 13,
  },
  {
    id: 'hr', title: '人事管理系統', subtitle: 'HR Management',
    description: '涵蓋考勤、請假、加班、薪資、排班、績效考核、招募等完整人事生命週期管理。',
    icon: Users, accent: 'var(--accent-blue)', accentDim: 'var(--accent-blue-dim)',
    glow: 'rgba(59, 130, 246, 0.2)', path: '/hr/report',
    features: ['考勤打卡', '請假管理', '薪資計算', '排班系統', '績效考核', '招募管理'], moduleCount: 17,
  },
  {
    id: 'process', title: '流程管理系統', subtitle: 'Process Management',
    description: '工作流程自動化、任務分派追蹤、SOP 標準作業程序管理，提升團隊協作效率。',
    icon: GitBranch, accent: 'var(--accent-purple)', accentDim: 'var(--accent-purple-dim)',
    glow: 'rgba(167, 139, 250, 0.2)', path: '/process/overview',
    features: ['工作流程', '任務管理', '檢核表', 'SOP 模板'], moduleCount: 5,
  },
  {
    id: 'org', title: '組織管理系統', subtitle: 'Organization Management',
    description: '多公司架構、門市據點、部門管理、員工目錄、LINE 整合，組織架構一覽無遺。',
    icon: Building2, accent: 'var(--accent-green)', accentDim: 'var(--accent-green-dim)',
    glow: 'rgba(52, 211, 153, 0.2)', path: '/org/overview',
    features: ['組織圖', '門市管理', '部門管理', 'LINE 整合'], moduleCount: 8,
  },
  {
    id: 'crm', title: '客戶關係管理', subtitle: 'CRM System',
    description: '客戶 360° 全視角、銷售漏斗、Drip Campaign、行銷自動化、客服工單、表單建立器。',
    icon: HeadphonesIcon, accent: 'var(--accent-orange)', accentDim: 'var(--accent-orange-dim)',
    glow: 'rgba(251, 146, 60, 0.2)', path: '/crm/overview',
    features: ['客戶 360', '銷售管線', 'Drip Campaign', '客服系統', '表單建立器', '客戶分群'], moduleCount: 12,
  },
  {
    id: 'wms', title: '倉儲管理系統', subtitle: 'Warehouse Management',
    description: 'SKU 管理、入庫出庫、庫存追蹤、批號效期、盤點作業、儲位管理、揀貨包裝出貨。',
    icon: Warehouse, accent: 'var(--accent-yellow)', accentDim: 'var(--accent-yellow-dim)',
    glow: 'rgba(251, 191, 36, 0.2)', path: '/wms/overview',
    features: ['SKU 管理', '庫存追蹤', '批號效期', '盤點作業', '儲位管理', '揀貨包裝'], moduleCount: 12,
  },
  {
    id: 'system', title: '系統管理', subtitle: 'System Administration',
    description: '使用者權限、觸發器、通知設定、稽核日誌、租戶管理、簽核規則、系統設定。',
    icon: Settings, accent: 'var(--accent-red)', accentDim: 'var(--accent-red-dim)',
    glow: 'rgba(248, 113, 113, 0.2)', path: '/system/triggers',
    features: ['權限管理', '觸發器', '稽核日誌', '租戶管理', '簽核規則', '資料庫管理'], moduleCount: 10,
  },
  {
    id: 'ai', title: 'AI 智能工具', subtitle: 'AI Tools',
    description: 'AI 助理、智能 Agent 控制台、教學中心，讓 AI 成為您的營運好幫手。',
    icon: Bot, accent: 'var(--accent-pink)', accentDim: 'var(--accent-pink-dim)',
    glow: 'rgba(244, 114, 182, 0.2)', path: '/ai/help',
    features: ['說明中心', 'Agent 控制台', '教學中心'], moduleCount: 3,
  },
  {
    id: 'sales', title: '銷售管理', subtitle: 'Sales Management',
    description: '報價版本管理、一鍵轉訂單、促銷引擎、退貨管理、物流追蹤、價格規則、業務佣金。',
    icon: ShoppingCart, accent: 'var(--accent-pink)', accentDim: 'var(--accent-pink-dim)',
    glow: 'rgba(244, 114, 182, 0.2)', path: '/sales',
    features: ['報價管理', '銷售訂單', '促銷活動', '退貨管理', '價格規則', '業務佣金'], moduleCount: 8,
  },
  {
    id: 'pos', title: 'POS 收銀', subtitle: 'Point of Sale',
    description: '收銀台結帳介面、多元支付整合、交班日結、會員點數折抵。',
    icon: CreditCard, accent: 'var(--accent-cyan)', accentDim: 'var(--accent-cyan-dim)',
    glow: 'rgba(34, 211, 238, 0.2)', path: '/pos',
    features: ['營運總覽', '收銀台', '交班日結'], moduleCount: 3,
  },
  {
    id: 'purchase', title: '採購管理', subtitle: 'Procurement',
    description: '供應商管理、採購申請、下單追蹤、進貨驗收、合約管理、三方比對、長期採購協議。',
    icon: ShoppingCart, accent: 'var(--accent-yellow)', accentDim: 'var(--accent-yellow-dim)',
    glow: 'rgba(251, 191, 36, 0.2)', path: '/purchase/suppliers',
    features: ['供應商管理', '採購申請', '進貨驗收', '合約管理', '三方比對', '長期協議'], moduleCount: 12,
  },
  {
    id: 'finance', title: '財務會計', subtitle: 'Finance & Accounting',
    description: '傳票管理、應收應付帳款、資產負債表、損益表、稅務申報、現金流量、成本中心。',
    icon: CreditCard, accent: 'var(--accent-green)', accentDim: 'var(--accent-green-dim)',
    glow: 'rgba(52, 211, 153, 0.2)', path: '/finance/overview',
    features: ['傳票管理', '應收帳款', '資產負債表', '損益表', '稅務申報', '成本中心'], moduleCount: 18,
  },
  {
    id: 'manufacturing', title: '生產品管', subtitle: 'Manufacturing & Quality',
    description: 'BOM 物料清單、MRP 需求計畫、品質管理、製令管理、生產現場、工作中心、排程。',
    icon: Wrench, accent: 'var(--accent-orange)', accentDim: 'var(--accent-orange-dim)',
    glow: 'rgba(251, 146, 60, 0.2)', path: '/manufacturing/bom',
    features: ['物料清單', '需求計畫', '品質管理', '製令管理', '生產現場', '生產排程'], moduleCount: 8,
  },
  {
    id: 'integration', title: '外部串接', subtitle: 'Integrations',
    description: '電商平台串接、文中匯入、API 開放介面、物流整合，連通外部系統生態。',
    icon: Plug, accent: 'var(--accent-orange)', accentDim: 'var(--accent-orange-dim)',
    glow: 'rgba(251, 146, 60, 0.2)', path: '/integration/ecommerce',
    features: ['電商串接', '文中匯入', 'API 文件', '物流整合'], moduleCount: 4,
  },
]

export default function DemoLanding() {
  const navigate = useNavigate()
  const [visible, setVisible] = useState(false)
  const [activeModule, setActiveModule] = useState(null)
  const [hoveredId, setHoveredId] = useState(null)

  // Inquiry form
  const [inquiry, setInquiry] = useState({ company_name: '', contact_name: '', phone: '', email: '', company_size: '', interested_modules: [] })
  const [inquiryStatus, setInquiryStatus] = useState(null) // null | 'sending' | 'success' | 'error'
  const MODULE_OPTIONS = ['HR 人資管理', 'CRM 客戶管理', 'WMS 倉儲管理', '銷售管理', 'POS 收銀', '採購管理', '財務會計', '製造 & 品質', '流程管理', '組織管理', '數據分析', 'AI 工具', '全部都要']

  const toggleModule = (mod) => {
    setInquiry(prev => ({
      ...prev,
      interested_modules: prev.interested_modules.includes(mod)
        ? prev.interested_modules.filter(m => m !== mod)
        : [...prev.interested_modules, mod],
    }))
  }

  const handleInquirySubmit = async () => {
    if (!inquiry.company_name || !inquiry.contact_name || !inquiry.phone) return
    setInquiryStatus('sending')
    try {
      await supabase.from('inquiries').insert({
        company_name: inquiry.company_name,
        contact_name: inquiry.contact_name,
        phone: inquiry.phone,
        email: inquiry.email,
        company_size: inquiry.company_size,
        interested_modules: inquiry.interested_modules,
      })
      setInquiryStatus('success')
    } catch {
      setInquiryStatus('error')
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 300)
    return () => clearTimeout(timer)
  }, [])

  const c0 = useCounter(STATS[0].value, 1200, visible)
  const c1 = useCounter(STATS[1].value, 1600, visible)
  const c2 = useCounter(STATS[2].value, 1400, visible)
  const c3 = useCounter(STATS[3].value, 1800, visible)
  const counts = [c0, c1, c2, c3]

  return (
    <div style={{
      height: '100vh',
      background: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      fontFamily: "'Inter', 'Noto Sans TC', sans-serif",
      overflowX: 'hidden',
      overflowY: 'auto',
      scrollbarWidth: 'thin',
      scrollbarColor: 'var(--text-muted) transparent',
    }}>

      {/* ── Navbar ── */}
      <nav style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 40px', height: 64,
        background: 'var(--bg-sidebar)',
        backdropFilter: 'blur(16px)',
        borderBottom: '1px solid var(--border-subtle)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 10,
            background: 'linear-gradient(135deg, var(--accent-cyan), var(--accent-blue))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, fontWeight: 800, color: '#fff',
          }}>S</div>
          <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.3px', color: 'var(--text-primary)' }}>SME OPS</span>
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
            background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)',
            border: '1px solid rgba(34,211,238,0.3)', marginLeft: 4,
          }}>DEMO</span>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button
            onClick={() => navigate('/')}
            style={{
              padding: '8px 20px', borderRadius: 10,
              background: 'linear-gradient(135deg, var(--accent-cyan), #3b82f6)',
              border: 'none', color: '#fff', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', letterSpacing: '0.3px',
            }}
          >
            進入系統 →
          </button>
        </div>
      </nav>

      {/* ══════════════════════════════════════════
          SECTION 1: Hero 介紹
         ══════════════════════════════════════════ */}
      <section style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '120px 40px 80px',
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', width: 600, height: 600, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(34,211,238,0.06) 0%, transparent 70%)',
          top: '10%', left: '15%', pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', width: 500, height: 500, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(167,139,250,0.06) 0%, transparent 70%)',
          bottom: '10%', right: '10%', pointerEvents: 'none',
        }} />

        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '6px 16px', borderRadius: 999,
          background: 'var(--accent-cyan-dim)', border: '1px solid rgba(34,211,238,0.25)',
          fontSize: 12, fontWeight: 600, color: 'var(--accent-cyan)',
          marginBottom: 28,
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0)' : 'translateY(16px)',
          transition: 'all 0.6s ease',
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent-cyan)', display: 'inline-block', animation: 'pulse 2s infinite' }} />
          中小企業一體化營運管理平台
        </div>

        <h1 style={{
          fontSize: 'clamp(36px, 6vw, 72px)',
          fontWeight: 800, lineHeight: 1.1, textAlign: 'center',
          margin: '0 0 20px',
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0)' : 'translateY(24px)',
          transition: 'all 0.7s ease 0.1s',
        }}>
          <span style={{ background: 'linear-gradient(135deg, var(--text-primary) 0%, var(--text-tertiary) 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            人資 · 倉儲 · 客戶
          </span>
          <br />
          <span style={{ background: 'linear-gradient(135deg, var(--accent-cyan) 0%, var(--accent-blue) 50%, var(--accent-purple) 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            全部整合，一套搞定
          </span>
        </h1>

        <p style={{
          fontSize: 17, color: 'var(--text-secondary)', textAlign: 'center',
          maxWidth: 560, lineHeight: 1.7, margin: '0 0 44px',
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0)' : 'translateY(20px)',
          transition: 'all 0.7s ease 0.2s',
        }}>
          從員工打卡、客戶開發、倉庫出貨到績效獎金，
          <br />所有核心業務流程串連成一個智慧系統。
        </p>

        <div style={{
          display: 'flex', gap: 12,
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0)' : 'translateY(16px)',
          transition: 'all 0.7s ease 0.3s',
        }}>
          <button
            onClick={() => document.getElementById('enter-system').scrollIntoView({ behavior: 'smooth' })}
            style={{
              padding: '13px 32px', borderRadius: 12, border: 'none',
              background: 'linear-gradient(135deg, var(--accent-cyan), #3b82f6)',
              color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer',
              boxShadow: '0 0 30px rgba(34,211,238,0.25)',
            }}
          >
            選擇系統體驗 →
          </button>
          <button
            onClick={() => document.getElementById('modules').scrollIntoView({ behavior: 'smooth' })}
            style={{
              padding: '13px 32px', borderRadius: 12,
              background: 'var(--glass-medium)', border: '1px solid var(--border-medium)',
              color: 'var(--text-secondary)', fontSize: 15, fontWeight: 600, cursor: 'pointer',
            }}
          >
            了解功能
          </button>
        </div>

        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1,
          marginTop: 72, width: '100%', maxWidth: 680,
          background: 'var(--border-subtle)', borderRadius: 16,
          overflow: 'hidden', border: '1px solid var(--border-subtle)',
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0)' : 'translateY(20px)',
          transition: 'all 0.8s ease 0.4s',
        }}>
          {STATS.map((s, i) => (
            <div key={i} style={{
              background: 'var(--bg-card)', padding: '24px 20px', textAlign: 'center',
            }}>
              <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--accent-cyan)', lineHeight: 1 }}>
                {counts[i]}{s.suffix}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ══════════════════════════════════════════
          SECTION 2: 8 大核心模組介紹
         ══════════════════════════════════════════ */}
      <section id="modules" style={{ padding: '80px 40px', maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 52 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-cyan)', letterSpacing: '2px', marginBottom: 12 }}>核心模組</div>
          <h2 style={{ fontSize: 36, fontWeight: 800, margin: 0 }}>企業營運的每一塊，我們都幫你想到了</h2>
          <p style={{ color: 'var(--text-secondary)', marginTop: 12, fontSize: 15 }}>從人事薪資到財務會計，模組之間資料自動串接，不用再手動搬資料</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {核心模組_INTRO.map((m, i) => (
            <div
              key={i}
              onMouseEnter={() => setActiveModule(i)}
              onMouseLeave={() => setActiveModule(null)}
              style={{
                background: activeModule === i ? m.dim : 'var(--bg-card)',
                border: `1px solid ${activeModule === i ? m.color + '40' : 'var(--border-subtle)'}`,
                borderRadius: 16, padding: '24px 22px',
                cursor: 'default', transition: 'all 0.25s ease',
                transform: activeModule === i ? 'translateY(-3px)' : 'none',
                boxShadow: activeModule === i ? `0 8px 32px ${m.color}18` : 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12,
                  background: m.dim, border: `1px solid ${m.color}30`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
                }}>{m.icon}</div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{m.title}</div>
                  <div style={{ fontSize: 10, color: m.color, fontWeight: 600, letterSpacing: '1px', marginTop: 2 }}>{m.tag}</div>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {m.features.map((f, j) => (
                  <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
                    <span style={{ width: 4, height: 4, borderRadius: '50%', background: m.color, flexShrink: 0 }} />
                    {f}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ══════════════════════════════════════════
          SECTION 3: 模組間深度整合
         ══════════════════════════════════════════ */}
      <section style={{ padding: '80px 40px', background: 'var(--bg-secondary)' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 52 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-purple)', letterSpacing: '2px', marginBottom: 12 }}>跨系統串接</div>
            <h2 style={{ fontSize: 36, fontWeight: 800, margin: 0 }}>系統之間自動串接，資料不再各做各的</h2>
            <p style={{ color: 'var(--text-secondary)', marginTop: 12, fontSize: 15 }}>訂單成立自動檢查庫存、出貨完成自動產生帳款、獎金直接抓業績數據</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
            {跨系統串接S.map((item, i) => (
              <div key={i} style={{
                background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                borderRadius: 14, padding: '20px 20px',
              }}>
                <div style={{ fontSize: 24, marginBottom: 10 }}>{item.icon}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <span style={{
                    padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                    background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)',
                  }}>{item.from}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>→</span>
                  <span style={{
                    padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                    background: 'var(--accent-purple-dim)', color: 'var(--accent-purple)',
                  }}>{item.to}</span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{item.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          SECTION 3.5: LINE 整合預覽
         ══════════════════════════════════════════ */}
      <section style={{ padding: '80px 40px', maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 52 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-green)', letterSpacing: '2px', marginBottom: 12 }}>LINE 行動整合</div>
          <h2 style={{ fontSize: 36, fontWeight: 800, margin: 0 }}>員工用 LINE 就能搞定所有事</h2>
          <p style={{ color: 'var(--text-secondary)', marginTop: 12, fontSize: 15 }}>不用另外裝 App，打開 LINE 就能打卡、查薪水、請假、回報進度</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 32, alignItems: 'start' }}>

          {/* Phone 1: Chat + Flex Messages */}
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: 280, margin: '0 auto', borderRadius: 32, overflow: 'hidden',
              border: '3px solid var(--border-medium)', background: '#e8e8e8',
              boxShadow: 'var(--shadow-xl)',
            }}>
              {/* Status bar */}
              <div style={{ background: '#06C755', padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: '#fff', fontWeight: 600 }}>SME OPS</span>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>官方帳號</span>
              </div>
              {/* Chat area */}
              <div style={{ background: '#7494A5', padding: '12px 10px', minHeight: 360, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {/* User message */}
                <div style={{ alignSelf: 'flex-end', background: '#8DE055', borderRadius: '14px 14px 4px 14px', padding: '8px 12px', maxWidth: '60%' }}>
                  <span style={{ fontSize: 12, color: '#1a1a1a' }}>打卡</span>
                </div>
                {/* Flex: Clock */}
                <div style={{ alignSelf: 'flex-start', background: '#fff', borderRadius: 12, overflow: 'hidden', width: '75%', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                  <div style={{ background: '#EFF9FB', padding: '10px 12px' }}>
                    <div style={{ fontSize: 9, color: '#67B2C4', fontWeight: 600 }}>⏰ 打卡</div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#0E7490', marginTop: 2 }}>上班打卡成功</div>
                  </div>
                  <div style={{ padding: '8px 12px', fontSize: 10, color: '#666' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}><span>員工</span><span style={{ fontWeight: 700, color: '#333' }}>王小明</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}><span>日期</span><span style={{ fontWeight: 700, color: '#333' }}>2026-04-02</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>時間</span><span style={{ fontWeight: 700, color: '#0891B2' }}>08:52</span></div>
                  </div>
                </div>
                {/* User message */}
                <div style={{ alignSelf: 'flex-end', background: '#8DE055', borderRadius: '14px 14px 4px 14px', padding: '8px 12px', maxWidth: '60%' }}>
                  <span style={{ fontSize: 12, color: '#1a1a1a' }}>薪資</span>
                </div>
                {/* Flex: Salary */}
                <div style={{ alignSelf: 'flex-start', background: '#fff', borderRadius: 12, overflow: 'hidden', width: '75%', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                  <div style={{ background: '#ECFDF5', padding: '10px 12px' }}>
                    <div style={{ fontSize: 9, color: '#6EBF9E', fontWeight: 600 }}>💰 2026-04 薪資</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: '#047857', marginTop: 2 }}>NT$ 45,800</div>
                    <div style={{ fontSize: 9, color: '#6EBF9E' }}>實發薪資</div>
                  </div>
                  <div style={{ padding: '8px 12px', fontSize: 10, color: '#666' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}><span>底薪</span><span style={{ color: '#333' }}>NT$ 40,000</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}><span>津貼</span><span style={{ color: '#059669' }}>+3,000</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>加班費</span><span style={{ color: '#2563EB' }}>+5,200</span></div>
                  </div>
                </div>
              </div>
            </div>
            <div style={{ marginTop: 16, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>傳訊息就能操作</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>打「打卡」兩個字，系統秒回結果</div>
          </div>

          {/* Phone 2: LIFF Home */}
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: 280, margin: '0 auto', borderRadius: 32, overflow: 'hidden',
              border: '3px solid var(--border-medium)', background: '#f0f2f5',
              boxShadow: 'var(--shadow-xl)',
            }}>
              {/* LIFF header */}
              <div style={{ background: '#fff', padding: '12px 16px', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(8,145,178,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800, color: '#0891B2' }}>王</div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>午安，王小明</div>
                    <div style={{ fontSize: 10, color: '#94a3b8' }}>研發部 · 資深工程師</div>
                  </div>
                </div>
              </div>
              {/* Status */}
              <div style={{ padding: '10px 14px', display: 'flex', gap: 8 }}>
                <div style={{ flex: 1, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', borderRadius: 10, padding: '8px 10px' }}>
                  <div style={{ fontSize: 9, color: '#94a3b8' }}>出勤</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#0891B2' }}>已上班</div>
                </div>
                <div style={{ flex: 1, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', borderRadius: 10, padding: '8px 10px' }}>
                  <div style={{ fontSize: 9, color: '#94a3b8' }}>待辦</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#EA580C' }}>3 項任務</div>
                </div>
              </div>
              {/* Quick clock */}
              <div style={{ padding: '0 14px 10px' }}>
                <div style={{ background: 'linear-gradient(135deg, rgba(234,88,12,0.08), rgba(220,38,38,0.08))', border: '1px solid rgba(234,88,12,0.15)', borderRadius: 12, padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#1e293b' }}>點我下班打卡</div>
                    <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>上班 08:52</div>
                  </div>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #fb923c, #f87171)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>👋</div>
                </div>
              </div>
              {/* Menu grid */}
              <div style={{ padding: '0 14px 10px' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>功能選單</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                  {[
                    { icon: '⏰', label: '打卡', color: 'rgba(8,145,178,0.1)' },
                    { icon: '💰', label: '查薪水', color: 'rgba(5,150,105,0.1)' },
                    { icon: '📋', label: '請假', color: 'rgba(37,99,235,0.1)' },
                    { icon: '📦', label: '查庫存', color: 'rgba(234,88,12,0.1)' },
                    { icon: '⚙️', label: '流程', color: 'rgba(124,58,237,0.1)' },
                    { icon: '🧾', label: '報帳', color: 'rgba(217,119,6,0.1)' },
                    { icon: '📅', label: '排休', color: 'rgba(8,145,178,0.1)' },
                    { icon: '🤝', label: '客戶', color: 'rgba(219,39,119,0.1)' },
                  ].map(m => (
                    <div key={m.label} style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.06)', borderRadius: 10, padding: '10px 4px', textAlign: 'center' }}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: m.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, margin: '0 auto 4px' }}>{m.icon}</div>
                      <div style={{ fontSize: 9, fontWeight: 600, color: '#64748b' }}>{m.label}</div>
                    </div>
                  ))}
                </div>
              </div>
              {/* Tab bar */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', background: '#fff', borderTop: '1px solid rgba(0,0,0,0.06)', padding: '6px 0 8px' }}>
                {['首頁', '打卡', '請假', '庫存'].map((t, i) => (
                  <div key={t} style={{ textAlign: 'center', fontSize: 9, color: i === 0 ? '#0891B2' : '#94a3b8', fontWeight: 500 }}>{t}</div>
                ))}
              </div>
            </div>
            <div style={{ marginTop: 16, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>員工行動工作台</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>在 LINE 裡面直接開，不用另外下載</div>
          </div>

          {/* Phone 3: Rich Menu */}
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: 280, margin: '0 auto', borderRadius: 32, overflow: 'hidden',
              border: '3px solid var(--border-medium)', background: '#e8e8e8',
              boxShadow: 'var(--shadow-xl)',
            }}>
              {/* Status bar */}
              <div style={{ background: '#06C755', padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: '#fff', fontWeight: 600 }}>SME OPS</span>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>官方帳號</span>
              </div>
              {/* Chat area */}
              <div style={{ background: '#7494A5', padding: '12px 10px', height: 140, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 6 }}>
                <div style={{ alignSelf: 'flex-start', background: '#fff', borderRadius: 12, padding: '8px 12px', fontSize: 11, color: '#333', maxWidth: '80%' }}>
                  歡迎使用 SME OPS 員工服務！<br/>請點選下方選單開始操作 👇
                </div>
              </div>
              {/* Rich Menu */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'repeat(2, 1fr)', background: '#f0f2f5' }}>
                {[
                  { icon: '⏰', label: '打卡', sub: 'Clock In/Out', bg: '#f8fcff', color: '#0891B2' },
                  { icon: '📋', label: '請假', sub: 'Leave', bg: '#f6f8ff', color: '#2563EB' },
                  { icon: '💰', label: '薪水', sub: 'Salary', bg: '#f4fdf9', color: '#059669' },
                  { icon: '📦', label: '庫存', sub: 'Inventory', bg: '#fffbf5', color: '#EA580C' },
                  { icon: '🧾', label: '報帳', sub: 'Expense', bg: '#faf8ff', color: '#7C3AED' },
                  { icon: '✨', label: '更多', sub: 'More', bg: '#fef6fa', color: '#DB2777' },
                ].map(m => (
                  <div key={m.label} style={{
                    background: m.bg, padding: '14px 6px', textAlign: 'center',
                    borderRight: '1px solid rgba(0,0,0,0.04)', borderBottom: '1px solid rgba(0,0,0,0.04)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
                  }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 10,
                      background: `${m.color}18`, border: `1px solid ${m.color}25`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
                    }}>{m.icon}</div>
                    <div style={{ fontSize: 12, fontWeight: 800, color: '#1e293b' }}>{m.label}</div>
                    <div style={{ fontSize: 7, color: '#94a3b8', letterSpacing: '0.5px', textTransform: 'uppercase' }}>{m.sub}</div>
                  </div>
                ))}
              </div>
              {/* Bottom bar */}
              <div style={{ background: '#fff', padding: '8px 0', textAlign: 'center', borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                <span style={{ fontSize: 11, color: '#666' }}>SME OPS 智慧選單 ▾</span>
              </div>
            </div>
            <div style={{ marginTop: 16, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>底部快捷選單</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>六大功能一目瞭然，點了就用</div>
          </div>
        </div>

        {/* LINE features list */}
        <div style={{
          display: 'flex', justifyContent: 'center', gap: 24, marginTop: 40, flexWrap: 'wrap',
        }}>
          {[
            '不用裝 App，打開 LINE 就能用',
            '打卡、請假、查薪水一指搞定',
            '訊息卡片即時回覆結果',
            '班表提醒、庫存警示自動推播',
            'GPS + WiFi 雙重打卡驗證',
            '整月日曆排休，一目瞭然',
          ].map(f => (
            <div key={f} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', borderRadius: 20,
              background: 'rgba(6, 199, 85, 0.08)', border: '1px solid rgba(6, 199, 85, 0.2)',
              fontSize: 12, fontWeight: 600, color: '#06C755',
            }}>
              <span style={{ fontSize: 14 }}>✓</span> {f}
            </div>
          ))}
        </div>
      </section>

      {/* ══════════════════════════════════════════
          SECTION 4: 核心設計理念
         ══════════════════════════════════════════ */}
      <section style={{ padding: '80px 40px', maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 52 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-green)', letterSpacing: '2px', marginBottom: 12 }}>我們的優勢</div>
          <h2 style={{ fontSize: 36, fontWeight: 800, margin: 0 }}>為什麼老闆都選我們？</h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 }}>
          {我們的優勢.map((item, i) => (
            <div key={i} style={{
              background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
              borderRadius: 16, padding: '28px 24px',
            }}>
              <div style={{
                width: 48, height: 48, borderRadius: 14, fontSize: 22,
                background: `${item.color}15`, border: `1px solid ${item.color}30`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginBottom: 16,
              }}>{item.icon}</div>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>{item.title}</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>{item.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ══════════════════════════════════════════
          SECTION 5: 完整功能清單
         ══════════════════════════════════════════ */}
      <section style={{ padding: '80px 40px', maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 52 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-blue)', letterSpacing: '2px', marginBottom: 12 }}>所有功能一覽</div>
          <h2 style={{ fontSize: 36, fontWeight: 800, margin: 0 }}>系統完整功能一覽</h2>
          <p style={{ color: 'var(--text-secondary)', marginTop: 12, fontSize: 15 }}>136+ 個功能頁面、52+ 張資料表、16 大模組，從人事到財務全面涵蓋</p>
        </div>

        {/* Feature modules */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
          {[
            {
              icon: '📊', title: '數據分析', tag: '13 項功能', color: 'var(--accent-amber)',
              items: ['BI 營運看板', '銷售預測（趨勢圖表/漏斗分析）', '財務分析', '銷售績效', '庫存分析', '人資分析', 'POS 分析', '製造分析', '異常偵測（AI 自動標記異常值）', '自訂儀表板（拖拉配置）', '排程報表（定期 Email 寄送）', '圖表分享（嵌入外部頁面）', '跨系統分析'],
            },
            {
              icon: '👥', title: '人事管理', tag: '17 項功能', color: 'var(--accent-cyan)',
              items: ['人事報表總覽', '打卡系統（GPS 圍籬 + WiFi IP 驗證）', '請假管理（14種假別，符合勞基法/性平法）', '加班申請與費率自動計算', '薪資管理（含請假扣款明細 + 報帳退款）', '智慧排班（AI 自動排班 + 法規即時檢核）', '假日管理（年度月曆 + 國定/公司假）', '排班規則（三大法律50+條完整對照）', '績效考核', '招募管理', '文件管理', '轉調紀錄', '公出差旅', '費用核銷', '績效獎金', '勞檢報表（法規合規檢核）', '教育訓練'],
            },
            {
              icon: '🤝', title: '客戶經營', tag: '12 項功能', color: 'var(--accent-blue)',
              items: ['客戶經營總覽', '客戶管理（個資遮蔽保護）', '銷售漏斗追蹤', '行銷自動化', 'Drip Campaign（滴灌行銷）', '客服工單追蹤', '會員管理（等級/點數累折）', '表單建立器', '工作流程自動化', '發送紀錄', '客戶分群', '客戶 360° 完整檢視'],
            },
            {
              icon: '📦', title: '倉儲物流', tag: '12 項功能', color: 'var(--accent-green)',
              items: ['倉庫營運總覽', '商品主檔管理', '進貨入庫作業', '庫存即時追蹤', '出貨管理（出貨自動拋轉應收帳款）', '異常報表與分析', '批號追蹤（效期管理/過期預警）', '盤點作業（差異管理/盤盈盤虧）', '庫存估價', '儲位管理', '揀貨/包裝/出貨', '倉庫調撥'],
            },
            {
              icon: '🧾', title: '銷售管理', tag: '8 項功能', color: 'var(--accent-pink)',
              items: ['銷售總覽', '報價單（版本管理 v1/v2，一鍵轉訂單）', '銷售訂單（信用額度自動檢核）', '促銷引擎（滿額折/階梯折/VIP價/組合優惠）', '退貨管理（自動沖帳 + 庫存回補）', '物流追蹤（運單號/配送狀態/到貨通知）', '價格規則', '業務佣金'],
            },
            {
              icon: '🖥️', title: 'POS 收銀系統', tag: '3 項功能', color: 'var(--accent-cyan)',
              items: ['營運總覽（當日營收/交易筆數）', '收銀台（商品搜尋 + 購物車 + 多元支付結帳）', '交班日結（現金核對 / 刷卡對帳 / 溢缺管理）'],
            },
            {
              icon: '🛒', title: '採購管理', tag: '12 項功能', color: 'var(--accent-yellow)',
              items: ['供應商管理（評等與付款條件）', '供應商分類', '供應商績效', '廠商入駐', '採購申請（主管動態簽核）', '採購單追蹤', '進貨驗收（驗收完自動產生應付帳款）', '合約管理（折扣/最低訂量/效期）', '採購管線', '採購流程', '三方比對（PO/GR/Invoice）', '長期採購協議'],
            },
            {
              icon: '💰', title: '財務會計', tag: '18 項功能', color: 'var(--accent-cyan)',
              items: ['財務總覽（資產負債 + 毛利分析）', '傳票管理（借貸自動平衡）', '應收帳款（帳齡分析 + 逾期追蹤）', '應付帳款（付款排程管理）', '預算管理', '銀行對帳', '電子發票', '試算表', '資產負債表', '損益表', '稅務申報', '固定資產', '營業稅申報', '401 營業稅報表', '匯率管理', '成本中心', '現金流量表', '期間關帳'],
            },
            {
              icon: '🔧', title: '生產品管', tag: '8 項功能', color: 'var(--accent-red)',
              items: ['BOM 物料清單（成品展開零件組成）', 'MRP 需求計畫（根據訂單自動算缺料）', '品質管理（進料檢驗/合格率追蹤）', '製令管理（生產工單/進度/不良率）', '生產現場（即時看板）', '工作中心', '生產排程', '託外加工'],
            },
            {
              icon: '⚙️', title: '流程管理', tag: '5 項功能', color: 'var(--accent-purple)',
              items: ['流程進度總覽', '工作流程設計與自動化', '任務分派與進度追蹤', '查核清單', '標準作業程序範本'],
            },
            {
              icon: '🏢', title: '組織管理', tag: '8 項功能', color: 'var(--accent-orange)',
              items: ['組織總覽', '組織架構圖', '多公司管理', '門市管理（含 GPS 打卡座標）', '部門管理', '員工目錄（個資遮蔽保護）', 'LINE 官方帳號串接', '文件範本管理'],
            },
            {
              icon: '🔐', title: '系統管理', tag: '10 項功能', color: 'var(--accent-red)',
              items: ['自動觸發器（排程 + 事件驅動）', '通知中心（即時推播）', '使用者權限（RBAC 角色管理）', '操作紀錄（欄位級變更追蹤）', '系統效能監控', '全域設定', '資料庫管理', '資料匯入匯出', '租戶管理（多租戶架構）', '簽核規則'],
            },
            {
              icon: '🤖', title: '智慧工具', tag: '3 項功能', color: 'var(--accent-pink)',
              items: ['AI 說明中心', 'Agent 智慧控制台', '教學中心（分類教程/難度標示）'],
            },
            {
              icon: '🔌', title: '外部串接', tag: '4 項功能', color: 'var(--accent-orange)',
              items: ['電商平台串接（蝦皮/Momo/PChome/LINE購物）', '文中匯入（POS 系統資料匯入）', 'API 開放介面（RESTful 文件/Token 驗證）', '物流整合（宅配/超取/物流商串接）'],
            },
            {
              icon: '📱', title: 'LINE 員工服務', tag: '行動辦公', color: '#34d399',
              items: ['LINE 打卡（GPS + WiFi 雙重驗證）', 'LINE 查薪資（含扣款明細）', 'LINE 請假（支援時數制）', 'LINE 任務回報（即時更新狀態）', 'LINE 查庫存', '排休申請（整月日曆選日）', '出差申請', '主管行動簽核（假單/採購單）', '推播通知（班表/庫存/薪資）'],
            },
          ].map((mod, i) => (
            <div key={i} style={{
              background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
              borderRadius: 16, padding: '24px', backdropFilter: 'blur(12px)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 12,
                    background: `${mod.color}15`, border: `1px solid ${mod.color}25`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
                  }}>{mod.icon}</div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{mod.title}</div>
                  </div>
                </div>
                <span style={{
                  padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                  background: `${mod.color}15`, color: mod.color,
                }}>{mod.tag}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {mod.items.map((item, j) => (
                  <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
                    <span style={{ width: 4, height: 4, borderRadius: '50%', background: mod.color, flexShrink: 0 }} />
                    {item}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Special features */}
        <div style={{ marginTop: 32 }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-yellow)', letterSpacing: '2px', marginBottom: 8 }}>更多亮點</div>
            <h3 style={{ fontSize: 24, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>更多亮點功能</h3>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            {[
              { icon: '📊', label: '營運數據儀表板', desc: '即時圖表，營收、出勤、庫存一目瞭然' },
              { icon: '📄', label: '報表一鍵匯出', desc: '考勤表、薪資單直接下載 PDF' },
              { icon: '🔔', label: '即時通知中心', desc: '假單待審、庫存不足、任務逾期即時提醒' },
              { icon: '🎯', label: '新手引導精靈', desc: '第一次登入，4 步驟帶你完成系統設定' },
              { icon: '📍', label: '打卡地理圍籬', desc: '門市 150 公尺內 + WiFi IP 雙重驗證' },
              { icon: '👤', label: '員工自助入口', desc: '員工專屬頁面，查出勤、薪資、請假' },
              { icon: '⚖️', label: '勞基法合規檢核', desc: '排班即時檢查三大法律，違規自動警示' },
              { icon: '🔒', label: '個資遮蔽保護', desc: '手機、Email 自動遮蔽，主管才能查看' },
              { icon: '🔄', label: '跨模組自動串接', desc: '贏單→應收、出貨→帳款、缺料→採購' },
              { icon: '📋', label: '動態簽核流程', desc: '依組織架構自動找主管，LINE 上直接核准' },
              { icon: '🌙', label: '深淺色主題', desc: '護眼暗色模式 / 清爽淺色模式隨時切換' },
              { icon: '💬', label: 'LINE 快捷選單', desc: '精緻圖示設計，員工一看就會用' },
            ].map((f, i) => (
              <div key={i} style={{
                background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                borderRadius: 14, padding: '18px 16px',
                display: 'flex', alignItems: 'flex-start', gap: 12,
              }}>
                <div style={{ fontSize: 24, lineHeight: 1 }}>{f.icon}</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>{f.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Stats bar */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 1,
          marginTop: 32, background: 'var(--border-subtle)', borderRadius: 14,
          overflow: 'hidden', border: '1px solid var(--border-subtle)',
        }}>
          {[
            { value: '136+', label: '功能頁面' },
            { value: '52+', label: '資料表' },
            { value: '16', label: '大模組' },
            { value: '14', label: '法定假別' },
            { value: '50+', label: '法規條文' },
          ].map((s, i) => (
            <div key={i} style={{ background: 'var(--bg-card)', padding: '20px', textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--accent-cyan)' }}>{s.value}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ══════════════════════════════════════════
          SECTION 6: 選擇系統進入體驗
         ══════════════════════════════════════════ */}
      <section id="enter-system" style={{
        padding: '80px 40px',
        background: 'linear-gradient(180deg, var(--bg-secondary) 0%, var(--bg-primary) 100%)',
      }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 52 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-cyan)', letterSpacing: '2px', marginBottom: 12 }}>立即體驗</div>
            <h2 style={{ fontSize: 36, fontWeight: 800, margin: 0 }}>挑一個模組，馬上試用看看</h2>
            <p style={{ color: 'var(--text-secondary)', marginTop: 12, fontSize: 15 }}>點進去就能操作，不用註冊、不用等</p>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: '20px',
          }}>
            {systems.map((sys) => {
              const Icon = sys.icon
              const isHovered = hoveredId === sys.id
              return (
                <div
                  key={sys.id}
                  style={{
                    background: 'var(--bg-card)',
                    borderRadius: 'var(--radius-lg)',
                    border: `1px solid ${isHovered ? sys.accent : 'var(--border-subtle)'}`,
                    padding: '28px',
                    cursor: 'pointer',
                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                    backdropFilter: 'blur(12px)',
                    display: 'flex',
                    flexDirection: 'column',
                    boxShadow: isHovered ? `0 8px 40px ${sys.glow}, var(--shadow-lg)` : 'var(--shadow-md)',
                    transform: isHovered ? 'translateY(-4px)' : 'translateY(0)',
                  }}
                  onMouseEnter={() => setHoveredId(sys.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  onClick={() => navigate(sys.path)}
                >
                  <div style={{
                    display: 'flex', justifyContent: 'space-between',
                    alignItems: 'flex-start', marginBottom: '16px',
                  }}>
                    <div style={{
                      width: '48px', height: '48px', borderRadius: 'var(--radius-md)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: sys.accentDim, color: sys.accent,
                      boxShadow: isHovered ? `0 0 20px ${sys.glow}` : 'none',
                      transition: 'box-shadow 0.3s ease',
                    }}>
                      <Icon size={24} />
                    </div>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '4px',
                      fontSize: '12px', color: 'var(--text-tertiary)', fontWeight: 500,
                    }}>
                      <BarChart3 size={12} />
                      <span>{sys.moduleCount} 個模組</span>
                    </div>
                  </div>

                  <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px' }}>{sys.title}</h3>
                  <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', margin: '0 0 12px', fontWeight: 500, letterSpacing: '0.5px', textTransform: 'uppercase' }}>{sys.subtitle}</p>
                  <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 16px', lineHeight: 1.6, flex: 1 }}>{sys.description}</p>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' }}>
                    {sys.features.map((f) => (
                      <span key={f} style={{
                        padding: '3px 10px', borderRadius: 'var(--radius-full)',
                        fontSize: '11px', fontWeight: 600,
                        background: sys.accentDim, color: sys.accent,
                      }}>{f}</span>
                    ))}
                  </div>

                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                    gap: '4px', fontSize: '13px', fontWeight: 600,
                    transition: 'color 0.2s ease', paddingTop: '12px',
                    borderTop: '1px solid var(--border-subtle)',
                    color: isHovered ? sys.accent : 'var(--text-tertiary)',
                  }}>
                    <span>進入系統</span>
                    <ArrowRight size={16} style={{
                      transform: isHovered ? 'translateX(4px)' : 'translateX(0)',
                      transition: 'transform 0.2s ease',
                    }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          SECTION 7: 聯繫我們
         ══════════════════════════════════════════ */}
      <section style={{ padding: '80px 40px', background: 'var(--bg-secondary)' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-cyan)', letterSpacing: '2px', marginBottom: 12 }}>預約諮詢</div>
            <h2 style={{ fontSize: 36, fontWeight: 800, margin: 0 }}>想了解更多？留個資料聊聊</h2>
            <p style={{ color: 'var(--text-secondary)', marginTop: 12, fontSize: 15 }}>填寫後我們會在一個工作天內主動聯繫您</p>
          </div>

          {inquiryStatus === 'success' ? (
            <div style={{
              background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
              borderRadius: 20, padding: '60px 40px', textAlign: 'center',
              backdropFilter: 'blur(16px)',
            }}>
              <CheckCircle size={48} style={{ color: 'var(--accent-green)', marginBottom: 16 }} />
              <h3 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8, color: 'var(--text-primary)' }}>感謝您的諮詢！</h3>
              <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>我們會在 1 個工作天內與您聯繫。</p>
            </div>
          ) : (
            <div style={{
              background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
              borderRadius: 20, padding: '32px', backdropFilter: 'blur(16px)',
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                {[
                  { key: 'company_name', label: '公司名稱 *', placeholder: '例：好吃餐飲有限公司' },
                  { key: 'contact_name', label: '聯絡人姓名 *', placeholder: '王小明' },
                  { key: 'phone', label: '電話 *', placeholder: '0912-345-678' },
                  { key: 'email', label: 'Email', placeholder: 'example@company.com' },
                ].map(f => (
                  <div key={f.key}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>{f.label}</label>
                    <input
                      type="text"
                      placeholder={f.placeholder}
                      value={inquiry[f.key]}
                      onChange={e => setInquiry(prev => ({ ...prev, [f.key]: e.target.value }))}
                      style={{
                        width: '100%', padding: '10px 14px', borderRadius: 10,
                        background: 'var(--glass-medium)', border: '1px solid var(--border-medium)',
                        color: 'var(--text-primary)', fontSize: 14, outline: 'none',
                      }}
                    />
                  </div>
                ))}
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>公司人數</label>
                <select
                  value={inquiry.company_size}
                  onChange={e => setInquiry(prev => ({ ...prev, company_size: e.target.value }))}
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 10,
                    background: 'var(--glass-medium)', border: '1px solid var(--border-medium)',
                    color: 'var(--text-primary)', fontSize: 14, outline: 'none', appearance: 'none',
                  }}
                >
                  <option value="">請選擇</option>
                  <option>1-10 人</option>
                  <option>11-30 人</option>
                  <option>31-50 人</option>
                  <option>51-100 人</option>
                  <option>100 人以上</option>
                </select>
              </div>

              <div style={{ marginBottom: 24 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10 }}>感興趣的模組</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {MODULE_OPTIONS.map(mod => {
                    const selected = inquiry.interested_modules.includes(mod)
                    return (
                      <button
                        key={mod}
                        onClick={() => toggleModule(mod)}
                        style={{
                          padding: '6px 16px', borderRadius: 99, fontSize: 13, fontWeight: 600,
                          cursor: 'pointer', transition: 'all 0.15s', border: 'none',
                          background: selected ? 'var(--accent-cyan-dim)' : 'var(--glass-medium)',
                          color: selected ? 'var(--accent-cyan)' : 'var(--text-tertiary)',
                          outline: selected ? '1.5px solid var(--accent-cyan)' : '1px solid var(--border-medium)',
                        }}
                      >
                        {mod}
                      </button>
                    )
                  })}
                </div>
              </div>

              {inquiryStatus === 'error' && (
                <div style={{ color: 'var(--accent-red)', fontSize: 13, marginBottom: 12, textAlign: 'center' }}>
                  提交失敗，請稍後再試
                </div>
              )}

              <button
                onClick={handleInquirySubmit}
                disabled={inquiryStatus === 'sending' || !inquiry.company_name || !inquiry.contact_name || !inquiry.phone}
                style={{
                  width: '100%', padding: '14px', borderRadius: 12, border: 'none',
                  background: (!inquiry.company_name || !inquiry.contact_name || !inquiry.phone)
                    ? 'var(--glass-medium)'
                    : 'linear-gradient(135deg, var(--accent-cyan), var(--accent-blue))',
                  color: (!inquiry.company_name || !inquiry.contact_name || !inquiry.phone) ? 'var(--text-muted)' : '#fff',
                  fontSize: 15, fontWeight: 700, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  boxShadow: (inquiry.company_name && inquiry.contact_name && inquiry.phone) ? '0 4px 20px rgba(34,211,238,0.2)' : 'none',
                }}
              >
                <Send size={16} />
                {inquiryStatus === 'sending' ? '提交中...' : '提交諮詢'}
              </button>
            </div>
          )}
        </div>
      </section>

      {/* ── Footer ── */}
      <footer style={{
        padding: '24px 40px', borderTop: '1px solid var(--border-subtle)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontSize: 12, color: 'var(--text-muted)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 24, height: 24, borderRadius: 7,
            background: 'linear-gradient(135deg, var(--accent-cyan), var(--accent-blue))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 800, color: '#fff',
          }}>S</div>
          <span>SME OPS — 中小企業智慧營運系統</span>
        </div>
        <div>專為台灣中小企業打造</div>
      </footer>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(0.8); }
        }
      `}</style>
    </div>
  )
}
