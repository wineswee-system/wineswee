import { useState, useEffect } from 'react'
import { RefreshCw, ShieldCheck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'

import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'

// 依實際月薪找對應級距(第一個 min_salary <= salary 的最高一級)
const findGrade = (salary, brackets) => {
  if (!brackets?.length) return null
  const sorted = [...brackets].sort((a, b) => (a.min_salary || 0) - (b.min_salary || 0))
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (salary >= (sorted[i].min_salary || 0)) return sorted[i]
  }
  return sorted[0]
}

export default function InsuranceGradeMonitor() {
  const { profile } = useAuth()
  const [mode, setMode] = useState('labor')   // 'labor'=勞保投保級距 / 'pension'=勞退提繳級距
  const [employees, setEmployees] = useState([])
  const [laborBrackets, setLaborBrackets] = useState([])
  const [pensionBrackets, setPensionBrackets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [updating, setUpdating] = useState(false)
  const [updatingId, setUpdatingId] = useState(null)

  const fetchData = async () => {
    try {
      setLoading(true); setError(null)
      const year = new Date().getFullYear()
      const [empRes, laborRes, pensionRes] = await Promise.all([
        supabase.from('employees')
          .select('id, name, dept, store, base_salary, labor_ins_grade, labor_pension_grade, status, employment_type')
          .eq('status', '在職').eq('organization_id', profile?.organization_id).order('name'),
        supabase.from('labor_ins_brackets').select('*').eq('year', year).order('insured_salary'),
        supabase.from('labor_pension_brackets').select('*').eq('year', year).order('monthly_wage'),
      ])
      if (empRes.error) throw empRes.error
      if (laborRes.error) throw laborRes.error
      if (pensionRes.error) throw pensionRes.error
      setEmployees(empRes.data || [])
      setLaborBrackets(laborRes.data || [])
      setPensionBrackets(pensionRes.data || [])
    } catch (err) {
      console.error('Failed to load insurance data:', err)
      setError('資料載入失敗，請重新整理頁面')
    } finally { setLoading(false) }
  }
  useEffect(() => { fetchData() }, [])

  // 每種模式的設定:員工欄位、級距金額欄位、級距表、適用判斷、標題
  const CFG = {
    labor:   { field: 'labor_ins_grade',     valueKey: 'insured_salary', brackets: laborBrackets,   label: '勞保投保級距',
               managed: (e) => !['派遣'].includes(e.employment_type || '正職'), na: '派遣不投保(由派遣公司辦理)' },
    pension: { field: 'labor_pension_grade', valueKey: 'monthly_wage',   brackets: pensionBrackets, label: '勞退提繳級距',
               managed: (e) => !['派遣', '外籍'].includes(e.employment_type || '正職'), na: '外籍/派遣不適用勞退新制' },
  }
  const cfg = CFG[mode]

  const correctBracket = (emp) => cfg.managed(emp) ? findGrade(emp.base_salary || 0, cfg.brackets) : null
  const correctVal = (emp) => { const b = correctBracket(emp); return b ? Number(b[cfg.valueKey]) : 0 }
  const currentVal = (emp) => Number(emp[cfg.field]) || 0
  const needsChange = (emp) => cfg.managed(emp) && correctVal(emp) > 0 && String(correctVal(emp)) !== String(currentVal(emp))

  const updateOne = async (emp) => {
    const v = correctVal(emp); if (!v) return
    try {
      setUpdatingId(emp.id)
      const { error } = await supabase.from('employees').update({ [cfg.field]: v }).eq('id', emp.id)
      if (error) throw error
      await fetchData()
    } catch (err) { toast.error('更新失敗：' + (err.message || '未知錯誤')) } finally { setUpdatingId(null) }
  }

  const updateAll = async () => {
    const toUpdate = employees.filter(needsChange)
    if (!toUpdate.length) return
    if (!(await confirm({ message: `確定要更新 ${toUpdate.length} 位員工的${cfg.label}？` }))) return
    try {
      setUpdating(true)
      const results = await Promise.all(toUpdate.map(emp =>
        supabase.from('employees').update({ [cfg.field]: correctVal(emp) }).eq('id', emp.id)))
      const failed = results.filter(r => r.error)
      if (failed.length) toast.error(`更新完成，但有 ${failed.length} 筆失敗，請重新整理後確認`)
      await fetchData()
    } catch (err) { toast.error('批次更新失敗：' + (err.message || '未知錯誤')) } finally { setUpdating(false) }
  }

  if (loading) return <LoadingSpinner />
  if (error) return (
    <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}>
      <h3>{error}</h3>
      <button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button>
    </div>
  )

  const needsChangeList = employees.filter(needsChange)
  const okList = employees.filter(e => !needsChange(e))
  const EMP_TYPE_COLOR = { 正職: 'var(--accent-green)', 約聘: 'var(--accent-cyan)', 兼職: 'var(--accent-orange)', 外籍: 'var(--accent-purple)', 派遣: 'var(--accent-red)' }
  const EMP_TYPE_DIM = { 正職: 'var(--accent-green-dim)', 約聘: 'var(--accent-cyan-dim)', 兼職: 'var(--accent-orange-dim)', 外籍: 'var(--accent-purple-dim)', 派遣: 'var(--accent-red-dim)' }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2>投保級距監控</h2>
            <p>依員工實際月薪比對{cfg.label}，自動偵測需調整項目（勞退依 115/1/1 官方月提繳分級表）</p>
          </div>
          <button className="btn btn-primary" onClick={updateAll}
            disabled={updating || !!updatingId || needsChangeList.length === 0}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw size={14} />
            {updating ? '更新中...' : `一鍵更新全部 (${needsChangeList.length})`}
          </button>
        </div>
      </div>

      {/* 勞保 / 勞退 切換 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[['labor', '勞保投保級距'], ['pension', '勞退提繳級距']].map(([k, l]) => (
          <button key={k} onClick={() => setMode(k)}
            style={{ padding: '8px 18px', borderRadius: 8, cursor: 'pointer', fontWeight: 700,
              border: `1.5px solid ${mode === k ? 'var(--accent-cyan)' : 'var(--border)'}`,
              background: mode === k ? 'var(--accent-cyan-dim)' : 'var(--bg-card)',
              color: mode === k ? 'var(--accent-cyan)' : 'var(--text-secondary)' }}>{l}</button>
        ))}
      </div>

      {/* KPI Cards */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 16 }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">在職員工</div>
          <div className="stat-card-value">{employees.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">需調整{mode === 'pension' ? '勞退' : '勞保'}級距</div>
          <div className="stat-card-value">{needsChangeList.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已正確</div>
          <div className="stat-card-value">{okList.length}</div>
        </div>
      </div>

      {/* Table */}
      <div className="card">
        <div className="card-header">
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <ShieldCheck size={16} style={{ color: 'var(--accent-cyan)' }} />
            {cfg.label}明細
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>員工</th><th>類型</th><th>部門</th><th>目前月薪</th>
                <th>現{mode === 'pension' ? '提繳' : '投保'}級距</th><th>應調整為</th><th>差異</th><th>狀態</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {employees.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無在職員工資料</td></tr>
              )}
              {employees.map(emp => {
                const managed = cfg.managed(emp)
                const cur = currentVal(emp)
                const cor = managed ? correctVal(emp) : cur
                const diff = cor - cur
                const changed = needsChange(emp)
                const empType = emp.employment_type || '正職'
                return (
                  <tr key={emp.id}>
                    <td style={{ fontWeight: 600 }}>{emp.name}</td>
                    <td>
                      <span style={{ padding: '2px 7px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: EMP_TYPE_DIM[empType] || 'var(--accent-green-dim)', color: EMP_TYPE_COLOR[empType] || 'var(--accent-green)' }}>{empType}</span>
                      {!managed && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{cfg.na}</div>}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{emp.dept || emp.store || '—'}</td>
                    <td>NT$ {(emp.base_salary || 0).toLocaleString()}</td>
                    <td>{!managed ? <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>— 不適用</span> : cur ? `NT$ ${cur.toLocaleString()}` : '—'}</td>
                    <td style={{ fontWeight: 600, color: changed ? 'var(--accent-orange)' : 'var(--text-secondary)' }}>
                      {!managed ? '—' : cor ? `NT$ ${cor.toLocaleString()}` : '—'}
                    </td>
                    <td>
                      {!managed ? '—' : diff !== 0 ? (
                        <span style={{ color: diff > 0 ? 'var(--accent-orange)' : 'var(--accent-red)', fontWeight: 600 }}>{diff > 0 ? '+' : ''}{diff.toLocaleString()}</span>
                      ) : <span style={{ color: 'var(--text-muted)' }}>0</span>}
                    </td>
                    <td>
                      {!managed ? <span className="badge badge-info">不適用</span>
                        : changed ? <span className="badge badge-warning">需調整</span>
                          : <span className="badge badge-success">正常</span>}
                    </td>
                    <td>
                      {changed && managed && (
                        <button className="btn btn-sm btn-secondary" onClick={() => updateOne(emp)} disabled={updatingId === emp.id}>
                          {updatingId === emp.id ? '...' : '更新'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
