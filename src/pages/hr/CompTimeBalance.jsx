import { useState, useEffect, useMemo } from 'react'
import { Search, Clock, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import SearchableSelect from '../../components/SearchableSelect'

// 補休餘額管理
// 列出每個員工目前 active comp_time_ledger 加總、最近到期、過期未結（理論上不存在，月結會自動清）
export default function CompTimeBalance() {
  const { profile, role } = useAuth()
  const userRole = role?.name || profile?.role || 'store_staff'
  const isStaff = userRole === 'store_staff'

  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [stores, setStores] = useState([])
  const [ledgers, setLedgers] = useState([])  // 全公司 active ledger
  const [deptFilter, setDeptFilter] = useState('')
  const [storeFilter, setStoreFilter] = useState('')
  const [search, setSearch] = useState(isStaff ? (profile?.name || '') : '')
  const [expandedEmpId, setExpandedEmpId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const orgId = profile?.organization_id
    setLoading(true)
    Promise.all([
      supabase
        .from('employees')
        .select('id, name, dept, store, status, departments!department_id(name), stores!store_id(name)')
        .eq('organization_id', orgId)
        .order('name'),
      supabase
        .from('comp_time_ledger')
        .select('*, overtime_requests(reason)')
        .eq('status', 'active')
        .gt('hours', 0)
        .order('expires_at', { ascending: true }),
      supabase.from('departments').select('id, name').eq('organization_id', orgId),
      supabase.from('stores').select('id, name').eq('organization_id', orgId),
    ]).then(([eRes, lRes, dRes, sRes]) => {
      let emps = eRes.data || []
      if (isStaff && profile?.name) emps = emps.filter(e => e.name === profile.name)
      setEmployees(emps)
      const allLedgers = (lRes.data || []).filter(l => Number(l.hours) - Number(l.hours_used) > 0)
      setLedgers(allLedgers)
      setDepartments(dRes.data || [])
      setStores(sRes.data || [])
    }).catch(err => {
      console.error('Failed to load comp_time balance:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [profile?.organization_id])

  // 員工聚合：每人 total_remaining / 最早到期日 / 30 天內到期數
  const empSummary = useMemo(() => {
    const byEmp = {}
    for (const l of ledgers) {
      const eid = l.employee_id
      if (!byEmp[eid]) byEmp[eid] = { total: 0, ledgers: [], nearest: null, urgentCount: 0 }
      const remaining = Number(l.hours) - Number(l.hours_used)
      byEmp[eid].total += remaining
      byEmp[eid].ledgers.push({ ...l, remaining })
      if (!byEmp[eid].nearest || l.expires_at < byEmp[eid].nearest) {
        byEmp[eid].nearest = l.expires_at
      }
    }
    const today = new Date().toISOString().slice(0, 10)
    const todayTs = new Date(today).getTime()
    for (const eid of Object.keys(byEmp)) {
      const urgent = byEmp[eid].ledgers.filter(l => {
        const days = Math.floor((new Date(l.expires_at).getTime() - todayTs) / 86400000)
        return days <= 30 && days >= 0
      })
      byEmp[eid].urgentCount = urgent.length
      byEmp[eid].urgentHours = urgent.reduce((s, l) => s + l.remaining, 0)
    }
    return byEmp
  }, [ledgers])

  const filteredEmps = useMemo(() => employees.filter(e => {
    const dept = e.departments?.name || e.dept || ''
    const store = e.stores?.name || e.store || ''
    return (deptFilter === '' || dept === deptFilter)
      && (storeFilter === '' || store === storeFilter)
      && (search === '' || e.name?.includes(search))
  }), [employees, deptFilter, storeFilter, search])

  // 統計 cards
  const stats = useMemo(() => {
    const totalEmps = filteredEmps.filter(e => empSummary[e.id]?.total > 0).length
    const totalHours = filteredEmps.reduce((s, e) => s + (empSummary[e.id]?.total || 0), 0)
    const urgentEmps = filteredEmps.filter(e => empSummary[e.id]?.urgentCount > 0).length
    const urgentHours = filteredEmps.reduce((s, e) => s + (empSummary[e.id]?.urgentHours || 0), 0)
    return { totalEmps, totalHours, urgentEmps, urgentHours }
  }, [filteredEmps, empSummary])

  if (loading) return <LoadingSpinner />
  if (error) return (
    <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}>
      <h3>{error}</h3>
      <button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button>
    </div>
  )

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🕐</span> 補休餘額管理</h2>
            <p>每筆加班申請選「補休」會獨立一筆 ledger · FIFO 扣 · 過期月結時自動換加班費</p>
          </div>
        </div>
      </div>

      {/* 統計 cards */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 16 }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">有補休的員工</div>
          <div className="stat-card-value">{stats.totalEmps}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">補休總時數</div>
          <div className="stat-card-value">{stats.totalHours.toFixed(1)}h</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">30 天內到期人數</div>
          <div className="stat-card-value">{stats.urgentEmps}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">30 天內到期時數</div>
          <div className="stat-card-value">{stats.urgentHours.toFixed(1)}h</div>
        </div>
      </div>

      {/* 篩選 */}
      {!isStaff && (
        <div style={{
          display: 'flex', gap: 12, marginBottom: 16, padding: '12px 16px',
          background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 10,
          alignItems: 'center', flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>🏪 門市</span>
          <select className="form-input" style={{ fontSize: 13, minWidth: 160 }} value={storeFilter} onChange={e => setStoreFilter(e.target.value)}>
            <option value="">全部門市</option>
            {stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>🏢 部門</span>
          <div style={{ minWidth: 200 }}>
            <SearchableSelect
              value={deptFilter}
              onChange={(v) => setDeptFilter(v || '')}
              options={[{ value: '', label: '全部部門' }, ...departments.map(d => ({ value: d.name, label: d.name }))]}
              placeholder="搜尋部門..."
              clearable
            />
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📋</span> 員工列表</div>
          <div className="search-bar">
            <Search className="search-icon" />
            <input type="text" placeholder="搜尋員工..." className="form-input" style={{ paddingLeft: 38 }}
              value={search} onChange={e => setSearch(e.target.value)}
              disabled={isStaff} />
          </div>
        </div>
        <div>
          {filteredEmps.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>沒有符合條件的員工</div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '180px 100px 140px 110px 130px 1fr 80px', background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-medium)', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
            {['員工', '部門', '門市', '補休總時數', '最早到期日', '提醒', '展開'].map(h => (
              <div key={h} style={{ padding: '10px 8px' }}>{h}</div>
            ))}
          </div>
          {filteredEmps.map(e => {
            const sum = empSummary[e.id] || { total: 0, ledgers: [], nearest: null, urgentCount: 0, urgentHours: 0 }
            const isExpanded = expandedEmpId === e.id
            const hasBalance = sum.total > 0
            return (
              <div key={e.id}>
                <div style={{ display: 'grid', gridTemplateColumns: '180px 100px 140px 110px 130px 1fr 80px', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)', opacity: hasBalance ? 1 : 0.5 }}>
                  <div style={{ padding: '8px', fontWeight: 600, fontSize: 13 }}>{e.name}</div>
                  <div style={{ padding: '8px', fontSize: 12, color: 'var(--text-muted)' }}>{e.departments?.name || e.dept || '-'}</div>
                  <div style={{ padding: '8px', fontSize: 12, color: 'var(--text-muted)' }}>{e.stores?.name || e.store || '-'}</div>
                  <div style={{ padding: '8px', fontSize: 14, fontWeight: 700, color: hasBalance ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                    {sum.total.toFixed(1)}h
                  </div>
                  <div style={{ padding: '8px', fontSize: 12, color: 'var(--text-secondary)' }}>{sum.nearest || '—'}</div>
                  <div style={{ padding: '8px' }}>
                    {sum.urgentCount > 0 ? (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                        background: 'var(--accent-orange-dim)', color: 'var(--accent-orange)',
                      }}>
                        <AlertTriangle size={10} />
                        {sum.urgentCount} 筆 ({sum.urgentHours.toFixed(1)}h) 即將到期
                      </span>
                    ) : <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>—</span>}
                  </div>
                  <div style={{ padding: '8px' }}>
                    {hasBalance && (
                      <button className="btn btn-secondary" style={{ fontSize: 11, padding: '3px 10px' }}
                        onClick={() => setExpandedEmpId(isExpanded ? null : e.id)}>
                        {isExpanded ? '收起' : '明細'}
                      </button>
                    )}
                  </div>
                </div>
                {isExpanded && sum.ledgers.length > 0 && (
                  <div style={{ padding: '8px 16px 16px 16px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                      <Clock size={12} style={{ display: 'inline', marginRight: 4 }} />
                      明細（最早到期先扣 / FIFO）：
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '110px 90px 90px 110px 90px 1fr', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', padding: '4px 8px', borderBottom: '1px solid var(--border-subtle)' }}>
                      {['加班日', '原時數', '已用', '剩餘', '到期日', '備註'].map(h => <div key={h}>{h}</div>)}
                    </div>
                    {sum.ledgers.map(l => {
                      const days = Math.floor((new Date(l.expires_at).getTime() - Date.now()) / 86400000)
                      const urgent = days <= 30 && days >= 0
                      return (
                        <div key={l.id} style={{ display: 'grid', gridTemplateColumns: '110px 90px 90px 110px 90px 1fr', fontSize: 12, padding: '6px 8px', borderBottom: '1px solid var(--border-subtle)' }}>
                          <div>{l.ot_date}</div>
                          <div>{Number(l.hours).toFixed(1)}h</div>
                          <div style={{ color: 'var(--text-muted)' }}>{Number(l.hours_used).toFixed(1)}h</div>
                          <div style={{ fontWeight: 700, color: 'var(--accent-green)' }}>{l.remaining.toFixed(1)}h</div>
                          <div style={{ color: urgent ? 'var(--accent-orange)' : 'var(--text-secondary)' }}>
                            {l.expires_at}
                            {urgent && <span style={{ fontSize: 10, marginLeft: 4 }}>（{days}天）</span>}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            凍結金額 ${Number(l.frozen_ot_amount).toFixed(0)}
                            {l.overtime_requests?.reason && (
                              <span style={{ marginLeft: 8 }}>· {l.overtime_requests.reason.slice(0, 30)}</span>
                            )}
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
    </div>
  )
}
