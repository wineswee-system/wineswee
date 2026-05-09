import { useState, useEffect, useRef } from 'react'
import { Plus, Check, X, Printer, Settings } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import SearchableSelect, { empOptions } from '../../components/SearchableSelect'
import { empLabel } from '../../lib/empLabel'
import { printClockCorrectionSignOff } from '../../lib/signOffAdapters'
import ApprovalDetailModal from '../../components/ApprovalDetailModal'
import ChainConfigModal from '../../components/ChainConfigModal'
import { buildFormChainSteps } from '../../lib/buildChainSteps'
import { createApprovalWorkflow } from '../../lib/workflowIntegration'
import { validateRequired, clearError } from '../../lib/formValidation'

export default function PunchCorrection() {
  const { profile, role } = useAuth()
  const userRole = role?.name || profile?.role || 'store_staff'
  const isStaff = userRole === 'store_staff'
  const [showChainModal, setShowChainModal] = useState(false)

  const [corrections, setCorrections] = useState([])
  const [employees, setEmployees] = useState([])
  const [stores, setStores] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [tab, setTab] = useState('pending')
  const [form, setForm] = useState({ employee: isStaff ? (profile?.name || '') : '', date: '', correction_type: 'clock_out', corrected_time: '', reason: '', store: '' })
  const [editingId, setEditingId] = useState(null)
  const [errors, setErrors] = useState({})
  const [organization, setOrganization] = useState(null)  // 印簽呈用
  const [detailRow, setDetailRow] = useState(null)
  const [detailChainSteps, setDetailChainSteps] = useState([])
  const [loadingChain, setLoadingChain] = useState(false)
  const detailRowIdRef = useRef(null)

  const openDetail = async (row) => {
    detailRowIdRef.current = row.id
    setDetailRow(row)
    setLoadingChain(true)
    setDetailChainSteps([])
    const empRow = employees.find(e => e.name === row.employee)
    const steps = await buildFormChainSteps({
      formType: 'punch',
      organizationId: profile?.organization_id,
      applicantName: row.employee,
      applicantId: empRow?.id,
      applicantCreatedAt: row.created_at,
      recordStatus: row.status,
      approverName: row.approved_by,
      approvedAt: row.approved_at,
      rejectReason: row.reject_reason,
    })
    if (detailRowIdRef.current !== row.id) return
    setDetailChainSteps(steps)
    setLoadingChain(false)
  }

  const printWithChain = async (row) => {
    if (!employees.length) { alert('員工清單載入中，請稍候'); return }
    const win = window.open('', '_blank', 'width=900,height=1100')
    if (!win) { alert('請允許彈出視窗才能列印簽呈'); return }
    try {
      const empRow = employees.find(e => e.name === row.employee)
      const chainSteps = await buildFormChainSteps({
        formType: 'punch',
        organizationId: profile?.organization_id,
        applicantName: row.employee,
        applicantId: empRow?.id,
        applicantCreatedAt: row.created_at,
        recordStatus: row.status,
        approverName: row.approved_by,
        approvedAt: row.approved_at,
        rejectReason: row.reject_reason,
      })
      const approverMap = {}
      chainSteps.forEach(s => { if (s.target_emp_id && s.name) approverMap[s.target_emp_id] = s.name })
      printClockCorrectionSignOff(row, {
        companyName: organization?.name, logoUrl: organization?.logo_url,
        signatures: Object.fromEntries(employees.filter(emp => emp.signature_url).map(emp => [emp.name, emp.signature_url])),
        chainSteps,
        approverMap,
        _win: win,
      })
    } catch (e) {
      win.close()
      alert('產生簽呈失敗：' + (e.message || '未知錯誤'))
    }
  }

  const load = () => {
    const orgId = profile?.organization_id
    Promise.all([
      supabase.from('punch_corrections').select('*').order('created_at', { ascending: false }),
      supabase.from('employees').select('id, name, name_en, position, dept, department_id, store, store_id, signature_url, departments!department_id(name), stores!store_id(name)').eq('status', '在職').order('name'),
      orgId ? supabase.from('organizations').select('name, logo_url').eq('id', orgId).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from('stores').select('id, name').eq('organization_id', orgId ?? -1).order('name'),
    ]).then(([c, e, orgRes, s]) => {
      let recs = c.data || []
      if (isStaff && profile?.name) recs = recs.filter(r => r.employee === profile.name)
      setCorrections(recs)
      const emps = e.data || []
      setEmployees(isStaff ? emps.filter(emp => emp.name === profile?.name) : emps)
      setOrganization(orgRes?.data || null)
      setStores(s.data || [])
    }).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!validateRequired(form, ['employee', 'date', 'corrected_time', 'reason', 'store'], setErrors)) return
    const emp = employees.find(e => e.name === form.employee)
    const payload = {
      employee: form.employee,
      employee_id: emp?.id || null,
      date: form.date,
      correction_type: form.correction_type,
      corrected_time: form.corrected_time,
      reason: form.reason,
      store: form.store,
    }

    // ── 編輯路徑 ──（待審核 / 已駁回 都走這條）
    if (editingId) {
      const { error: updErr } = await supabase.from('punch_corrections')
        .update({ ...payload, status: '待審核', reject_reason: null, current_step: 0 })
        .eq('id', editingId)
      if (updErr) { alert('更新失敗：' + updErr.message); return }
      try {
        await supabase.rpc('resume_workflow_for_request', { p_type: 'punch_correction', p_id: editingId })
      } catch (e) { console.error('[resume_workflow] failed:', e) }
      setCorrections(prev => prev.map(c => c.id === editingId ? { ...c, ...payload, status: '待審核', reject_reason: null } : c))
      setShowModal(false); setEditingId(null)
      setForm({ employee: '', date: '', correction_type: 'clock_out', corrected_time: '', reason: '', store: '' })
      return
    }

    // ── 新增 ──
    const { data } = await supabase.from('punch_corrections').insert({
      ...payload, status: '待審核', organization_id: profile?.organization_id || null,
    }).select().single()
    if (data) {
      setCorrections(prev => [data, ...prev])
      setShowModal(false)
      setForm({ employee: '', date: '', correction_type: 'clock_out', corrected_time: '', reason: '', store: '' })
      await createApprovalWorkflow('clock_correction', data, form.employee)
    }
  }

  const openEditPunch = (c) => {
    setEditingId(c.id)
    setForm({
      employee: c.employee || '',
      date: c.date || '',
      correction_type: c.correction_type || 'clock_out',
      corrected_time: c.corrected_time || '',
      reason: c.reason || '',
      store: c.store || '',
    })
    setShowModal(true)
  }

  const handleApprove = async (id) => {
    const correction = corrections.find(c => c.id === id)
    const { data } = await supabase.from('punch_corrections')
      .update({ status: '已核准', approved_by: '管理員', approved_at: new Date().toISOString() })
      .eq('id', id).select().single()
    if (data) {
      setCorrections(prev => prev.map(c => c.id === id ? data : c))

      // Write correction back to attendance_records
      if (correction) {
        const matchField = correction.employee_id ? 'employee_id' : 'employee'
        const matchValue = correction.employee_id || correction.employee
        const { data: existing } = await supabase.from('attendance_records')
          .select('*')
          .eq(matchField, matchValue)
          .eq('date', correction.date).maybeSingle()

        if (existing) {
          const update = {}
          if (correction.correction_type === 'clock_in') {
            update.clock_in = correction.corrected_time
          } else {
            update.clock_out = correction.corrected_time
          }
          // Recalculate hours when both in/out exist
          const finalIn = update.clock_in || existing.clock_in
          const finalOut = update.clock_out || existing.clock_out
          if (finalIn && finalOut) {
            const [inH, inM] = finalIn.split(':').map(Number)
            const [outH, outM] = finalOut.split(':').map(Number)
            let diff = (outH * 60 + outM) - (inH * 60 + inM)
            if (diff < 0) diff += 24 * 60 // overnight shift
            update.hours = Math.round(diff / 60 * 10) / 10
          }
          update.status = existing.status === '未打卡' ? '補登' : existing.status
          await supabase.from('attendance_records').update(update).eq('id', existing.id)
        } else {
          // Create new record
          const newRecord = {
            employee: correction.employee,
            date: correction.date,
            status: '補登',
          }
          if (correction.correction_type === 'clock_in') {
            newRecord.clock_in = correction.corrected_time
          } else {
            newRecord.clock_out = correction.corrected_time
          }
          await supabase.from('attendance_records').insert(newRecord)
        }
      }
    }
  }

  const handleReject = async (id) => {
    const reason = prompt('駁回原因：')
    if (!reason) return
    const { data } = await supabase.from('punch_corrections')
      .update({ status: '已駁回', reject_reason: reason })
      .eq('id', id).select().single()
    if (data) setCorrections(prev => prev.map(c => c.id === id ? data : c))
  }

  if (loading) return <LoadingSpinner />

  const filtered = corrections.filter(c => {
    if (tab === 'pending') return c.status === '待審核'
    if (tab === 'approved') return c.status === '已核准'
    if (tab === 'rejected') return c.status === '已駁回'
    return true
  })

  const pendingCount = corrections.filter(c => c.status === '待審核').length

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🔄</span> 打卡補登申請</h2>
            <p>員工打卡異常補登審核</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {(role?.name === 'super_admin' || role?.name === 'admin') && (
              <button className="btn btn-secondary" onClick={() => setShowChainModal(true)} title="設定補打卡簽核流程">
                <Settings size={14} /> 簽核設定
              </button>
            )}
            <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增補登</button>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {[
          { key: 'pending', label: `待審核 (${pendingCount})` },
          { key: 'approved', label: '已核准' },
          { key: 'rejected', label: '已駁回' },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            background: tab === t.key ? 'var(--accent-cyan)' : 'var(--bg-card)',
            color: tab === t.key ? '#fff' : 'var(--text-muted)',
            border: tab === t.key ? 'none' : '1px solid var(--border-medium)',
          }}>{t.label}</button>
        ))}
      </div>

      <div className="card">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>員工</th><th>日期</th><th>類型</th><th>補登時間</th><th>原因</th><th>狀態</th><th>操作</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>無資料</td></tr>}
              {filtered.map(c => (
                <tr key={c.id} onClick={() => openDetail(c)} style={{ cursor: 'pointer' }} title="點擊查看簽核明細"
                  onMouseEnter={(ev) => ev.currentTarget.style.background = 'var(--bg-secondary)'}
                  onMouseLeave={(ev) => ev.currentTarget.style.background = ''}>
                  <td style={{ fontWeight: 600 }}>{c.employee}</td>
                  <td>{c.date}</td>
                  <td><span className="badge badge-cyan">{c.correction_type === 'clock_in' ? '上班' : '下班'}</span></td>
                  <td style={{ fontWeight: 600 }}>{c.corrected_time}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 200 }}>{c.reason}</td>
                  <td>
                    <span className={`badge ${c.status === '已核准' ? 'badge-success' : c.status === '已駁回' ? 'badge-danger' : 'badge-warning'}`}>
                      <span className="badge-dot"></span>{c.status}
                    </span>
                  </td>
                  <td onClick={(ev) => ev.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                      {c.status === '待審核' ? (
                        <>
                          <button className="btn btn-sm btn-primary" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => handleApprove(c.id)}>
                            <Check size={12} /> 核准
                          </button>
                          <button className="btn btn-sm btn-secondary" style={{ padding: '4px 10px', fontSize: 11, color: 'var(--accent-red)' }} onClick={() => handleReject(c.id)}>
                            <X size={12} /> 駁回
                          </button>
                        </>
                      ) : (
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {c.approved_by}
                          {c.reject_reason && <div style={{ color: 'var(--accent-red)' }}>原因：{c.reject_reason}</div>}
                        </span>
                      )}
                      {['待審核','申請中','已駁回','已退回'].includes(c.status) && c.employee === profile?.name && (
                        <button className="btn btn-sm btn-primary" style={{ padding: '4px 8px', fontSize: 11, background: 'var(--accent-orange)' }} onClick={() => openEditPunch(c)}>
                          ✏️ {(['已駁回','已退回'].includes(c.status)) ? '編輯重送' : '編輯'}
                        </button>
                      )}
                      <button className="btn btn-sm btn-secondary" style={{ padding: '4px 8px', fontSize: 11 }} title="下載簽呈"
                        onClick={() => printWithChain(c)}>
                        <Printer size={11} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <Modal title={editingId ? '✏️ 編輯補登申請' : '新增補登申請'} onClose={() => { setShowModal(false); setErrors({}); setEditingId(null) }} onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="員工 *" error={errors.employee} errorMsg="請選擇員工">
              <SearchableSelect
                value={form.employee}
                onChange={(v) => { set('employee', v || ''); clearError('employee', setErrors) }}
                options={empOptions(employees, { keyBy: 'name' })}
                placeholder="搜尋員工姓名..."
              />
            </Field>
            <Field label="日期 *" error={errors.date} errorMsg="請選日期">
              <input className="form-input" type="date" style={{ width: '100%' }} value={form.date} onChange={e => { set('date', e.target.value); clearError('date', setErrors) }} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="補登類型">
              <select className="form-input" style={{ width: '100%' }} value={form.correction_type} onChange={e => set('correction_type', e.target.value)}>
                <option value="clock_in">上班打卡</option>
                <option value="clock_out">下班打卡</option>
              </select>
            </Field>
            <Field label="補登時間 *" error={errors.corrected_time} errorMsg="請選時間">
              <input className="form-input" type="time" style={{ width: '100%' }} value={form.corrected_time} onChange={e => { set('corrected_time', e.target.value); clearError('corrected_time', setErrors) }} />
            </Field>
          </div>
          <Field label="補打卡門市 *" error={errors.store} errorMsg="請選門市">
            <select className="form-input" style={{ width: '100%' }} value={form.store || ''}
              onChange={e => { set('store', e.target.value); clearError('store', setErrors) }}>
              <option value="">— 選擇實際門市 —</option>
              {stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              💡 跨門市支援請選實際門市
            </div>
          </Field>
          <Field label="原因 *" error={errors.reason} errorMsg="請填寫原因">
            <textarea className="form-input" style={{ width: '100%', minHeight: 80, resize: 'vertical' }} placeholder="例：忘記打卡、系統異常..."
              value={form.reason} onChange={e => { set('reason', e.target.value); clearError('reason', setErrors) }} />
          </Field>
        </Modal>
      )}

      {detailRow && (() => {
        const empRow = employees.find(e => e.name === detailRow.employee)
        const typeLabel = detailRow.correction_type === 'clock_in' ? '上班打卡' : '下班打卡'
        return (
          <ApprovalDetailModal
            open={!!detailRow}
            onClose={() => { setDetailRow(null); setDetailChainSteps([]) }}
            docTitle="補打卡申請"
            docNo={detailRow.id}
            status={detailRow.status}
            applicant={{
              name: detailRow.employee,
              name_en: empRow?.name_en,
              position: empRow?.position,
              dept: empRow?.dept,
              status: empRow?.status,
              employee_no: empRow?.employee_no,
            }}
            fields={[
              { label: '日期', value: detailRow.date },
              { label: '打卡類型', value: typeLabel },
              { label: '補登時間', value: detailRow.corrected_time },
              { label: '原因', value: detailRow.reason, multiline: true },
              ...(detailRow.reject_reason ? [{ label: '駁回原因', value: detailRow.reject_reason, multiline: true }] : []),
            ]}
            createdAt={detailRow.created_at}
            chainSteps={loadingChain ? [{ label: '載入中…', name: '', status: 'pending' }] : detailChainSteps}
            onPrint={() => printWithChain(detailRow)}
          />
        )
      })()}

      <ChainConfigModal
        open={showChainModal}
        onClose={() => setShowChainModal(false)}
        formType="punch"
        formLabel="補打卡"
        organizationId={profile?.organization_id}
      />
    </div>
  )
}
