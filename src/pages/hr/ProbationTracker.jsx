import { useState, useEffect, useMemo } from 'react'
import { Plus, AlertTriangle, CheckCircle, Clock, Edit2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { getProbationRecords, createProbationRecord, updateProbationRecord } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import SearchableSelect, { empOptions } from '../../components/SearchableSelect'
import { empLabel } from '../../lib/empLabel'

import { toast } from '../../lib/toast'
const STATUS_STYLES = {
  '試用中': { color: 'var(--accent-cyan)', bg: 'rgba(6,182,212,0.12)' },
  '已通過': { color: 'var(--accent-green)', bg: 'rgba(16,185,129,0.12)' },
  '未通過': { color: 'var(--accent-red)', bg: 'rgba(239,68,68,0.12)' },
  '延長試用': { color: 'var(--accent-orange)', bg: 'rgba(245,158,11,0.12)' },
}

const EMPTY_FORM = { employee: '', start_date: '', end_date: '', mentor: '', notes: '' }

export default function ProbationTracker() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [records, setRecords] = useState([])
  const [employees, setEmployees] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [showEvalModal, setShowEvalModal] = useState(false)
  const [evalTarget, setEvalTarget] = useState(null)
  const [evalForm, setEvalForm] = useState({ score: 80, comment: '', result: '已通過' })
  const [statusFilter, setStatusFilter] = useState('')

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    Promise.all([
      getProbationRecords(),
      supabase.from('employees').select('id, name, name_en, dept, department_id, store, store_id, position, join_date, departments!department_id(name), stores!store_id(name)').eq('status', '在職').order('name'),
    ]).then(([r, e]) => {
      setRecords(r.data || [])
      setEmployees(e.data || [])
    }).catch(err => {
      console.error('Failed to load probation data:', err)
      setError('資料載入失敗')
    }).finally(() => setLoading(false))
  }, [])

  const handleCreate = async () => {
    if (!form.employee || !form.start_date || !form.end_date) return toast.warning('請填寫必要欄位')
    const { data, error: err } = await createProbationRecord({
      employee: form.employee,
      start_date: form.start_date,
      end_date: form.end_date,
      mentor: form.mentor || null,
      notes: form.notes || null,
      status: '試用中',
    })
    if (err) return toast.error('建立失敗：' + err.message)
    setRecords(prev => [...prev, data])
    setShowModal(false)
    setForm(EMPTY_FORM)
  }

  const handleEval = async () => {
    if (!evalTarget) return
    const evaluations = [...(evalTarget.evaluations || []), {
      date: new Date().toISOString().slice(0, 10),
      score: Number(evalForm.score),
      comment: evalForm.comment,
      result: evalForm.result,
    }]
    const { data, error: err } = await updateProbationRecord(evalTarget.id, {
      evaluations,
      status: evalForm.result,
      result: evalForm.result,
      decided_at: evalForm.result !== '試用中' ? new Date().toISOString().slice(0, 10) : null,
    })
    if (err) return toast.error('評核失敗：' + err.message)
    setRecords(prev => prev.map(r => r.id === evalTarget.id ? data : r))
    setShowEvalModal(false)
    setEvalTarget(null)
  }

  const openEval = (record) => {
    setEvalTarget(record)
    setEvalForm({ score: 80, comment: '', result: '已通過' })
    setShowEvalModal(true)
  }

  const today = new Date().toISOString().slice(0, 10)

  const filtered = useMemo(() => {
    let list = records
    if (statusFilter) list = list.filter(r => r.status === statusFilter)
    return list.sort((a, b) => new Date(a.end_date) - new Date(b.end_date))
  }, [records, statusFilter])

  const stats = useMemo(() => {
    const active = records.filter(r => r.status === '試用中').length
    const passed = records.filter(r => r.status === '已通過').length
    const failed = records.filter(r => r.status === '未通過').length
    const expiring = records.filter(r => {
      if (r.status !== '試用中') return false
      const diff = (new Date(r.end_date) - new Date()) / (1000 * 60 * 60 * 24)
      return diff <= 14 && diff >= 0
    }).length
    return { active, passed, failed, expiring }
  }, [records])

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3></div>

  return (
    <div>
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📋</span> 試用期管理</h2>
            <p>追蹤試用期進度、評核、到期提醒</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={() => { setForm(EMPTY_FORM); setShowModal(true) }}>
              <Plus size={14} /> 新增試用紀錄
            </button>
          </div>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'rgba(6,182,212,0.12)' }}>
          <div className="stat-card-label">試用中</div>
          <div className="stat-card-value">{stats.active}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'rgba(245,158,11,0.12)' }}>
          <div className="stat-card-label">即將到期（14天內）</div>
          <div className="stat-card-value">{stats.expiring}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'rgba(16,185,129,0.12)' }}>
          <div className="stat-card-label">已通過</div>
          <div className="stat-card-value">{stats.passed}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'rgba(239,68,68,0.12)' }}>
          <div className="stat-card-label">未通過</div>
          <div className="stat-card-value">{stats.failed}</div>
        </div>
      </div>

      {/* Filter */}
      <div style={{
        display: 'flex', gap: 16, marginBottom: 16, padding: '12px 16px',
        background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 10,
        alignItems: 'center',
      }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>📋 狀態</span>
        <select className="form-input" style={{ fontSize: 13, minWidth: 130 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">全部</option>
          <option value="試用中">試用中</option>
          <option value="已通過">已通過</option>
          <option value="未通過">未通過</option>
          <option value="延長試用">延長試用</option>
        </select>
      </div>

      {/* Expiring alerts */}
      {stats.expiring > 0 && (
        <div style={{
          padding: '10px 16px', marginBottom: 16, borderRadius: 8,
          background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)',
          display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--accent-orange)',
        }}>
          <AlertTriangle size={16} />
          <span style={{ fontWeight: 600 }}>{stats.expiring} 位員工試用期將於 14 天內到期，請安排評核</span>
        </div>
      )}

      {/* Records table */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon"><Clock size={16} /></span> 試用期紀錄</div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>員工</th>
                <th>開始日期</th>
                <th>結束日期</th>
                <th>剩餘天數</th>
                <th>進度</th>
                <th>指導人</th>
                <th>評核次數</th>
                <th>狀態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const startD = new Date(r.start_date)
                const endD = new Date(r.end_date)
                const totalDays = Math.max((endD - startD) / (1000 * 60 * 60 * 24), 1)
                const elapsed = Math.max((new Date() - startD) / (1000 * 60 * 60 * 24), 0)
                const remaining = Math.max(Math.ceil((endD - new Date()) / (1000 * 60 * 60 * 24)), 0)
                const pct = Math.min(Math.round((elapsed / totalDays) * 100), 100)
                const isExpiring = r.status === '試用中' && remaining <= 14
                const st = STATUS_STYLES[r.status] || STATUS_STYLES['試用中']
                const evalCount = (r.evaluations || []).length

                return (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 600 }}>{r.employee}</td>
                    <td>{r.start_date}</td>
                    <td>{r.end_date}</td>
                    <td style={{ color: isExpiring ? 'var(--accent-red)' : undefined, fontWeight: isExpiring ? 700 : undefined }}>
                      {r.status === '試用中' ? `${remaining} 天` : '-'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 60, height: 6, borderRadius: 3, background: 'var(--border-subtle)', overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: pct >= 90 ? 'var(--accent-orange)' : 'var(--accent-cyan)' }} />
                        </div>
                        <span style={{ fontSize: 12 }}>{pct}%</span>
                      </div>
                    </td>
                    <td>{r.mentor || '-'}</td>
                    <td>{evalCount}</td>
                    <td>
                      <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600, color: st.color, background: st.bg }}>
                        {r.status}
                      </span>
                    </td>
                    <td>
                      {r.status === '試用中' && (
                        <button className="btn btn-secondary" style={{ padding: '2px 10px', fontSize: 12 }} onClick={() => openEval(r)}>
                          <Edit2 size={12} /> 評核
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>無試用紀錄</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Modal */}
      {showModal && (
        <Modal title="新增試用紀錄" onClose={() => setShowModal(false)} onSubmit={handleCreate}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="員工 *">
              <SearchableSelect
                value={form.employee}
                onChange={(v) => {
                  setF('employee', v || '')
                  const emp = employees.find(em => em.name === v)
                  if (emp?.join_date) {
                    setF('start_date', emp.join_date)
                    const end = new Date(emp.join_date)
                    end.setMonth(end.getMonth() + 3)
                    setF('end_date', end.toISOString().slice(0, 10))
                  }
                }}
                options={empOptions(employees, { keyBy: 'name' })}
                placeholder="搜尋員工姓名..."
              />
            </Field>
            <Field label="指導人">
              <SearchableSelect
                value={form.mentor}
                onChange={(v) => setF('mentor', v || '')}
                options={empOptions(employees, { keyBy: 'name' })}
                placeholder="搜尋指導人..."
              />
            </Field>
            <Field label="開始日期 *">
              <input type="date" className="form-input" style={{ width: '100%' }} value={form.start_date} onChange={e => setF('start_date', e.target.value)} />
            </Field>
            <Field label="結束日期 *">
              <input type="date" className="form-input" style={{ width: '100%' }} value={form.end_date} onChange={e => setF('end_date', e.target.value)} />
            </Field>
          </div>
          <Field label="備註">
            <textarea className="form-input" style={{ width: '100%', minHeight: 60 }} value={form.notes} onChange={e => setF('notes', e.target.value)} />
          </Field>
        </Modal>
      )}

      {/* Evaluation Modal */}
      {showEvalModal && evalTarget && (
        <Modal title={`評核：${evalTarget.employee}`} onClose={() => { setShowEvalModal(false); setEvalTarget(null) }} onSubmit={handleEval}>
          <Field label="評核分數">
            <input type="number" className="form-input" style={{ width: '100%' }} min={0} max={100} value={evalForm.score}
              onChange={e => setEvalForm(f => ({ ...f, score: e.target.value }))} />
          </Field>
          <Field label="結果">
            <select className="form-input" style={{ width: '100%' }} value={evalForm.result}
              onChange={e => setEvalForm(f => ({ ...f, result: e.target.value }))}>
              <option value="試用中">繼續試用</option>
              <option value="已通過">通過</option>
              <option value="未通過">未通過</option>
              <option value="延長試用">延長試用</option>
            </select>
          </Field>
          <Field label="評語">
            <textarea className="form-input" style={{ width: '100%', minHeight: 80 }} value={evalForm.comment}
              onChange={e => setEvalForm(f => ({ ...f, comment: e.target.value }))} placeholder="試用期表現評語..." />
          </Field>

          {/* Previous evaluations */}
          {(evalTarget.evaluations || []).length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>歷次評核</div>
              {evalTarget.evaluations.map((ev, i) => (
                <div key={i} style={{ padding: '6px 10px', background: 'var(--bg-secondary)', borderRadius: 6, marginBottom: 4, fontSize: 12 }}>
                  <span style={{ fontWeight: 600 }}>{ev.date}</span> · 分數 {ev.score} · {ev.result}
                  {ev.comment && <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>{ev.comment}</div>}
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}
