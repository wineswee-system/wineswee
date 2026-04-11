/*
 * Design Direction: Organic & Refined (Light Premium)
 * Display Font: Space Grotesk (tech-warm)
 * Body Font: DM Sans / Noto Sans TC
 * Palette: Indigo-Violet primary, Cyan accent, Slate neutrals
 * Motion: Staggered word entrance, scroll fade-up, hover lift
 * Layout: Asymmetric bento, generous whitespace
 */

import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  Users, GitBranch, HeadphonesIcon, Warehouse,
  LayoutDashboard, BarChart3, ArrowRight,
  ShoppingCart, CreditCard, TrendingUp,
  Check, Package, Sun, Moon, ArrowUpRight, Monitor, Star,
  Clock, Smartphone, Zap, MessageCircle, Shield, ChevronRight,
} from 'lucide-react'

import DemoLineSection from './components/DemoLineSection'
import DemoContactSection from './components/DemoContactSection'

// ── Hooks ──
function useInView(threshold = 0.15) {
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

function useCounter(target, duration = 2000, start = false) {
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

// ── Animated Section ──
function Section({ children, id, className = '' }) {
  const [ref, inView] = useInView()
  return (
    <section ref={ref} id={id} className={`lp-section ${inView ? 'lp-visible' : ''} ${className}`}>
      {children}
    </section>
  )
}

// ── Staggered Word Animation ──
function AnimatedHeading({ text, highlight, delay = 0 }) {
  const words = text.split(' ')
  return (
    <h1 className="lp-hero-h1">
      {words.map((word, i) => (
        <span key={i} className="lp-word" style={{ animationDelay: `${delay + i * 80}ms` }}>
          {word}{' '}
        </span>
      ))}
      {highlight && (
        <strong className="lp-hero-highlight">
          {highlight.split(' ').map((word, i) => (
            <span key={i} className="lp-word" style={{ animationDelay: `${delay + (words.length + i) * 80}ms` }}>
              {word}{' '}
            </span>
          ))}
        </strong>
      )}
    </h1>
  )
}

// ════════════════════════════════════════════
//  DATA
// ════════════════════════════════════════════

const PAIN_POINTS = [
  { emoji: '📋', pain: '員工打卡用紙本，月底人資手動算出勤', cost: '每月浪費 40+ 小時', solution: 'LINE GPS 打卡 → 自動統計' },
  { emoji: '📊', pain: '排班用 Excel，改一個人要調半天', cost: '每週花 3-5 小時排班', solution: 'AI 一鍵排班 + 勞基法自動檢查' },
  { emoji: '💰', pain: '薪資用計算機，怕算錯又怕漏', cost: '每月 2-3 天算薪', solution: '自動拉出勤 + 加班 + 請假計算' },
  { emoji: '📦', pain: '庫存靠記憶，賣完才知道沒貨', cost: '缺貨損失 5-10% 營收', solution: '即時庫存 + 安全量自動補貨' },
  { emoji: '📱', pain: '請假要填紙本，主管不在就卡住', cost: '審核平均等 2-3 天', solution: 'LINE 即時送簽 → 秒核' },
  { emoji: '🔄', pain: '開新店流程混亂，總是漏東漏西', cost: '開店延誤 2-4 週', solution: 'SOP 範本 + 任務追蹤 + 進度透明' },
]

const BUNDLES = [
  {
    icon: Users, color: '#7c3aed', name: '人資行政包',
    tagline: 'LINE 打卡 · AI 排班 · 勞基法自動合規',
    features: ['GPS + WiFi 打卡驗證', 'AI 智慧排班', '14 種假別 + 自動算薪', '找人代班智能推薦', '員工 LIFF 自助操作'],
    popular: false,
  },
  {
    icon: Package, color: '#059669', name: '進銷存管理包',
    tagline: '採購到出貨 · 手機掃碼 · 智能補貨',
    features: ['採購申請 → 三方比對 → 驗收入庫', '批號效期追蹤', '安全庫存自動補貨', '多倉調撥管理', '庫存成本估價'],
    popular: true,
  },
  {
    icon: CreditCard, color: '#d97706', name: '財務會計包',
    tagline: '傳票自動化 · 一鍵對帳 · 稅務申報',
    features: ['應收應付自動沖帳', '銀行對帳自動比對', '資產負債表 + 損益表', '預算管理 + 成本中心'],
    popular: false,
  },
  {
    icon: GitBranch, color: '#2563eb', name: '流程管理包',
    tagline: 'AI 生成 SOP · 任務追蹤 · 多層簽核',
    features: ['AI 自動生成 SOP 流程', '任務指派 + LINE 通知', '多關卡簽核流程', '查核清單管理'],
    popular: false,
  },
  {
    icon: BarChart3, color: '#db2777', name: '數據分析包',
    tagline: '跨模組洞察 · AI 異常偵測 · 自訂報表',
    features: ['營運儀表板即時 KPI', '銷售預測 + 異常偵測', 'AI 助理對話式分析'],
    popular: false,
  },
]

const TIMELINE = [
  { week: '第 1 週', title: '需求訪談', desc: '了解公司流程，確認模組需求', icon: '📋', color: '#6366f1' },
  { week: '第 2 週', title: '系統設定', desc: '門市建立、員工匯入、客製化', icon: '⚙️', color: '#06b6d4' },
  { week: '第 3 週', title: '教育訓練', desc: '管理端操作、LINE Bot 綁定', icon: '🎓', color: '#8b5cf6' },
  { week: '第 4 週', title: '正式上線', desc: '平行測試、微調、正式切換', icon: '🚀', color: '#059669' },
]

const COMPARISON = [
  { item: '導入時間', us: '4 週', them: '3-6 個月' },
  { item: '最低啟動費用', us: '按模組計費', them: '50 萬起' },
  { item: '使用人數', us: '不限人數', them: '按授權數' },
  { item: 'LINE 整合', us: '完整 LIFF + Bot', them: '需另外開發' },
  { item: 'AI 功能', us: 'AI 排班 / 流程 / 分析', them: '無' },
  { item: '模組選購', us: '自由選配', them: '整包購買' },
]

const SYSTEMS = [
  { title: '營運儀表板', icon: LayoutDashboard, path: '/', color: '#6366f1' },
  { title: '人事管理', icon: Users, path: '/hr/attendance', color: '#7c3aed' },
  { title: '客戶經營', icon: HeadphonesIcon, path: '/crm/overview', color: '#f97316' },
  { title: '倉儲管理', icon: Warehouse, path: '/wms/overview', color: '#059669' },
  { title: 'POS 收銀', icon: Monitor, path: '/pos', color: '#06b6d4' },
  { title: '採購管理', icon: ShoppingCart, path: '/purchase/suppliers', color: '#d97706' },
  { title: '財務會計', icon: CreditCard, path: '/finance/overview', color: '#059669' },
  { title: '流程管理', icon: GitBranch, path: '/process/workflows', color: '#2563eb' },
  { title: '數據分析', icon: TrendingUp, path: '/analytics', color: '#db2777' },
]

// ════════════════════════════════════════════
//  MAIN PAGE
// ════════════════════════════════════════════

export default function DemoLanding() {
  const navigate = useNavigate()
  const [visible, setVisible] = useState(false)
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-theme') || 'light')
  const [inquiry, setInquiry] = useState({ company_name: '', contact_name: '', phone: '', email: '', company_size: '', interested_modules: [] })
  const [inquiryStatus, setInquiryStatus] = useState(null)

  const toggleModule = (mod) => setInquiry(prev => ({
    ...prev, interested_modules: prev.interested_modules.includes(mod) ? prev.interested_modules.filter(m => m !== mod) : [...prev.interested_modules, mod],
  }))
  const handleSubmit = async () => {
    if (!inquiry.company_name || !inquiry.contact_name || !inquiry.phone) return
    setInquiryStatus('sending')
    try { await supabase.from('inquiries').insert({ ...inquiry }); setInquiryStatus('success') } catch { setInquiryStatus('error') }
  }
  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light'
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem('theme', next)
    setTheme(next)
  }

  useEffect(() => { setTimeout(() => setVisible(true), 200) }, [])
  const c0 = useCounter(16, 1400, visible)
  const c1 = useCounter(136, 1800, visible)
  const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })

  return (
    <div className="lp-root">

      {/* ═══ Navbar ═══ */}
      <nav className="lp-nav">
        <div className="lp-nav-inner">
          <div className="lp-nav-brand" onClick={() => scrollTo('hero')}>
            <div className="lp-logo">S</div>
            <span className="lp-logo-text">SME OPS</span>
          </div>
          <div className="lp-nav-links">
            <button onClick={() => scrollTo('pain')}>痛點診斷</button>
            <button onClick={() => scrollTo('bundles')}>方案</button>
            <button onClick={() => scrollTo('line')}>LINE</button>
            <button onClick={() => scrollTo('try')}>體驗</button>
          </div>
          <div className="lp-nav-actions">
            <button className="lp-nav-theme" onClick={toggleTheme}>{theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}</button>
            <button className="lp-cta-nav" onClick={() => scrollTo('contact')}>
              預約諮詢 <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </nav>

      {/* ═══ Hero ═══ */}
      <section id="hero" className="lp-hero">
        {/* Background effects */}
        <div className="lp-hero-orb lp-hero-orb-1" />
        <div className="lp-hero-orb lp-hero-orb-2" />
        <div className="lp-hero-orb lp-hero-orb-3" />
        <div className="lp-hero-grid" />
        <div className="lp-particles">
          {Array.from({ length: 15 }).map((_, i) => (
            <div key={i} className="lp-particle" style={{
              left: `${10 + Math.random() * 80}%`, top: `${10 + Math.random() * 80}%`,
              width: `${3 + Math.random() * 6}px`, height: `${3 + Math.random() * 6}px`,
              animationDelay: `${Math.random() * 8}s`, animationDuration: `${10 + Math.random() * 15}s`,
            }} />
          ))}
        </div>

        <div className={`lp-hero-content ${visible ? 'lp-visible' : ''}`}>
          <div className="lp-eyebrow">
            <Zap size={14} /> 按需選購，隨需擴充
          </div>

          <AnimatedHeading
            text="從一個模組開始"
            highlight="打造最適合您的數位大腦"
          />

          <p className="lp-hero-sub">
            不限使用人數，彈性選購模組。<br />
            現在解決最痛的點，未來隨公司成長無限擴充。
          </p>

          <div className="lp-hero-ctas">
            <button className="lp-cta-primary" onClick={() => scrollTo('contact')}>
              預約專人導覽 <ArrowRight size={16} />
            </button>
            <button className="lp-cta-secondary" onClick={() => scrollTo('try')}>
              免費自行體驗
            </button>
          </div>

          <div className="lp-hero-stats">
            {[
              { value: '5', label: '解決方案包', color: '#6366f1' },
              { value: `${c0}`, label: '大模組自由選配', color: '#06b6d4' },
              { value: '4 週', label: '快速導入上線', color: '#8b5cf6' },
              { value: '不限', label: '使用人數', color: '#059669' },
            ].map((s, i) => (
              <div key={i} className="lp-stat">
                <strong style={{ color: s.color }}>{s.value}</strong>
                <span>{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ Pain Points ═══ */}
      <Section id="pain">
        <div className="lp-container">
          <div className="lp-section-header">
            <span className="lp-badge">💡 痛點診斷</span>
            <h2>這些問題，聽起來熟悉嗎？</h2>
            <p>如果你中了 3 項以上，是時候考慮數位化了</p>
          </div>
          <div className="lp-pain-grid">
            {PAIN_POINTS.map((item, i) => (
              <div key={i} className="lp-pain-card" style={{ animationDelay: `${i * 100}ms` }}>
                <div className="lp-pain-emoji">{item.emoji}</div>
                <div className="lp-pain-text">{item.pain}</div>
                <div className="lp-pain-cost">💸 {item.cost}</div>
                <div className="lp-pain-fix"><Check size={14} /> {item.solution}</div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ═══ Hot Modules ═══ */}
      <Section id="hot" className="lp-section-alt">
        <div className="lp-container">
          <div className="lp-section-header">
            <span className="lp-badge">🔥 最受歡迎</span>
            <h2>不知道從哪裡開始？</h2>
            <p>超過 80% 客戶首選導入的模組</p>
          </div>
          <div className="lp-hot-grid">
            {[
              { icon: Smartphone, name: 'LINE 行動辦公', desc: '員工用 LINE 就能打卡、查薪資、請假、回報任務。零學習成本。', color: '#06b6d4', tag: '最多人選' },
              { icon: Clock, name: 'AI 智慧排班', desc: '一鍵自動排班，15 條勞基法自動檢查。找人代班全自動化。', color: '#7c3aed', tag: 'AI 驅動' },
              { icon: GitBranch, name: 'AI 流程助手', desc: '用自然語言描述需求，AI 自動生成 SOP 流程。任務追蹤 + LINE 通知。', color: '#2563eb', tag: '效率翻倍' },
            ].map((item, i) => {
              const Icon = item.icon
              return (
                <div key={i} className="lp-hot-card">
                  <div className="lp-hot-icon" style={{ background: `${item.color}12`, color: item.color }}>
                    <Icon size={28} strokeWidth={1.5} />
                  </div>
                  <div className="lp-hot-tag" style={{ background: `${item.color}15`, color: item.color }}>{item.tag}</div>
                  <h3>{item.name}</h3>
                  <p>{item.desc}</p>
                  <div className="lp-hot-badge">可單獨導入</div>
                </div>
              )
            })}
          </div>
        </div>
      </Section>

      {/* ═══ Solution Bundles ═══ */}
      <Section id="bundles">
        <div className="lp-container">
          <div className="lp-section-header">
            <span className="lp-badge">📦 解決方案</span>
            <h2>依需求選擇方案包</h2>
            <p>或自由組合單一模組，打造最適合你的系統</p>
          </div>
          <div className="lp-bundle-grid">
            {BUNDLES.map((b, i) => {
              const Icon = b.icon
              return (
                <div key={i} className={`lp-bundle-card ${b.popular ? 'lp-popular' : ''}`}>
                  {b.popular && <div className="lp-popular-tag"><Star size={12} /> 最受歡迎</div>}
                  <div className="lp-bundle-icon" style={{ background: `${b.color}12`, color: b.color }}>
                    <Icon size={22} />
                  </div>
                  <h3>{b.name}</h3>
                  <p className="lp-bundle-tagline">{b.tagline}</p>
                  <ul className="lp-bundle-features">
                    {b.features.map((f, j) => (
                      <li key={j}><Check size={14} style={{ color: b.color, flexShrink: 0 }} /> {f}</li>
                    ))}
                  </ul>
                  <button className="lp-bundle-cta" style={{ borderColor: b.color, color: b.color }} onClick={() => scrollTo('contact')}>
                    了解方案 <ChevronRight size={14} />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </Section>

      {/* ═══ LINE ═══ */}
      <Section id="line" className="lp-section-alt">
        <div className="lp-container">
          <div className="lp-section-header">
            <span className="lp-badge"><MessageCircle size={14} /> LINE 整合</span>
            <h2>LINE 行動辦公整合</h2>
            <p>無需額外安裝 App，員工透過 LINE 即可完成日常操作</p>
          </div>
          <DemoLineSection />
        </div>
      </Section>

      {/* ═══ Timeline ═══ */}
      <Section id="timeline">
        <div className="lp-container">
          <div className="lp-section-header">
            <span className="lp-badge">🚀 導入流程</span>
            <h2>4 週快速導入</h2>
            <p>從需求訪談到正式上線，一個月內完成</p>
          </div>
          <div className="lp-timeline">
            {TIMELINE.map((t, i) => (
              <div key={i} className="lp-timeline-item">
                <div className="lp-timeline-dot" style={{ background: t.color }}>{t.icon}</div>
                <div className="lp-timeline-line" />
                <div className="lp-timeline-week" style={{ color: t.color }}>{t.week}</div>
                <h3>{t.title}</h3>
                <p>{t.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ═══ Comparison ═══ */}
      <Section className="lp-section-alt">
        <div className="lp-container">
          <div className="lp-section-header">
            <span className="lp-badge"><Shield size={14} /> 比較</span>
            <h2>跟傳統 ERP 有什麼不同？</h2>
          </div>
          <div className="lp-compare-table">
            <div className="lp-compare-header">
              <div>比較項目</div>
              <div className="lp-compare-us">SME Ops</div>
              <div className="lp-compare-them">傳統 ERP</div>
            </div>
            {COMPARISON.map((row, i) => (
              <div key={i} className="lp-compare-row">
                <div>{row.item}</div>
                <div className="lp-compare-us">{row.us}</div>
                <div className="lp-compare-them">{row.them}</div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ═══ Try It ═══ */}
      <Section id="try">
        <div className="lp-container">
          <div className="lp-section-header">
            <span className="lp-badge">🖥️ 線上體驗</span>
            <h2>直接操作，無需註冊</h2>
            <p>選擇模組進入體驗環境</p>
          </div>
          <div className="lp-try-grid">
            {SYSTEMS.map((sys, i) => {
              const Icon = sys.icon
              return (
                <button key={i} className="lp-try-tile" onClick={() => navigate(sys.path)} style={{ '--tc': sys.color }}>
                  <div className="lp-try-icon"><Icon size={22} strokeWidth={1.5} /></div>
                  <span>{sys.title}</span>
                  <ArrowUpRight size={14} className="lp-try-arrow" />
                </button>
              )
            })}
          </div>
        </div>
      </Section>

      {/* ═══ Final CTA ═══ */}
      <Section className="lp-section-alt">
        <div className="lp-container">
          <div className="lp-final-cta">
            <h2>不確定從哪裡開始？</h2>
            <p>預約 30 分鐘線上營運診斷，由顧問協助盤點管理痛點</p>
            <button className="lp-cta-primary lp-cta-big" onClick={() => scrollTo('contact')}>
              預約免費營運診斷 <ArrowRight size={18} />
            </button>
          </div>
        </div>
      </Section>

      {/* ═══ Contact ═══ */}
      <Section id="contact">
        <div className="lp-container" style={{ maxWidth: 640 }}>
          <div className="lp-section-header">
            <h2>聯繫我們</h2>
            <p>留下資料，將由專人於一個工作天內與您聯繫</p>
          </div>
          <DemoContactSection inquiry={inquiry} setInquiry={setInquiry} inquiryStatus={inquiryStatus} onSubmit={handleSubmit} toggleModule={toggleModule} />
        </div>
      </Section>

      {/* ═══ Footer ═══ */}
      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <div className="lp-footer-brand">
            <div className="lp-logo">S</div>
            <span>SME OPS — 按需選購，隨需擴充</span>
          </div>
          <span>專為台灣中小企業打造</span>
        </div>
      </footer>
    </div>
  )
}
