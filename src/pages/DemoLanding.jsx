import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  Users, GitBranch, HeadphonesIcon, Warehouse,
  LayoutDashboard, BarChart3, ArrowRight,
  ShoppingCart, CreditCard, TrendingUp,
  Check, Package,
  Sun, Moon, ArrowUpRight, Monitor, Star,
  Clock, Smartphone,
} from 'lucide-react'

import DemoLineSection from './components/DemoLineSection'
import DemoContactSection from './components/DemoContactSection'

// ── Hooks ──
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

function Section({ children, id, dark = false }) {
  const [ref, inView] = useInView()
  return (
    <section ref={ref} id={id} className={`demo-section ${inView ? 'in-view' : ''} ${dark ? 'demo-section-dark' : ''}`}>
      {children}
    </section>
  )
}

// ════════════════════════════════════════════
//  DATA
// ════════════════════════════════════════════

const SOLUTION_BUNDLES = [
  {
    id: 'hr', icon: Users, color: '#7c3aed', name: '人資行政包',
    tagline: 'LINE 打卡 · AI 排班 · 勞基法自動合規',
    price: '洽詢', popular: false,
    features: ['GPS + WiFi 打卡驗證', 'AI 智慧排班（勞基法 15 條檢查）', '14 種假別 + 自動算薪', '找人代班智能推薦', '員工 LIFF 自助操作', '打卡補登 + 主管審核'],
    modules: ['出勤管理', '排班系統', '薪資管理', '請假管理', '加班管理', '績效考核'],
  },
  {
    id: 'supply', icon: Package, color: '#059669', name: '進銷存管理包',
    tagline: '採購到出貨 · 手機掃碼 · 智能補貨',
    price: '洽詢', popular: true,
    features: ['採購申請 → 三方比對 → 驗收入庫', '批號效期追蹤', '手機條碼掃描收發貨', '安全庫存自動補貨建議', '多倉調撥管理', '庫存成本估價（FIFO/加權平均）'],
    modules: ['採購管理', '倉儲物流', '銷售管理', 'POS 收銀'],
  },
  {
    id: 'finance', icon: CreditCard, color: '#d97706', name: '財務會計包',
    tagline: '傳票自動化 · 一鍵對帳 · 稅務申報',
    price: '洽詢', popular: false,
    features: ['應收應付自動沖帳', '銀行對帳自動比對', '401/403 稅務報表', '資產負債表 + 損益表', '預算管理 + 成本中心', '固定資產折舊計算'],
    modules: ['財務會計', '應收帳款', '應付帳款', '預算管理'],
  },
  {
    id: 'process', icon: GitBranch, color: '#2563eb', name: '流程管理包',
    tagline: 'AI 生成 SOP · 任務追蹤 · 多層簽核',
    price: '洽詢', popular: false,
    features: ['AI 自動生成 SOP 流程', '任務指派 + LINE 即時通知', '前置條件 + 觸發動作', '多關卡簽核流程', '查核清單管理', '流程範本一鍵部署'],
    modules: ['流程管理', '任務管理', '簽核系統', 'SOP 範本'],
  },
  {
    id: 'data', icon: BarChart3, color: '#db2777', name: '數據分析包',
    tagline: '跨模組洞察 · AI 異常偵測 · 自訂報表',
    price: '洽詢', popular: false,
    features: ['營運儀表板即時 KPI', '銷售預測 + 異常偵測', '跨系統關聯分析', '自訂 BI 看板', 'AI 助理對話式分析', '資料匯出 PDF/Excel'],
    modules: ['數據分析', 'AI 工具', '報表系統'],
  },
]


const TIMELINE = [
  { week: '第 1 週', title: '需求訪談', desc: '了解公司流程、確認模組需求、盤點痛點', icon: '📋' },
  { week: '第 2 週', title: '系統設定', desc: '門市建立、員工匯入、班別設定、客製化欄位', icon: '⚙️' },
  { week: '第 3 週', title: '教育訓練', desc: '管理端操作教學、LINE Bot 綁定、員工端培訓', icon: '🎓' },
  { week: '第 4 週', title: '正式上線', desc: '平行測試、微調優化、正式切換使用', icon: '🚀' },
]

const COMPARISON = [
  { item: '導入時間', us: '4 週', them: '3-6 個月' },
  { item: '最低啟動費用', us: '按模組計費', them: '50 萬起' },
  { item: '使用人數限制', us: '不限人數', them: '按授權數' },
  { item: 'LINE 整合', us: '✅ 完整 LIFF + Bot', them: '❌ 需另外開發' },
  { item: '手機操作', us: '✅ 完整行動版', them: '⚠️ 有限功能' },
  { item: 'AI 功能', us: '✅ AI 排班 / 流程 / 分析', them: '❌ 無' },
  { item: '模組選購', us: '✅ 自由選配', them: '❌ 整包購買' },
  { item: '系統更新', us: '✅ 自動更新', them: '⚠️ 另收費用' },
  { item: '客製化', us: '✅ 彈性設定', them: '⚠️ 需求單另計' },
]

const SYSTEMS = [
  { id: 'dashboard', title: '營運儀表板', icon: LayoutDashboard, path: '/', color: '#06b6d4' },
  { id: 'hr', title: '人事管理', icon: Users, path: '/hr/attendance', color: '#7c3aed' },
  { id: 'crm', title: '客戶經營', icon: HeadphonesIcon, path: '/crm/overview', color: '#f97316' },
  { id: 'wms', title: '倉儲管理', icon: Warehouse, path: '/wms/overview', color: '#059669' },
  { id: 'pos', title: 'POS 收銀', icon: Monitor, path: '/pos', color: '#06b6d4' },
  { id: 'purchase', title: '採購管理', icon: ShoppingCart, path: '/purchase/suppliers', color: '#d97706' },
  { id: 'finance', title: '財務會計', icon: CreditCard, path: '/finance/overview', color: '#059669' },
  { id: 'process', title: '流程管理', icon: GitBranch, path: '/process/workflows', color: '#2563eb' },
  { id: 'analytics', title: '數據分析', icon: TrendingUp, path: '/analytics', color: '#db2777' },
]

// ════════════════════════════════════════════
//  COMPONENTS
// ════════════════════════════════════════════

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

  useEffect(() => { setTimeout(() => setVisible(true), 150) }, [])
  const c0 = useCounter(16, 1200, visible)
  const c1 = useCounter(136, 1600, visible)
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
            <button className="demo-nav-link" onClick={() => scrollTo('bundles')}>方案與功能</button>
            <button className="demo-nav-link" onClick={() => scrollTo('timeline')}>導入流程</button>
            <button className="demo-nav-link" onClick={() => scrollTo('line')}>LINE 整合</button>
            <button className="demo-nav-link" onClick={() => scrollTo('timeline')}>導入流程</button>
          </div>
          <div className="demo-nav-actions">
            <button className="demo-nav-theme" onClick={toggleTheme}>{theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}</button>
            <button className="demo-nav-link" onClick={() => scrollTo('try')}>免費體驗</button>
            <button className="demo-nav-cta" onClick={() => scrollTo('contact')}>預約諮詢 <ArrowRight size={14} /></button>
          </div>
        </div>
      </nav>

      {/* ═══ Hero ═══ */}
      <section id="hero" className="demo-hero">
        <div className="demo-hero-accent" />
        {/* Floating particles */}
        <div className="demo-particles">
          {Array.from({ length: 20 }).map((_, i) => (
            <div key={i} className="demo-particle" style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              width: `${4 + Math.random() * 8}px`,
              height: `${4 + Math.random() * 8}px`,
              animationDelay: `${Math.random() * 6}s`,
              animationDuration: `${8 + Math.random() * 12}s`,
            }} />
          ))}
        </div>
        {/* Animated grid lines */}
        <div className="demo-grid-bg" />
        <div className={`demo-hero-content ${visible ? 'visible' : ''}`}>
          <p className="demo-hero-eyebrow">按需選購，隨需擴充 — Buy what you need, grow when you're ready.</p>
          <h1 className="demo-hero-h1">
            從一個模組開始
            <br />
            <strong>打造最適合您的數位大腦</strong>
          </h1>
          <p className="demo-hero-p">
            不限使用人數，彈性選購模組。現在解決最痛的點，未來隨公司成長無限擴充。
            <br />
            涵蓋 {c0} 大模組、{c1}+ 項功能，跨模組資料即時串接。
          </p>
          <div className="demo-hero-buttons">
            <button className="demo-btn-solid" onClick={() => scrollTo('contact')}>預約專人導覽 <ArrowRight size={15} /></button>
            <button className="demo-btn-outline" onClick={() => scrollTo('try')}>免費自行體驗</button>
          </div>
          <div className="demo-hero-stats">
            <div className="demo-stat-item"><strong style={{ color: '#7c3aed' }}>5</strong><span>解決方案包</span></div>
            <div className="demo-stat-item"><strong style={{ color: '#059669' }}>{c0}</strong><span>大模組自由選配</span></div>
            <div className="demo-stat-item"><strong style={{ color: '#d97706' }}>4 週</strong><span>快速導入上線</span></div>
            <div className="demo-stat-item"><strong style={{ color: '#2563eb' }}>不限</strong><span>使用人數</span></div>
          </div>
        </div>
      </section>

      {/* ═══ Pain Points ═══ */}
      <Section>
        <div className="demo-container">
          <div className="demo-sh">
            <h2>這些問題，聽起來熟悉嗎？</h2>
            <p>如果你中了 3 項以上，是時候考慮數位化了</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, maxWidth: 1000, margin: '0 auto' }}>
            {[
              { emoji: '📋', pain: '員工打卡用紙本，月底人資手動算出勤', cost: '每月浪費 40+ 小時', solution: 'LINE GPS 打卡 → 自動統計' },
              { emoji: '📊', pain: '排班用 Excel，改一個人要調半天', cost: '每週花 3-5 小時排班', solution: 'AI 一鍵排班 + 勞基法自動檢查' },
              { emoji: '💰', pain: '薪資用計算機，怕算錯又怕漏', cost: '每月 2-3 天算薪', solution: '自動拉出勤 + 加班 + 請假計算' },
              { emoji: '📦', pain: '庫存靠記憶，賣完才知道沒貨', cost: '缺貨損失 5-10% 營收', solution: '即時庫存 + 安全量自動補貨' },
              { emoji: '📱', pain: '請假要填紙本，主管不在就卡住', cost: '審核平均等 2-3 天', solution: 'LINE 即時送簽 → 秒核' },
              { emoji: '🔄', pain: '開新店流程混亂，總是漏東漏西', cost: '開店延誤 2-4 週', solution: 'SOP 範本 + 任務追蹤 + 進度透明' },
              { emoji: '🧾', pain: '對帳要翻三本帳，月結拖到下個月', cost: '財務作業遲延', solution: '進銷存自動拋轉 + 一鍵對帳' },
              { emoji: '📞', pain: '系統七八套，資料不互通', cost: '重複輸入 + 資料不一致', solution: '一套系統 + 跨模組自動串接' },
              { emoji: '😰', pain: '老闆要報表，要等會計整理三天', cost: '決策延遲', solution: '即時儀表板 + AI 洞察' },
            ].map((item, i) => (
              <div key={i} style={{
                padding: 20, borderRadius: 14,
                background: 'var(--bg-card, #fff)',
                border: '1px solid var(--border-medium, #e2e8f0)',
                transition: 'transform 0.2s, box-shadow 0.2s',
              }}>
                <div style={{ fontSize: 28, marginBottom: 10 }}>{item.emoji}</div>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6, lineHeight: 1.4 }}>{item.pain}</div>
                <div style={{ fontSize: 12, color: '#ef4444', fontWeight: 600, marginBottom: 10 }}>💸 {item.cost}</div>
                <div style={{
                  fontSize: 12, padding: '6px 10px', borderRadius: 8,
                  background: 'rgba(6,182,212,0.08)', color: '#0891b2',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  <Check size={13} /> {item.solution}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ═══ Hot Module Spotlight ═══ */}
      <Section dark>
        <div className="demo-container">
          <div className="demo-sh">
            <h2>🔥 不知道從哪裡開始？</h2>
            <p>最受歡迎的模組，超過 80% 客戶首選導入</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20, maxWidth: 900, margin: '0 auto' }}>
            {[
              { icon: Smartphone, name: 'LINE 行動辦公', desc: '員工用 LINE 就能打卡、查薪資、請假、回報任務。零學習成本，開通即用。', color: '#06b6d4' },
              { icon: Clock, name: 'AI 智慧排班', desc: '一鍵自動排班，15 條勞基法自動檢查。找人代班、換班申請全自動化。', color: '#7c3aed' },
              { icon: GitBranch, name: 'AI 流程助手', desc: '用自然語言描述需求，AI 自動生成 SOP 流程。任務追蹤 + LINE 即時通知。', color: '#2563eb' },
            ].map((item, i) => {
              const Icon = item.icon
              return (
                <div key={i} style={{
                  padding: 24, borderRadius: 16,
                  background: 'var(--bg-card, #fff)', border: '1px solid var(--border-medium, #e2e8f0)',
                  textAlign: 'center',
                }}>
                  <div style={{ width: 56, height: 56, borderRadius: 14, background: item.color + '15', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
                    <Icon size={26} style={{ color: item.color }} />
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 8 }}>{item.name}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary, #64748b)', lineHeight: 1.6 }}>{item.desc}</div>
                  <div style={{ marginTop: 12, padding: '4px 12px', borderRadius: 20, background: item.color + '15', color: item.color, fontSize: 11, fontWeight: 700, display: 'inline-block' }}>可單獨導入</div>
                </div>
              )
            })}
          </div>
        </div>
      </Section>

      {/* ═══ Solution Bundles ═══ */}
      <Section id="bundles">
        <div className="demo-container">
          <div className="demo-sh">
            <h2>解決方案包</h2>
            <p>依需求選擇方案包，或自由組合單一模組</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
            {SOLUTION_BUNDLES.map(bundle => {
              const Icon = bundle.icon
              return (
                <div key={bundle.id} style={{
                  padding: 24, borderRadius: 16, position: 'relative',
                  background: 'var(--bg-card, #fff)', border: `2px solid ${bundle.popular ? bundle.color : 'var(--border-medium, #e2e8f0)'}`,
                }}>
                  {bundle.popular && (
                    <div style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', padding: '4px 16px', borderRadius: 20, background: bundle.color, color: '#fff', fontSize: 11, fontWeight: 700 }}>
                      <Star size={12} style={{ verticalAlign: -1 }} /> 最受歡迎
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: bundle.color + '15', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon size={20} style={{ color: bundle.color }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 17, fontWeight: 800 }}>{bundle.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary, #64748b)' }}>{bundle.tagline}</div>
                    </div>
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    {bundle.features.map((f, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '4px 0', color: 'var(--text-primary, #1e293b)' }}>
                        <Check size={14} style={{ color: bundle.color, flexShrink: 0 }} /> {f}
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted, #94a3b8)', marginBottom: 12 }}>
                    包含：{bundle.modules.join(' · ')}
                  </div>
                  <button onClick={() => scrollTo('contact')} style={{
                    width: '100%', padding: '10px', borderRadius: 10,
                    background: bundle.popular ? bundle.color : 'transparent',
                    color: bundle.popular ? '#fff' : bundle.color,
                    border: `2px solid ${bundle.color}`,
                    fontSize: 14, fontWeight: 700, cursor: 'pointer',
                  }}>
                    了解方案 <ArrowRight size={14} style={{ verticalAlign: -2 }} />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </Section>

      {/* ═══ LINE Integration ═══ */}
      <Section id="line" dark>
        <div className="demo-container">
          <div className="demo-sh">
            <h2>LINE 行動辦公整合</h2>
            <p>無需額外安裝 App，員工透過 LINE 即可完成日常營運操作</p>
          </div>
          <DemoLineSection />
        </div>
      </Section>

      {/* ═══ Implementation Timeline ═══ */}
      <Section id="timeline" dark>
        <div className="demo-container">
          <div className="demo-sh">
            <h2>4 週快速導入</h2>
            <p>從需求訪談到正式上線，一個月內完成</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, maxWidth: 900, margin: '0 auto' }}>
            {TIMELINE.map((t, i) => (
              <div key={i} style={{
                textAlign: 'center', padding: 20, borderRadius: 14,
                background: 'var(--bg-card, #fff)', border: '1px solid var(--border-medium, #e2e8f0)',
                position: 'relative',
              }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>{t.icon}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#06b6d4', marginBottom: 4 }}>{t.week}</div>
                <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>{t.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary, #64748b)', lineHeight: 1.5 }}>{t.desc}</div>
                {i < 3 && <div style={{ position: 'absolute', right: -12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted, #94a3b8)', fontSize: 18 }}>→</div>}
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ═══ Comparison ═══ */}
      <Section>
        <div className="demo-container">
          <div className="demo-sh">
            <h2>跟傳統 ERP 有什麼不同？</h2>
          </div>
          <div style={{ maxWidth: 700, margin: '0 auto', borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border-medium, #e2e8f0)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ background: 'var(--bg-secondary, #f8fafc)' }}>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600 }}>比較項目</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 700, color: '#06b6d4' }}>SME Ops</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 600, color: '#94a3b8' }}>傳統 ERP</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((row, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border-subtle, #f1f5f9)' }}>
                    <td style={{ padding: '10px 16px', fontWeight: 500 }}>{row.item}</td>
                    <td style={{ padding: '10px 16px', textAlign: 'center', fontWeight: 700, color: '#059669' }}>{row.us}</td>
                    <td style={{ padding: '10px 16px', textAlign: 'center', color: '#94a3b8' }}>{row.them}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Section>

      {/* ═══ Try It ═══ */}
      <Section id="try" dark>
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
                  <div className="demo-sys-tile-icon"><Icon size={20} strokeWidth={1.8} /></div>
                  <div className="demo-sys-tile-info">
                    <span className="demo-sys-tile-name">{sys.title}</span>
                  </div>
                  <ArrowUpRight size={14} className="demo-sys-tile-arrow" />
                </button>
              )
            })}
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
            <button className="demo-btn-solid" onClick={() => scrollTo('contact')}>預約免費營運診斷 <ArrowRight size={15} /></button>
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
          <DemoContactSection inquiry={inquiry} setInquiry={setInquiry} inquiryStatus={inquiryStatus} onSubmit={handleSubmit} toggleModule={toggleModule} />
        </div>
      </Section>

      {/* ═══ Footer ═══ */}
      <footer className="demo-footer">
        <div className="demo-footer-inner">
          <div className="demo-footer-brand">
            <div className="demo-nav-logo">S</div>
            <span>SME OPS — 按需選購，隨需擴充</span>
          </div>
          <span>專為台灣中小企業打造</span>
        </div>
      </footer>
    </div>
  )
}
