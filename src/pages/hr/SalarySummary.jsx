import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { getTenantOrgId } from '../../lib/events/middleware/tenantContext'
import { ChevronDown, Users, Briefcase, Wallet } from 'lucide-react'

const money = (v) => `NT$ ${(Number(v) || 0).toLocaleString()}`
const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
// 兼職 = employment_type「兼職」或(空 employment_type 且時薪);其餘(正職/全職/月薪)= 正職
const isPT = (e) => !!e && (e.employment_type === '兼職' || (!e.employment_type && e.salary_type === 'hourly'))

export default function SalarySummary() {
  const { profile } = useAuth()
  const orgId = profile?.organization_id ?? getTenantOrgId()
  const [month, setMonth] = useState(ym(new Date()))
  const [sum, setSum] = useState(null)   // { ft:{count,net}, pt:{count,net} }
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!orgId || !month) return
    let cancelled = false
    setLoading(true)
    Promise.all([
      supabase.rpc('preview_payroll', { p_period: month, p_org: orgId, p_store_filter: null }),
      supabase.from('employees').select('id, employment_type, salary_type').eq('organization_id', orgId),
    ]).then(([pv, emps]) => {
      if (cancelled) return
      const empMap = new Map((emps.data || []).map(e => [e.id, e]))
      const ft = { count: 0, net: 0 }, pt = { count: 0, net: 0 }
      for (const p of (pv.data || [])) {
        const b = isPT(empMap.get(p.employee_id)) ? pt : ft
        b.count++; b.net += Number(p.netSalary) || 0
      }
      setSum({ ft, pt })
      setLoading(false)
    }).catch(() => { if (!cancelled) { setSum({ ft: { count: 0, net: 0 }, pt: { count: 0, net: 0 } }); setLoading(false) } })
    return () => { cancelled = true }
  }, [orgId, month])

  const total = sum ? { count: sum.ft.count + sum.pt.count, net: sum.ft.net + sum.pt.net } : null

  const monthOpts = useMemo(() => {
    const d = new Date(), arr = []
    for (let i = 0; i < 12; i++) arr.push(ym(new Date(d.getFullYear(), d.getMonth() - i, 1)))
    return arr
  }, [])

  const Card = ({ icon: Icon, label, count, net, color }) => (
    <div className="card" style={{ flex: 1, minWidth: 220 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ width: 32, height: 32, borderRadius: 9, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: `var(--accent-${color}-dim)`, color: `var(--accent-${color})` }}><Icon size={16} /></span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>{label}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{count} 人</div>
        </div>
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: `var(--accent-${color})` }}>{money(net)}</div>
    </div>
  )

  return (
    <div className="fade-in" style={{ paddingBottom: 40 }}>
      <div className="page-header">
        <h2><span className="header-icon">📊</span> 薪資統整</h2>
        <p style={{ margin: 0 }}>各月正職 / 兼職實領總額（與薪資報表同源 preview_payroll）</p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '4px 0 20px' }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>📅 月份</span>
        <div style={{ position: 'relative' }}>
          <select className="form-input" style={{ fontSize: 13, minWidth: 160, paddingRight: 32, appearance: 'none' }} value={month} onChange={e => setMonth(e.target.value)}>
            {monthOpts.map(m => { const [y, mm] = m.split('-'); return <option key={m} value={m}>{y} 年 {parseInt(mm)} 月</option> })}
          </select>
          <ChevronDown size={16} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
        </div>
      </div>

      {loading ? (
        <div className="card" style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>統計中…</div>
      ) : total ? (
        <>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
            <Card icon={Briefcase} label="正職實領" count={sum.ft.count} net={sum.ft.net} color="cyan" />
            <Card icon={Users} label="兼職實領" count={sum.pt.count} net={sum.pt.net} color="purple" />
          </div>
          <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderColor: 'var(--accent-green)', background: 'var(--accent-green-dim)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 36, height: 36, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--accent-green)', color: '#fff' }}><Wallet size={18} /></span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 800 }}>總實領</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{total.count} 人（正職 {sum.ft.count} + 兼職 {sum.pt.count}）</div>
              </div>
            </div>
            <div style={{ fontSize: 30, fontWeight: 800, color: 'var(--accent-green)' }}>{money(total.net)}</div>
          </div>
        </>
      ) : (
        <div className="card" style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>此月無可計薪的員工</div>
      )}
    </div>
  )
}
