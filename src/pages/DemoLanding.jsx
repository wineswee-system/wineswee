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

import DemoIndustrySection from './components/DemoIndustrySection'
import DemoBentoSection from './components/DemoBentoSection'
import DemoLineSection from './components/DemoLineSection'
import DemoComparisonTable from './components/DemoComparisonTable'
import DemoContactSection from './components/DemoContactSection'

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

// ════════════════════════════════════════════
//  COMPONENTS
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

// ════════════════════════════════════════════
//  MAIN PAGE
// ════════════════════════════════════════════

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

      {/* ═══ Feature Showcase ═══ */}
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
          <DemoIndustrySection />
        </div>
      </Section>

      {/* ═══ Bento Grid — core value props ═══ */}
      <Section id="overview" dark>
        <div className="demo-container">
          <DemoBentoSection />
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
          <DemoLineSection />
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
          <DemoComparisonTable />
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
          <DemoContactSection
            inquiry={inquiry}
            setInquiry={setInquiry}
            inquiryStatus={inquiryStatus}
            onSubmit={handleSubmit}
            toggleModule={toggleModule}
          />
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
