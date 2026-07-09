import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useReturnNav } from '../../lib/useReturnNav'
import { Plus, Check, X, Printer, Settings, Paperclip, Search } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import DateRangeField from '../../components/DateRangeField'
import { monthStartTW, todayTW } from '../../lib/datetime'
import LoadingSpinner from '../../components/LoadingSpinner'
import AsyncButton from '../../components/AsyncButton'
import Time24 from '../../components/Time24'
import ExtraSignerControls from '../../components/ExtraSignerControls'
import Modal, { Field } from '../../components/Modal'
import SearchableSelect, { empOptions } from '../../components/SearchableSelect'
import { empLabel } from '../../lib/empLabel'
import { printClockCorrectionSignOff } from '../../lib/signOffAdapters'
import ApprovalDetailModal from '../../components/ApprovalDetailModal'
import { buildFormChainSteps } from '../../lib/buildChainSteps'
import { createApprovalWorkflow } from '../../lib/workflowIntegration'
import { validateRequired, clearError } from '../../lib/formValidation'
import { uploadFormAttachments, cloneFormAttachments, loadCarriedFormAttachments } from '../../lib/formAttachments'
import CarriedAttachments from '../../components/CarriedAttachments'
import { usePendingApprovals } from '../../lib/usePendingApprovals'
import { useChainGuard } from '../../lib/useChainGuard'

import { toast } from '../../lib/toast'
// LIFF 既有 row 可能有中文 type，Web 這邊統一解到 clock_in / clock_out 顯示
const normalizeType = (t) => {
  if (t === 'clock_in' || t === '上班打卡') return 'clock_in'
  if (t === 'clock_out' || t === '下班打卡') return 'clock_out'
  return t
}

export default function PunchCorrection() {
  const { profile, isStoreStaff, hasPermission } = useAuth()
  const canDeleteAll = hasPermission('hr_form.delete_all')
  const canEditClock = hasPermission('clock.correction_edit')
  const { canApprove } = usePendingApprovals()
  const chainGuard = useChainGuard({ formType: 'correction', organizationId: profile?.organization_id })
  const navigate = useNavigate()
  const returnNav = useReturnNav()
  const isStaff = isStoreStaff

  const [corrections, setCorrections] = useState([])
  const [employees, setEmployees] = useState([])
  const [stores, setStores] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [tab, setTab] = useState('pending')
  const [search, setSearch] = useState('')
  const [startDate, setStartDate] = useState(() => monthStartTW())  // 日期區間，預設本月1號~今天
  const [endDate, setEndDate] = useState(() => todayTW())
  const [form, setForm] = useState({ employee: isStaff ? (profile?.name || '') : '', date: '', type: 'clock_out', correction_time: '', reason: '', store: '' })
  const [editingId, setEditingId] = useState(null)
  const [cloneSourceId, setCloneSourceId] = useState(null)  // 複製重送：來源單 id（送出後複製附件）
  const [carriedAtts, setCarriedAtts] = useState([])  // 複製重送帶入的舊附件（彈窗內可看/可刪）
  const removeCarriedAtt = (idx) => setCarriedAtts(prev => prev.filter((_, i) => i !== idx))
  const [errors, setErrors] = useState({})
  const [organization, setOrganization] = useState(null)  // 印簽呈用
  // 附件（對齊 Leave）：上傳到 attachments bucket / punch/ 子目錄
  const [attachFiles, setAttachFiles] = useState([])
  const [uploading, setUploading] = useState(false)

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || [])
    const newFiles = files.map(f => ({ file: f, preview: URL.createObjectURL(f) }))
    setAttachFiles(prev => [...prev, ...newFiles].slice(0, 5))
    e.target.value = ''
  }
  const removeAttach = (idx) => {
    setAttachFiles(prev => {
      try { URL.revokeObjectURL(prev[idx].preview) } catch {}
      return prev.filter((_, i) => i !== idx)
    })
  }
  const uploadAttachments = async (correctionId, empId) => {
    if (attachFiles.length === 0) return
    setUploading(true)
    try {
      await uploadFormAttachments({
        formType: 'correction', formId: correctionId, files: attachFiles,
        organizationId: profile?.organization_id,
        uploaderEmpId: empId || profile?.id, uploaderName: profile?.name,
      })
    } finally {
      setUploading(false)
    }
  }
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
      approverName: row.approver,
      approvedAt: row.approved_at,
      rejectReason: row.reject_reason,
      requestType: 'correction',
      requestId: row.id,
      currentStep: row.current_step,
    })
    if (detailRowIdRef.current !== row.id) return
    setDetailChainSteps(steps)
    setLoadingChain(false)
  }

  const printWithChain = async (row) => {
    if (!employees.length) { toast.error('員工清單載入中，請稍候'); return }
    const win = window.open('', '_blank', 'width=900,height=1100')
    if (!win) { toast.error('請允許彈出視窗才能列印簽呈'); return }
    try {
      const empRow = employees.find(e => e.name === row.employee)
      const chainSteps = await buildFormChainSteps({
        formType: 'punch',
        organizationId: profile?.organization_id,
        applicantName: row.employee,
        applicantId: empRow?.id,
        applicantCreatedAt: row.created_at,
        recordStatus: row.status,
        approverName: row.approver,
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
      toast.error('產生簽呈失敗：' + (e.message || '未知錯誤'))
    }
  }

  const load = () => {
    const orgId = profile?.organization_id
    Promise.all([
      supabase.from('clock_corrections').select('*').is('deleted_at', null).order('created_at', { ascending: false }),
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

  // Dashboard ApprovalCenter 跳過來時 ?focus=ID 自動開明細
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    const focus = searchParams.get('focus')
    if (!focus || !corrections.length) return
    const row = corrections.find(c => c.id === Number(focus))
    if (row) {
      openDetail(row)
      setSearchParams(sp => { const x = new URLSearchParams(sp); x.delete('focus'); return x }, { replace: true })
    }
  }, [corrections, searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!validateRequired(form, ['employee', 'date', 'correction_time', 'reason', 'store'], setErrors)) return
    const emp = employees.find(e => e.name === form.employee)
    const payload = {
      employee: form.employee,
      employee_id: emp?.id || null,
      date: form.date,
      type: form.type,
      correction_time: form.correction_time,
      reason: form.reason,
      store: form.store,
    }

    // ── 編輯路徑 ──（待審核 / 已駁回 都走這條）
    if (editingId) {
      const { error: updErr } = await supabase.from('clock_corrections')
        .update({ ...payload, status: '待審核', reject_reason: null, current_step: 0 })
        .eq('id', editingId)
      if (updErr) { toast.error('更新失敗：' + updErr.message); return }
      try {
        const { error: rpcErr } = await supabase.rpc('resume_workflow_for_request', { p_type: 'correction', p_id: editingId })
        if (rpcErr) {
          console.error('[resume_workflow] error:', rpcErr)
          toast.error('簽核流程重啟失敗：' + rpcErr.message)
        }
      } catch (e) {
        console.error('[resume_workflow] failed:', e)
        toast.error('簽核流程重啟失敗：' + (e.message || '未知錯誤'))
      }
      setCorrections(prev => prev.map(c => c.id === editingId ? { ...c, ...payload, status: '待審核', reject_reason: null } : c))
      setShowModal(false); setEditingId(null)
      setForm({ employee: profile?.name || '', date: '', type: 'clock_out', correction_time: '', reason: '', store: '' })
      return
    }

    // ── 新增 ──
    const { data } = await supabase.from('clock_corrections').insert({
      ...payload, status: '待審核', organization_id: profile?.organization_id || null,
    }).select().single()
    if (data) {
      if (attachFiles.length > 0) {
        await uploadAttachments(data.id, emp?.id)
        setAttachFiles([])
      }
      // 複製重送：把彈窗裡「留下的」舊附件複製到新單（含 storage 檔，獨立）
      if (cloneSourceId) {
        if (carriedAtts.length) {
          await cloneFormAttachments({ formType: 'correction', toFormId: data.id, organizationId: profile?.organization_id, uploaderEmpId: emp?.id, uploaderName: form.employee, atts: carriedAtts })
        }
        setCloneSourceId(null)
        setCarriedAtts([])
      }
      setCorrections(prev => [data, ...prev])
      setShowModal(false)
      setForm({ employee: profile?.name || '', date: '', type: 'clock_out', correction_time: '', reason: '', store: '' })
      await createApprovalWorkflow('clock_correction', data, form.employee)
    }
  }

  const openEditPunch = (c) => {
    setEditingId(c.id)
    setForm({
      employee: c.employee || '',
      date: c.date || '',
      type: normalizeType(c.type) || 'clock_out',
      correction_time: c.correction_time || '',
      reason: c.reason || '',
      store: c.store || '',
    })
    setShowModal(true)
  }

  // 複製：以舊單為範本開全新單（含附件，不動原單）
  const openClonePunch = (c) => { openEditPunch(c); setEditingId(null); setCloneSourceId(c.id); loadCarriedFormAttachments('correction', c.id).then(setCarriedAtts) }

  const handleApprove = async (id) => {
    const correction = corrections.find(c => c.id === id)
    const { data: result, error } = await supabase.rpc('web_advance_chain_request', {
      p_type: 'correction', p_id: id, p_action: 'approve',
    })
    if (error) { toast.error('操作失敗：' + error.message); return }
    if (!result?.ok) { toast.error('操作失敗：' + (result?.error || '未知')); return }

    if (result.event === 'approved' && correction) {
      // Write correction back to attendance_records
      const matchField = correction.employee_id ? 'employee_id' : 'employee'
      const matchValue = correction.employee_id || correction.employee
      const { data: existing } = await supabase.from('attendance_records')
        .select('*').eq(matchField, matchValue).eq('date', correction.date).maybeSingle()
      if (existing) {
        const update = {}
        if (normalizeType(correction.type) === 'clock_in') {
          update.clock_in = correction.correction_time
        } else {
          update.clock_out = correction.correction_time
        }
        const finalIn = update.clock_in || existing.clock_in
        const finalOut = update.clock_out || existing.clock_out
        if (finalIn && finalOut) {
          const [inH, inM] = finalIn.split(':').map(Number)
          const [outH, outM] = finalOut.split(':').map(Number)
          let diff = (outH * 60 + outM) - (inH * 60 + inM)
          if (diff < 0) diff += 24 * 60
          update.hours = Math.round(diff / 60 * 10) / 10
        }
        update.status = existing.status === '未打卡' ? '補登' : existing.status
        await supabase.from('attendance_records').update(update).eq('id', existing.id)
      } else {
        const newRecord = { employee: correction.employee, date: correction.date, status: '補登' }
        if (normalizeType(correction.type) === 'clock_in') {
          newRecord.clock_in = correction.correction_time
        } else {
          newRecord.clock_out = correction.correction_time
        }
        await supabase.from('attendance_records').insert(newRecord)
      }
    }
    setCorrections(prev => prev.map(c => c.id === id ? { ...c, status: result.status } : c))
  }

  const handleReject = async (id, reasonArg) => {
    const reason = reasonArg ?? prompt('駁回原因：')
    if (!reason) return
    const { data: result, error } = await supabase.rpc('web_advance_chain_request', {
      p_type: 'correction', p_id: id, p_action: 'reject', p_reason: reason,
    })
    if (error) { toast.error('操作失敗：' + error.message); return }
    if (!result?.ok) { toast.error('操作失敗：' + (result?.error || '未知')); return }
    setCorrections(prev => prev.map(c => c.id === id ? { ...c, status: result.status } : c))
  }

  const handleDelete = async (row) => {
    if (!(await confirm({ message: '移至最近刪除？可在 60 天內復原。' }))) return
    const { error } = await supabase.rpc('soft_delete_request', { p_table: 'clock_corrections', p_id: row.id, p_deleted_by: profile?.id ?? null })
    if (error) { toast.error('刪除失敗：' + error.message); return }
    toast.success('已移至最近刪除')
    load()
  }

  if (loading) return <LoadingSpinner />

  const filtered = corrections.filter(c => {
    if (c.date && (c.date < startDate || c.date > endDate)) return false  // 日期區間篩選（純檢視用）
    if (tab === 'pending' && c.status !== '待審核') return false
    if (tab === 'approved' && c.status !== '已核准') return false
    if (tab === 'rejected' && c.status !== '已駁回') return false
    if (search.trim() && ![String(c.id), c.employee_name, c.reason, c.type].some(f => (f||'').toLowerCase().includes(search.trim().toLowerCase()))) return false
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
            {hasPermission('approval_chain.edit') && (
              <button className="btn btn-secondary" onClick={() => navigate('/process/settings/chains/edit?formType=correction&label=補打卡')} title="設定補打卡簽核流程">
                <Settings size={14} /> 簽核設定
              </button>
            )}
            <button
              className="btn btn-primary"
              disabled={chainGuard.blocked}
              title={chainGuard.blocked ? chainGuard.reason : undefined}
              onClick={() => {
                if (chainGuard.blocked) { toast.error(chainGuard.reason); return }
                setEditingId(null)
                setForm({ employee: profile?.name || '', date: '', type: 'clock_out', correction_time: '', reason: '', store: '' })
                setErrors({})
                setShowModal(true)
              }}><Plus size={14} /> 新增補登</button>
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '12px 16px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>📅 日期</span>
            <DateRangeField start={startDate} end={endDate} onChange={(s, e) => { setStartDate(s); setEndDate(e) }} />
          </div>
          <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
            <Search size={13} style={{ position: 'absolute', left: 8, color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜尋單號" style={{ paddingLeft: 26, paddingRight: search ? 26 : 10, paddingTop: 5, paddingBottom: 5, borderRadius: 6, border: '1px solid var(--border-medium)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13, outline: 'none', width: 120 }} />
            {search && <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}><X size={12} /></button>}
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th style={{ width: 55 }}>單號</th><th>員工</th><th>日期</th><th>類型</th><th>補登時間</th><th>原因</th><th>狀態</th><th>操作</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>無資料</td></tr>}
              {filtered.map(c => (
                <tr key={c.id} onClick={() => openDetail(c)} style={{ cursor: 'pointer' }} title="點擊查看簽核明細"
                  onMouseEnter={(ev) => ev.currentTarget.style.background = 'var(--bg-secondary)'}
                  onMouseLeave={(ev) => ev.currentTarget.style.background = ''}>
                  <td style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)' }}>#{c.id}</td>
                  <td style={{ fontWeight: 600 }}>{c.employee}</td>
                  <td>{c.date}</td>
                  <td><span className="badge badge-cyan">{normalizeType(c.type) === 'clock_in' ? '上班' : '下班'}</span></td>
                  <td style={{ fontWeight: 600 }}>{c.correction_time}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 200 }}>{c.reason}</td>
                  <td>
                    <span className={`badge ${c.status === '已核准' ? 'badge-success' : c.status === '已駁回' ? 'badge-danger' : 'badge-warning'}`}>
                      <span className="badge-dot"></span>{c.status}
                    </span>
                  </td>
                  <td onClick={(ev) => ev.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                      {c.status === '待審核' && canApprove('clock_corrections', c.id) ? (
                        <span style={{ fontSize: 11, color: 'var(--accent-cyan)', fontWeight: 600 }}>點明細簽核</span>
                      ) : (
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {c.approver}
                          {c.reject_reason && <div style={{ color: 'var(--accent-red)' }}>原因：{c.reject_reason}</div>}
                        </span>
                      )}
                      {['待審核','申請中','已駁回','已退回'].includes(c.status) && (canEditClock || c.employee === profile?.name) && (
                        <button className="btn btn-sm btn-primary" style={{ padding: '4px 8px', fontSize: 11, background: 'var(--accent-orange)' }} onClick={() => openEditPunch(c)}>
                          ✏️ {(['已駁回','已退回'].includes(c.status)) ? '編輯重送' : '編輯'}
                        </button>
                      )}
                      {c.employee === profile?.name && (
                        <button className="btn btn-sm btn-secondary" style={{ padding: '4px 8px', fontSize: 11, color: 'var(--accent-cyan)' }} title="以這張為範本開一張全新申請（含附件，不動原單）" onClick={() => openClonePunch(c)}>
                          📋 複製
                        </button>
                      )}
                      <button className="btn btn-sm btn-secondary" style={{ padding: '4px 8px', fontSize: 11 }} title="下載簽呈"
                        onClick={() => printWithChain(c)}>
                        <Printer size={11} />
                      </button>
                      {canDeleteAll && (
                        <button className="btn btn-sm btn-secondary" style={{ fontSize: 11, padding: '3px 8px', color: 'var(--accent-red)' }} onClick={() => handleDelete(c)} title="永久刪除">
                          刪除
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <Modal
          title={editingId ? '✏️ 編輯補登申請' : '新增補登申請'}
          onClose={() => { setShowModal(false); setErrors({}); setEditingId(null); setCloneSourceId(null); setCarriedAtts([]) }}
          onSubmit={handleSubmit}
          successMessage={editingId ? '已重新送審，主管會收到通知' : '補登申請已送出，等待主管簽核'}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="員工" required error={errors.employee} errorMsg="請選擇員工">
              <SearchableSelect
                value={form.employee}
                onChange={(v) => { set('employee', v || ''); clearError('employee', setErrors) }}
                options={empOptions(employees, { keyBy: 'name' })}
                placeholder="搜尋員工姓名..."
              />
            </Field>
            <Field label="日期" required error={errors.date} errorMsg="請選日期">
              <input className="form-input" type="date" style={{ width: '100%' }} value={form.date} onChange={e => { set('date', e.target.value); clearError('date', setErrors) }} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="補登類型">
              <select className="form-input" style={{ width: '100%' }} value={form.type} onChange={e => set('type', e.target.value)}>
                <option value="clock_in">上班打卡</option>
                <option value="clock_out">下班打卡</option>
              </select>
            </Field>
            <Field label="補登時間" required error={errors.correction_time} errorMsg="請選時間">
              <Time24 value={form.correction_time} onChange={v => { set('correction_time', v); clearError('correction_time', setErrors) }} />
            </Field>
          </div>
          <Field label="補打卡門市" required error={errors.store} errorMsg="請選門市">
            <select className="form-input" style={{ width: '100%' }} value={form.store || ''}
              onChange={e => { set('store', e.target.value); clearError('store', setErrors) }}>
              <option value="">— 選擇實際門市 —</option>
              {stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              💡 跨門市支援請選實際門市
            </div>
          </Field>
          <Field label="原因" required error={errors.reason} errorMsg="請填寫原因">
            <textarea className="form-input" style={{ width: '100%', minHeight: 80, resize: 'vertical' }} placeholder="例：忘記打卡、系統異常..."
              value={form.reason} onChange={e => { set('reason', e.target.value); clearError('reason', setErrors) }} />
          </Field>
          <Field label="附件（最多 5 個）">
            <div>
              <CarriedAttachments atts={carriedAtts} onRemove={removeCarriedAtt} />
              <input type="file" multiple accept="image/*,application/pdf"
                onChange={handleFileSelect}
                style={{ fontSize: 12 }}
              />
              {attachFiles.length > 0 && (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {attachFiles.map((a, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '4px 8px', background: 'var(--bg-secondary)', borderRadius: 6 }}>
                      <Paperclip size={11} />
                      <span style={{ flex: 1 }}>{a.file.name}</span>
                      <button type="button" onClick={() => removeAttach(i)}
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 0 }}>✕</button>
                    </div>
                  ))}
                </div>
              )}
              {uploading && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>📤 附件上傳中…</div>}
            </div>
          </Field>
        </Modal>
      )}

      {detailRow && (() => {
        const empRow = employees.find(e => e.name === detailRow.employee)
        const typeLabel = normalizeType(detailRow.type) === 'clock_in' ? '上班打卡' : '下班打卡'
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
              { label: '補登時間', value: detailRow.correction_time },
              { label: '原因', value: detailRow.reason, multiline: true },
              ...(detailRow.reject_reason ? [{ label: '駁回原因', value: detailRow.reject_reason, multiline: true }] : []),
            ]}
            attachments={(detailRow.attachments || []).map(url => ({
              url,
              name: decodeURIComponent(url.split('?')[0].split('/').pop() || '附件'),
            }))}
            createdAt={detailRow.created_at}
            chainSteps={loadingChain ? [{ label: '載入中…', name: '', status: 'pending' }] : detailChainSteps}
            requestType="correction"
            requestId={detailRow.id}
            onPrint={() => printWithChain(detailRow)}
            actions={
              detailRow.status === '待審核' && canApprove('clock_corrections', detailRow.id) ? {
                sourceTable: 'clock_corrections',
                row: detailRow,
                onApprove: async () => handleApprove(detailRow.id),
                onReject: async (_r, reason) => handleReject(detailRow.id, reason),
                onChanged: () => { load(); setDetailRow(null); returnNav() },
              } : null
            }
          />
        )
      })()}

    </div>
  )
}
