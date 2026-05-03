import { useState, useEffect } from 'react'
import { RefreshCw, ShieldCheck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'

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
  const [employees, setEmployees] = useState([])
  const [laborBrackets, setLaborBrackets] = useState([])
  const [healthBrackets, setHealthBrackets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [updating, setUpdating] = useState(false)
  const [updatingId, setUpdatingId] = useState(null)

  const fetchData = async () => {
    try {
      setLoading(true)
      setError(null)
      const year = new Date().getFullYear()
      const [empRes, laborRes, healthRes] = await Promise.all([
        supabase
          .from('employees')
          .select('id, name, dept, store, base_salary, labor_ins_grade, health_ins_grade, labor_ins_enrolled, status')
          .eq('status', '在職')
          .eq('organization_id', profile?.organization_id)
          .order('name'),
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
      if (empRes.error) throw empRes.error
      if (laborRes.error) throw laborRes.error
      if (healthRes.error) throw healthRes.error
      setEmployees(empRes.data || [])
      setLaborBrackets(laborRes.data || [])
      setHealthBrackets(healthRes.data || [])
    } catch (err) {
      console.error('Failed to load insurance data:', err)
      setError('資料載入失敗，請重新整理頁面')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  const getCorrectGrade = (emp) => findGrade(emp.base_salary || 0, laborBrackets)

  const needsChange = (emp) => {
    const correct = getCorrectGrade(emp)
    return correct && String(correct.insured_salary) !== String(emp.labor_ins_grade)
  }

  const updateOne = async (emp) => {
    const correct = getCorrectGrade(emp)
    if (!correct) return
    try {
      setUpdatingId(emp.id)
      const { error } = await supabase
        .from('employees')
        .update({ labor_ins_grade: correct.insured_salary })
        .eq('id', emp.id)
      if (error) throw error
      await fetchData()
    } catch (err) {
      console.error('Update failed:', err)
      alert('更新失敗：' + (err.message || '未知錯誤'))
    } finally {
      setUpdatingId(null)
    }
  }

  const updateAll = async () => {
    const toUpdate = employees.filter(needsChange)
    if (!toUpdate.length) return
    if (!confirm(`確定要更新 ${toUpdate.length} 位員工的投保級距？`)) return
    try {
      setUpdating(true)
      const results = await Promise.all(
        toUpdate.map(emp => {
          const correct = getCorrectGrade(emp)
          return supabase
            .from('employees')
            .update({ labor_ins_grade: correct.insured_salary })
            .eq('id', emp.id)
        })
      )
      const failed = results.filter(r => r.error)
      if (failed.length > 0) {
        console.error('Bulk update partial failure:', failed.map(r => r.error))
        alert(`更新完成，但有 ${failed.length} 筆失敗，請重新整理後確認`)
      }
      await fetchData()
    } catch (err) {
      console.error('Bulk update failed:', err)
      alert('批次更新失敗：' + (err.message || '未知錯誤'))
    } finally {
      setUpdating(false)
    }
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

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2>投保級距監控</h2>
            <p>依員工實際月薪比對勞健保應投保薪資級距，自動偵測需調整項目</p>
          </div>
          <button
            className="btn btn-primary"
            onClick={updateAll}
            disabled={updating || !!updatingId || needsChangeList.length === 0}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <RefreshCw size={14} />
            {updating ? '更新中...' : `一鍵更新全部 (${needsChangeList.length})`}
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 16 }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">在職員工</div>
          <div className="stat-card-value">{employees.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">需調整投保級距</div>
          <div className="stat-card-value">{needsChangeList.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已正確投保</div>
          <div className="stat-card-value">{okList.length}</div>
        </div>
      </div>

      {/* Table */}
      <div className="card">
        <div className="card-header">
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <ShieldCheck size={16} style={{ color: 'var(--accent-cyan)' }} />
            投保級距明細
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>員工</th>
                <th>部門</th>
                <th>目前月薪</th>
                <th>現投保薪資</th>
                <th>應調整為</th>
                <th>差異</th>
                <th>狀態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {employees.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                    尚無在職員工資料
                  </td>
                </tr>
              )}
              {employees.map(emp => {
                const correct = getCorrectGrade(emp)
                const current = Number(emp.labor_ins_grade) || 0
                const correctVal = correct ? Number(correct.insured_salary) : current
                const diff = correctVal - current
                const changed = needsChange(emp)
                return (
                  <tr key={emp.id}>
                    <td style={{ fontWeight: 600 }}>{emp.name}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {emp.dept || emp.store || '—'}
                    </td>
                    <td>NT$ {(emp.base_salary || 0).toLocaleString()}</td>
                    <td>{current ? `NT$ ${current.toLocaleString()}` : '—'}</td>
                    <td style={{
                      fontWeight: 600,
                      color: changed ? 'var(--accent-orange)' : 'var(--text-secondary)',
                    }}>
                      {correctVal ? `NT$ ${correctVal.toLocaleString()}` : '—'}
                    </td>
                    <td>
                      {diff !== 0 ? (
                        <span style={{
                          color: diff > 0 ? 'var(--accent-orange)' : 'var(--accent-red)',
                          fontWeight: 600,
                        }}>
                          {diff > 0 ? '+' : ''}{diff.toLocaleString()}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>0</span>
                      )}
                    </td>
                    <td>
                      {changed
                        ? <span className="badge badge-warning">需調整</span>
                        : <span className="badge badge-success">正常</span>
                      }
                    </td>
                    <td>
                      {changed && (
                        <button
                          className="btn btn-sm btn-secondary"
                          onClick={() => updateOne(emp)}
                          disabled={updatingId === emp.id}
                        >
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
