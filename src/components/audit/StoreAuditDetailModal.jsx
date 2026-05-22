import { useState, useEffect } from 'react'
import { X, CheckCircle2, XCircle, RotateCcw, Send, Edit3 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../LoadingSpinner'
import { ModalOverlay } from '../Modal'
import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
import SignaturePad from './SignaturePad'
import SearchableSelect, { empOptions } from '../SearchableSelect'

const STATUS_BADGE = {
  '草稿':   { bg: 'rgba(148,163,184,0.15)', color: 'var(--text-muted)' },
  '待確認': { bg: 'rgba(99,102,241,0.15)',   color: '#6366f1' },
  '申請中': { bg: 'rgba(245,158,11,0.15)',   color: 'var(--accent-orange)' },
  '已核准': { bg: 'rgba(34,197,94,0.15)',    color: 'var(--accent-green)' },
  '已退回': { bg: 'rgba(239,68,68,0.15)',    color: 'var(--accent-red)' },
}

export default function StoreAuditDetailModal({ auditId, onClose, onChanged }) {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [audit, setAudit] = useState(null)
  const [items, setItems] = useState([])
  const [onDuty, setOnDuty] = useState([])
  const [chainSteps, setChainSteps] = useState([])
  const [employees, setEmployees] = useState([])
  const [signingIdx, setSigningIdx] = useState(null)  // 哪位當班人員正在簽名

  const load = async () => {
    setLoading(true)
    const [a, i, d, e] = await Promise.all([
      supabase.from('store_audits').select('*').eq('id', auditId).single(),
      supabase.from('store_audit_items').select('*').eq('audit_id', auditId).order('category_code').order('item_no'),
      supabase.from('store_audit_on_duty').select('*').eq('audit_id', auditId).order('sort_order'),
      supabase.from('employees').select('id, name, name_en, position, dept, store, department_id, store_id, departments!department_id(name), stores!store_id(name)').eq('status', '在職').order('name'),
    ])
    if (a.error) { toast.error('載入失敗：' + a.error.message); onClose(); return }
    setAudit(a.data)
    setItems(i.data || [])
    setOnDuty(d.data || [])
    setEmployees(e.data || [])

    if (a.data?.approval_chain_id) {
      const { data: cs } = await supabase.from('approval_chain_steps')
        .select('id, step_order, label, role_name')
        .eq('chain_id', a.data.approval_chain_id)
        .order('step_order')
      setChainSteps(cs || [])
    }
    setLoading(false)
  }
  useEffect(() => { if (auditId) load() }, [auditId]) // eslint-disable-line

  if (loading || !audit) {
    return (
      <ModalOverlay onClose={onClose}>
        <LoadingSpinner />
      </ModalOverlay>
    )
  }

  const isDraft = audit.status === '草稿'
  const isApproving = audit.status === '申請中'
  const isAuditor = profile?.id === audit.auditor_id

  // 群組化 items
  const grouped = items.reduce((acc, item) => {
    const k = item.category_code
    if (!acc[k]) acc[k] = { name: item.category_name, items: [] }
    acc[k].items.push(item)
    return acc
  }, {})

  // 統計
  const passed = items.filter(i => i.passed === true).length
  const failed = items.filter(i => i.passed === false).length
  const pending = items.filter(i => i.passed === null).length
  const deducted = items.filter(i => i.passed === false).reduce((s, i) => s + (i.deduct_score || 0), 0)

  // ─── 草稿：編輯項目 ───
  const updateItem = async (itemId, patch) => {
    const item = items.find(i => i.id === itemId)
    if (!item) return
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, ...patch } : i))
    const { error } = await supabase.from('store_audit_items').update(patch).eq('id', itemId)
    if (error) toast.error('更新失敗：' + error.message)
  }

  const updateAudit = async (patch) => {
    setAudit(a => ({ ...a, ...patch }))
    const { error } = await supabase.from('store_audits').update(patch).eq('id', auditId)
    if (error) toast.error('更新失敗：' + error.message)
  }

  // base64 dataUrl → Blob → 上傳 Storage → 回傳公開 URL
  const uploadSignature = async (dataUrl, audId, empId) => {
    // 已經是 URL 直接回傳（重簽情境）
    if (dataUrl.startsWith('http')) return dataUrl
    if (!dataUrl.startsWith('data:image')) throw new Error('簽名格式錯誤')
    const blob = await (await fetch(dataUrl)).blob()
    const path = `${audId}/${empId || 'anon'}_${Date.now()}.png`
    const { error } = await supabase.storage
      .from('audit-signatures')
      .upload(path, blob, { contentType: 'image/png', upsert: true })
    if (error) throw error
    const { data: pub } = supabase.storage.from('audit-signatures').getPublicUrl(path)
    return pub.publicUrl
  }

  // ─── 送出 ───
  const handleSubmit = async () => {
    if (pending > 0) { toast.warning(`還有 ${pending} 項未評核`); return }
    if (onDuty.length === 0) { toast.warning('請至少選 1 名當班人員'); return }
    const unsigned = onDuty.filter(d => !d.signature_data_url)
    if (unsigned.length > 0) {
      toast.warning(`還有 ${unsigned.length} 位當班人員未簽名（${unsigned.map(d => d.employee_name).join('、')}）`)
      return
    }
    setSaving(true)
    try {
      // 平行上傳所有簽名
      const uploaded = await Promise.all(onDuty.map(async d => ({
        employee_id: d.employee_id,
        employee_name: d.employee_name,
        signature: await uploadSignature(d.signature_data_url, auditId, d.employee_id),
      })))
      const { data, error } = await supabase.rpc('submit_store_audit', {
        p_audit_id: auditId,
        p_on_duty: uploaded,
      })
      if (error) throw error
      if (!data?.ok) throw new Error(data?.error || 'unknown')
      toast.success(data.event === 'auto_approved_no_chain' ? '已核准（無簽核鏈設定）' : '已送出，進入簽核流程')
      onChanged?.(); load()
    } catch (err) {
      toast.error('送出失敗：' + (err.message || err))
    } finally {
      setSaving(false)
    }
  }

  // ─── 簽核（chain）───
  const handleApprove = async (action) => {
    let reason = null
    if (action === 'reject') {
      reason = prompt('退回原因？')
      if (!reason?.trim()) return
    } else {
      const ok = await confirm({ message: '確認核准此份稽核單？核准後缺失將自動同步至業績獎金' })
      if (!ok) return
    }
    setSaving(true)
    const { data, error } = await supabase.rpc('web_approve_store_audit', {
      p_audit_id: auditId, p_action: action, p_reason: reason,
    })
    setSaving(false)
    if (error) { toast.error('簽核失敗：' + error.message); return }
    if (!data?.ok) { toast.error('簽核失敗：' + (data?.error || 'unknown')); return }
    toast.success(action === 'approve' ? '已核准' : '已退回')
    onChanged?.(); load()
  }

  // ─── 退回 → 重編 ───
  const handleCancel = async () => {
    const ok = await confirm({ message: '把單退回草稿狀態重新編輯？' })
    if (!ok) return
    setSaving(true)
    const { data, error } = await supabase.rpc('cancel_store_audit', { p_audit_id: auditId })
    setSaving(false)
    if (error || !data?.ok) { toast.error('失敗：' + (error?.message || data?.error)); return }
    toast.success('已回到草稿狀態')
    onChanged?.(); load()
  }

  // ─── 當班人員管理（草稿時可改）───
  const addOnDuty = () => {
    if (onDuty.length >= 3) { toast.warning('最多 3 人'); return }
    setOnDuty(prev => [...prev, { employee_id: null, employee_name: '', sort_order: prev.length, confirmed: false }])
  }
  const updateOnDuty = (idx, empId) => {
    const emp = employees.find(e => e.id === Number(empId))
    setOnDuty(prev => prev.map((d, i) => i === idx ? { ...d, employee_id: emp?.id || null, employee_name: emp?.name || '' } : d))
  }
  const removeOnDuty = (idx) => setOnDuty(prev => prev.filter((_, i) => i !== idx))

  const s = STATUS_BADGE[audit.status] || {}

  return (
    <ModalOverlay onClose={onClose}>
      <div className="card" style={{ width: 'min(900px, 96vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ padding: 16, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              稽核單 #{audit.id} — {audit.store_name}
              <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: s.bg, color: s.color }}>{audit.status}</span>
            </h3>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              {audit.audit_date} · {audit.shift || '—'} · 稽核員 {audit.auditor_name}
              {audit.arrive_time && ` · 到店 ${audit.arrive_time.slice(0,5)}`}
              {audit.depart_time && ` · 離店 ${audit.depart_time.slice(0,5)}`}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
            <X size={20} />
          </button>
        </div>

        {/* 統計列 */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)', display: 'flex', gap: 16, fontSize: 13 }}>
          <span>共 {items.length} 項</span>
          <span style={{ color: 'var(--accent-green)' }}>✓ 合格 {passed}</span>
          <span style={{ color: 'var(--accent-red)' }}>✗ 不合格 {failed}</span>
          {pending > 0 && <span style={{ color: 'var(--accent-orange)' }}>未評核 {pending}</span>}
          <span style={{ marginLeft: 'auto', fontWeight: 700, color: deducted > 0 ? 'var(--accent-red)' : 'var(--text-secondary)' }}>
            扣分：{deducted} / {audit.total_max_score}
          </span>
        </div>

        {/* 主體 - 雙欄 */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'grid', gridTemplateColumns: '1fr 280px', gap: 0 }}>
          {/* 左：評核項目 */}
          <div style={{ padding: 16, borderRight: '1px solid var(--border)', overflowY: 'auto' }}>
            {Object.entries(grouped).map(([code, group]) => (
              <div key={code} style={{ marginBottom: 20 }}>
                <h4 style={{ margin: '0 0 8px', color: 'var(--text-secondary)', fontSize: 13, padding: '4px 0', borderBottom: '2px solid var(--border)' }}>
                  {code}、{group.name}（共 {group.items.length} 項，最高扣 {group.items.reduce((s, i) => s + i.deduct_score, 0)} 分）
                </h4>
                {group.items.map(item => (
                  <ItemRow key={item.id} item={item} employees={employees} editable={isDraft} onChange={p => updateItem(item.id, p)} />
                ))}
              </div>
            ))}

            {/* Notes */}
            <div style={{ marginTop: 20 }}>
              <NoteField label="違反其他員工守則" value={audit.notes_violations} editable={isDraft}
                onChange={v => updateAudit({ notes_violations: v })} />
              <NoteField label="店內反饋事項" value={audit.notes_feedback} editable={isDraft}
                onChange={v => updateAudit({ notes_feedback: v })} />
              <NoteField label="公司建議 / 活動安排事項" value={audit.notes_suggestions} editable={isDraft}
                onChange={v => updateAudit({ notes_suggestions: v })} />
            </div>
          </div>

          {/* 右：當班人員 + 簽核流程 */}
          <div style={{ padding: 16, overflowY: 'auto', background: 'var(--bg-secondary)' }}>
            <h4 style={{ margin: '0 0 8px', fontSize: 13 }}>當班人員（1~3 人）{isDraft && '— 請現場簽名'}</h4>
            {isDraft ? (
              <>
                {onDuty.map((d, idx) => (
                  <div key={idx} style={{ marginBottom: 8, padding: 8, background: 'var(--bg-primary)', borderRadius: 6 }}>
                    <div style={{ display: 'flex', gap: 4, marginBottom: 6, alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <SearchableSelect
                          value={d.employee_id || ''}
                          onChange={(v) => updateOnDuty(idx, v)}
                          options={empOptions(employees, { keyBy: 'id' })}
                          placeholder="選當班人員"
                        />
                      </div>
                      <button className="btn btn-sm btn-secondary" style={{ padding: '0 8px', height: 36 }} onClick={() => removeOnDuty(idx)}>×</button>
                    </div>
                    {d.employee_id && (
                      d.signature_data_url ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                          <img src={d.signature_data_url} alt="簽名" style={{ height: 30, background: '#fff', borderRadius: 4, border: '1px solid var(--border)' }} />
                          <span style={{ color: 'var(--accent-green)', flex: 1 }}>✓ 已簽</span>
                          <button className="btn btn-sm btn-secondary" style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => setSigningIdx(idx)}>重簽</button>
                        </div>
                      ) : (
                        <button className="btn btn-sm btn-primary" style={{ width: '100%', fontSize: 11, padding: '4px' }} onClick={() => setSigningIdx(idx)}>
                          <Edit3 size={12} /> 請當班人員簽名
                        </button>
                      )
                    )}
                  </div>
                ))}
                {onDuty.length < 3 && (
                  <button className="btn btn-sm btn-secondary" onClick={addOnDuty} style={{ width: '100%', fontSize: 12 }}>+ 新增當班人員</button>
                )}
              </>
            ) : (
              <div>
                {onDuty.map(d => (
                  <div key={d.id} style={{ padding: 8, background: 'var(--bg-primary)', borderRadius: 6, marginBottom: 4, fontSize: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span>{d.employee_name}</span>
                      <span style={{ color: 'var(--accent-green)', fontSize: 11 }}>✓ 已簽</span>
                    </div>
                    {d.signature_data_url && (
                      <img src={d.signature_data_url} alt="簽名" style={{ height: 36, background: '#fff', borderRadius: 4, border: '1px solid var(--border)' }} />
                    )}
                  </div>
                ))}
              </div>
            )}

            {chainSteps.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <h4 style={{ margin: '0 0 8px', fontSize: 13 }}>簽核流程</h4>
                {chainSteps.map((cs, i) => {
                  const done = isApproving ? i < audit.current_step : (audit.status === '已核准' ? true : false)
                  const current = isApproving && i === audit.current_step
                  return (
                    <div key={cs.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, background: current ? 'rgba(245,158,11,0.1)' : 'transparent', fontSize: 12 }}>
                      <div style={{ width: 18, height: 18, borderRadius: '50%', background: done ? 'var(--accent-green)' : current ? 'var(--accent-orange)' : 'var(--bg-primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700 }}>
                        {done ? '✓' : i + 1}
                      </div>
                      <span style={{ flex: 1 }}>{cs.label || cs.role_name || `第 ${i+1} 關`}</span>
                    </div>
                  )
                })}
              </div>
            )}

            {audit.reject_reason && (
              <div style={{ marginTop: 16, padding: 8, background: 'rgba(239,68,68,0.1)', borderRadius: 6, fontSize: 12 }}>
                <div style={{ color: 'var(--accent-red)', fontWeight: 700, marginBottom: 4 }}>退回原因</div>
                <div>{audit.reject_reason}</div>
              </div>
            )}

            {audit.approver && (
              <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-muted)' }}>
                {audit.status === '已核准' ? '✓ 最終核簽人' : '退回人'}：{audit.approver}
                {audit.approved_at && <div>{audit.approved_at.slice(0, 16).replace('T', ' ')}</div>}
              </div>
            )}
          </div>
        </div>

        {/* Footer 操作 */}
        <div style={{ padding: 16, borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose}>關閉</button>
          {isDraft && isAuditor && (
            <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
              <Send size={14} /> 送出（待當班確認）
            </button>
          )}
          {/* 「待確認」狀態保留供舊資料相容（新流程已改現場簽名） */}
          {isApproving && (
            <>
              <button className="btn btn-warning" onClick={() => handleApprove('reject')} disabled={saving}>
                <XCircle size={14} /> 退回
              </button>
              <button className="btn btn-primary" onClick={() => handleApprove('approve')} disabled={saving}>
                <CheckCircle2 size={14} /> 核准
              </button>
            </>
          )}
          {audit.status === '已退回' && isAuditor && (
            <button className="btn btn-secondary" onClick={handleCancel} disabled={saving}>
              <RotateCcw size={14} /> 重新編輯
            </button>
          )}
        </div>
      </div>

      {signingIdx !== null && (
        <SignaturePad
          open
          signerName={onDuty[signingIdx]?.employee_name || ''}
          onClose={() => setSigningIdx(null)}
          onConfirm={(dataUrl) => {
            setOnDuty(prev => prev.map((d, i) => i === signingIdx ? { ...d, signature_data_url: dataUrl } : d))
            setSigningIdx(null)
          }}
        />
      )}
    </ModalOverlay>
  )
}

// ─── 評核項目單列 ───
function ItemRow({ item, employees, editable, onChange }) {
  const failed = item.passed === false
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '32px 1fr auto auto', gap: 8, padding: '8px 4px',
      borderBottom: '1px solid var(--border)', alignItems: 'center', fontSize: 13,
      background: failed ? 'rgba(239,68,68,0.04)' : 'transparent',
    }}>
      <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{item.item_no}</div>
      <div>
        {item.item_text}
        {failed && editable && (
          <div style={{ width: '100%', marginTop: 4 }}>
            <SearchableSelect
              value={item.responsible_employee_id || ''}
              onChange={(v) => {
                const emp = employees.find(x => x.id === Number(v))
                onChange({ responsible_employee_id: emp?.id || null, responsible_employee_name: emp?.name || null })
              }}
              options={empOptions(employees, { keyBy: 'id' })}
              placeholder="未指定責任人（算當班全體）"
            />
          </div>
        )}
        {failed && !editable && item.responsible_employee_name && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>責任人：{item.responsible_employee_name}</div>
        )}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>扣 {item.deduct_score}</div>
      <div style={{ display: 'flex', gap: 4 }}>
        {editable ? (
          <>
            <button
              onClick={() => onChange({ passed: true })}
              style={{
                padding: '4px 8px', fontSize: 11, borderRadius: 4, cursor: 'pointer', border: 'none',
                background: item.passed === true ? 'var(--accent-green)' : 'var(--bg-primary)',
                color: item.passed === true ? '#fff' : 'var(--text-muted)',
              }}
            >合格</button>
            <button
              onClick={() => onChange({ passed: false })}
              style={{
                padding: '4px 8px', fontSize: 11, borderRadius: 4, cursor: 'pointer', border: 'none',
                background: item.passed === false ? 'var(--accent-red)' : 'var(--bg-primary)',
                color: item.passed === false ? '#fff' : 'var(--text-muted)',
              }}
            >不合格</button>
          </>
        ) : (
          <span style={{
            padding: '3px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700,
            background: item.passed === true ? 'rgba(34,197,94,0.12)' : item.passed === false ? 'rgba(239,68,68,0.12)' : 'var(--bg-primary)',
            color: item.passed === true ? 'var(--accent-green)' : item.passed === false ? 'var(--accent-red)' : 'var(--text-muted)',
          }}>
            {item.passed === true ? '✓ 合格' : item.passed === false ? '✗ 不合格' : '—'}
          </span>
        )}
      </div>
    </div>
  )
}

function NoteField({ label, value, editable, onChange }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>{label}</div>
      {editable ? (
        <textarea className="form-input" rows={2} value={value || ''} onChange={e => onChange(e.target.value)} style={{ width: '100%', fontSize: 13 }} />
      ) : (
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', padding: 8, background: 'var(--bg-secondary)', borderRadius: 4, minHeight: 24 }}>
          {value || <span style={{ color: 'var(--text-muted)' }}>—</span>}
        </div>
      )}
    </div>
  )
}
