import { useState, useEffect } from 'react'
import { Info } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'

function SectionHeader({ title, subtitle }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>{title}</div>
      {subtitle && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div>}
    </div>
  )
}

function StaticRow({ label, value, accent }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '10px 0', borderBottom: '1px solid var(--border-subtle)',
    }}>
      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontWeight: 700, fontSize: 14, color: accent || 'var(--accent-cyan)' }}>{value}</span>
    </div>
  )
}

function RateTable({ brackets }) {
  if (!brackets.length) return (
    <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
      尚未設定費率級距資料
    </div>
  )
  return (
    <div className="data-table-wrapper">
      <table className="data-table">
        <thead>
          <tr>
            <th>投保薪資級距</th>
            <th>最低月薪</th>
            <th>員工負擔</th>
            <th>雇主負擔</th>
          </tr>
        </thead>
        <tbody>
          {brackets.map((b, i) => (
            <tr key={i}>
              <td style={{ fontWeight: 600 }}>NT$ {Number(b.insured_salary).toLocaleString()}</td>
              <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                {b.min_salary ? `NT$ ${Number(b.min_salary).toLocaleString()} 以上` : '—'}
              </td>
              <td>
                {b.employee_rate != null
                  ? <span style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>{(Number(b.employee_rate) * 100).toFixed(2)}%</span>
                  : '—'}
              </td>
              <td>
                {b.employer_rate != null
                  ? <span style={{ color: 'var(--accent-orange)', fontWeight: 600 }}>{(Number(b.employer_rate) * 100).toFixed(2)}%</span>
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function LaborLawRates() {
  const [laborBrackets, setLaborBrackets] = useState([])
  const [healthBrackets, setHealthBrackets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const fetchRates = async () => {
      try {
        setLoading(true)
        const year = new Date().getFullYear()
        const [laborRes, healthRes] = await Promise.all([
          supabase
            .from('labor_ins_brackets')
            .select('*')
            .eq('year', year)
            .order('insured_salary'),
          supabase
            .from('health_ins_brackets')
            .select('*')
            .eq('year', year)
            .order('insured_salary'),
        ])
        if (laborRes.error) throw laborRes.error
        if (healthRes.error) throw healthRes.error
        setLaborBrackets(laborRes.data || [])
        setHealthBrackets(healthRes.data || [])
      } catch (err) {
        console.error('Failed to load labor law rates:', err)
        setError('費率資料載入失敗，請重新整理頁面')
      } finally {
        setLoading(false)
      }
    }
    fetchRates()
  }, [])

  if (loading) return <LoadingSpinner />
  if (error) return (
    <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}>
      <h3>{error}</h3>
      <button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button>
    </div>
  )

  const currentYear = new Date().getFullYear()

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2>勞動法令費率查詢</h2>
            <p>台灣現行勞健保、基本工資與勞退提繳等法定費率一覽</p>
          </div>
        </div>
      </div>

      {/* Notice bar */}
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '12px 16px',
        background: 'var(--accent-blue-dim)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 10,
        marginBottom: 20,
        fontSize: 13,
        color: 'var(--text-secondary)',
      }}>
        <Info size={16} style={{ color: 'var(--accent-blue)', flexShrink: 0, marginTop: 1 }} />
        費率依法規自動適用，如需更新投保薪資級距請聯繫系統管理員。
      </div>

      {/* Top two static cards side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>

        {/* Section 1: 基本工資 */}
        <div className="card" style={{ padding: 20 }}>
          <SectionHeader title="基本工資" subtitle="2026 年度適用（2026-01-01 生效）" />
          <StaticRow label="月薪基本工資" value="NT$ 29,500" />
          <StaticRow label="時薪基本工資" value="NT$ 196" />
          <StaticRow label="生效日" value="2026-01-01" accent="var(--text-secondary)" />
        </div>

        {/* Section 4: 勞退提繳率 */}
        <div className="card" style={{ padding: 20 }}>
          <SectionHeader title="勞退提繳率" subtitle="勞工退休金條例第14條" />
          <StaticRow label="雇主最低提繳率" value="6%" />
          <StaticRow label="員工可自願提繳" value="0% – 6%" accent="var(--text-secondary)" />
          <div style={{
            marginTop: 12, padding: 10,
            background: 'var(--bg-secondary)', borderRadius: 8,
            fontSize: 12, color: 'var(--text-muted)',
          }}>
            員工自願提繳部分可享個人所得稅優惠，上限為每月工資 6%。
          </div>
        </div>

      </div>

      {/* Section 5: 二代健保補充保費 — full width */}
      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <SectionHeader title="二代健保補充保費" subtitle="全民健康保險法第31條" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          <div style={{ padding: '12px 0', borderBottom: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>費率</div>
            <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--accent-cyan)' }}>2.11%</div>
          </div>
          <div style={{ padding: '12px 0', borderBottom: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>起徵門檻</div>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--accent-orange)' }}>單次 NT$ 2,000 以上</div>
          </div>
          <div style={{ padding: '12px 0', borderBottom: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>法源</div>
            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-secondary)' }}>全民健康保險法第31條</div>
          </div>
        </div>
        <div style={{
          marginTop: 12, padding: 10,
          background: 'var(--bg-secondary)', borderRadius: 8,
          fontSize: 12, color: 'var(--text-muted)',
        }}>
          適用對象：獎金、加班費、兼職收入等單次給付超過 NT$2,000 之所得。
        </div>
      </div>

      {/* Section 2: 勞保費率 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title">勞保費率 — 投保薪資級距（{currentYear} 年）</div>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>全部級距</span>
        </div>
        <RateTable brackets={laborBrackets} />
      </div>

      {/* Section 3: 健保費率 */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">健保費率 — 投保薪資級距（{currentYear} 年）</div>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>全部級距</span>
        </div>
        <RateTable brackets={healthBrackets} />
      </div>
    </div>
  )
}
