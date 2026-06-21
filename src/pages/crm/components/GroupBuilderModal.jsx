import { useState, useEffect } from 'react'
import { X, Plus, Trash2, Eye } from 'lucide-react'
import { getMemberLevels, createMemberGroup, updateMemberGroup, refreshMemberGroup, previewMemberGroup } from '../../../lib/db'

const FIELD_CONFIG = {
  lifetime_spend:  { label: '累計消費 (NT$)', type: 'number',        ops: ['gte','lte','eq'] },
  lifetime_points: { label: '累計積分',        type: 'number',        ops: ['gte','lte','eq'] },
  visit_count:     { label: '來店次數',         type: 'number',        ops: ['gte','lte','eq'] },
  level_id:        { label: '會員等級',         type: 'level_select',  ops: ['eq','neq']       },
  type:            { label: '會員類型',         type: 'type_select',   ops: ['eq','neq']       },
  status:          { label: '會員狀態',         type: 'status_select', ops: ['eq']             },
}

const OP_LABELS   = { eq: '等於', neq: '不等於', gte: '≥', lte: '≤' }
const MEMBER_TYPES    = ['consumer','corporate','vip','staff','trade']
const MEMBER_STATUSES = ['active','inactive','suspended']

let _seq = 0
const uid = () => String(++_seq)
const emptyCondition = () => ({ id: uid(), field: 'lifetime_spend', operator: 'gte', value: '' })

export default function GroupBuilderModal({ group, orgId, onClose, onSaved }) {
  const isEdit = !!group

  const [name, setName]         = useState(group?.name || '')
  const [desc, setDesc]         = useState(group?.description || '')
  const [type, setType]         = useState(group?.type || 'dynamic')
  const [op, setOp]             = useState(group?.criteria_json?.op || 'AND')
  const [conditions, setConds]  = useState(() => {
    const raw = group?.criteria_json?.conditions || []
    return raw.length ? raw.map(c => ({ ...c, id: uid() })) : [emptyCondition()]
  })
  const [levels, setLevels]     = useState([])
  const [preview, setPreview]   = useState(null)
  const [previewing, setPreview2] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')

  useEffect(() => {
    if (orgId) getMemberLevels(orgId).then(({ data }) => setLevels(data || []))
  }, [orgId])

  function addCond()       { setConds(p => [...p, emptyCondition()]) }
  function removeCond(id)  { setConds(p => p.filter(c => c.id !== id)) }
  function updateCond(id, key, value) {
    setConds(p => p.map(c => {
      if (c.id !== id) return c
      const next = { ...c, [key]: value }
      if (key === 'field') { next.operator = FIELD_CONFIG[value]?.ops[0] || 'eq'; next.value = '' }
      return next
    }))
  }

  async function handlePreview() {
    if (!orgId || type !== 'dynamic') return
    setPreview2(true)
    setPreview(null)
    const criteria = { op, conditions: conditions.filter(c => c.value !== '') }
    const { data, error: err } = await previewMemberGroup(orgId, criteria)
    setPreview2(false)
    if (err) { setError(err.message); return }
    setPreview(data)
  }

  async function handleSave() {
    if (!name.trim()) { setError('群組名稱不可空白'); return }
    setSaving(true); setError('')

    const criteria_json = type === 'dynamic'
      ? { op, conditions: conditions.filter(c => c.value !== '') }
      : { op: 'AND', conditions: [] }

    const payload = { name: name.trim(), description: desc.trim() || null, type, criteria_json, organization_id: orgId }
    let data, err
    if (isEdit) {
      ;({ data, error: err } = await updateMemberGroup(group.id, payload))
    } else {
      ;({ data, error: err } = await createMemberGroup(payload))
    }

    if (err) { setError(err.message); setSaving(false); return }
    if (type === 'dynamic' && data?.id) await refreshMemberGroup(data.id)
    setSaving(false); onSaved(); onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: '12px', width: '100%', maxWidth: '640px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-primary)' }}>
          <h3 style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '1rem' }}>
            {isEdit ? '編輯群組' : '新增群組'}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>

          <FormRow label="群組名稱 *">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="例：高消費金級會員" style={inp} />
          </FormRow>

          <FormRow label="說明（選填）">
            <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="此群組用途說明" style={inp} />
          </FormRow>

          <FormRow label="群組類型">
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {['dynamic','static'].map(t => (
                <button key={t} onClick={() => setType(t)} style={{
                  padding: '0.35rem 0.875rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem',
                  border: `1px solid ${type === t ? 'var(--accent-cyan)' : 'var(--border-primary)'}`,
                  background: type === t ? 'var(--accent-cyan-dim)' : 'var(--bg-primary)',
                  color: type === t ? 'var(--accent-cyan)' : 'var(--text-muted)',
                  fontWeight: type === t ? 600 : 400,
                }}>
                  {t === 'dynamic' ? '動態（依條件）' : '靜態（手動維護）'}
                </button>
              ))}
            </div>
          </FormRow>

          {/* Criteria builder */}
          {type === 'dynamic' && (
            <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-primary)', borderRadius: '8px', padding: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 600 }}>篩選條件</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>條件關係</span>
                  {['AND','OR'].map(o => (
                    <button key={o} onClick={() => setOp(o)} style={{
                      padding: '0.15rem 0.55rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem',
                      border: `1px solid ${op === o ? 'var(--accent-orange)' : 'var(--border-primary)'}`,
                      background: op === o ? 'var(--accent-orange-dim)' : 'transparent',
                      color: op === o ? 'var(--accent-orange)' : 'var(--text-muted)',
                      fontWeight: op === o ? 700 : 400,
                    }}>{o}</button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                {conditions.map((cond, i) => (
                  <ConditionRow
                    key={cond.id} cond={cond} connector={i > 0 ? op : null} levels={levels}
                    onChange={(k, v) => updateCond(cond.id, k, v)}
                    onRemove={() => removeCond(cond.id)}
                    removable={conditions.length > 1}
                  />
                ))}
              </div>

              <button onClick={addCond} style={{ marginTop: '0.6rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem', background: 'none', border: '1px dashed var(--border-primary)', borderRadius: '6px', padding: '0.28rem 0.7rem', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.78rem' }}>
                <Plus size={13} /> 新增條件
              </button>

              <div style={{ marginTop: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <button onClick={handlePreview} disabled={previewing} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: '6px', padding: '0.3rem 0.7rem', color: 'var(--text-secondary)', cursor: previewing ? 'not-allowed' : 'pointer', fontSize: '0.8rem' }}>
                  <Eye size={13} /> {previewing ? '計算中…' : '預覽人數'}
                </button>
                {preview !== null && (
                  <span style={{ color: 'var(--accent-cyan)', fontWeight: 700, fontSize: '0.9rem' }}>
                    符合條件：{preview.toLocaleString()} 人
                  </span>
                )}
              </div>
            </div>
          )}

          {type === 'static' && (
            <div style={{ background: 'var(--accent-blue-dim)', color: 'var(--accent-blue)', borderRadius: '8px', padding: '0.75rem 1rem', fontSize: '0.82rem' }}>
              靜態群組儲存後，請到群組列表展開成員清單，手動加入或移除會員。
            </div>
          )}

          {error && (
            <div style={{ background: 'var(--accent-red-dim)', color: 'var(--accent-red)', borderRadius: '6px', padding: '0.5rem 0.75rem', fontSize: '0.85rem' }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '1rem 1.25rem', borderTop: '1px solid var(--border-primary)', display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '0.45rem 1rem', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border-primary)', borderRadius: '6px', cursor: 'pointer', fontSize: '0.875rem' }}>
            取消
          </button>
          <button onClick={handleSave} disabled={saving} style={{ padding: '0.45rem 1.25rem', background: saving ? 'var(--bg-tertiary)' : 'var(--accent-cyan)', color: saving ? 'var(--text-muted)' : '#fff', border: 'none', borderRadius: '6px', cursor: saving ? 'not-allowed' : 'pointer', fontSize: '0.875rem', fontWeight: 600 }}>
            {saving ? '儲存中…' : isEdit ? '更新群組' : '建立群組'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ConditionRow({ cond, connector, levels, onChange, onRemove, removable }) {
  const config = FIELD_CONFIG[cond.field] || FIELD_CONFIG.lifetime_spend
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
      <div style={{ width: '28px', textAlign: 'center', color: 'var(--accent-orange)', fontSize: '0.7rem', fontWeight: 700, flexShrink: 0 }}>
        {connector || ''}
      </div>

      <select value={cond.field} onChange={e => onChange('field', e.target.value)} style={{ ...sel, flex: '1.4' }}>
        {Object.entries(FIELD_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
      </select>

      <select value={cond.operator} onChange={e => onChange('operator', e.target.value)} style={{ ...sel, flex: '0.7' }}>
        {config.ops.map(o => <option key={o} value={o}>{OP_LABELS[o]}</option>)}
      </select>

      {config.type === 'number' && (
        <input type="number" min={0} value={cond.value} onChange={e => onChange('value', e.target.value)} placeholder="數值" style={{ ...sel, flex: '1' }} />
      )}
      {config.type === 'level_select' && (
        <select value={cond.value} onChange={e => onChange('value', e.target.value)} style={{ ...sel, flex: '1' }}>
          <option value="">選擇等級</option>
          {levels.map(l => <option key={l.id} value={String(l.id)}>{l.icon} {l.name}</option>)}
        </select>
      )}
      {config.type === 'type_select' && (
        <select value={cond.value} onChange={e => onChange('value', e.target.value)} style={{ ...sel, flex: '1' }}>
          <option value="">選擇類型</option>
          {MEMBER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      )}
      {config.type === 'status_select' && (
        <select value={cond.value} onChange={e => onChange('value', e.target.value)} style={{ ...sel, flex: '1' }}>
          <option value="">選擇狀態</option>
          {MEMBER_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      )}

      <button onClick={onRemove} disabled={!removable} style={{ background: 'none', border: 'none', cursor: removable ? 'pointer' : 'not-allowed', color: removable ? 'var(--accent-red)' : 'var(--bg-tertiary)', padding: '2px', flexShrink: 0 }}>
        <Trash2 size={14} />
      </button>
    </div>
  )
}

function FormRow({ label, children }) {
  return (
    <div>
      <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '0.25rem' }}>{label}</label>
      {children}
    </div>
  )
}

const inp = { width: '100%', background: 'var(--bg-primary)', border: '1px solid var(--border-primary)', borderRadius: '6px', padding: '0.4rem 0.6rem', color: 'var(--text-primary)', fontSize: '0.875rem', boxSizing: 'border-box' }
const sel = { background: 'var(--bg-primary)', border: '1px solid var(--border-primary)', borderRadius: '6px', padding: '0.32rem 0.45rem', color: 'var(--text-primary)', fontSize: '0.8rem', boxSizing: 'border-box' }
