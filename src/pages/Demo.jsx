import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'

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

const MODULES = [
  {
    icon: '👥',
    title: '人資管理',
    color: 'var(--accent-cyan)',
    dim: 'var(--accent-cyan-dim)',
    features: ['打卡追蹤', '請假 / 加班審核', '薪資計算與獎金', '績效考核', '招募管理', '差旅費核銷(驗收)'],
    tag: 'HR',
  },
  {
    icon: '🤝',
    title: 'CRM 客戶管理',
    color: 'var(--accent-blue)',
    dim: 'var(--accent-blue-dim)',
    features: ['客戶 360° 檢視', '銷售漏斗追蹤', '行銷自動化', '客服工單', '信用額度警示', '跨分店篩選'],
    tag: 'CRM',
  },
  {
    icon: '📦',
    title: 'WMS 倉儲管理',
    color: 'var(--accent-green)',
    dim: 'var(--accent-green-dim)',
    features: ['進貨 / 出貨管理', '即時庫存盤點', '庫存異動紀錄', 'SKU 品項管理', '倉庫篩選', '即將到期預警'],
    tag: 'WMS',
  },
  {
    icon: '⚙️',
    title: '流程管理',
    color: 'var(--accent-purple)',
    dim: 'var(--accent-purple-dim)',
    features: ['標準作業流程', '任務指派追蹤', '查核清單', '流程進度看板', '部門任務篩選', '優先度管理'],
    tag: 'PROCESS',
  },
  {
    icon: '🏢',
    title: '組織管理',
    color: 'var(--accent-orange)',
    dim: 'var(--accent-orange-dim)',
    features: ['公司 / 分店管理', '部門架構', '員工資料庫', '組織圖', 'LINE 整合', '通知範本'],
    tag: 'ORG',
  },
  {
    icon: '🏆',
    title: '績效獎金',
    color: 'var(--accent-yellow)',
    dim: 'var(--accent-yellow-dim)',
    features: ['業務獎金自動計算', '倉管績效評分', '跨部門合戰', 'CRM 數據連動', 'WMS 數據連動', '獎金發放紀錄'],
    tag: 'BONUS',
  },
  {
    icon: '🤖',
    title: 'AI 工具',
    color: 'var(--accent-pink)',
    dim: 'var(--accent-pink-dim)',
    features: ['AI 助理問答', '流程建議', '數據分析輔助', '異常預警解讀', '自動化規則推薦', '智慧報表摘要'],
    tag: 'AI',
  },
  {
    icon: '🔐',
    title: '員工 Portal',
    color: '#34d399',
    dim: 'rgba(52,211,153,0.12)',
    features: ['自助打卡', '我的假單', '申請與核銷(驗收)', '差旅申報', '績效自評', '個人行事曆'],
    tag: 'PORTAL',
  },
]

const INTEGRATIONS = [
  { from: 'CRM', to: 'WMS', desc: '出貨單自動帶入客戶信用額度警示', icon: '⚡' },
  { from: 'WMS', to: 'CRM', desc: '客戶頁顯示最新出貨紀錄與狀態', icon: '🔗' },
  { from: 'CRM', to: '獎金', desc: '業務獎金直接抓 CRM 成交數據', icon: '🏆' },
  { from: 'WMS', to: '獎金', desc: '倉管績效串接出貨量與錯誤率', icon: '📊' },
  { from: '組織', to: '全模組', desc: '員工、部門資料統一來源、全系統同步', icon: '🏢' },
  { from: 'HR', to: '薪資', desc: '事假/遲到自動連動薪資扣款明細', icon: '💰' },
]

const STATS = [
  { label: '功能模組', value: 8, suffix: '' },
  { label: '功能頁面', value: 50, suffix: '+' },
  { label: '跨模組整合', value: 6, suffix: '項' },
  { label: '資料表串接', value: 30, suffix: '+' },
]

export default function Demo() {
  const navigate = useNavigate()
  const [visible, setVisible] = useState(false)
  const [activeModule, setActiveModule] = useState(null)
  const heroRef = useRef(null)

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
      minHeight: '100vh',
      background: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      fontFamily: "'Inter', 'Noto Sans TC', sans-serif",
      overflowX: 'hidden',
    }}>

      {/* ── Navbar ── */}
      <nav style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 40px', height: 64,
        background: 'rgba(6, 9, 26, 0.85)',
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
          <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.3px' }}>SME OPS</span>
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

      {/* ── Hero ── */}
      <section ref={heroRef} style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '120px 40px 80px',
        position: 'relative', overflow: 'hidden',
      }}>
        {/* Background glow orbs */}
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

        {/* Badge */}
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

        {/* Title */}
        <h1 style={{
          fontSize: 'clamp(36px, 6vw, 72px)',
          fontWeight: 800, lineHeight: 1.1, textAlign: 'center',
          margin: '0 0 20px',
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0)' : 'translateY(24px)',
          transition: 'all 0.7s ease 0.1s',
        }}>
          <span style={{ background: 'linear-gradient(135deg, #fff 0%, #94a3b8 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
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

        {/* CTA */}
        <div style={{
          display: 'flex', gap: 12,
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0)' : 'translateY(16px)',
          transition: 'all 0.7s ease 0.3s',
        }}>
          <button
            onClick={() => navigate('/')}
            style={{
              padding: '13px 32px', borderRadius: 12, border: 'none',
              background: 'linear-gradient(135deg, var(--accent-cyan), #3b82f6)',
              color: '#fff', fontSize: 15, fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 0 30px rgba(34,211,238,0.25)',
            }}
          >
            立即體驗系統 →
          </button>
          <button
            onClick={() => document.getElementById('modules').scrollIntoView({ behavior: 'smooth' })}
            style={{
              padding: '13px 32px', borderRadius: 12,
              background: 'var(--glass-medium)', border: '1px solid var(--border-medium)',
              color: 'var(--text-secondary)', fontSize: 15, fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            了解功能
          </button>
        </div>

        {/* Stats */}
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

      {/* ── Modules ── */}
      <section id="modules" style={{ padding: '80px 40px', maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 52 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-cyan)', letterSpacing: '2px', marginBottom: 12 }}>MODULES</div>
          <h2 style={{ fontSize: 36, fontWeight: 800, margin: 0 }}>8 大核心模組</h2>
          <p style={{ color: 'var(--text-secondary)', marginTop: 12, fontSize: 15 }}>覆蓋企業日常營運所有面向，模組間資料全面互通</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {MODULES.map((m, i) => (
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
                }}>
                  {m.icon}
                </div>
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

      {/* ── Integration ── */}
      <section style={{ padding: '80px 40px', background: 'var(--bg-secondary)' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 52 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-purple)', letterSpacing: '2px', marginBottom: 12 }}>INTEGRATION</div>
            <h2 style={{ fontSize: 36, fontWeight: 800, margin: 0 }}>模組間深度整合</h2>
            <p style={{ color: 'var(--text-secondary)', marginTop: 12, fontSize: 15 }}>資料不再孤立，各系統即時互通，讓決策更即時、獎金更透明</p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
            {INTEGRATIONS.map((item, i) => (
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

      {/* ── Feature Highlights ── */}
      <section style={{ padding: '80px 40px', maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 52 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-green)', letterSpacing: '2px', marginBottom: 12 }}>HIGHLIGHTS</div>
          <h2 style={{ fontSize: 36, fontWeight: 800, margin: 0 }}>核心設計理念</h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
          {[
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
          ].map((item, i) => (
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

      {/* ── CTA ── */}
      <section style={{
        padding: '100px 40px',
        background: 'linear-gradient(180deg, var(--bg-secondary) 0%, var(--bg-primary) 100%)',
        textAlign: 'center',
      }}>
        <div style={{
          display: 'inline-block', padding: '6px 16px', borderRadius: 999,
          background: 'var(--accent-green-dim)', border: '1px solid rgba(52,211,153,0.25)',
          fontSize: 12, fontWeight: 600, color: 'var(--accent-green)', marginBottom: 24,
        }}>
          準備好了嗎？
        </div>
        <h2 style={{ fontSize: 42, fontWeight: 800, margin: '0 0 16px' }}>
          開始讓系統幫你管公司
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 16, marginBottom: 40, maxWidth: 480, margin: '0 auto 40px' }}>
          登入後即可使用所有功能，資料即時同步，多人協作無衝突。
        </p>
        <button
          onClick={() => navigate('/')}
          style={{
            padding: '16px 48px', borderRadius: 14, border: 'none',
            background: 'linear-gradient(135deg, var(--accent-cyan), #3b82f6, var(--accent-purple))',
            color: '#fff', fontSize: 16, fontWeight: 700,
            cursor: 'pointer',
            boxShadow: '0 0 40px rgba(34,211,238,0.2), 0 0 80px rgba(167,139,250,0.1)',
          }}
        >
          進入 SME OPS 系統 →
        </button>
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
          <span>SME OPS — 企業營運管理系統</span>
        </div>
        <div>Built with React + Supabase</div>
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
