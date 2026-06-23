import { useState, useEffect, useCallback } from 'react'
import { Award, ChevronDown, TrendingUp, ShoppingCart, DollarSign, Hash } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useOrgId } from '../../contexts/AuthContext'
import PageHeader from '../../components/ui/PageHeader'
import LoadingSpinner from '../../components/LoadingSpinner'

const sel = {
  background: 'var(--bg-input)', border: '1px solid var(--border-medium)',
  borderRadius: 8, color: 'var(--text-primary)', padding: '8px 12px', fontSize: 14,
  cursor: 'pointer', appearance: 'none', outline: 'none',
}

const RANGES = [
  { label: '今日', value: 'today' },
  { label: '本週', value: 'week' },
  { label: '本月', value: 'month' },
  { label: '自訂', value: 'custom' },
]

function rangeToISO(range, customFrom, customTo) {
  const now = new Date()
  const pad = d => d.toISOString().slice(0, 10)
  if (range === 'today') {
    const t = pad(now)
    return { from: t + 'T00:00:00', to: t + 'T23:59:59' }
  }
  if (range === 'week') {
    const d = new Date(now)
    d.setDate(d.getDate() - d.getDay())
    return { from: pad(d) + 'T00:00:00', to: pad(now) + 'T23:59:59' }
  }
  if (range === 'month') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1)
    return { from: pad(from) + 'T00:00:00', to: pad(now) + 'T23:59:59' }
  }
  return { from: (customFrom || pad(now)) + 'T00:00:00', to: (customTo || pad(now)) + 'T23:59:59' }
}

export default function StaffPerformance() {
  const orgId = useOrgId()
  const [stores, setStores]     = useState([])
  const [storeId, setStoreId]   = useState(null)
  const [range, setRange]       = useState('month')
  const [customFrom, setFrom]   = useState('')
  const [customTo, setTo]       = useState('')
  const [rows, setRows]         = useState([])
  const [loading, setLoading]   = useState(false)

  // ── Stores ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!orgId) return
    supabase.from('stores').select('id, name').eq('organization_id', orgId).order('name')
      .then(({ data }) => {
        setStores(data ?? [])
        if (data?.length) setStoreId(id => id ?? data[0].id)
      })
  }, [orgId])

  // ── Load ─────────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!storeId || !orgId) return
    setLoading(true)
    const { from, to } = rangeToISO(range, customFrom, customTo)

    const [{ data: emps }, { data: orders }, { data: payments }] = await Promise.all([
      supabase.from('employees').select('id, name').eq('organization_id', orgId).eq('status', 'active').order('name'),
      supabase.from('pos_orders').select('id, opened_by').eq('store_id', storeId).eq('status', 'paid').gte('paid_at', from).lte('paid_at', to),
      supabase.from('pos_payments').select('employee_id, amount').eq('store_id', storeId).gte('paid_at', from).lte('paid_at', to),
    ])

    const orderMap = {}
    for (const o of (orders ?? [])) {
      if (!o.opened_by) continue
      orderMap[o.opened_by] = (orderMap[o.opened_by] || 0) + 1
    }
    const revenueMap = {}
    for (const p of (payments ?? [])) {
      if (!p.employee_id) continue
      revenueMap[p.employee_id] = (revenueMap[p.employee_id] || 0) + Number(p.amount)
    }

    const computed = (emps ?? []).map(e => {
      const orderCount = orderMap[e.id] || 0
      const revenue    = revenueMap[e.id] || 0
      return { id: e.id, name: e.name, orderCount, revenue, avgOrder: orderCount > 0 ? revenue / orderCount : 0 }
    }).sort((a, b) => b.revenue - a.revenue)

    setRows(computed)
    setLoading(false)
  }, [storeId, orgId, range, customFrom, customTo])

  useEffect(() => { load() }, [load])

  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0)
  const totalOrders  = rows.reduce((s, r) => s + r.orderCount, 0)

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1000 }}>
      <PageHeader
        icon={Award}
        title="員工業績"
        description="依門市和時間範圍查看每位員工的訂單數與營業額"
        accentColor="var(--accent-purple)"
        actions={
          <div style={{ position: 'relative' }}>
            <select value={storeId ?? ''} onChange={e => setStoreId(e.target.value)} style={{ ...sel, width: 150, paddingRight: 28 }}>
              {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <ChevronDown size={13} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          </div>
        }
      />

      {/* Range selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{
          display: 'inline-flex', borderRadius: 8, overflow: 'hidden',
          border: '1px solid var(--border-medium)', background: 'var(--bg-tertiary)',
        }}>
          {RANGES.map(r => (
            <button key={r.value} onClick={() => setRange(r.value)} style={{
              padding: '6px 16px', fontSize: 13, border: 'none', cursor: 'pointer',
              background: range === r.value ? 'var(--accent-purple)' : 'transparent',
              color: range === r.value ? '#fff' : 'var(--text-secondary)',
              fontWeight: range === r.value ? 600 : 400,
            }}>{r.label}</button>
          ))}
        </div>
        {range === 'custom' && (
          <>
            <input type="date" value={customFrom} onChange={e => setFrom(e.target.value)} style={{ ...sel, width: 140 }} />
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>至</span>
            <input type="date" value={customTo} onChange={e => setTo(e.target.value)} style={{ ...sel, width: 140 }} />
          </>
        )}
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
        <StatCard icon={DollarSign} label="總營業額" value={`$${totalRevenue.toLocaleString()}`} color="var(--accent-green)" />
        <StatCard icon={Hash}       label="總訂單數" value={totalOrders} color="var(--accent-blue)" />
        <StatCard icon={TrendingUp} label="平均單量" value={totalOrders > 0 ? `$${Math.round(totalRevenue / totalOrders).toLocaleString()}` : '—'} color="var(--accent-purple)" />
      </div>

      {/* Table */}
      {loading ? <LoadingSpinner /> : (
        <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-subtle)', overflow: 'hidden' }}>
          {rows.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
              目前無員工資料
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  {['排名', '員工姓名', '訂單數', '營業額', '平均單量'].map(h => (
                    <th key={h} style={{ padding: '12px 16px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: 12 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 700, fontSize: 13 }}>
                      {i < 3 ? ['🥇', '🥈', '🥉'][i] : `#${i + 1}`}
                    </td>
                    <td style={{ padding: '12px 16px', color: 'var(--text-primary)', fontWeight: 600 }}>{r.name}</td>
                    <td style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <ShoppingCart size={13} style={{ color: 'var(--accent-blue)' }} />
                        {r.orderCount}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', color: 'var(--accent-green)', fontWeight: 700 }}>
                      ${r.revenue.toLocaleString()}
                    </td>
                    <td style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>
                      {r.avgOrder > 0 ? `$${Math.round(r.avgOrder).toLocaleString()}` : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {!loading && rows.length > 0 && rows.every(r => r.orderCount === 0) && (
        <div style={{ marginTop: 16, padding: '12px 16px', borderRadius: 8, background: 'var(--bg-tertiary)', color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>
          本期間尚無已結帳訂單；業績數據待訂單資料累積後自動計算
        </div>
      )}
    </div>
  )
}

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div style={{
      background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-subtle)',
      padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14,
    }}>
      <div style={{
        width: 42, height: 42, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: `color-mix(in srgb, ${color} 15%, transparent)`,
      }}>
        <Icon size={20} style={{ color }} />
      </div>
      <div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>{value}</div>
      </div>
    </div>
  )
}
