import { useState, useEffect, useMemo } from 'react'
import { DollarSign, Plus, Trash2, Edit2, Save, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { getCompensationBands, createCompensationBand, updateCompensationBand, deleteCompensationBand, getDepartments } from '../../lib/db'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

const EMPTY_BAND = { dept: '', position: '', band_name: '', min_salary: '', mid_salary: '', max_salary: '' }

function compaRatio(salary, midpoint) {
  if (!midpoint) return null
  return Math.round((salary / midpoint) * 100)
}

function ratioColor(ratio) {
  if (ratio === null) return 'var(--text-muted)'
  if (ratio < 80) return 'var(--accent-red)'
  if (ratio < 95) return 'var(--accent-orange)'
  if (ratio <= 110) return 'var(--accent-green)'
  return 'var(--accent-cyan)'
}

function ratioLabel(ratio) {
  if (ratio === null) return '-'
  if (ratio < 80) return '偏低'
  if (ratio < 95) return '略低'
  if (ratio <= 110) return '適中'
  return '偏高'
}

export default function CompensationBenchmark() {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [bands, setBands] = useState([])
  const [employees, setEmployees] = useState([])
  const [salaries, setSalaries] = useState([])
  const [departments, setDepartments] = useState([])
  const [tab, setTab] = useState('overview')
  const [deptFilter, setDeptFilter] = useState('')
  const [showBandModal, setShowBandModal] = useState(false)
  const [bandForm, setBandForm] = useState(EMPTY_BAND)
  const [editingId, setEditingId] = useState(null)

  const setB = (k, v) => setBandForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    const orgId = profile?.organization_id
    if (!orgId) { setLoading(false); return }
    Promise.all([
      getCompensationBands(),
      supabase.from('employees').select('id, name, dept, store, department_id, position, store_id, status, departments!department_id(name), stores!store_id(name)').eq('status', '在職').eq('organization_id', orgId).order('name'),
      supabase.from('salary_records').select('employee_id, base_salary, allowance, month, employees(name)').eq('organization_id', orgId).order('month', { ascending: false }),
      getDepartments(orgId),
    ]).then(([b, e, s, d]) => {
      setBands(b.data || [])
      setEmployees(e.data || [])
      setSalaries(s.data || [])
      setDepartments(d.data || [])
    }).catch(err => {
      console.error('Failed to load compensation data:', err)
      setError('資料載入失敗')
    }).finally(() => setLoading(false))
  }, [profile?.organization_id])

  // Build employee compensation view
  const empComp = useMemo(() => {
    const latestSalary = {}
    salaries.forEach(s => {
      if (!latestSalary[s.employee]) latestSalary[s.employee] = s
    })

    return employees.map(emp => {
      const sal = latestSalary[emp.name]
      const totalPay = sal ? (sal.base_salary || 0) + (sal.allowance || 0) : null
      const band = bands.find(b => b.dept === emp.dept && b.position === emp.position)
      const ratio = band && totalPay ? compaRatio(totalPay, band.mid_salary) : null

      return {
        ...emp,
        base_salary: sal?.base_salary || null,
        allowance: sal?.allowance || 0,
        total_pay: totalPay,
        band,
        compa_ratio: ratio,
      }
    })
  }, [employees, salaries, bands])

  const filteredEmp = useMemo(() => {
    let list = empComp
    if (deptFilter) list = list.filter(e => e.dept === deptFilter)
    return list.sort((a, b) => (a.compa_ratio ?? 999) - (b.compa_ratio ?? 999))
  }, [empComp, deptFilter])

  // Department summary
  const deptSummary = useMemo(() => {
    const map = {}
    empComp.forEach(e => {
      const dept = e.dept || '未分配'
      if (!map[dept]) map[dept] = { dept, employees: [], totalPay: 0, count: 0, belowBand: 0, aboveBand: 0, noBand: 0 }
      map[dept].employees.push(e)
      map[dept].count++
      if (e.total_pay) map[dept].totalPay += e.total_pay
      if (e.compa_ratio === null) map[dept].noBand++
      else if (e.compa_ratio < 80) map[dept].belowBand++
      else if (e.compa_ratio > 110) map[dept].aboveBand++
    })
    return Object.values(map).sort((a, b) => b.belowBand - a.belowBand)
  }, [empComp])

  // Equity stats
  const equityStats = useMemo(() => {
    const withRatio = empComp.filter(e => e.compa_ratio !== null)
    const below = withRatio.filter(e => e.compa_ratio < 80).length
    const in_range = withRatio.filter(e => e.compa_ratio >= 80 && e.compa_ratio <= 110).length
    const above = withRatio.filter(e => e.compa_ratio > 110).length
    const avg = withRatio.length ? Math.round(withRatio.reduce((s, e) => s + e.compa_ratio, 0) / withRatio.length) : 0
    const noBand = empComp.filter(e => e.compa_ratio === null).length
    return { below, in_range, above, avg, noBand, total: empComp.length }
  }, [empComp])

  const handleSaveBand = async () => {
    const payload = {
      dept: bandForm.dept,
      position: bandForm.position,
      band_name: bandForm.band_name || `${bandForm.dept}-${bandForm.position}`,
      min_salary: Number(bandForm.min_salary),
      mid_salary: Number(bandForm.mid_salary),
      max_salary: Number(bandForm.max_salary),
    }
    if (!payload.dept || !payload.position || !payload.min_salary) return alert('請填寫必要欄位')

    const { data, error: err } = editingId
      ? await updateCompensationBand(editingId, payload)
      : await createCompensationBand(payload)

    if (err) return alert('儲存失敗：' + err.message)
    if (editingId) {
      setBands(prev => prev.map(b => b.id === editingId ? data : b))
    } else {
      setBands(prev => [...prev, data])
    }
    setShowBandModal(false)
    setBandForm(EMPTY_BAND)
    setEditingId(null)
  }

  const handleDeleteBand = async (id) => {
    if (!confirm('確定刪除此薪資帶？')) return
    await deleteCompensationBand(id)
    setBands(prev => prev.filter(b => b.id !== id))
  }

  const handleEditBand = (band) => {
    setBandForm({ dept: band.dept, position: band.position, band_name: band.band_name || '', min_salary: band.min_salary, mid_salary: band.mid_salary, max_salary: band.max_salary })
    setEditingId(band.id)
    setShowBandModal(true)
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3></div>

  return (
    <div>
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📊</span> 薪酬基準分析</h2>
            <p>部門/職位薪資帶比對、Compa-Ratio 公平性分析</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={() => { setBandForm(EMPTY_BAND); setEditingId(null); setShowBandModal(true) }}>
              <Plus size={14} /> 新增薪資帶
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'rgba(239,68,68,0.12)' }}>
          <div className="stat-card-label">低於帶寬</div>
          <div className="stat-card-value">{equityStats.below}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'rgba(16,185,129,0.12)' }}>
          <div className="stat-card-label">帶寬內</div>
          <div className="stat-card-value">{equityStats.in_range}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'rgba(6,182,212,0.12)' }}>
          <div className="stat-card-label">高於帶寬</div>
          <div className="stat-card-value">{equityStats.above}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'rgba(245,158,11,0.12)' }}>
          <div className="stat-card-label">平均 Compa-Ratio</div>
          <div className="stat-card-value">{equityStats.avg}%</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--text-muted)', '--card-accent-dim': 'var(--bg-secondary)' }}>
          <div className="stat-card-label">未設薪資帶</div>
          <div className="stat-card-value">{equityStats.noBand}</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: 'var(--bg-card)', borderRadius: 10, padding: 4, border: '1px solid var(--border-subtle)', width: 'fit-content' }}>
        {[['overview', '📋 部門總覽'], ['employees', '👤 員工明細'], ['bands', '📏 薪資帶設定']].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            padding: '6px 16px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500,
            background: tab === key ? 'var(--accent-cyan)' : 'transparent',
            color: tab === key ? '#fff' : 'var(--text-muted)',
          }}>{label}</button>
        ))}
      </div>

      {/* Department Overview */}
      {tab === 'overview' && (
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">🏢</span> 部門薪酬概覽</div>
          </div>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>部門</th>
                  <th>人數</th>
                  <th>月薪資總額</th>
                  <th>平均薪資</th>
                  <th>低於帶寬</th>
                  <th>高於帶寬</th>
                  <th>未設帶寬</th>
                  <th>公平性</th>
                </tr>
              </thead>
              <tbody>
                {deptSummary.map(d => {
                  const avg = d.count ? Math.round(d.totalPay / d.count) : 0
                  const healthPct = d.count ? Math.round(((d.count - d.belowBand - d.noBand) / d.count) * 100) : 0
                  return (
                    <tr key={d.dept}>
                      <td style={{ fontWeight: 600 }}>{d.dept}</td>
                      <td>{d.count}</td>
                      <td>${d.totalPay.toLocaleString()}</td>
                      <td>${avg.toLocaleString()}</td>
                      <td style={{ color: d.belowBand ? 'var(--accent-red)' : undefined, fontWeight: d.belowBand ? 600 : undefined }}>{d.belowBand}</td>
                      <td style={{ color: d.aboveBand ? 'var(--accent-cyan)' : undefined }}>{d.aboveBand}</td>
                      <td style={{ color: d.noBand ? 'var(--text-muted)' : undefined }}>{d.noBand}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ width: 50, height: 6, borderRadius: 3, background: 'var(--border-subtle)', overflow: 'hidden' }}>
                            <div style={{ width: `${healthPct}%`, height: '100%', borderRadius: 3, background: healthPct >= 80 ? 'var(--accent-green)' : healthPct >= 60 ? 'var(--accent-orange)' : 'var(--accent-red)' }} />
                          </div>
                          <span style={{ fontSize: 12 }}>{healthPct}%</span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Employee Detail */}
      {tab === 'employees' && (
        <>
          <div style={{
            display: 'flex', gap: 16, marginBottom: 16, padding: '12px 16px',
            background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 10,
            alignItems: 'center',
          }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>🏢 部門</span>
            <select className="form-input" style={{ fontSize: 13, minWidth: 140 }} value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
              <option value="">全部部門</option>
              {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
            </select>
          </div>
          <div className="card">
            <div className="card-header">
              <div className="card-title"><span className="card-title-icon">👤</span> 員工 Compa-Ratio 明細</div>
            </div>
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>員工</th>
                    <th>部門</th>
                    <th>職位</th>
                    <th>底薪</th>
                    <th>津貼</th>
                    <th>總薪</th>
                    <th>帶寬中位</th>
                    <th>Compa-Ratio</th>
                    <th>狀態</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEmp.map(emp => (
                    <tr key={emp.id}>
                      <td style={{ fontWeight: 600 }}>{emp.name}</td>
                      <td>{emp.dept || '-'}</td>
                      <td>{emp.position || '-'}</td>
                      <td>{emp.base_salary ? `$${emp.base_salary.toLocaleString()}` : '-'}</td>
                      <td>{emp.allowance ? `$${emp.allowance.toLocaleString()}` : '-'}</td>
                      <td style={{ fontWeight: 600 }}>{emp.total_pay ? `$${emp.total_pay.toLocaleString()}` : '-'}</td>
                      <td>{emp.band ? `$${emp.band.mid_salary.toLocaleString()}` : <span style={{ color: 'var(--text-muted)' }}>未設定</span>}</td>
                      <td style={{ fontWeight: 600, color: ratioColor(emp.compa_ratio) }}>
                        {emp.compa_ratio !== null ? `${emp.compa_ratio}%` : '-'}
                      </td>
                      <td>
                        <span style={{
                          padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600,
                          color: ratioColor(emp.compa_ratio),
                          background: emp.compa_ratio !== null ? (emp.compa_ratio < 80 ? 'rgba(239,68,68,0.12)' : emp.compa_ratio <= 110 ? 'rgba(16,185,129,0.12)' : 'rgba(6,182,212,0.12)') : 'var(--bg-secondary)',
                        }}>
                          {ratioLabel(emp.compa_ratio)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Band Settings */}
      {tab === 'bands' && (
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">📏</span> 薪資帶設定</div>
          </div>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>部門</th>
                  <th>職位</th>
                  <th>帶名</th>
                  <th>最低薪</th>
                  <th>中位薪</th>
                  <th>最高薪</th>
                  <th>帶寬幅度</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {bands.map(b => {
                  const spread = b.min_salary ? Math.round(((b.max_salary - b.min_salary) / b.min_salary) * 100) : 0
                  return (
                    <tr key={b.id}>
                      <td style={{ fontWeight: 600 }}>{b.dept}</td>
                      <td>{b.position}</td>
                      <td>{b.band_name || '-'}</td>
                      <td>${b.min_salary.toLocaleString()}</td>
                      <td style={{ fontWeight: 600 }}>${b.mid_salary.toLocaleString()}</td>
                      <td>${b.max_salary.toLocaleString()}</td>
                      <td>{spread}%</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn-secondary" style={{ padding: '2px 8px' }} onClick={() => handleEditBand(b)}><Edit2 size={13} /></button>
                          <button className="btn btn-secondary" style={{ padding: '2px 8px', color: 'var(--accent-red)' }} onClick={() => handleDeleteBand(b.id)}><Trash2 size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {bands.length === 0 && (
                  <tr><td colSpan={8} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>尚未設定薪資帶，請點擊「新增薪資帶」開始</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Band Modal */}
      {showBandModal && (
        <Modal title={editingId ? '編輯薪資帶' : '新增薪資帶'} onClose={() => { setShowBandModal(false); setEditingId(null) }} onSubmit={handleSaveBand}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="部門 *">
              <select className="form-input" style={{ width: '100%' }} value={bandForm.dept} onChange={e => setB('dept', e.target.value)}>
                <option value="">選擇部門</option>
                {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="職位 *">
              <input className="form-input" style={{ width: '100%' }} value={bandForm.position} onChange={e => setB('position', e.target.value)} placeholder="例：店長、課長" />
            </Field>
            <Field label="帶名">
              <input className="form-input" style={{ width: '100%' }} value={bandForm.band_name} onChange={e => setB('band_name', e.target.value)} placeholder="例：L3" />
            </Field>
            <div />
            <Field label="最低薪 *">
              <input type="number" className="form-input" style={{ width: '100%' }} value={bandForm.min_salary} onChange={e => setB('min_salary', e.target.value)} />
            </Field>
            <Field label="中位薪 *">
              <input type="number" className="form-input" style={{ width: '100%' }} value={bandForm.mid_salary} onChange={e => setB('mid_salary', e.target.value)} />
            </Field>
            <Field label="最高薪 *">
              <input type="number" className="form-input" style={{ width: '100%' }} value={bandForm.max_salary} onChange={e => setB('max_salary', e.target.value)} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  )
}
