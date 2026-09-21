import { useState, useMemo } from 'react'
import {
  Shield, Search, RefreshCw, Download, Filter, Sparkles,
  ChevronLeft, ChevronRight, X, Clock, DollarSign, Cpu, Zap, Target
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'

// Known model pricing (USD per 1K tokens) — input/output rates
const MODEL_PRICING = {
  'claude-opus-4-7':        { in: 0.015,   out: 0.075,  color: '#a855f7' },
  'claude-sonnet-4-6':      { in: 0.003,   out: 0.015,  color: '#3b82f6' },
  'claude-haiku-4-5':       { in: 0.0008,  out: 0.004,  color: '#22d3ee' },
  'gpt-4o':                 { in: 0.0025,  out: 0.01,   color: '#10b981' },
  'gpt-4o-mini':            { in: 0.00015, out: 0.0006, color: '#84cc16' },
  'gemini-2.5-pro':         { in: 0.00125, out: 0.005,  color: '#f59e0b' },
  'gemini-2.5-flash':       { in: 0.0003,  out: 0.0025, color: '#fb923c' },
}

const PURPOSES = [
  'HR AI 助理', '離職預測', 'AI 庫存管理', 'Agent 控制台',
  '銷售預測', '異常偵測', '說明中心', 'Drip Campaign', '教學中心', '跨系統分析',
]

// ── Demo data generator (deterministic) ──────────────────────
function seedRandom(seed) {
  let s = seed
  return () => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280
  }
}

function generateDemoUsage() {
  const rand = seedRandom(42)
  const models = Object.keys(MODEL_PRICING)
  const users = ['admin@astro.tw', 'manager@astro.tw', 'hr@astro.tw', 'sales@astro.tw', 'ops@astro.tw']
  const rows = []
  const now = Date.now()
  for (let i = 0; i < 180; i++) {
    const model = models[Math.floor(rand() * models.length)]
    const purpose = PURPOSES[Math.floor(rand() * PURPOSES.length)]
    const user = users[Math.floor(rand() * users.length)]
    const inTokens = Math.floor(rand() * 8000) + 200
    const outTokens = Math.floor(rand() * 2500) + 50
    const pricing = MODEL_PRICING[model]
    const cost = (inTokens / 1000) * pricing.in + (outTokens / 1000) * pricing.out
    const ageMs = rand() * 1000 * 60 * 60 * 24 * 30 // last 30 days
    rows.push({
      id: i + 1,
      created_at: new Date(now - ageMs).toISOString(),
      model,
      purpose,
      user,
      input_tokens: inTokens,
      output_tokens: outTokens,
      total_tokens: inTokens + outTokens,
      cost_usd: cost,
      latency_ms: Math.floor(rand() * 3000) + 200,
    })
  }
  return rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
}

const DEMO_ROWS = generateDemoUsage()
const PAGE_SIZE = 25

function formatTime(ts) {
  if (!ts) return '-'
  const d = new Date(ts)
  return d.toLocaleString('zh-TW', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  })
}

function formatCost(c) {
  if (c < 0.01) return `$${c.toFixed(4)}`
  if (c < 1) return `$${c.toFixed(3)}`
  return `$${c.toFixed(2)}`
}

function formatTokens(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(2)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(n)
}

export default function AIUsage() {
  const { hasPermission } = useAuth()
  const isSuperAdmin = hasPermission('nav.group.super_admin')
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState({ model: '', purpose: '', user: '', from: '', to: '' })

  const allModels = Object.keys(MODEL_PRICING)
  const allUsers = useMemo(() => [...new Set(DEMO_ROWS.map(r => r.user))], [])

  // Apply filters
  const filtered = useMemo(() => {
    return DEMO_ROWS.filter(r => {
      if (filters.model && r.model !== filters.model) return false
      if (filters.purpose && r.purpose !== filters.purpose) return false
      if (filters.user && r.user !== filters.user) return false
      if (filters.from && new Date(r.created_at) < new Date(filters.from)) return false
      if (filters.to && new Date(r.created_at) > new Date(filters.to + 'T23:59:59')) return false
      if (search) {
        const s = search.toLowerCase()
        const hay = `${r.model} ${r.purpose} ${r.user}`.toLowerCase()
        if (!hay.includes(s)) return false
      }
      return true
    })
  }, [filters, search])

  // Aggregates
  const stats = useMemo(() => {
    const totalTokens = filtered.reduce((s, r) => s + r.total_tokens, 0)
    const totalCost = filtered.reduce((s, r) => s + r.cost_usd, 0)
    const avgLatency = filtered.length
      ? filtered.reduce((s, r) => s + r.latency_ms, 0) / filtered.length
      : 0
    return {
      requests: filtered.length,
      totalTokens,
      totalCost,
      avgLatency: Math.round(avgLatency),
    }
  }, [filtered])

  // By-model breakdown
  const byModel = useMemo(() => {
    const acc = {}
    for (const r of filtered) {
      if (!acc[r.model]) acc[r.model] = { requests: 0, tokens: 0, cost: 0 }
      acc[r.model].requests += 1
      acc[r.model].tokens += r.total_tokens
      acc[r.model].cost += r.cost_usd
    }
    return Object.entries(acc)
      .map(([model, v]) => ({ model, ...v }))
      .sort((a, b) => b.cost - a.cost)
  }, [filtered])

  const maxCost = Math.max(1, ...byModel.map(m => m.cost))

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const activeFilterCount = Object.values(filters).filter(Boolean).length

  const resetFilters = () => {
    setFilters({ model: '', purpose: '', user: '', from: '', to: '' })
    setPage(0)
  }

  const exportCSV = () => {
    const header = '時間,模型,用途,使用者,Input Tokens,Output Tokens,Total Tokens,Cost (USD),Latency (ms)'
    const rows = filtered.map(r =>
      `"${new Date(r.created_at).toLocaleString('zh-TW')}","${r.model}","${r.purpose}","${r.user}",${r.input_tokens},${r.output_tokens},${r.total_tokens},${r.cost_usd.toFixed(6)},${r.latency_ms}`
    )
    const blob = new Blob(['\ufeff' + header + '\n' + rows.join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `ai-usage-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  if (!isSuperAdmin) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', flexDirection: 'column', gap: 12 }}>
        <Shield size={48} style={{ color: 'var(--accent-red)' }} />
        <h2>超級管理員專屬</h2>
        <p style={{ color: 'var(--text-secondary)' }}>此頁面僅限超級管理員存取</p>
      </div>
    )
  }

  return (
    <div className="fade-in">
      {/* Header */}
      <div className="page-header">
        <div>
          <h2><Sparkles size={22} style={{ marginRight: 8, color: '#a855f7' }} />AI 使用量</h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
            跨組織 AI 模型調用追蹤 — 時間、模型、用途、Token、成本
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={exportCSV}><Download size={15} /> 匯出 CSV</button>
          <button className="btn btn-secondary" onClick={() => { setPage(0) }}><RefreshCw size={15} /> 重新整理</button>
        </div>
      </div>

      {/* Stats */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 16 }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-value">{stats.requests.toLocaleString()}</div>
          <div className="stat-card-label"><Zap size={11} style={{ marginRight: 3, verticalAlign: -1 }} />總請求數</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-value" style={{ color: '#7c3aed' }}>{formatTokens(stats.totalTokens)}</div>
          <div className="stat-card-label"><Cpu size={11} style={{ marginRight: 3, verticalAlign: -1 }} />總 Tokens</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-value" style={{ color: '#10b981' }}>{formatCost(stats.totalCost)}</div>
          <div className="stat-card-label"><DollarSign size={11} style={{ marginRight: 3, verticalAlign: -1 }} />總成本 (USD)</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-value" style={{ color: '#f59e0b' }}>{stats.avgLatency} ms</div>
          <div className="stat-card-label"><Target size={11} style={{ marginRight: 3, verticalAlign: -1 }} />平均延遲</div>
        </div>
      </div>

      {/* By-model breakdown */}
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>模型成本分布</h3>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>依 cost 排序</span>
        </div>
        {byModel.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-secondary)', fontSize: 13 }}>無資料</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {byModel.map(m => {
              const pct = (m.cost / maxCost) * 100
              const color = MODEL_PRICING[m.model]?.color || '#6b7280'
              return (
                <div key={m.model} style={{ display: 'grid', gridTemplateColumns: '180px 1fr 100px 90px', gap: 12, alignItems: 'center', fontSize: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
                    <code style={{ fontSize: 11 }}>{m.model}</code>
                  </div>
                  <div style={{ background: 'var(--bg-secondary)', borderRadius: 6, height: 10, overflow: 'hidden', position: 'relative' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 6, transition: 'width 0.3s' }} />
                  </div>
                  <span style={{ color: 'var(--text-secondary)', textAlign: 'right' }}>{formatTokens(m.tokens)} tok</span>
                  <span style={{ fontWeight: 600, textAlign: 'right', color: '#10b981' }}>{formatCost(m.cost)}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
          <input
            className="form-input"
            placeholder="搜尋模型、用途、使用者..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0) }}
            style={{ paddingLeft: 32, width: '100%' }}
          />
        </div>
        <button className={`btn ${showFilters ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setShowFilters(!showFilters)}>
          <Filter size={14} /> 篩選{activeFilterCount > 0 && ` (${activeFilterCount})`}
        </button>
        {activeFilterCount > 0 && (
          <button className="btn btn-secondary" onClick={resetFilters}><X size={14} /> 清除篩選</button>
        )}
      </div>

      {/* Filter Panel */}
      {showFilters && (
        <div className="card" style={{ padding: 16, marginBottom: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>模型</label>
            <select className="form-input" value={filters.model} onChange={e => { setFilters(f => ({ ...f, model: e.target.value })); setPage(0) }}>
              <option value="">全部模型</option>
              {allModels.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>用途</label>
            <select className="form-input" value={filters.purpose} onChange={e => { setFilters(f => ({ ...f, purpose: e.target.value })); setPage(0) }}>
              <option value="">全部用途</option>
              {PURPOSES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>使用者</label>
            <select className="form-input" value={filters.user} onChange={e => { setFilters(f => ({ ...f, user: e.target.value })); setPage(0) }}>
              <option value="">全部</option>
              {allUsers.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>開始日期</label>
            <input className="form-input" type="date" value={filters.from} onChange={e => { setFilters(f => ({ ...f, from: e.target.value })); setPage(0) }} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>結束日期</label>
            <input className="form-input" type="date" value={filters.to} onChange={e => { setFilters(f => ({ ...f, to: e.target.value })); setPage(0) }} />
          </div>
        </div>
      )}

      {/* Table */}
      <div className="card" style={{ overflow: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 160 }}>日期 / 時間</th>
              <th style={{ width: 180 }}>模型</th>
              <th style={{ width: 140 }}>用途</th>
              <th style={{ width: 150 }}>使用者</th>
              <th style={{ width: 180 }}>Tokens (in / out)</th>
              <th style={{ width: 100, textAlign: 'right' }}>成本 (USD)</th>
              <th style={{ width: 90, textAlign: 'right' }}>延遲</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>無符合條件的 AI 使用紀錄</td></tr>
            ) : pageRows.map(r => {
              const color = MODEL_PRICING[r.model]?.color || '#6b7280'
              return (
                <tr key={r.id}>
                  <td>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                      <Clock size={12} style={{ color: 'var(--text-secondary)' }} />
                      {formatTime(r.created_at)}
                    </span>
                  </td>
                  <td>
                    <span className="badge" style={{ background: color + '22', color, fontFamily: 'monospace', fontSize: 11 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block', marginRight: 5 }} />
                      {r.model}
                    </span>
                  </td>
                  <td style={{ fontSize: 13 }}>{r.purpose}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{r.user}</td>
                  <td style={{ fontSize: 12 }}>
                    <span style={{ color: '#3b82f6' }}>{formatTokens(r.input_tokens)}</span>
                    <span style={{ color: 'var(--text-muted)', margin: '0 6px' }}>/</span>
                    <span style={{ color: '#8b5cf6' }}>{formatTokens(r.output_tokens)}</span>
                    <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>= {formatTokens(r.total_tokens)}</span>
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 600, color: '#10b981' }}>{formatCost(r.cost_usd)}</td>
                  <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-secondary)' }}>{r.latency_ms} ms</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            共 {filtered.length} 筆，第 {page + 1} / {totalPages} 頁
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="btn btn-secondary btn-sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft size={14} /> 上一頁
            </button>
            <button className="btn btn-secondary btn-sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
              下一頁 <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
