/*
 * SME Ops — Public showcase (/showcase)
 * Focus: 三大核心模組 — 人力資源 (HRM) · 營運儀表板 (Dashboard) · 專案與簽核流程 (Project/Workflow)
 * Real product screenshots live in /public/demo-shots/ (captured from the seeded demo org).
 * Design language reuses the existing `lp-*` light-premium system in src/index.css.
 */

import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  Users, CalendarClock, Fingerprint, Wallet, Brain, ShieldCheck, MessageSquare,
  LayoutDashboard, Sparkles, TrendingUp, BellRing, Network,
  GitBranch, KanbanSquare, FileCheck2, Workflow, Repeat2, Boxes,
  ArrowRight, Check, Sun, Moon, Zap,
} from 'lucide-react'

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

function Section({ children, id, className = '' }) {
  const [ref, inView] = useInView()
  return (
    <section ref={ref} id={id} className={`lp-section ${inView ? 'lp-visible' : ''} ${className}`}>
      {children}
    </section>
  )
}

function AnimatedHeading({ text, highlight, delay = 0 }) {
  const words = text.split(' ')
  return (
    <h1 className="lp-hero-h1">
      {words.map((word, i) => (
        <span key={i} className="lp-word" style={{ animationDelay: `${delay + i * 80}ms` }}>{word}{' '}</span>
      ))}
      {highlight && (
        <strong className="lp-hero-highlight">
          {highlight.split(' ').map((word, i) => (
            <span key={i} className="lp-word" style={{ animationDelay: `${delay + (words.length + i) * 80}ms` }}>{word}{' '}</span>
          ))}
        </strong>
      )}
    </h1>
  )
}

// Browser-chrome framed screenshot
function Shot({ src, alt, caption }) {
  return (
    <figure className="lp-shot">
      <div className="lp-shot-bar">
        <span className="lp-shot-dot" style={{ background: '#ff5f57' }} />
        <span className="lp-shot-dot" style={{ background: '#febc2e' }} />
        <span className="lp-shot-dot" style={{ background: '#28c840' }} />
      </div>
      <img src={src} alt={alt} loading="lazy" />
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  )
}

// ════════════════════════════════════════════════════════════════════
//  DATA
// ════════════════════════════════════════════════════════════════════

const PAIN_POINTS = [
  { emoji: '💣', pain: '每月算薪像拆炸彈', cost: '加班倍率、勞健保級距、二代健保、法扣，算錯就被檢舉', mod: '人資' },
  { emoji: '🌙', pain: '排班排到半夜', cost: '誰不能連上七天、誰只排早班、國定假日誰加倍', mod: '人資' },
  { emoji: '🚪', pain: '員工說走就走', cost: '等發現關鍵店員要離職，已經來不及找人', mod: '人資' },
  { emoji: '🗂️', pain: '沒有一個地方看完公司', cost: '營收、應收、庫存、出勤散在 5 個系統與 Excel', mod: '儀表板' },
  { emoji: '⏰', pain: '問題總是太晚發現', cost: '逾期應收、缺貨、簽核卡關，出事才知道', mod: '儀表板' },
  { emoji: '🔀', pain: '開新店一片混亂', cost: '事情老是漏掉；主管請假，簽核就卡住', mod: '流程' },
]

const MODULES = [
  {
    id: 'hr',
    kicker: '人力資源 HRM',
    color: '#7c3aed',
    icon: Users,
    title: '人資、排班、薪資，一次到位',
    lead: '從 GPS 打卡到台灣勞基法薪資，AI 幫你排班、預測離職 — 把 HR 從每月拆炸彈，變成一次審核。',
    shot: { src: '/demo-shots/hr-schedule.png', alt: 'AI 智慧排班畫面', caption: 'AI 智慧排班 — 一鍵排班、自動檢查勞基法違規' },
    features: [
      { icon: CalendarClock, t: 'AI 智慧排班', d: 'Gemini 產生班表草稿，勞基法規則自動檢查，違規一鍵修正，還能找人代班。' },
      { icon: Fingerprint, t: 'GPS + WiFi 打卡', d: '定位與 IP 雙重驗證杜絕代打卡，月結核對報表自動比對排班與實打卡。' },
      { icon: Wallet, t: '台灣薪資全合規', d: '加班費倍率、勞健保級距、二代健保補充保費、資遣費 §11/§13、法扣全自動計算。' },
      { icon: Brain, t: 'AI 離職預測', d: '從出勤、績效、薪資、滿意度七大因子評分，關鍵員工離職前先預警。' },
      { icon: MessageSquare, t: 'HR AI 助理', d: '用自然語言問「近 30 天遲到最多是誰」，立即回傳表格與圖表。' },
    ],
  },
  {
    id: 'dashboard',
    kicker: '營運儀表板 Dashboard',
    color: '#2563eb',
    icon: LayoutDashboard,
    title: '打開一個畫面，看完整間公司',
    lead: '跨模組即時 KPI、AI 智慧洞察與預警中心，讓你從「出事才知道」變成「提前部署」。',
    shot: { src: '/demo-shots/dashboard.png', alt: '營運儀表板畫面', caption: '角色化營運儀表板 — 團隊出勤、待簽核、警示與 AI 洞察一次看' },
    features: [
      { icon: LayoutDashboard, t: '即時營運儀表板', d: '出勤率、待審核、應收應付、銷售漏斗、庫存警示，跨模組 KPI 即時彙整。' },
      { icon: Sparkles, t: 'AI 智慧洞察 (Gemini)', d: '一鍵讓 Gemini 分析當日營運摘要，回傳 3–5 條可執行的洞察與建議。' },
      { icon: TrendingUp, t: '跨系統深度分析', d: '把銷售×庫存×財務×人資×製造串起來:真實產品毛利、單位人工成本、需求預測。' },
      { icon: BellRing, t: '預警中心', d: '逾期應收、低庫存、簽核卡關、證件到期，含「未來 7 天」預測警示，每天早上一次看完。' },
      { icon: Network, t: '角色化與自訂', d: '老闆、店長、HR 各有專屬儀表板，也能拖拉自訂 KPI 卡片。' },
    ],
  },
  {
    id: 'process',
    kicker: '專案與簽核流程 Workflow',
    color: '#059669',
    icon: GitBranch,
    title: 'SOP、任務、簽核，全都跑得動',
    lead: '用一句話讓 AI 生成 SOP,一鍵部署整個展店專案,任務、簽核、代理全自動,沒有事情會漏掉。',
    shot: { src: '/demo-shots/tasks.png', alt: '任務看板畫面', caption: '任務管理 — 看板/時程/泳道/月曆/工作量 6 種視圖' },
    features: [
      { icon: KanbanSquare, t: '6 視圖任務板', d: '列表、看板、泳道、月曆、時程 (含相依甘特圖) 與工作量,一份任務多種看法。' },
      { icon: Workflow, t: 'AI SOP 生成', d: '打字或用說的描述需求,Gemini 自動生成流程步驟,逐步確認後直接部署。' },
      { icon: Boxes, t: '展店一鍵部署', d: '選好範本 → 自動建立整個專案的所有任務、指派對的人、排定期限、LINE 通知。' },
      { icon: FileCheck2, t: '多關卡簽核', d: '並簽/會簽/簽核鏈、條件分支、金額分流,直屬主管與店長自動解析。' },
      { icon: Repeat2, t: '簽核代理不卡關', d: '主管請假自動改由代理人簽核;跨部門交辦轉工單,完成自動回填。' },
    ],
  },
]

const GALLERY = [
  { src: '/demo-shots/attrition.png', alt: 'AI 離職預測', t: 'AI 離職預測', d: '員工流失風險評分' },
  { src: '/demo-shots/process-overview.png', alt: '流程總覽', t: '流程總覽', d: '所有簽核與任務即時狀態' },
  { src: '/demo-shots/hr-report.png', alt: 'HR 報表', t: 'HR 報表', d: '人力綜合數據分析' },
]

const AI_POINTS = [
  { icon: CalendarClock, t: 'AI 排班', d: '一鍵產生合規班表' },
  { icon: Brain, t: 'AI 離職預測', d: '關鍵員工先預警' },
  { icon: Sparkles, t: 'AI 營運洞察', d: 'Gemini 分析每日營運' },
  { icon: Workflow, t: 'AI SOP 生成', d: '一句話變成流程' },
  { icon: MessageSquare, t: 'HR AI 助理', d: '自然語言查資料' },
]

const COMPARISON = [
  { item: '導入時間', us: '4 週', them: '3–6 個月' },
  { item: '台灣勞基法薪資', us: '內建自動合規', them: '需大量客製' },
  { item: 'AI 功能', us: '排班 / 離職 / 洞察 / SOP', them: '無' },
  { item: '跨模組即時儀表板', us: '內建', them: '需另購 BI' },
  { item: '使用人數', us: '不限人數', them: '按授權數' },
  { item: '模組選購', us: '自由選配', them: '整包購買' },
]

// ════════════════════════════════════════════════════════════════════
//  MAIN
// ════════════════════════════════════════════════════════════════════

export default function DemoLanding() {
  const navigate = useNavigate()
  const [visible, setVisible] = useState(false)
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-theme') || 'light')
  const [inquiry, setInquiry] = useState({ company_name: '', contact_name: '', phone: '', email: '', company_size: '', interested_modules: [] })
  const [inquiryStatus, setInquiryStatus] = useState(null)
  const [trialEmail, setTrialEmail] = useState('')
  const [trialStatus, setTrialStatus] = useState(null)

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trialEmail)
  const handleTrialSubmit = async () => {
    if (!emailValid) return
    setTrialStatus('sending')
    try {
      await supabase.from('inquiries').insert({ company_name: '免費試用申請', email: trialEmail.trim(), interested_modules: ['免費試用'] })
      setTrialStatus('success')
    } catch { setTrialStatus('error') }
  }

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
  const cModules = useCounter(3, 1200, visible)
  const cLaws = useCounter(15, 1600, visible)
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
            <button onClick={() => scrollTo('pain')}>痛點</button>
            <button onClick={() => scrollTo('hr')}>人資</button>
            <button onClick={() => scrollTo('dashboard')}>儀表板</button>
            <button onClick={() => scrollTo('process')}>專案流程</button>
          </div>
          <div className="lp-nav-actions">
            <button className="lp-nav-theme" onClick={toggleTheme}>{theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}</button>
            <button className="lp-cta-nav" onClick={() => scrollTo('try')}>免費試用 <ArrowRight size={14} /></button>
          </div>
        </div>
      </nav>

      {/* ═══ Hero ═══ */}
      <section id="hero" className="lp-hero">
        <div className="lp-hero-orb lp-hero-orb-1" />
        <div className="lp-hero-orb lp-hero-orb-2" />
        <div className="lp-hero-orb lp-hero-orb-3" />
        <div className="lp-hero-grid" />

        <div className={`lp-hero-content lp-hero-narrow ${visible ? 'lp-visible' : ''}`}>
          <div className="lp-eyebrow"><Zap size={14} /> 人資 · 營運儀表板 · 專案簽核，AI 全整合</div>
          <AnimatedHeading text="讓管理" highlight="像多請了一位營運長" />
          <p className="lp-hero-sub">
            台灣中小企業的數位大腦：AI 排班與薪資合規、跨模組即時儀表板、<br />
            一鍵部署的簽核流程 —— 三大核心，一個系統搞定。
          </p>
          <div className="lp-hero-ctas">
            <button className="lp-cta-primary" onClick={() => scrollTo('try')}>免費開通試用 <ArrowRight size={16} /></button>
            <button className="lp-cta-secondary" onClick={() => scrollTo('contact')}>預約專人導覽</button>
          </div>
          <div className="lp-hero-stats">
            {[
              { value: `${cModules}`, label: '大核心模組', color: '#6366f1' },
              { value: `${cLaws}+`, label: '勞基法自動檢查', color: '#7c3aed' },
              { value: 'Gemini', label: 'AI 全模組驅動', color: '#2563eb' },
              { value: '4 週', label: '快速導入上線', color: '#059669' },
            ].map((s, i) => (
              <div key={i} className="lp-stat"><strong style={{ color: s.color }}>{s.value}</strong><span>{s.label}</span></div>
            ))}
          </div>
        </div>

        <div className={`lp-hero-shot ${visible ? 'lp-visible' : ''}`}>
          <Shot src="/demo-shots/dashboard.png" alt="SME Ops 營運儀表板" />
        </div>
      </section>

      {/* ═══ Pain Points ═══ */}
      <Section id="pain">
        <div className="lp-container">
          <div className="lp-section-header">
            <span className="lp-badge">💡 痛點診斷</span>
            <h2>這些問題，聽起來熟悉嗎？</h2>
            <p>如果你中了 3 項以上，是時候讓系統幫你了</p>
          </div>
          <div className="lp-pain-grid">
            {PAIN_POINTS.map((item, i) => (
              <div key={i} className="lp-pain-card" style={{ animationDelay: `${i * 100}ms` }}>
                <div className="lp-pain-top">
                  <span className="lp-pain-emoji">{item.emoji}</span>
                  <span className="lp-pain-tag">{item.mod}</span>
                </div>
                <div className="lp-pain-text">{item.pain}</div>
                <div className="lp-pain-cost">{item.cost}</div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ═══ Module Sections ═══ */}
      {MODULES.map((m, idx) => {
        const Icon = m.icon
        return (
          <Section key={m.id} id={m.id} className={idx % 2 === 1 ? 'lp-section-alt' : ''}>
            <div className="lp-container">
              <div className={`lp-module ${idx % 2 === 1 ? 'lp-module-rev' : ''}`}>
                <div className="lp-module-media">
                  <Shot src={m.shot.src} alt={m.shot.alt} caption={m.shot.caption} />
                </div>
                <div className="lp-module-body">
                  <div className="lp-module-kicker" style={{ color: m.color, background: `${m.color}14` }}>
                    <Icon size={15} /> {m.kicker}
                  </div>
                  <h2 className="lp-module-title">{m.title}</h2>
                  <p className="lp-module-lead">{m.lead}</p>
                  <ul className="lp-feature-list">
                    {m.features.map((f, j) => {
                      const FIcon = f.icon
                      return (
                        <li key={j}>
                          <span className="lp-feature-ic" style={{ color: m.color, background: `${m.color}12` }}><FIcon size={17} /></span>
                          <span><strong>{f.t}</strong>{f.d}</span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              </div>
            </div>
          </Section>
        )
      })}

      {/* ═══ AI strip ═══ */}
      <Section className="lp-section-alt">
        <div className="lp-container">
          <div className="lp-ai-band">
            <div className="lp-ai-head">
              <span className="lp-badge lp-badge-dark"><Sparkles size={14} /> AI 驅動</span>
              <h2>每個模組，都內建一位 AI 助手</h2>
              <p>由 Google Gemini 驅動，藏在你每天都要做的事情裡</p>
            </div>
            <div className="lp-ai-grid">
              {AI_POINTS.map((a, i) => {
                const AIcon = a.icon
                return (
                  <div key={i} className="lp-ai-card">
                    <div className="lp-ai-ic"><AIcon size={20} /></div>
                    <strong>{a.t}</strong>
                    <span>{a.d}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </Section>

      {/* ═══ Screenshot gallery ═══ */}
      <Section>
        <div className="lp-container">
          <div className="lp-section-header">
            <span className="lp-badge">🖥️ 更多實際畫面</span>
            <h2>這些都是系統實際運作的畫面</h2>
            <p>不是示意圖 —— 每一張都是真實操作截圖</p>
          </div>
          <div className="lp-gallery">
            {GALLERY.map((g, i) => (
              <div key={i} className="lp-gallery-item">
                <Shot src={g.src} alt={g.alt} />
                <div className="lp-gallery-cap"><strong>{g.t}</strong><span>{g.d}</span></div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ═══ Comparison ═══ */}
      <Section className="lp-section-alt">
        <div className="lp-container">
          <div className="lp-section-header">
            <span className="lp-badge"><ShieldCheck size={14} /> 比較</span>
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
                <div className="lp-compare-us"><Check size={14} style={{ flexShrink: 0 }} /> {row.us}</div>
                <div className="lp-compare-them">{row.them}</div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ═══ Free Trial (email capture) ═══ */}
      <Section id="try">
        <div className="lp-container">
          <div className="lp-section-header">
            <span className="lp-badge">🚀 免費試用</span>
            <h2>留下 Email，立即開通試用帳號</h2>
            <p>無需信用卡，專人為您建立體驗環境，一個工作天內開通</p>
          </div>
          <div className="lp-trial">
            {trialStatus === 'success' ? (
              <div className="lp-trial-done">
                <div className="lp-trial-check"><Check size={28} strokeWidth={2.5} /></div>
                <h3>已收到您的申請</h3>
                <p>我們會將試用帳號的開通資訊寄到<br /><strong>{trialEmail}</strong></p>
              </div>
            ) : (
              <>
                <div className="lp-trial-form">
                  <input
                    type="email" placeholder="you@company.com" value={trialEmail}
                    onChange={e => { setTrialEmail(e.target.value); if (trialStatus === 'error') setTrialStatus(null) }}
                    onKeyDown={e => { if (e.key === 'Enter') handleTrialSubmit() }}
                  />
                  <button className="lp-trial-btn" onClick={handleTrialSubmit} disabled={!emailValid || trialStatus === 'sending'}>
                    {trialStatus === 'sending' ? '開通中…' : '開通試用帳號'} <ArrowRight size={16} />
                  </button>
                </div>
                {trialStatus === 'error' && <p className="lp-trial-err">送出失敗，請稍後再試，或使用下方聯繫表單。</p>}
                <p className="lp-trial-note">已經有帳號了？<button className="lp-trial-login" onClick={() => navigate('/login')}>登入</button></p>
              </>
            )}
          </div>
        </div>
      </Section>

      {/* ═══ Contact ═══ */}
      <Section id="contact" className="lp-section-alt">
        <div className="lp-container" style={{ maxWidth: 640 }}>
          <div className="lp-section-header">
            <h2>預約專人導覽</h2>
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
            <span>SME OPS — 人資 · 儀表板 · 專案流程，一個系統搞定</span>
          </div>
          <span>專為台灣中小企業打造</span>
        </div>
      </footer>
    </div>
  )
}
