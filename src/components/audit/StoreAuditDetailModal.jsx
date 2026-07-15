import { useState, useEffect, useCallback, useMemo } from 'react'
import { X, CheckCircle2, XCircle, RotateCcw, Send, Star, Paperclip } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../LoadingSpinner'
import { ModalOverlay } from '../Modal'
import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
import SignaturePad from './SignaturePad'
import SearchableSelect, { empOptions } from '../SearchableSelect'
import { postBindingFillDone } from '../../lib/embeddedBinding'
import ExtraSignerControls from '../ExtraSignerControls'

const STATUS_BADGE = {
  '草稿':   { bg: 'var(--bg-secondary)',      color: 'var(--text-muted)' },
  '待確認': { bg: 'var(--accent-purple-dim)',  color: 'var(--accent-purple)' },
  '申請中': { bg: 'var(--accent-orange-dim)', color: 'var(--accent-orange)' },
  '已核准': { bg: 'var(--accent-green-dim)',  color: 'var(--accent-green)' },
  '已退回': { bg: 'var(--accent-red-dim)',    color: 'var(--accent-red)' },
}

const CAT_ORDER = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6 }

// 依 item_no 排序 → 兩層分組：大類 → 關聯群組
function buildCats(items) {
  const cats = {}
  ;[...items].sort((a, b) => (a.item_no || 0) - (b.item_no || 0)).forEach(item => {
    const c = item.category_code || '?'
    if (!cats[c]) cats[c] = { code: c, name: item.category_name, groups: {}, order: [] }
    const g = item.relation_group || '—'
    if (!cats[c].groups[g]) { cats[c].groups[g] = { name: g, allot: item.group_allot || 0, items: [] }; cats[c].order.push(g) }
    cats[c].groups[g].items.push(item)
  })
  return Object.values(cats).sort((a, b) => (CAT_ORDER[a.code] || 99) - (CAT_ORDER[b.code] || 99))
}
const groupDeduct = (grp) => grp.items.reduce((s, i) => s + (i.deduct_score || 0), 0)
const catMax = (cat) => cat.order.reduce((s, g) => s + (cat.groups[g].allot || 0), 0)
const catDeduct = (cat) => cat.order.reduce((s, g) => s + groupDeduct(cat.groups[g]), 0)
const catScore = (cat) => Math.max(0, catMax(cat) - catDeduct(cat))

function computeScores(items) {
  const cats = buildCats(items)
  const scored = cats.filter(c => catMax(c) > 0)
  const avg = scored.length ? Math.round(scored.reduce((s, c) => s + catScore(c), 0) / scored.length * 100) / 100 : 0
  const totalDed = items.reduce((s, i) => s + (i.deduct_score || 0), 0)
  return { avg, totalDed }
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
  const [signingIdx, setSigningIdx] = useState(null)
  const employeeOptions = useMemo(() => empOptions(employees, { keyBy: 'id' }), [employees])

  const load = useCallback(async () => {
    setLoading(true)
    const [a, i, d, e] = await Promise.all([
      supabase.from('store_audits').select('*').eq('id', auditId).single(),
      supabase.from('store_audit_items').select('*').eq('audit_id', auditId).order('item_no'),
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
  }, [auditId, onClose])
  useEffect(() => { if (auditId) load() }, [auditId, load])

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

  const cats = buildCats(items)
  const scored = cats.filter(c => catMax(c) > 0)
  const avgScore = scored.length ? Math.round(scored.reduce((s, c) => s + catScore(c), 0) / scored.length * 100) / 100 : 0

  // 統計（評分制：只看有沒有扣分）
  const deductedCount = items.filter(i => (i.deduct_score || 0) > 0).length
  const totalDeducted = items.reduce((s, i) => s + (i.deduct_score || 0), 0)

  // ─── 草稿：編輯項目（並即時把總平均/總扣分寫回單頭）───
  const updateItem = async (itemId, patch) => {
    const next = items.map(i => i.id === itemId ? { ...i, ...patch } : i)
    setItems(next)
    const { error } = await supabase.from('store_audit_items').update(patch).eq('id', itemId)
    if (error) { toast.error('更新失敗：' + error.message); return }
    const { avg, totalDed } = computeScores(next)
    if (avg !== audit.avg_score || totalDed !== audit.total_deducted) {
      setAudit(a => ({ ...a, avg_score: avg, total_deducted: totalDed }))
      supabase.from('store_audits').update({ avg_score: avg, total_deducted: totalDed }).eq('id', auditId)
    }
  }

  const updateAudit = async (patch) => {
    setAudit(a => ({ ...a, ...patch }))
    const { error } = await supabase.from('store_audits').update(patch).eq('id', auditId)
    if (error) toast.error('更新失敗：' + error.message)
  }

  const uploadSignature = async (dataUrl, audId, empId) => {
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
    if (onDuty.length === 0) { toast.warning('請至少選 1 名當班人員'); return }
    const unsigned = onDuty.filter(d => !d.signature_data_url)
    if (unsigned.length > 0) {
      toast.warning(`還有 ${unsigned.length} 位當班人員未簽名（${unsigned.map(d => d.employee_name).join('、')}）`)
      return
    }
    setSaving(true)
    try {
      // 評分制：沒扣分的項目視為合格，避免撞 submit 的未評核檢查
      await supabase.from('store_audit_items').update({ passed: true }).eq('audit_id', auditId).is('passed', null)
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
      postBindingFillDone(null)
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
      const ok = await confirm({ message: '確認核准此份稽核單？' })
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
    setOnDuty(prev => [...prev, { employee_id: null, employee_name: '', sort_order: prev.length, confirmed: false, _key: crypto.randomUUID() }])
  }
  const updateOnDuty = (idx, empId) => {
    const emp = employees.find(e => e.id === Number(empId))
    setOnDuty(prev => prev.map((d, i) => i === idx ? { ...d, employee_id: emp?.id || null, employee_name: emp?.name || '' } : d))
  }
  const removeOnDuty = (idx) => setOnDuty(prev => prev.filter((_, i) => i !== idx))

  const s = STATUS_BADGE[audit.status] || {}
  const scoreColor = avgScore >= 90 ? 'var(--accent-green)' : avgScore >= 70 ? 'var(--accent-orange)' : 'var(--accent-red)'

  return (
    <ModalOverlay onClose={onClose}>
      <div className="card" style={{ width: 'min(980px, 96vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
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

        {/* 統計 + 總平均 */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)', display: 'flex', gap: 16, fontSize: 13, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>共 {items.length} 項</span>
          <span style={{ color: deductedCount > 0 ? 'var(--accent-red)' : 'var(--text-muted)' }}>扣分 {deductedCount} 項</span>
          <span style={{ color: 'var(--text-secondary)' }}>總扣 {totalDeducted}</span>
          {/* 各類得分 */}
          <div style={{ display: 'flex', gap: 8, marginLeft: 8, flexWrap: 'wrap' }}>
            {scored.map(c => (
              <span key={c.code} style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>
                {c.name} {catScore(c)}
              </span>
            ))}
          </div>
          <span style={{ marginLeft: 'auto', fontWeight: 700, fontSize: 15, color: scoreColor }}>
            總平均 {avgScore}
          </span>
        </div>

        {/* 主體 - 雙欄 */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 280px', gap: 0 }}>
          {/* 左：評核項目 */}
          <div style={{ padding: 16, borderRight: '1px solid var(--border)', overflowY: 'auto' }}>
            {cats.map(cat => (
              <div key={cat.code} style={{ marginBottom: 22 }}>
                <h4 style={{ margin: '0 0 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', color: 'var(--text-primary)', fontSize: 15, padding: '4px 0', borderBottom: '2px solid var(--accent-cyan)' }}>
                  <span>{cat.code}、{cat.name}</span>
                  {catMax(cat) > 0 && (
                    <span style={{ fontSize: 12, fontWeight: 700, color: catDeduct(cat) > 0 ? 'var(--accent-red)' : 'var(--accent-green)' }}>
                      {catScore(cat)} / {catMax(cat)}
                    </span>
                  )}
                </h4>
                {cat.order.map(gName => {
                  const grp = cat.groups[gName]
                  const gd = groupDeduct(grp)
                  return (
                    <div key={gName} style={{ marginBottom: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', padding: '4px 6px', background: 'var(--bg-secondary)', borderRadius: 4, marginBottom: 4 }}>
                        <span>{grp.name}</span>
                        <span style={{ color: gd > 0 ? 'var(--accent-red)' : 'var(--text-muted)' }}>
                          配分 {grp.allot}{gd > 0 ? ` · 已扣 ${gd}` : ''}
                        </span>
                      </div>
                      {/* 群組說明（一組一個，對齊紙本合併儲存格）*/}
                      {isDraft ? (
                        <input
                          className="form-input"
                          value={grp.items[0]?.group_note || ''}
                          onChange={e => updateItem(grp.items[0].id, { group_note: e.target.value })}
                          placeholder="此區說明（可留白）"
                          style={{ width: '100%', fontSize: 12, marginBottom: 6 }}
                        />
                      ) : (grp.items[0]?.group_note && (
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6, padding: '3px 8px', background: 'var(--bg-secondary)', borderRadius: 4 }}>說明：{grp.items[0].group_note}</div>
                      ))}
                      {grp.items.map(item => (
                        <ItemRow
                          key={item.id}
                          item={item}
                          editable={isDraft}
                          maxDeduct={(grp.allot || 0) - (gd - (item.deduct_score || 0))}
                          onChange={p => updateItem(item.id, p)}
                        />
                      ))}
                    </div>
                  )
                })}
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

            {/* 整張稽核單共用照片（最多 20 張）*/}
            <AuditPhotos
              auditId={auditId}
              photos={Array.isArray(audit.photos) ? audit.photos : []}
              editable={isDraft}
              onChange={photos => updateAudit({ photos })}
            />
          </div>

          {/* 右：當班人員 + 簽核流程 */}
          <div style={{ padding: 16, overflowY: 'auto', background: 'var(--bg-secondary)' }}>
            <h4 style={{ margin: '0 0 8px', fontSize: 13 }}>當班人員（1~3 人）{isDraft && '— 請現場簽名'}</h4>
            {isDraft ? (
              <>
                {onDuty.map((d, idx) => (
                  <div key={d._key ?? d.id ?? idx} style={{ marginBottom: 8, padding: 8, background: 'var(--bg-primary)', borderRadius: 6 }}>
                    <div style={{ display: 'flex', gap: 4, marginBottom: 6, alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <SearchableSelect
                          value={d.employee_id || ''}
                          onChange={(v) => updateOnDuty(idx, v)}
                          options={employeeOptions}
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
                          請當班人員簽名
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
                  const done = isApproving ? i < audit.current_step : audit.status === '已核准'
                  const current = isApproving && i === audit.current_step
                  return (
                    <div key={cs.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, background: current ? 'var(--accent-orange-dim)' : 'transparent', fontSize: 12 }}>
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
              <div style={{ marginTop: 16, padding: 8, background: 'var(--accent-red-dim)', borderRadius: 6, fontSize: 12 }}>
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
          {isApproving && (
            <ExtraSignerControls
              sourceTable="store_audits"
              row={{ id: audit.id, current_step: audit.current_step, employee_id: audit.auditor_id }}
              onChanged={() => { onChanged?.(); load() }}
              renderNormal={() => (
                <>
                  <button className="btn btn-warning" onClick={() => handleApprove('reject')} disabled={saving}>
                    <XCircle size={14} /> 退回
                  </button>
                  <button className="btn btn-primary" onClick={() => handleApprove('approve')} disabled={saving}>
                    <CheckCircle2 size={14} /> 核准
                  </button>
                </>
              )}
            />
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

// ─── 評核項目單列（評分制：只填扣分；責任人看當班簽名、照片看整張統計）───
function ItemRow({ item, editable, maxDeduct, onChange }) {
  const deducted = item.deduct_score || 0
  const hasDeduct = deducted > 0

  const setDeduct = (raw) => {
    let v = Math.max(0, Math.floor(Number(raw) || 0))
    if (v > maxDeduct) { v = Math.max(0, maxDeduct); toast.warning(`此群組最多再扣 ${Math.max(0, maxDeduct)} 分`) }
    // 有扣分 → passed=false（供 submit 計 total_deducted）；0 → 合格
    onChange({ deduct_score: v, passed: v > 0 ? false : true })
  }

  return (
    <div style={{
      padding: '6px 4px', borderBottom: '1px solid var(--border)', fontSize: 13,
      background: hasDeduct ? 'var(--accent-red-dim)' : 'transparent',
    }}>
      {/* 內容 + 扣分 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center' }}>
        <div style={{ minWidth: 0 }}>
          {item.is_star && <Star size={12} style={{ color: 'var(--accent-orange)', verticalAlign: 'middle', marginRight: 4 }} fill="var(--accent-orange)" />}
          {item.item_text}
          {item.is_star && <span style={{ fontSize: 10, color: 'var(--accent-orange)', marginLeft: 4 }}>可開罰</span>}
        </div>
        {editable ? (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>扣</span>
            <input
              type="number" min={0} max={Math.max(0, maxDeduct)}
              value={deducted || ''}
              placeholder="0"
              onChange={e => setDeduct(e.target.value)}
              className="form-input"
              style={{ width: 56, fontSize: 13, textAlign: 'center', padding: '4px 6px', color: hasDeduct ? 'var(--accent-red)' : 'var(--text-primary)', fontWeight: hasDeduct ? 700 : 400 }}
            />
          </div>
        ) : (
          <span style={{
            padding: '3px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700,
            background: hasDeduct ? 'var(--accent-red-dim)' : 'var(--accent-green-dim)',
            color: hasDeduct ? 'var(--accent-red)' : 'var(--accent-green)',
          }}>
            {hasDeduct ? `扣 ${deducted}` : '✓'}
          </span>
        )}
      </div>

      {/* 打字題（結尾冒號）才顯示各自的內容輸入；一般項共用群組說明 */}
      {item.input_type === 'text' && (
        editable ? (
          <input
            className="form-input"
            value={item.remark || ''}
            onChange={e => onChange({ remark: e.target.value })}
            placeholder="請填寫抽查 / 內容"
            style={{ width: '100%', fontSize: 12, marginTop: 4, background: 'var(--bg-secondary)' }}
          />
        ) : (
          item.remark && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3, padding: '3px 8px', background: 'var(--bg-secondary)', borderRadius: 4 }}>{item.remark}</div>
        )
      )}
    </div>
  )
}

// ─── 整張稽核單共用照片區（最多 20 張）───
function AuditPhotos({ auditId, photos, editable, onChange }) {
  const [uploading, setUploading] = useState(false)
  const handleFiles = async (e) => {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    const remaining = 20 - photos.length
    if (remaining <= 0) { toast.warning('最多 20 張照片'); e.target.value = ''; return }
    setUploading(true)
    try {
      const urls = await Promise.all(files.slice(0, remaining).map(async (file) => {
        const ext = file.name.split('.').pop() || 'jpg'
        const path = `${auditId}/audit/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
        const { error } = await supabase.storage.from('audit-photos').upload(path, file, { upsert: false })
        if (error) throw error
        return supabase.storage.from('audit-photos').getPublicUrl(path).data.publicUrl
      }))
      onChange([...photos, ...urls])
    } catch (err) {
      toast.error('上傳失敗：' + err.message)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }
  const removePhoto = (url) => onChange(photos.filter(u => u !== url))

  if (!editable && photos.length === 0) return null
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span><Paperclip size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />稽核照片（{photos.length}/20）</span>
        {editable && photos.length < 20 && (
          <label style={{ cursor: uploading ? 'default' : 'pointer', fontSize: 12, color: uploading ? 'var(--text-muted)' : 'var(--accent-cyan)' }}>
            {uploading ? '上傳中...' : '＋ 新增照片'}
            <input type="file" multiple accept="image/*" style={{ display: 'none' }} onChange={handleFiles} disabled={uploading} />
          </label>
        )}
      </div>
      {photos.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))', gap: 6 }}>
          {photos.map((url, i) => (
            <div key={url} style={{ position: 'relative', aspectRatio: '1', borderRadius: 6, overflow: 'hidden', background: 'var(--bg-secondary)' }}>
              <img src={url} alt={`照片 ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'pointer', display: 'block' }} onClick={() => window.open(url, '_blank')} />
              {editable && (
                <button onClick={() => removePhoto(url)} style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,0.65)', border: 'none', borderRadius: '50%', width: 20, height: 20, color: '#fff', cursor: 'pointer', fontSize: 14, lineHeight: '20px', padding: 0 }}>×</button>
              )}
            </div>
          ))}
        </div>
      ) : editable ? (
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 56, border: '1px dashed var(--border)', borderRadius: 6, cursor: uploading ? 'default' : 'pointer', fontSize: 13, color: 'var(--text-muted)' }}>
          <Paperclip size={15} /> {uploading ? '上傳中...' : '點此新增稽核照片（最多 20 張）'}
          <input type="file" multiple accept="image/*" style={{ display: 'none' }} onChange={handleFiles} disabled={uploading} />
        </label>
      ) : null}
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
