import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  Users, GitBranch, Building2, HeadphonesIcon, Warehouse, Settings,
  Bot, LayoutDashboard, BarChart3, ArrowRight, Send, CheckCircle,
  ShoppingCart, CreditCard, Wrench, TrendingUp, Plug, ChevronDown,
  Check, Zap, Shield, Globe, FileText, Package,
  Sun, Moon, ArrowUpRight, Factory, PieChart, Monitor,
} from 'lucide-react'
import FeatureCarousel from '../components/ui/FeatureCarousel'
import { ALL_DEMOS } from '../data/featureDemos'

// ── Count-up animation hook ──
function useCounter(target, duration = 1600, start = false) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!start) return
    let startTime = null
    const step = (ts) => {
      if (!startTime) startTime = ts
      const p = Math.min((ts - startTime) / duration, 1)
      setCount(Math.floor((1 - Math.pow(1 - p, 3)) * target))
      if (p < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }, [target, duration, start])
  return count
}

// ── Intersection observer for scroll reveal ──
function useInView(threshold = 0.12) {
  const ref = useRef(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setInView(true) }, { threshold })
    obs.observe(el)
    return () => obs.disconnect()
  }, [threshold])
  return [ref, inView]
}

function Section({ children, id, className = '', dark = false }) {
  const [ref, inView] = useInView()
  return (
    <section
      ref={ref}
      id={id}
      className={`demo-section ${inView ? 'in-view' : ''} ${dark ? 'demo-section-dark' : ''} ${className}`}
    >
      {children}
    </section>
  )
}

// ════════════════════════════════════════════
//  DATA
// ════════════════════════════════════════════

const MODULE_GROUPS = [
  {
    title: '商務營運',
    desc: '從開發客戶到收款入帳的完整流程',
    icon: TrendingUp,
    color: '#2563eb',
    modules: [
      { icon: HeadphonesIcon, name: 'CRM 客戶管理', count: 12, items: ['客戶 360°', '銷售漏斗', '行銷自動化', '客服工單', '會員管理', '表單建立器'] },
      { icon: FileText, name: '銷售管理', count: 8, items: ['報價轉訂單', '促銷引擎', '退貨管理', '佣金計算', '價格規則', '物流追蹤'] },
      { icon: Monitor, name: 'POS 收銀', count: 3, items: ['收銀台結帳', '多元支付', '交班日結'] },
    ],
  },
  {
    title: '供應鏈管理',
    desc: '採購、倉儲、生產一條龍',
    icon: Package,
    color: '#059669',
    modules: [
      { icon: ShoppingCart, name: '採購管理', count: 12, items: ['供應商評等', '採購申請', '進貨驗收', '合約管理', '三方比對', '長期協議'] },
      { icon: Warehouse, name: '倉儲物流', count: 12, items: ['即時庫存', '批號效期', '盤點作業', '儲位管理', '揀貨包裝', '庫存估價'] },
      { icon: Factory, name: '生產品管', count: 8, items: ['BOM 物料清單', 'MRP 需求計畫', '品質檢驗', '製令管理', '生產排程', '託外加工'] },
    ],
  },
  {
    title: '財務會計',
    desc: '從傳票到報表，帳務全自動化',
    icon: CreditCard,
    color: '#d97706',
    modules: [
      { icon: CreditCard, name: '財務會計', count: 18, items: ['傳票管理', '應收應付帳款', '資產負債表', '損益表', '稅務申報', '銀行對帳', '預算管理', '成本中心', '現金流量表'] },
    ],
  },
  {
    title: '人員組織',
    desc: '打卡、排班、薪資、績效一站搞定',
    icon: Users,
    color: '#7c3aed',
    modules: [
      { icon: Users, name: '人事管理', count: 17, items: ['GPS 打卡驗證', '14 種假別', '薪資計算', '智慧排班', '績效考核', '招募管理', '費用核銷'] },
      { icon: Building2, name: '組織管理', count: 8, items: ['多公司管理', '門市據點', '部門架構', '員工目錄', '組織圖', 'LINE 串接'] },
      { icon: GitBranch, name: '流程管理', count: 5, items: ['工作流程設計', '任務追蹤', '查核清單', 'SOP 範本'] },
    ],
  },
  {
    title: '數據與系統',
    desc: '分析、AI 工具、權限與外部串接',
    icon: BarChart3,
    color: '#db2777',
    modules: [
      { icon: PieChart, name: '數據分析', count: 13, items: ['BI 看板', '銷售預測', '異常偵測', '自訂儀表板', '跨系統分析'] },
      { icon: Bot, name: 'AI 工具', count: 3, items: ['AI 助理', 'Agent 控制台', '教學中心'] },
      { icon: Shield, name: '系統管理', count: 10, items: ['RBAC 權限', '操作紀錄', '觸發器', '租戶管理', '簽核規則'] },
      { icon: Plug, name: '外部串接', count: 4, items: ['電商平台', '文中匯入', 'API 介面', '物流整合'] },
    ],
  },
]

const INTEGRATIONS = [
  { from: '客戶贏單', to: '應收帳款', desc: '商機成交後自動建立帳款和傳票' },
  { from: '出貨完成', to: '財務入帳', desc: '倉儲出貨後自動拋轉應收帳款' },
  { from: '庫存不足', to: '採購建議', desc: '低於安全量自動產生採購建議' },
  { from: '進貨驗收', to: '應付帳款', desc: '到貨驗收完成自動建立應付' },
  { from: '請假/加班', to: '薪資連動', desc: '假別扣薪、加班費自動計算' },
  { from: '假單申請', to: 'LINE 通知', desc: '員工請假主管 LINE 即刻簽核' },
]

const SYSTEMS = [
  { id: 'dashboard', title: '營運儀表板', icon: LayoutDashboard, path: '/', count: 2, color: '#06b6d4' },
  { id: 'analytics', title: '數據分析', icon: TrendingUp, path: '/analytics', count: 13, color: '#d97706' },
  { id: 'hr', title: '人事管理', icon: Users, path: '/hr/report', count: 17, color: '#2563eb' },
  { id: 'crm', title: '客戶經營', icon: HeadphonesIcon, path: '/crm/overview', count: 12, color: '#f97316' },
  { id: 'wms', title: '倉儲管理', icon: Warehouse, path: '/wms/overview', count: 12, color: '#059669' },
  { id: 'sales', title: '銷售管理', icon: ShoppingCart, path: '/sales', count: 8, color: '#db2777' },
  { id: 'pos', title: 'POS 收銀', icon: Monitor, path: '/pos', count: 3, color: '#06b6d4' },
  { id: 'purchase', title: '採購管理', icon: ShoppingCart, path: '/purchase/suppliers', count: 12, color: '#d97706' },
  { id: 'finance', title: '財務會計', icon: CreditCard, path: '/finance/overview', count: 18, color: '#059669' },
  { id: 'manufacturing', title: '生產品管', icon: Wrench, path: '/manufacturing/bom', count: 8, color: '#f97316' },
  { id: 'org', title: '組織管理', icon: Building2, path: '/org/overview', count: 8, color: '#7c3aed' },
  { id: 'process', title: '流程管理', icon: GitBranch, path: '/process/overview', count: 5, color: '#2563eb' },
  { id: 'system', title: '系統管理', icon: Settings, path: '/system/triggers', count: 10, color: '#ef4444' },
  { id: 'ai', title: 'AI 工具', icon: Bot, path: '/ai/help', count: 3, color: '#db2777' },
  { id: 'integration', title: '外部串接', icon: Plug, path: '/integration/ecommerce', count: 4, color: '#f97316' },
]

const MODULE_OPTIONS = ['HR 人資', 'CRM 客戶', 'WMS 倉儲', '銷售', 'POS', '採購', '財務', '製造品管', '流程', '組織', '數據分析', 'AI', '全部都要']

// ════════════════════════════════════════════
//  COMPONENT
// ════════════════════════════════════════════

function FeatureShowcase() {
  const [activeDemo, setActiveDemo] = useState(0)
  const demo = ALL_DEMOS[activeDemo]

  return (
    <div className="showcase">
      {/* Module tabs */}
      <div className="showcase-tabs">
        {ALL_DEMOS.map((d, i) => {
          const Icon = d.icon
          const active = i === activeDemo
          return (
            <button
              key={d.key}
              className={`showcase-tab ${active ? 'active' : ''}`}
              style={active ? { '--tab-color': d.color } : undefined}
              onClick={() => setActiveDemo(i)}
            >
              <Icon size={16} strokeWidth={1.8} />
              <span>{d.label}</span>
            </button>
          )
        })}
      </div>

      {/* Carousel */}
      <FeatureCarousel key={demo.key} steps={demo.steps} accentColor={demo.color} interval={5000} />
    </div>
  )
}

// ── ROI Calculator ──
function ROICalculator() {
  const [employees, setEmployees] = useState(30)
  const [hours, setHours] = useState(2)
  const savedHours = employees * hours * 22 * 12
  const savedCost = Math.round(savedHours * 250)
  const fmt = v => v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : String(v)

  return (
    <div className="roi-calc">
      <div className="roi-sliders">
        <label className="roi-field">
          <span>公司人數</span>
          <div className="roi-slider-row">
            <input type="range" min="5" max="200" value={employees} onChange={e => setEmployees(+e.target.value)} />
            <strong>{employees} 人</strong>
          </div>
        </label>
        <label className="roi-field">
          <span>每人每天手動作業時間</span>
          <div className="roi-slider-row">
            <input type="range" min="0.5" max="8" step="0.5" value={hours} onChange={e => setHours(+e.target.value)} />
            <strong>{hours} 小時</strong>
          </div>
        </label>
      </div>
      <div className="roi-result">
        <div className="roi-result-item">
          <span className="roi-result-label">每年可節省工時</span>
          <span className="roi-result-value">{fmt(savedHours)} 小時</span>
        </div>
        <div className="roi-result-item">
          <span className="roi-result-label">估算節省成本</span>
          <span className="roi-result-value highlight">NT$ {fmt(savedCost)}</span>
        </div>
      </div>
    </div>
  )
}

// ── Interactive LINE Phone (hover to switch screen) ──
function InteractiveLinePhone() {
  const [activeScreen, setActiveScreen] = useState('clock')
  const screens = {
    clock: { header: '打卡結果', headerBg: '#EFF9FB', headerColor: '#0E7490', title: '上班打卡成功', rows: [['員工', '王小明'], ['時間', '08:52'], ['方式', 'GPS 驗證']] },
    salary: { header: '2026-04 薪資', headerBg: '#ECFDF5', headerColor: '#047857', title: 'NT$ 45,800', rows: [['底薪', 'NT$ 40,000'], ['加班費', '+5,200'], ['津貼', '+3,000']] },
    leave: { header: '請假申請', headerBg: '#EFF6FF', headerColor: '#1D4ED8', title: '已送出審核', rows: [['假別', '特休假'], ['日期', '04/15~04/16'], ['狀態', '待主管核准']] },
    stock: { header: '庫存查詢', headerBg: '#FFF7ED', headerColor: '#C2410C', title: '12 項低庫存', rows: [['有機牛奶', '45 / 50'], ['鮮奶油', '8 / 20'], ['雞胸肉', '150 / 80']] },
  }
  const s = screens[activeScreen]

  return (
    <div className="demo-line-phone-col">
      <div className="demo-phone" style={{ background: '#e8e8e8' }}>
        <div className="demo-phone-top"><span>SME OPS</span><span style={{ opacity: 0.6, fontSize: 10 }}>官方帳號</span></div>
        <div className="demo-phone-chat">
          <div className="demo-msg-r">{activeScreen === 'clock' ? '打卡' : activeScreen === 'salary' ? '薪資' : activeScreen === 'leave' ? '請假' : '庫存'}</div>
          <div className="demo-msg-l" key={activeScreen}>
            <div style={{ background: s.headerBg, padding: '10px 14px' }}>
              <div style={{ fontSize: 10, color: `${s.headerColor}99`, fontWeight: 600 }}>{s.header}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: s.headerColor, marginTop: 2 }}>{s.title}</div>
            </div>
            <div style={{ padding: '8px 14px', fontSize: 11, color: '#555' }}>
              {s.rows.map(([k, v], i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span>{k}</span><span style={{ fontWeight: 600, color: '#222' }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="demo-line-triggers">
        {[
          { key: 'clock', label: '打卡' },
          { key: 'salary', label: '薪資' },
          { key: 'leave', label: '請假' },
          { key: 'stock', label: '庫存' },
        ].map(t => (
          <button
            key={t.key}
            className={`demo-line-trigger ${activeScreen === t.key ? 'active' : ''}`}
            onMouseEnter={() => setActiveScreen(t.key)}
            onClick={() => setActiveScreen(t.key)}
          >{t.label}</button>
        ))}
      </div>
      <div className="demo-line-phone-label">
        <strong>互動體驗</strong>
        <span>滑過上方按鈕，即時切換畫面</span>
      </div>
    </div>
  )
}

export default function DemoLanding() {
  const navigate = useNavigate()
  const [visible, setVisible] = useState(false)
  const [expandedGroup, setExpandedGroup] = useState(null)
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-theme') || 'light')

  // Inquiry
  const [inquiry, setInquiry] = useState({ company_name: '', contact_name: '', phone: '', email: '', company_size: '', interested_modules: [] })
  const [inquiryStatus, setInquiryStatus] = useState(null)

  const toggleModule = (mod) => {
    setInquiry(prev => ({
      ...prev,
      interested_modules: prev.interested_modules.includes(mod)
        ? prev.interested_modules.filter(m => m !== mod)
        : [...prev.interested_modules, mod],
    }))
  }

  const handleSubmit = async () => {
    if (!inquiry.company_name || !inquiry.contact_name || !inquiry.phone) return
    setInquiryStatus('sending')
    try {
      await supabase.from('inquiries').insert({ ...inquiry })
      setInquiryStatus('success')
    } catch {
      setInquiryStatus('error')
    }
  }

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light'
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem('theme', next)
    setTheme(next)
  }

  useEffect(() => { setTimeout(() => setVisible(true), 150) }, [])

  const c0 = useCounter(16, 1200, visible)
  const c1 = useCounter(136, 1600, visible)
  const c2 = useCounter(8, 1000, visible)

  const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })

  return (
    <div className="demo-root">

      {/* ═══ Navbar ═══ */}
      <nav className="demo-nav">
        <div className="demo-nav-inner">
          <div className="demo-nav-brand" onClick={() => scrollTo('hero')}>
            <div className="demo-nav-logo">S</div>
            <span className="demo-nav-name">SME OPS</span>
          </div>

          <div className="demo-nav-links">
            <button className="demo-nav-link" onClick={() => scrollTo('showcase')}>功能展示</button>
            <button className="demo-nav-link" onClick={() => scrollTo('industry')}>適合產業</button>
            <button className="demo-nav-link" onClick={() => scrollTo('features')}>完整功能</button>
            <button className="demo-nav-link" onClick={() => scrollTo('line')}>LINE 整合</button>
          </div>

          <div className="demo-nav-actions">
            <button className="demo-nav-theme" onClick={toggleTheme}>
              {theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
            </button>
            <button className="demo-nav-link" onClick={() => scrollTo('try')}>免費體驗</button>
            <button className="demo-nav-cta" onClick={() => scrollTo('contact')}>
              預約諮詢 <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </nav>

      {/* ═══ Hero ═══ */}
      <section id="hero" className="demo-hero">
        <div className="demo-hero-accent" />
        <div className={`demo-hero-content ${visible ? 'visible' : ''}`}>

          <p className="demo-hero-eyebrow">
            人事 / 倉儲 / CRM / 銷售 / 採購 / 財務 / 生產 / POS — 全模組整合
          </p>

          <h1 className="demo-hero-h1">
            不限使用人數
            <br />
            <strong>一套系統管好整間公司</strong>
          </h1>

          <p className="demo-hero-p">
            涵蓋企業營運核心流程的 16 大模組，跨模組資料即時串接
            <br />
            從進貨到出帳、從打卡到發薪，全流程線上化管理
          </p>

          <div className="demo-hero-buttons">
            <button className="demo-btn-solid" onClick={() => scrollTo('contact')}>
              預約專人導覽 <ArrowRight size={15} />
            </button>
            <button className="demo-btn-outline" onClick={() => scrollTo('try')}>
              免費自行體驗
            </button>
          </div>

          {/* Trust numbers with count-up */}
          <div className="demo-hero-stats">
            <div className="demo-stat-item"><strong style={{ color: '#2563eb' }}>{c0}</strong><span>大模組</span></div>
            <div className="demo-stat-item"><strong style={{ color: '#059669' }}>{c1}+</strong><span>功能頁面</span></div>
            <div className="demo-stat-item"><strong style={{ color: '#d97706' }}>{c2}</strong><span>條自動串接</span></div>
            <div className="demo-stat-item"><strong style={{ color: '#7c3aed' }}>不限</strong><span>使用人數</span></div>
          </div>
        </div>
      </section>

      {/* ═══ Feature Showcase (moved up — most prominent) ═══ */}
      <Section id="showcase" dark>
        <div className="demo-container">
          <div className="demo-sh">
            <h2>系統操作畫面</h2>
            <p>選擇模組，瀏覽實際操作流程與介面配置</p>
          </div>
          <FeatureShowcase />
        </div>
      </Section>

      {/* ═══ 適合哪些企業 ═══ */}
      <Section id="industry">
        <div className="demo-container">
          <div className="demo-sh">
            <h2>適合你的公司嗎？</h2>
            <p>不同產業有不同的管理重點，我們都能對應</p>
          </div>
          <div className="demo-industry-grid">
            {[
              {
                icon: Warehouse, title: '餐飲連鎖', color: '#f97316',
                pains: ['門市多、排班複雜，人力調度困難', '食材效期管控不易，過期報廢成本高', '各店營收數據分散，老闆看不到全貌'],
                solutions: ['智慧排班 + 勞基法即時檢核', '批號效期追蹤 + 低庫存自動預警', 'POS 日結 + BI 看板即時匯總'],
              },
              {
                icon: ShoppingCart, title: '批發零售', color: '#2563eb',
                pains: ['進銷存各做各的，月底對帳對到崩潰', '客戶帳款追不回來，應收越積越多', '促銷活動人工算折扣，錯誤率高'],
                solutions: ['進貨→庫存→出貨→帳款全自動串接', '帳齡分析 + 逾期自動提醒', '促銷引擎自動套用最優方案'],
              },
              {
                icon: Factory, title: '製造業', color: '#059669',
                pains: ['物料需求靠 Excel 算，經常缺料停工', '品質問題追溯困難，不知道哪批出問題', '生產成本算不清楚，毛利只是猜的'],
                solutions: ['MRP 需求計畫自動計算缺料', '批號追蹤 + 品質檢驗紀錄完整', '進貨成本 + 工時自動算出實際毛利'],
              },
              {
                icon: HeadphonesIcon, title: '服務業', color: '#7c3aed',
                pains: ['客戶資料散在業務手機裡，離職就帶走', '專案進度追蹤靠問人，沒有系統化管理', '員工報帳流程冗長，紙本簽核效率低'],
                solutions: ['CRM 客戶 360° 集中管理', '任務流程 + SOP 範本 + 即時追蹤', 'LINE 行動簽核 + 費用線上核銷'],
              },
              {
                icon: Globe, title: '貿易物流', color: '#d97706',
                pains: ['多幣別交易，匯率換算容易出錯', '供應商多、採購流程缺乏標準化', '倉庫跨區調撥，庫存數字不即時'],
                solutions: ['匯率管理 + 多幣別自動換算', '採購流程 + 三方比對 + 合約管理', '多倉庫即時庫存 + 調撥自動扣帳'],
              },
              {
                icon: BarChart3, title: '科技 / 新創', color: '#db2777',
                pains: ['公司快速成長，HR 流程跟不上', '業務獎金計算規則複雜，每月手算', '老闆想看數據但報表散落各處'],
                solutions: ['完整 HR 生命週期管理', 'CRM 成交數據直接連動獎金計算', 'BI 營運看板 + 自訂儀表板'],
              },
            ].map((ind, i) => {
              const IIcon = ind.icon
              return (
                <div key={i} className="demo-industry-card-v2">
                  <div className="demo-ind-header">
                    <div className="demo-ind-icon" style={{ '--ind-color': ind.color }}>
                      <IIcon size={20} strokeWidth={1.8} />
                    </div>
                    <h3>{ind.title}</h3>
                  </div>
                  <div className="demo-ind-section">
                    <div className="demo-ind-label pain">常見痛點</div>
                    {ind.pains.map((p, pi) => (
                      <div key={pi} className="demo-ind-item pain">{p}</div>
                    ))}
                  </div>
                  <div className="demo-ind-section">
                    <div className="demo-ind-label solution">對應方案</div>
                    {ind.solutions.map((s, si) => (
                      <div key={si} className="demo-ind-item solution"><Check size={12} /> {s}</div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </Section>

      {/* ═══ Bento Grid — core value props ═══ */}
      <Section id="overview" dark>
        <div className="demo-container">
          <div className="bento-grid">
            {/* Row 1: 3 equal cards */}
            <div className="bento-card glass">
              <div className="bento-icon" style={{ '--bcolor': '#2563eb' }}><Zap size={22} strokeWidth={1.8} /></div>
              <h3>跨模組即時串接</h3>
              <p>訂單自動檢查庫存與信用額度，出貨即時拋轉應收帳款，減少人工對帳。</p>
              <div className="bento-tags">
                {['贏單→應收', '出貨→帳款', '請假→薪資', '庫存→採購'].map(t => <span key={t} className="bento-tag">{t}</span>)}
              </div>
            </div>
            <div className="bento-card glass">
              <div className="bento-icon" style={{ '--bcolor': '#059669' }}><Shield size={22} strokeWidth={1.8} /></div>
              <h3>台灣法規合規引擎</h3>
              <p>勞基法、性平法共 50+ 條法規即時檢核，排班違規自動標示，降低勞檢風險。</p>
            </div>
            <div className="bento-card glass">
              <div className="bento-icon" style={{ '--bcolor': '#d97706' }}><Globe size={22} strokeWidth={1.8} /></div>
              <h3>LINE 行動辦公</h3>
              <p>打卡、假單、薪資、簽核，打開 LINE 就能操作，不受時間地點限制。</p>
            </div>
            {/* Row 2: 3 equal cards */}
            <div className="bento-card glass">
              <div className="bento-icon" style={{ '--bcolor': '#7c3aed' }}><BarChart3 size={22} strokeWidth={1.8} /></div>
              <h3>BI 數據看板</h3>
              <p>即時營運圖表、銷售預測、異常偵測，用數據驅動決策，不憑感覺。</p>
            </div>
            <div className="bento-card glass">
              <div className="bento-icon" style={{ '--bcolor': '#db2777' }}><Users size={22} strokeWidth={1.8} /></div>
              <h3>不限使用人數</h3>
              <p>全模組授權不按人頭計費，5 人到 200 人同一套系統，隨公司成長擴展。</p>
            </div>
            <div className="bento-card glass">
              <div className="bento-icon" style={{ '--bcolor': '#f97316' }}><CreditCard size={22} strokeWidth={1.8} /></div>
              <h3>全模組一次包含</h3>
              <p>人事、倉儲、CRM、財務、生產全部內建，不用一個一個另外買。</p>
            </div>
          </div>
        </div>
      </Section>

      {/* ═══ Module Groups ═══ */}
      <Section id="features">
        <div className="demo-container">
          <div className="demo-sh">
            <h2>功能總覽</h2>
            <p>5 大領域、16 個模組，點擊展開查看各模組細項</p>
          </div>

          <div className="demo-accordion">
            {MODULE_GROUPS.map((group, gi) => {
              const GIcon = group.icon
              const isOpen = expandedGroup === gi
              const totalCount = group.modules.reduce((s, m) => s + m.count, 0)
              return (
                <div key={gi} className={`demo-acc-item ${isOpen ? 'open' : ''}`}>
                  <button className="demo-acc-header" onClick={() => setExpandedGroup(isOpen ? null : gi)}>
                    <div className="demo-acc-left">
                      <div className="demo-acc-icon" style={{ color: group.color }}>
                        <GIcon size={20} strokeWidth={1.8} />
                      </div>
                      <div>
                        <div className="demo-acc-title">{group.title}</div>
                        <div className="demo-acc-desc">{group.desc}</div>
                      </div>
                    </div>
                    <div className="demo-acc-right">
                      <span className="demo-acc-count">{totalCount} 項功能</span>
                      <ChevronDown size={18} className={`demo-acc-chevron ${isOpen ? 'open' : ''}`} />
                    </div>
                  </button>

                  {isOpen && (
                    <div className="demo-acc-body">
                      {group.modules.map((mod, mi) => {
                        const MIcon = mod.icon
                        return (
                          <div key={mi} className="demo-mod-card">
                            <div className="demo-mod-top">
                              <MIcon size={18} strokeWidth={1.8} style={{ color: group.color }} />
                              <span className="demo-mod-name">{mod.name}</span>
                              <span className="demo-mod-count">{mod.count} 項</span>
                            </div>
                            <div className="demo-mod-items">
                              {mod.items.map((item, ii) => (
                                <span key={ii} className="demo-mod-item">
                                  <Check size={11} /> {item}
                                </span>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </Section>

      {/* ═══ Integrations ═══ */}
      <Section id="integration" dark>
        <div className="demo-container">
          <div className="demo-sh">
            <h2>跨模組流程自動化</h2>
            <p>資料單次輸入，後續作業流程自動觸發，消除人工搬運與重複建檔</p>
          </div>

          <div className="demo-int-grid">
            {INTEGRATIONS.map((item, i) => (
              <div key={i} className="demo-int-card">
                <div className="demo-int-flow">
                  <span className="demo-int-tag">{item.from}</span>
                  <ArrowRight size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                  <span className="demo-int-tag dark">{item.to}</span>
                </div>
                <p>{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ═══ LINE Integration ═══ */}
      <Section id="line">
        <div className="demo-container">
          <div className="demo-sh">
            <h2>LINE 行動辦公整合</h2>
            <p>無需額外安裝 App，員工透過 LINE 即可完成日常營運操作</p>
          </div>

          {/* 3 phones side by side */}
          <div className="demo-line-phones">

            {/* Phone 1: Interactive — hover to switch */}
            <InteractiveLinePhone />

            {/* Phone 2: LIFF 員工首頁 */}
            <div className="demo-line-phone-col">
              <div className="demo-phone" style={{ background: '#f0f2f5' }}>
                <div style={{ background: '#fff', padding: '12px 14px', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'rgba(8,145,178,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, color: '#0891B2' }}>王</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>午安，王小明</div>
                      <div style={{ fontSize: 10, color: '#94a3b8' }}>研發部 · 資深工程師</div>
                    </div>
                  </div>
                </div>
                <div style={{ padding: '8px 12px', display: 'flex', gap: 6 }}>
                  <div style={{ flex: 1, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', borderRadius: 8, padding: '7px 10px' }}>
                    <div style={{ fontSize: 9, color: '#94a3b8' }}>出勤</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#0891B2' }}>已上班</div>
                  </div>
                  <div style={{ flex: 1, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', borderRadius: 8, padding: '7px 10px' }}>
                    <div style={{ fontSize: 9, color: '#94a3b8' }}>待辦</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#EA580C' }}>3 項任務</div>
                  </div>
                  <div style={{ flex: 1, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', borderRadius: 8, padding: '7px 10px' }}>
                    <div style={{ fontSize: 9, color: '#94a3b8' }}>假單</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#059669' }}>已核准</div>
                  </div>
                </div>
                <div style={{ padding: '0 12px 8px' }}>
                  <div style={{ background: 'linear-gradient(135deg, rgba(234,88,12,0.08), rgba(220,38,38,0.08))', border: '1px solid rgba(234,88,12,0.15)', borderRadius: 10, padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#1e293b' }}>點我下班打卡</div>
                      <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>上班 08:52</div>
                    </div>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #fb923c, #f87171)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#fff' }}>👋</div>
                  </div>
                </div>
                <div style={{ padding: '0 12px 8px' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#1e293b', marginBottom: 6 }}>功能選單</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5 }}>
                    {[
                      { icon: '⏰', label: '打卡', bg: 'rgba(8,145,178,0.1)' },
                      { icon: '💰', label: '查薪水', bg: 'rgba(5,150,105,0.1)' },
                      { icon: '📋', label: '請假', bg: 'rgba(37,99,235,0.1)' },
                      { icon: '📦', label: '查庫存', bg: 'rgba(234,88,12,0.1)' },
                      { icon: '⚙️', label: '流程', bg: 'rgba(124,58,237,0.1)' },
                      { icon: '🧾', label: '報帳', bg: 'rgba(217,119,6,0.1)' },
                      { icon: '📅', label: '排休', bg: 'rgba(8,145,178,0.1)' },
                      { icon: '🤝', label: '客戶', bg: 'rgba(219,39,119,0.1)' },
                    ].map(m => (
                      <div key={m.label} style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.05)', borderRadius: 8, padding: '8px 4px', textAlign: 'center' }}>
                        <div style={{ width: 28, height: 28, borderRadius: 7, background: m.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, margin: '0 auto 3px' }}>{m.icon}</div>
                        <div style={{ fontSize: 9, fontWeight: 600, color: '#64748b' }}>{m.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', background: '#fff', borderTop: '1px solid rgba(0,0,0,0.06)', padding: '6px 0' }}>
                  {['首頁', '打卡', '請假', '庫存'].map((t, i) => (
                    <div key={t} style={{ textAlign: 'center', fontSize: 9, color: i === 0 ? '#0891B2' : '#94a3b8', fontWeight: 500 }}>{t}</div>
                  ))}
                </div>
              </div>
              <div className="demo-line-phone-label">
                <strong>員工行動工作台</strong>
                <span>在 LINE 裡直接開，8 大功能一鍵操作</span>
              </div>
            </div>

            {/* Phone 3: 主管簽核 + Rich Menu */}
            <div className="demo-line-phone-col">
              <div className="demo-phone" style={{ background: '#e8e8e8' }}>
                <div className="demo-phone-top"><span>SME OPS</span><span style={{ opacity: 0.6, fontSize: 10 }}>官方帳號</span></div>
                <div className="demo-phone-chat" style={{ minHeight: 160 }}>
                  <div className="demo-msg-l" style={{ width: '82%' }}>
                    <div style={{ background: '#FEF3C7', padding: '10px 14px' }}>
                      <div style={{ fontSize: 10, color: '#92400E', fontWeight: 600 }}>簽核通知</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#78350F', marginTop: 2 }}>李美玲 申請特休假</div>
                    </div>
                    <div style={{ padding: '8px 14px', fontSize: 11, color: '#555' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}><span>日期</span><span style={{ fontWeight: 600, color: '#222' }}>04/15 ~ 04/16</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}><span>天數</span><span style={{ fontWeight: 600, color: '#222' }}>2 天</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>事由</span><span style={{ fontWeight: 600, color: '#222' }}>家庭旅遊</span></div>
                    </div>
                    <div style={{ padding: '6px 14px 10px', display: 'flex', gap: 6 }}>
                      <div style={{ flex: 1, textAlign: 'center', padding: '6px', borderRadius: 6, background: '#059669', color: '#fff', fontSize: 12, fontWeight: 700 }}>核准</div>
                      <div style={{ flex: 1, textAlign: 'center', padding: '6px', borderRadius: 6, background: '#f1f5f9', color: '#64748b', fontSize: 12, fontWeight: 600 }}>退回</div>
                    </div>
                  </div>
                  <div className="demo-msg-r">核准</div>
                  <div className="demo-msg-l" style={{ width: '75%' }}>
                    <div style={{ padding: '10px 14px', fontSize: 12, color: '#059669', fontWeight: 600 }}>
                      ✓ 已核准李美玲的特休假申請
                    </div>
                  </div>
                </div>
                {/* Rich Menu */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', background: '#f6f8fa' }}>
                  {[
                    { icon: '✍️', label: '待簽核', color: '#EA580C' },
                    { icon: '📊', label: '營運數據', color: '#2563EB' },
                    { icon: '👥', label: '員工狀態', color: '#0891B2' },
                  ].map(m => (
                    <div key={m.label} style={{ background: '#fff', padding: '10px 6px', textAlign: 'center', borderRight: '1px solid rgba(0,0,0,0.04)', borderTop: '1px solid rgba(0,0,0,0.04)' }}>
                      <div style={{ width: 30, height: 30, borderRadius: 8, background: `${m.color}12`, border: `1px solid ${m.color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, margin: '0 auto 3px' }}>{m.icon}</div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#1e293b' }}>{m.label}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="demo-line-phone-label">
                <strong>主管行動簽核</strong>
                <span>假單、採購單，LINE 上直接核准或退回</span>
              </div>
            </div>
          </div>

          {/* Feature pills */}
          <div className="demo-line-pills">
            {[
              '不用另外裝 App',
              'GPS + WiFi 雙重打卡驗證',
              '14 種假別線上申請',
              '薪資明細即時查詢',
              '庫存低量自動推播',
              '主管隨時隨地簽核',
              '排休月曆一目瞭然',
              '班表提醒自動推播',
            ].map(f => (
              <span key={f} className="demo-line-pill"><Check size={11} /> {f}</span>
            ))}
          </div>
        </div>
      </Section>

      {/* ═══ ROI Calculator ═══ */}
      <Section dark>
        <div className="demo-container">
          <div className="demo-sh">
            <h2>導入效益試算</h2>
            <p>拖動滑桿，估算導入系統後每年可節省的時間與成本</p>
          </div>
          <ROICalculator />
        </div>
      </Section>

      {/* ═══ Comparison Table ═══ */}
      <Section>
        <div className="demo-container">
          <div className="demo-sh">
            <h2>跟傳統 ERP 有什麼不同？</h2>
          </div>
          <div className="compare-table">
            <div className="compare-header">
              <div className="compare-col feature">比較項目</div>
              <div className="compare-col them">傳統 ERP</div>
              <div className="compare-col us">SME OPS</div>
            </div>
            {[
              { feature: '導入時程', them: '半年 ~ 一年', us: '兩週內上線' },
              { feature: '授權方式', them: '按人頭計費', us: '不限使用人數' },
              { feature: '操作介面', them: '類似 Excel 表格', us: '現代化 Web UI' },
              { feature: 'LINE 整合', them: '無 / 需額外開發', us: '原生內建' },
              { feature: '模組擴充', them: '每個模組另外購買', us: '全模組包含' },
              { feature: '行動辦公', them: '需另購 App', us: 'LINE + Web 即用' },
              { feature: '跨模組串接', them: '手動匯出匯入', us: '即時自動串接' },
              { feature: '法規合規', them: '需自行檢查', us: '內建 50+ 條法規檢核' },
            ].map((row, i) => (
              <div key={i} className="compare-row">
                <div className="compare-col feature">{row.feature}</div>
                <div className="compare-col them">{row.them}</div>
                <div className="compare-col us"><Check size={13} /> {row.us}</div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ═══ Team / Trust ═══ */}
      <Section dark>
        <div className="demo-container">
          <div className="team-section">
            <div className="team-banner">
              <div className="team-banner-left">
                <h3>專為台灣中小企業打造</h3>
                <p>我們的目標很簡單：讓老闆不用再花大錢買七套系統、請七家廠商。一套搞定，是我們對每個客戶的承諾。</p>
              </div>
              <div className="team-banner-stats">
                <div className="team-stat"><strong>50+</strong><span>條內建法規</span></div>
                <div className="team-stat"><strong>16</strong><span>大模組全包</span></div>
                <div className="team-stat"><strong>24hr</strong><span>內回覆諮詢</span></div>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* ═══ Diagnostic CTA ═══ */}
      <Section>
        <div className="demo-container">
          <div className="demo-diagnostic">
            <div className="demo-diagnostic-text">
              <h2>不確定從哪裡開始？</h2>
              <p>預約 30 分鐘線上營運診斷，由顧問協助盤點貴公司目前的管理痛點，評估哪些模組最能產生即時效益。</p>
            </div>
            <button className="demo-btn-solid" onClick={() => scrollTo('contact')}>
              預約免費營運診斷 <ArrowRight size={15} />
            </button>
          </div>
        </div>
      </Section>

      {/* ═══ Try It ═══ */}
      <Section id="try">
        <div className="demo-container">
          <div className="demo-sh">
            <h2>線上體驗環境</h2>
            <p>選擇模組直接進入操作，無需註冊</p>
          </div>

          <div className="demo-sys-grid">
            {SYSTEMS.map(sys => {
              const Icon = sys.icon
              return (
                <button key={sys.id} className="demo-sys-tile" onClick={() => navigate(sys.path)} style={{ '--tile-color': sys.color }}>
                  <div className="demo-sys-tile-icon">
                    <Icon size={20} strokeWidth={1.8} />
                  </div>
                  <div className="demo-sys-tile-info">
                    <span className="demo-sys-tile-name">{sys.title}</span>
                    <span className="demo-sys-tile-count">{sys.count} 項功能</span>
                  </div>
                  <ArrowUpRight size={14} className="demo-sys-tile-arrow" />
                </button>
              )
            })}
          </div>
        </div>
      </Section>

      {/* ═══ Contact ═══ */}
      <Section id="contact">
        <div className="demo-container" style={{ maxWidth: 640 }}>
          <div className="demo-sh">
            <h2>聯繫我們</h2>
            <p>留下資料，將由專人於一個工作天內與您聯繫</p>
          </div>

          {inquiryStatus === 'success' ? (
            <div className="demo-form-done">
              <CheckCircle size={40} strokeWidth={1.5} />
              <h3>感謝您的諮詢</h3>
              <p>我們會在 1 個工作天內與您聯繫。</p>
            </div>
          ) : (
            <div className="demo-form">
              <div className="demo-form-row">
                {[
                  { key: 'company_name', label: '公司名稱 *', ph: '例：好吃餐飲有限公司' },
                  { key: 'contact_name', label: '聯絡人 *', ph: '王小明' },
                  { key: 'phone', label: '電話 *', ph: '0912-345-678' },
                  { key: 'email', label: 'Email', ph: 'example@company.com' },
                ].map(f => (
                  <label key={f.key} className="demo-field">
                    <span>{f.label}</span>
                    <input
                      type="text" placeholder={f.ph} value={inquiry[f.key]}
                      onChange={e => setInquiry(prev => ({ ...prev, [f.key]: e.target.value }))}
                    />
                  </label>
                ))}
              </div>

              <label className="demo-field">
                <span>公司人數</span>
                <select value={inquiry.company_size} onChange={e => setInquiry(prev => ({ ...prev, company_size: e.target.value }))}>
                  <option value="">請選擇</option>
                  {['1-10 人', '11-30 人', '31-50 人', '51-100 人', '100 人以上'].map(o => <option key={o}>{o}</option>)}
                </select>
              </label>

              <div className="demo-field">
                <span>感興趣的模組</span>
                <div className="demo-chips">
                  {MODULE_OPTIONS.map(mod => (
                    <button
                      key={mod}
                      className={`demo-chip ${inquiry.interested_modules.includes(mod) ? 'on' : ''}`}
                      onClick={() => toggleModule(mod)}
                    >{mod}</button>
                  ))}
                </div>
              </div>

              {inquiryStatus === 'error' && <p style={{ color: 'var(--accent-red)', fontSize: 13, textAlign: 'center' }}>提交失敗，請稍後再試</p>}

              <button
                className={`demo-submit ${inquiry.company_name && inquiry.contact_name && inquiry.phone ? 'ready' : ''}`}
                onClick={handleSubmit}
                disabled={inquiryStatus === 'sending' || !inquiry.company_name || !inquiry.contact_name || !inquiry.phone}
              >
                <Send size={15} />
                {inquiryStatus === 'sending' ? '提交中...' : '提交諮詢'}
              </button>
            </div>
          )}
        </div>
      </Section>

      {/* ═══ Footer ═══ */}
      <footer className="demo-footer">
        <div className="demo-footer-inner">
          <div className="demo-footer-brand">
            <div className="demo-nav-logo">S</div>
            <span>SME OPS — 中小企業智慧營運系統</span>
          </div>
          <span>專為台灣中小企業打造</span>
        </div>
      </footer>
    </div>
  )
}
