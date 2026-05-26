import { useState, useEffect } from 'react'
import { CheckCircle, AlertTriangle, Filter, Printer } from 'lucide-react'
import { getBalanceSheetData } from '../../lib/accounting'
import LoadingSpinner from '../../components/LoadingSpinner'

import { fmtNT as fmt } from '../../lib/currency'

export default function BalanceSheet() {
  const [bsData, setBsData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().slice(0, 10))

  const loadData = (date) => {
    setLoading(true)
    setError(null)
    getBalanceSheetData(date).then(data => {
      setBsData(data)
    }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }

  useEffect(() => {
    loadData(asOfDate)
  }, [])

  const handleDateChange = (newDate) => {
    setAsOfDate(newDate)
    loadData(newDate)
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const {
    assets = [],
    liabilities = [],
    equity = [],
    totalAssets = 0,
    totalLiabilities = 0,
    totalEquity = 0,
    balanced = false,
  } = bsData || {}

  const totalLiabilitiesEquity = Math.round((totalLiabilities + totalEquity) * 100) / 100

  const SectionBlock = ({ title, categories, total, color }) => (
    <div style={{ marginBottom: 20 }}>
      <h4 style={{ margin: '0 0 12px', color, fontSize: 15, fontWeight: 700 }}>{title}</h4>
      {categories.length === 0 ? (
        <div style={{ padding: '12px 16px', color: 'var(--text-muted)', fontSize: 13 }}>暫無資料</div>
      ) : categories.map((cat, ci) => (
        <div key={ci} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', padding: '4px 12px', background: 'var(--glass-light)', borderRadius: 4, marginBottom: 4 }}>
            {cat.category}
          </div>
          {cat.items.map((item, ii) => (
            <div key={ii} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 16px', borderBottom: '1px solid var(--border-subtle)', fontSize: 13 }}>
              <span style={{ display: 'flex', gap: 8 }}>
                <span style={{ fontFamily: 'monospace', color: 'var(--text-muted)', fontSize: 12 }}>{item.account_code}</span>
                {item.account_name}
              </span>
              <span style={{ fontFamily: 'monospace' }}>{fmt(item.amount)}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 16px', fontWeight: 600, fontSize: 13, color: 'var(--text-secondary)' }}>
            <span>{cat.category}小計</span>
            <span style={{ fontFamily: 'monospace' }}>{fmt(cat.subtotal)}</span>
          </div>
        </div>
      ))}
      <div style={{ borderTop: '2px solid var(--border-medium)', padding: '10px 12px', display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 15 }}>
        <span>{title}合計</span>
        <span style={{ fontFamily: 'monospace' }}>{fmt(total)}</span>
      </div>
    </div>
  )

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📋</span> 資產負債表 Balance Sheet</h2>
            <p>資產、負債與權益（僅含已過帳傳票）</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Filter size={14} />
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>截止日期</span>
            <input
              type="date"
              value={asOfDate}
              onChange={e => handleDateChange(e.target.value)}
              className="form-input"
              style={{ padding: '6px 12px', fontSize: 13 }}
            />
            <button className="btn btn-secondary" onClick={() => window.print()} style={{ fontSize: 12, padding: '6px 12px' }}>
              <Printer size={14} /> 列印
            </button>
          </div>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
          <div className="stat-card-label">總資產</div>
          <div className="stat-card-value">{fmt(totalAssets)}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">總負債</div>
          <div className="stat-card-value">{fmt(totalLiabilities)}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">權益</div>
          <div className="stat-card-value">{fmt(totalEquity)}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': balanced ? 'var(--accent-green)' : 'var(--accent-red)', '--card-accent-dim': balanced ? 'var(--accent-green-dim)' : 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">平衡狀態</div>
          <div className="stat-card-value" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {balanced
              ? <><CheckCircle size={18} style={{ color: 'var(--accent-green)' }} /> 平衡</>
              : <><AlertTriangle size={18} style={{ color: 'var(--accent-red)' }} /> 不平衡</>
            }
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* Left: Assets */}
        <div className="card" style={{ padding: 24 }}>
          <h3 style={{ margin: '0 0 16px', borderBottom: '2px solid var(--accent-blue)', paddingBottom: 8, color: 'var(--accent-blue)' }}>
            資產 Assets
          </h3>
          <SectionBlock title="資產" categories={assets} total={totalAssets} color="var(--accent-blue)" />
        </div>

        {/* Right: Liabilities + Equity */}
        <div className="card" style={{ padding: 24 }}>
          <h3 style={{ margin: '0 0 16px', borderBottom: '2px solid var(--accent-red)', paddingBottom: 8, color: 'var(--accent-red)' }}>
            負債與權益 Liabilities & Equity
          </h3>
          <SectionBlock title="負債" categories={liabilities} total={totalLiabilities} color="var(--accent-red)" />
          <SectionBlock title="權益" categories={equity} total={totalEquity} color="var(--accent-purple)" />

          <div style={{ borderTop: '3px double var(--border-medium)', padding: '12px 0', display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 16 }}>
            <span>負債及權益合計</span>
            <span style={{ fontFamily: 'monospace' }}>{fmt(totalLiabilitiesEquity)}</span>
          </div>
        </div>
      </div>

      {/* Balance check */}
      <div style={{
        marginTop: 16,
        padding: '12px 16px',
        borderRadius: 8,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 8,
        fontSize: 14,
        fontWeight: 600,
        color: balanced ? 'var(--accent-green)' : 'var(--accent-red)',
        background: balanced ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
        border: `1px solid ${balanced ? 'var(--accent-green)' : 'var(--accent-red)'}`,
      }}>
        {balanced
          ? <><CheckCircle size={16} /> 資產合計 {fmt(totalAssets)} = 負債及權益合計 {fmt(totalLiabilitiesEquity)}</>
          : <><AlertTriangle size={16} /> 資產合計 {fmt(totalAssets)} ≠ 負債及權益合計 {fmt(totalLiabilitiesEquity)}，差額 {fmt(Math.abs(totalAssets - totalLiabilitiesEquity))}</>
        }
      </div>
    </div>
  )
}
