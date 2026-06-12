import { useState, useEffect } from 'react'
import { AlertTriangle, Users, GitBranch, Building2, Calendar, ChevronDown, Copy } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { empLabel } from '../lib/empLabel'

const RT_LABEL = {
  expense_request:   '費用申請',
  leave_request:     '請假申請',
  overtime_request:  '加班申請',
  form_submission:   '自建表單',
  business_trip:     '差旅申請',
  clock_correction:  '補打卡',
}

function EmpSelect({ value, onChange, candidates, placeholder = '挑選承接人' }) {
  return (
    <div style={{ position: 'relative', minWidth: 180 }}>
      <select
        className="form-input"
        style={{ width: '100%', paddingRight: 28, fontSize: 12 }}
        value={value}
        onChange={e => onChange(e.target.value)}
      >
        <option value="">{placeholder}</option>
        {candidates.map(e => (
          <option key={e.id} value={e.id}>
            {empLabel(e)}{e.position || e.dept ? ` — ${e.position || e.dept}` : ''}
          </option>
        ))}
      </select>
      <ChevronDown size={12} style={{
        position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
        color: 'var(--text-muted)', pointerEvents: 'none',
      }} />
    </div>
  )
}

export default function OffboardingModal({
  employee,
  pendingStatus,
  pendingResignDate,
  allEmployees,
  currentUserEmpId,
  onSuccess,
  onCancel,
}) {
  const [items, setItems]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState(null)

  // Per-category delegates
  const [delegates, setDelegates] = useState({ chain: '', store: '', dept: '', section: '' })
  // 交接(永久) | 代理(可再轉手)
  const [mode, setMode] = useState('transfer')
  // "同一個人" bulk selector
  const [bulkId, setBulkId] = useState('')

  const setDelegate = (key, val) => {
    setDelegates(prev => ({ ...prev, [key]: val }))
    setError(null)
  }

  const applyBulk = () => {
    if (!bulkId) return
    setDelegates(prev => ({
      chain:   items?.chain_steps?.length > 0 || items?.snapshots?.length > 0 || items?.extra_signs > 0 || items?.tasks > 0 ? bulkId : prev.chain,
      store:   items?.managed_stores?.length > 0 ? bulkId : prev.store,
      dept:    items?.managed_depts?.length > 0 || items?.subordinates?.length > 0 ? bulkId : prev.dept,
      section: items?.managed_sections?.length > 0 ? bulkId : prev.section,
    }))
    setError(null)
  }

  useEffect(() => {
    supabase
      .rpc('get_employee_offboarding_items', { p_emp_id: employee.id })
      .then(({ data, error: e }) => {
        if (e) setError(e.message)
        else setItems(data)
        setLoading(false)
      })
  }, [employee.id])

  const needsChain   = !!(items?.chain_steps?.length > 0 || items?.snapshots?.length > 0 || items?.extra_signs > 0 || items?.tasks > 0)
  const needsStore   = !!(items?.managed_stores?.length > 0)
  const needsDept    = !!(items?.managed_depts?.length > 0 || items?.subordinates?.length > 0)
  const needsSection = !!(items?.managed_sections?.length > 0)
  const hasWork      = needsChain || needsStore || needsDept || needsSection || items?.upcoming_shifts > 0

  const candidateEmployees = (allEmployees || []).filter(
    e => e.id !== employee.id && e.status === '在職'
  )

  const handleConfirm = async () => {
    if (needsChain   && !delegates.chain)   { setError('請選擇簽核鏈承接人'); return }
    if (needsStore   && !delegates.store)   { setError('請選擇門市主管承接人'); return }
    if (needsDept    && !delegates.dept)    { setError('請選擇部門主管承接人'); return }
    if (needsSection && !delegates.section) { setError('請選擇課別督導承接人'); return }

    setSaving(true)
    setError(null)
    try {
      const { data, error: rpcErr } = await supabase.rpc('resign_employee', {
        p_emp_id:               employee.id,
        p_new_status:           pendingStatus,
        p_resign_date:          pendingResignDate || null,
        p_chain_delegate_id:    delegates.chain   ? Number(delegates.chain)   : null,
        p_store_delegate_id:    delegates.store   ? Number(delegates.store)   : null,
        p_dept_delegate_id:     delegates.dept    ? Number(delegates.dept)    : null,
        p_section_delegate_id:  delegates.section ? Number(delegates.section) : null,
        p_mode:                 mode,
        p_authorized_by_emp_id: currentUserEmpId || null,
      })
      if (rpcErr) throw new Error(rpcErr.message)
      if (!data?.ok) throw new Error(data?.error || '未知錯誤')
      onSuccess(data)
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }}>
      <div style={{
        background: 'var(--bg-card)', borderRadius: 16,
        border: '1px solid var(--border-medium)',
        width: '100%', maxWidth: 560,
        boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
        overflow: 'hidden',
      }}>

        {/* Header */}
        <div style={{
          padding: '16px 22px 12px',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-secondary)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <AlertTriangle size={17} style={{ color: 'var(--accent-orange)', flexShrink: 0 }} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>
                設為「{pendingStatus}」前請確認交接
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>
                {employee.name}
                {(employee.position || employee.dept) ? `（${employee.position || employee.dept}）` : ''}
              </div>
            </div>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 22px', maxHeight: '62vh', overflowY: 'auto' }}>

          {loading && (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)', fontSize: 13 }}>
              載入中…
            </div>
          )}

          {!loading && !hasWork && (
            <div style={{
              padding: '18px 16px', borderRadius: 10, textAlign: 'center',
              background: 'var(--accent-green-dim)', color: 'var(--accent-green)',
              fontSize: 13, fontWeight: 600,
            }}>
              此員工目前無待交接項目，可直接設為{pendingStatus}。
            </div>
          )}

          {!loading && hasWork && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

              {/* ── 交接 / 代理 模式 ── */}
              <div style={{ display: 'flex', gap: 8 }}>
                {[
                  { key: 'transfer', label: '🔄 交接（永久）', desc: '以後都是接手人的' },
                  { key: 'proxy',    label: '🟡 代理（暫代）', desc: '之後可再轉給別人' },
                ].map(m => {
                  const active = mode === m.key
                  return (
                    <button key={m.key} onClick={() => setMode(m.key)}
                      style={{
                        flex: 1, padding: '8px 10px', borderRadius: 9, cursor: 'pointer', textAlign: 'left',
                        border: `1.5px solid ${active ? 'var(--accent-cyan)' : 'var(--border-medium)'}`,
                        background: active ? 'var(--accent-cyan-dim)' : 'var(--glass-light)',
                      }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: active ? 'var(--accent-cyan)' : 'var(--text-secondary)' }}>{m.label}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>{m.desc}</div>
                    </button>
                  )
                })}
              </div>

              {/* ── 同一個人快速套用 ── */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 14px', borderRadius: 10,
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-subtle)',
              }}>
                <Copy size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  同一個人：
                </span>
                <div style={{ flex: 1 }}>
                  <EmpSelect
                    value={bulkId}
                    onChange={setBulkId}
                    candidates={candidateEmployees}
                    placeholder="選人後套用到全部"
                  />
                </div>
                <button
                  onClick={applyBulk}
                  disabled={!bulkId}
                  style={{
                    padding: '5px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                    background: bulkId ? 'var(--accent-cyan)' : 'var(--glass-light)',
                    border: 'none', color: bulkId ? '#fff' : 'var(--text-muted)',
                    cursor: bulkId ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap',
                  }}
                >
                  套用
                </button>
              </div>

              {/* ── 簽核鏈 + 快照 ── */}
              {needsChain && (
                <SectionWithPicker
                  icon={<GitBranch size={13} />}
                  label={`簽核鏈設定（${items.chain_steps?.length || 0} 個關卡）`}
                  accent="cyan"
                  note={items.snapshots?.length > 0 ? `含 ${items.snapshots.length} 筆待簽快照` : undefined}
                  pickerValue={delegates.chain}
                  onPickerChange={v => setDelegate('chain', v)}
                  candidates={candidateEmployees}
                  pickerLabel="* 離職後，未簽核的表單改由以下簽核人簽核："
                >
                  {items.chain_steps?.map(s => (
                    <Row key={s.id}>{s.chain_name} › {s.label}（第 {s.step_order + 1} 關）</Row>
                  ))}
                  {items.snapshots?.length > 0 && (
                    <Row>
                      {Object.entries(
                        items.snapshots.reduce((acc, s) => {
                          acc[s.request_type] = (acc[s.request_type] || 0) + 1; return acc
                        }, {})
                      ).map(([rt, cnt]) => `${RT_LABEL[rt] || rt} ${cnt} 筆`).join('、')}
                    </Row>
                  )}
                  {items.extra_signs > 0 && <Row>待處理加簽 {items.extra_signs} 筆</Row>}
                  {items.tasks > 0 && <Row>名下未完成任務 {items.tasks} 項</Row>}
                </SectionWithPicker>
              )}

              {/* ── 課別督導 ── */}
              {needsSection && (
                <SectionWithPicker
                  icon={<Users size={13} />}
                  label={`課別督導（${items.managed_sections.length} 個課別）`}
                  accent="cyan"
                  pickerValue={delegates.section}
                  onPickerChange={v => setDelegate('section', v)}
                  candidates={candidateEmployees}
                  pickerLabel="* 課別督導承接人："
                >
                  {items.managed_sections.map(s => <Row key={s.id}>{s.name}</Row>)}
                </SectionWithPicker>
              )}

              {/* ── 門市主管 ── */}
              {needsStore && (
                <SectionWithPicker
                  icon={<Building2 size={13} />}
                  label={`門市主管（${items.managed_stores.length} 間門市）`}
                  accent="purple"
                  pickerValue={delegates.store}
                  onPickerChange={v => setDelegate('store', v)}
                  candidates={candidateEmployees}
                  pickerLabel="* 門市主管承接人："
                >
                  {items.managed_stores.map(s => <Row key={s.id}>{s.name}</Row>)}
                </SectionWithPicker>
              )}

              {/* ── 部門主管 + 直屬下屬 ── */}
              {needsDept && (
                <SectionWithPicker
                  icon={<Users size={13} />}
                  label={`部門主管／下屬（${items.managed_depts?.length || 0} 部門 · ${items.subordinates?.length || 0} 下屬）`}
                  accent="blue"
                  pickerValue={delegates.dept}
                  onPickerChange={v => setDelegate('dept', v)}
                  candidates={candidateEmployees}
                  pickerLabel="* 部門主管／下屬報告對象承接人："
                >
                  {items.managed_depts?.map(d => <Row key={d.id}>{d.name}</Row>)}
                  {items.subordinates?.length > 0 && (
                    <Row>下屬：{items.subordinates.map(s => s.name).slice(0, 5).join('、')}{items.subordinates.length > 5 ? `…等 ${items.subordinates.length} 人` : ''}</Row>
                  )}
                </SectionWithPicker>
              )}

              {/* ── 排班（提示用，不需選人） ── */}
              {items.upcoming_shifts > 0 && (
                <div style={{
                  padding: '9px 13px', borderRadius: 10,
                  border: '1px solid var(--accent-orange-dim)',
                  background: 'var(--accent-orange-dim)',
                  display: 'flex', alignItems: 'center', gap: 7,
                }}>
                  <Calendar size={13} style={{ color: 'var(--accent-orange)', flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: 'var(--accent-orange)', fontWeight: 600 }}>
                    近期排班 {items.upcoming_shifts} 個班次
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>— 請另行安排代班，排班不自動轉移</span>
                </div>
              )}

            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 22px 18px',
          borderTop: '1px solid var(--border-subtle)',
          background: 'var(--bg-secondary)',
        }}>
          {error && (
            <div style={{
              marginBottom: 10, padding: '7px 11px', borderRadius: 8,
              background: 'var(--accent-red-dim)', color: 'var(--accent-red)',
              fontSize: 12, fontWeight: 600,
            }}>
              {error}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button
              onClick={onCancel}
              disabled={saving}
              style={{
                padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                background: 'var(--glass-light)', border: '1px solid var(--border-medium)',
                color: 'var(--text-secondary)', cursor: 'pointer',
              }}
            >
              取消
            </button>
            <button
              onClick={handleConfirm}
              disabled={saving || loading}
              style={{
                padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                background: 'var(--accent-cyan)', border: 'none',
                color: '#fff', cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? '處理中…' : `✓ 確定${pendingStatus}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function SectionWithPicker({ icon, label, accent, note, pickerValue, onPickerChange, candidates, pickerLabel, children }) {
  return (
    <div style={{
      borderRadius: 10,
      border: `1px solid var(--accent-${accent}-dim)`,
      overflow: 'hidden',
    }}>
      {/* Section header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '7px 12px',
        background: `var(--accent-${accent}-dim)`,
        color: `var(--accent-${accent})`,
        fontSize: 12, fontWeight: 700,
      }}>
        {icon} {label}
        {note && <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 4 }}>— {note}</span>}
      </div>

      {/* Item list */}
      {children && (
        <div style={{ padding: '6px 12px 4px' }}>
          {children}
        </div>
      )}

      {/* Picker */}
      <div style={{
        padding: '8px 12px 10px',
        borderTop: '1px solid var(--border-subtle)',
        background: 'var(--bg-secondary)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
          {pickerLabel}
        </span>
        <div style={{ flex: 1 }}>
          <EmpSelect
            value={pickerValue}
            onChange={onPickerChange}
            candidates={candidates}
          />
        </div>
      </div>
    </div>
  )
}

function Row({ children }) {
  return (
    <div style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '2px 0', lineHeight: 1.6 }}>
      · {children}
    </div>
  )
}
