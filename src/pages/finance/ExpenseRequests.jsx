import { useState, useEffect, useRef } from 'react'
import { ModalOverlay } from '../../components/Modal'
import { Plus, X, Check, Upload, FileText, Image, Trash2, Eye, Send } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { getAccounts, getEmployees } from '../../lib/db'
import { createApprovalWorkflow } from '../../lib/workflowIntegration'
import LoadingSpinner from '../../components/LoadingSpinner'

const STATUS_COLORS = {
  '申請中': { bg: 'var(--accent-blue-dim)', color: 'var(--accent-blue)' },
  '已核准': { bg: 'var(--accent-green-dim)', color: 'var(--accent-green)' },
  '待核銷': { bg: 'var(--accent-yellow-dim)', color: 'var(--accent-yellow)' },
  '已核銷': { bg: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)' },
  '已駁回': { bg: 'var(--accent-red-dim)', color: 'var(--accent-red)' },
}

const fmt = (n) => n != null ? `NT$ ${Number(n).toLocaleString()}` : '-'

const emptyForm = {
  employee: '', account_code: '', title: '', description: '',
  estimated_amount: '', store: '',
}

export default function ExpenseRequests() {
  const [requests, setRequests] = useState([])
  const [accounts, setAccounts] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showSettleModal, setShowSettleModal] = useState(false)
  const [showDetail, setShowDetail] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [settleForm, setSettleForm] = useState({ actual_amount: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('all')
  const [files, setFiles] = useState([])
  const [settleFiles, setSettleFiles] = useState([])
  const [attachments, setAttachments] = useState({})
  const fileRef = useRef(null)
  const settleFileRef = useRef(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const load = async () => {
    setLoading(true)
    const [reqRes, accRes, empRes] = await Promise.all([
      supabase.from('expense_requests').select('*').order('created_at', { ascending: false }),
      getAccounts(),
      getEmployees(),
    ])
    setRequests(reqRes.data || [])
    setAccounts((accRes.data || []).filter(a => a.type === '費用'))
    setEmployees((empRes.data || []).filter(e => e.status === '在職'))
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  // Load attachments for detail view
  const loadAttachments = async (requestId) => {
    const { data } = await supabase.from('expense_request_attachments')
      .select('*').eq('request_id', requestId).order('created_at')
    setAttachments(prev => ({ ...prev, [requestId]: data || [] }))
  }

  // Upload files to Supabase Storage
  const uploadFiles = async (requestId, fileList, stage = 'request') => {
    const results = []
    for (const file of fileList) {
      const path = `expense-requests/${requestId}/${stage}/${Date.now()}_${file.name}`
      const { error: upErr } = await supabase.storage.from('attachments').upload(path, file)
      if (upErr) continue
      const { data } = await supabase.from('expense_request_attachments').insert({
        request_id: requestId,
        file_name: file.name,
        storage_path: path,
        file_size: file.size,
        file_type: file.type,
        stage,
        uploaded_by: form.employee || '系統',
      }).select().single()
      if (data) results.push(data)
    }
    return results
  }

  // Submit new request
  const handleSubmit = async () => {
    if (!form.employee || !form.account_code || !form.title || !form.estimated_amount) return
    setSaving(true)
    const emp = employees.find(e => e.name === form.employee)
    const acc = accounts.find(a => a.code === form.account_code)
    const payload = {
      employee: form.employee,
      employee_id: emp?.id || null,
      department: emp?.dept || null,
      account_code: form.account_code,
      account_name: acc?.name || '',
      title: form.title,
      description: form.description || null,
      estimated_amount: Number(form.estimated_amount),
      store: form.store || null,
      status: '申請中',
      organization_id: 1,
    }
    const { data, error: insertErr } = await supabase.from('expense_requests').insert(payload).select().single()
    if (insertErr) { setError(insertErr.message); setSaving(false); return }

    // Upload attachments
    if (files.length > 0 && data) {
      await uploadFiles(data.id, files, 'request')
    }

    // Create approval workflow
    if (data) {
      await createApprovalWorkflow('expense_request', data, form.employee).catch(() => {})
    }

    setSaving(false)
    setShowModal(false)
    setForm(emptyForm)
    setFiles([])
    load()
  }

  // Approve request
  const handleApprove = async (req) => {
    const { error } = await supabase.from('expense_requests')
      .update({ status: '已核准', approved_by: '管理員', approved_at: new Date().toISOString() })
      .eq('id', req.id)
    if (error) setError(error.message)
    else load()
  }

  // Reject request
  const handleReject = async (req) => {
    const reason = prompt('駁回原因：')
    if (!reason) return
    const { error } = await supabase.from('expense_requests')
      .update({ status: '已駁回', reject_reason: reason })
      .eq('id', req.id)
    if (error) setError(error.message)
    else load()
  }

  // Open settle modal
  const openSettle = (req) => {
    setShowDetail(req)
    setSettleForm({ actual_amount: req.estimated_amount, notes: '' })
    setSettleFiles([])
    setShowSettleModal(true)
  }

  // Submit settlement
  const handleSettle = async () => {
    if (!settleForm.actual_amount) return
    setSaving(true)
    const req = showDetail
    const { error: upErr } = await supabase.from('expense_requests')
      .update({
        actual_amount: Number(settleForm.actual_amount),
        notes: settleForm.notes || null,
        status: '待核銷',
      }).eq('id', req.id)
    if (upErr) { setError(upErr.message); setSaving(false); return }

    // Upload settlement attachments (receipts)
    if (settleFiles.length > 0) {
      await uploadFiles(req.id, settleFiles, 'settlement')
    }

    setSaving(false)
    setShowSettleModal(false)
    load()
  }

  // Finance confirms settlement
  const handleConfirmSettle = async (req) => {
    // Create journal entry
    try {
      const amount = req.actual_amount || req.estimated_amount
      await supabase.rpc('secure_create_journal_entry', {
        p_entry_date: new Date().toISOString().slice(0, 10),
        p_description: `費用申請核銷 - ${req.employee} (${req.title})`,
        p_lines: [
          { account_code: req.account_code, account_name: req.account_name, debit: amount, credit: 0, memo: `申請單 #${req.id}` },
          { account_code: '1100', account_name: '現金', debit: 0, credit: amount, memo: '' },
        ],
        p_source: '費用申請',
        p_source_id: req.id,
        p_created_by: '財務',
      })
    } catch { /* journal entry is optional */ }

    const { error } = await supabase.from('expense_requests')
      .update({ status: '已核銷', settled_by: '財務', settled_at: new Date().toISOString() })
      .eq('id', req.id)
    if (error) setError(error.message)
    else load()
  }

  // View attachment
  const viewFile = (att) => {
    const { data } = supabase.storage.from('attachments').getPublicUrl(att.storage_path)
    if (data?.publicUrl) window.open(data.publicUrl, '_blank')
  }

  const deleteFile = async (att) => {
    if (!confirm(`刪除 ${att.file_name}？`)) return
    await supabase.storage.from('attachments').remove([att.storage_path])
    await supabase.from('expense_request_attachments').delete().eq('id', att.id)
    setAttachments(prev => ({
      ...prev,
      [att.request_id]: (prev[att.request_id] || []).filter(a => a.id !== att.id),
    }))
  }

  // Filter
  const filtered = requests.filter(r => {
    if (tab === 'all') return true
    return r.status === tab
  })

  const counts = {}
  requests.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1 })

  if (loading) return <LoadingSpinner />

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📝</span> 費用申請</h2>
            <p>先申請核准，購買後核銷入帳</p>
          </div>
          <button className="btn btn-primary" onClick={() => { setForm(emptyForm); setFiles([]); setShowModal(true) }}>
            <Plus size={14} /> 新增申請
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: 'var(--accent-red-dim)', color: 'var(--accent-red)', padding: '8px 16px', borderRadius: 8, marginBottom: 16 }}>
          {error} <button onClick={() => setError(null)} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}><X size={14} /></button>
        </div>
      )}

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 20 }}>
        {['申請中', '已核准', '待核銷', '已核銷', '已駁回'].map(s => (
          <div key={s} className="card" style={{ padding: '12px 16px', cursor: 'pointer', border: tab === s ? `2px solid ${STATUS_COLORS[s].color}` : undefined }}
            onClick={() => setTab(tab === s ? 'all' : s)}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: STATUS_COLORS[s].color }}>{counts[s] || 0}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="data-table">
        <table>
          <thead>
            <tr>
              <th>申請人</th>
              <th>科目</th>
              <th>項目</th>
              <th style={{ textAlign: 'right' }}>預估金額</th>
              <th style={{ textAlign: 'right' }}>實際金額</th>
              <th>狀態</th>
              <th>日期</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>無資料</td></tr>}
            {filtered.map(r => {
              const sc = STATUS_COLORS[r.status] || {}
              return (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>{r.employee}</td>
                  <td><span style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.account_code}</span> {r.account_name}</td>
                  <td style={{ fontWeight: 500 }}>{r.title}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(r.estimated_amount)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                    {r.actual_amount != null ? fmt(r.actual_amount) : '-'}
                    {r.difference != null && r.difference !== 0 && (
                      <span style={{ fontSize: 11, color: r.difference > 0 ? 'var(--accent-red)' : 'var(--accent-green)', marginLeft: 4 }}>
                        ({r.difference > 0 ? '+' : ''}{fmt(r.difference)})
                      </span>
                    )}
                  </td>
                  <td><span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600, background: sc.bg, color: sc.color }}>{r.status}</span></td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{r.created_at?.slice(0, 10)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: 11 }}
                        onClick={() => { setShowDetail(r); loadAttachments(r.id) }}>
                        <Eye size={12} />
                      </button>
                      {r.status === '申請中' && (
                        <>
                          <button className="btn btn-primary" style={{ padding: '4px 8px', fontSize: 11 }} onClick={() => handleApprove(r)}>
                            <Check size={12} /> 核准
                          </button>
                          <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: 11, color: 'var(--accent-red)' }} onClick={() => handleReject(r)}>
                            <X size={12} />
                          </button>
                        </>
                      )}
                      {r.status === '已核准' && (
                        <button className="btn btn-primary" style={{ padding: '4px 8px', fontSize: 11 }} onClick={() => openSettle(r)}>
                          <Send size={12} /> 核銷
                        </button>
                      )}
                      {r.status === '待核銷' && (
                        <button className="btn btn-primary" style={{ padding: '4px 8px', fontSize: 11, background: 'var(--accent-cyan)' }} onClick={() => handleConfirmSettle(r)}>
                          <Check size={12} /> 確認
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* New Request Modal */}
      {showModal && (
        <ModalOverlay onClose={() => setShowModal(false)}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 24, width: 520, maxHeight: '85vh', overflowY: 'auto', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0 }}>新增費用申請</h3>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={() => setShowModal(false)}><X size={20} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>申請人 *</label>
                  <select value={form.employee} onChange={e => set('employee', e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}>
                    <option value="">請選擇</option>
                    {employees.map(e => <option key={e.id} value={e.name}>{e.name} ({e.dept})</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>會計科目 *</label>
                  <select value={form.account_code} onChange={e => set('account_code', e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}>
                    <option value="">請選擇科目</option>
                    {accounts.map(a => <option key={a.id} value={a.code}>{a.code} — {a.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>項目名稱 *</label>
                <input type="text" value={form.title} onChange={e => set('title', e.target.value)} placeholder="例：採購辦公椅 x5"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>預估金額 *</label>
                  <input type="number" value={form.estimated_amount} onChange={e => set('estimated_amount', e.target.value)} placeholder="0"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>門市</label>
                  <input type="text" value={form.store} onChange={e => set('store', e.target.value)} placeholder="選填"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
                </div>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>說明</label>
                <textarea value={form.description} onChange={e => set('description', e.target.value)} placeholder="用途、規格、供應商..."
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)', minHeight: 60, resize: 'vertical' }} />
              </div>
              {/* File upload */}
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>附件（訂購單、報價單...）</label>
                <input ref={fileRef} type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
                  onChange={e => setFiles(prev => [...prev, ...Array.from(e.target.files)])}
                  style={{ display: 'none' }} />
                <button className="btn btn-secondary" onClick={() => fileRef.current?.click()} style={{ fontSize: 12 }}>
                  <Upload size={12} /> 選擇檔案
                </button>
                {files.length > 0 && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {files.map((f, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                        {f.type?.startsWith('image') ? <Image size={12} /> : <FileText size={12} />}
                        {f.name}
                        <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 0 }}
                          onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}><X size={12} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>{saving ? '提交中...' : '提交申請'}</button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Settlement Modal */}
      {showSettleModal && showDetail && (
        <ModalOverlay onClose={() => setShowSettleModal(false)}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 24, width: 480, border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0 }}>核銷：{showDetail.title}</h3>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={() => setShowSettleModal(false)}><X size={20} /></button>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
              預估金額：<strong>{fmt(showDetail.estimated_amount)}</strong>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>實際金額 *</label>
                <input type="number" value={settleForm.actual_amount} onChange={e => setSettleForm(f => ({ ...f, actual_amount: e.target.value }))}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>備註</label>
                <textarea value={settleForm.notes} onChange={e => setSettleForm(f => ({ ...f, notes: e.target.value }))} placeholder="選填"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)', minHeight: 60, resize: 'vertical' }} />
              </div>
              {/* Receipt upload */}
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>收據/發票附件</label>
                <input ref={settleFileRef} type="file" multiple accept="image/*,.pdf"
                  onChange={e => setSettleFiles(prev => [...prev, ...Array.from(e.target.files)])}
                  style={{ display: 'none' }} />
                <button className="btn btn-secondary" onClick={() => settleFileRef.current?.click()} style={{ fontSize: 12 }}>
                  <Upload size={12} /> 上傳收據
                </button>
                {settleFiles.length > 0 && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {settleFiles.map((f, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                        {f.type?.startsWith('image') ? <Image size={12} /> : <FileText size={12} />}
                        {f.name}
                        <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 0 }}
                          onClick={() => setSettleFiles(prev => prev.filter((_, j) => j !== i))}><X size={12} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button className="btn btn-secondary" onClick={() => setShowSettleModal(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleSettle} disabled={saving}>{saving ? '提交中...' : '提交核銷'}</button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Detail Modal */}
      {showDetail && !showSettleModal && (
        <ModalOverlay onClose={() => setShowDetail(null)}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 24, width: 520, maxHeight: '85vh', overflowY: 'auto', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>申請詳情 #{showDetail.id}</h3>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={() => setShowDetail(null)}><X size={20} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div><span style={{ color: 'var(--text-muted)' }}>申請人：</span><strong>{showDetail.employee}</strong></div>
                <div><span style={{ color: 'var(--text-muted)' }}>部門：</span>{showDetail.department || '-'}</div>
                <div><span style={{ color: 'var(--text-muted)' }}>科目：</span>{showDetail.account_code} {showDetail.account_name}</div>
                <div><span style={{ color: 'var(--text-muted)' }}>門市：</span>{showDetail.store || '-'}</div>
              </div>
              <div><span style={{ color: 'var(--text-muted)' }}>項目：</span><strong>{showDetail.title}</strong></div>
              {showDetail.description && <div><span style={{ color: 'var(--text-muted)' }}>說明：</span>{showDetail.description}</div>}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, background: 'var(--bg-main)', padding: 12, borderRadius: 8 }}>
                <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>預估金額</div><div style={{ fontWeight: 700 }}>{fmt(showDetail.estimated_amount)}</div></div>
                <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>實際金額</div><div style={{ fontWeight: 700 }}>{showDetail.actual_amount != null ? fmt(showDetail.actual_amount) : '-'}</div></div>
                <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>差異</div><div style={{ fontWeight: 700, color: showDetail.difference > 0 ? 'var(--accent-red)' : 'var(--accent-green)' }}>{showDetail.difference != null ? fmt(showDetail.difference) : '-'}</div></div>
              </div>
              {showDetail.reject_reason && <div style={{ color: 'var(--accent-red)' }}>駁回原因：{showDetail.reject_reason}</div>}
              {showDetail.notes && <div><span style={{ color: 'var(--text-muted)' }}>核銷備註：</span>{showDetail.notes}</div>}

              {/* Attachments */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 4 }}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>附件</div>
                {(attachments[showDetail.id] || []).length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>無附件</div>
                ) : (attachments[showDetail.id] || []).map(att => (
                  <div key={att.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 12 }}>
                    {att.file_type?.startsWith('image') ? <Image size={14} color="var(--accent-blue)" /> : <FileText size={14} color="var(--accent-yellow)" />}
                    <span style={{ flex: 1 }}>{att.file_name}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{att.stage === 'settlement' ? '核銷' : '申請'}</span>
                    <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-blue)' }} onClick={() => viewFile(att)}><Eye size={13} /></button>
                    <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)' }} onClick={() => deleteFile(att)}><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn btn-secondary" onClick={() => setShowDetail(null)}>關閉</button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  )
}
