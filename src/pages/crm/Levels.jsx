import { useState, useEffect, useCallback } from 'react'
import { useTenant } from '../../contexts/TenantContext'
import {
  getMemberLevels,
  createMemberLevel,
  updateMemberLevel,
  deleteMemberLevel,
} from '../../lib/db'

const CRITERIA_LABELS = {
  lifetime_spend: '累計消費金額 (NT$)',
  visit_count: '累計來店次數',
  lifetime_points: '累計積分',
  manual: '手動指定（不自動晉級）',
}

const EMPTY_FORM = {
  name: '',
  rank: 0,
  color: '#6b7280',
  icon: '⭐',
  criteria_type: 'lifetime_spend',
  criteria_value: 0,
  point_multiplier: 1.0,
  birthday_multiplier: 2.0,
  welcome_points: 0,
  downgrade_inactive_months: 12,
  is_default: false,
}

export default function Levels() {
  const { currentOrg } = useTenant()
  const [levels, setLevels] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)   // level id or 'new'
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await getMemberLevels(currentOrg?.id)
    setLevels(data || [])
    setLoading(false)
  }, [currentOrg?.id])

  useEffect(() => { load() }, [load])

  function openNew() {
    const nextRank = levels.length
    setForm({ ...EMPTY_FORM, rank: nextRank })
    setEditing('new')
    setError('')
  }

  function openEdit(level) {
    setForm({
      name: level.name,
      rank: level.rank,
      color: level.color,
      icon: level.icon,
      criteria_type: level.criteria_type,
      criteria_value: level.criteria_value,
      point_multiplier: level.point_multiplier,
      birthday_multiplier: level.birthday_multiplier,
      welcome_points: level.welcome_points,
      downgrade_inactive_months: level.downgrade_inactive_months,
      is_default: level.is_default,
    })
    setEditing(level.id)
    setError('')
  }

  function closePanel() {
    setEditing(null)
    setError('')
  }

  function setField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('等級名稱不可空白'); return }
    setSaving(true)
    setError('')
    const payload = {
      ...form,
      organization_id: currentOrg?.id,
      rank: Number(form.rank),
      criteria_value: Number(form.criteria_value),
      point_multiplier: Number(form.point_multiplier),
      birthday_multiplier: Number(form.birthday_multiplier),
      welcome_points: Number(form.welcome_points),
      downgrade_inactive_months: Number(form.downgrade_inactive_months),
    }
    let err
    if (editing === 'new') {
      ;({ error: err } = await createMemberLevel(payload))
    } else {
      ;({ error: err } = await updateMemberLevel(editing, payload))
    }
    setSaving(false)
    if (err) { setError(err.message); return }
    await load()
    closePanel()
  }

  async function handleDelete(level) {
    if (level.is_default) return
    if (!confirm(`確定刪除「${level.name}」等級？`)) return
    await deleteMemberLevel(level.id)
    await load()
  }

  return (
    <div style={{ display: 'flex', gap: '1.5rem', padding: '1.5rem', minHeight: '100%' }}>
      {/* Left: level list */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ color: 'var(--text-primary)', fontSize: '1.1rem', fontWeight: 600 }}>會員等級設定</h2>
          <button
            onClick={openNew}
            style={{
              background: 'var(--accent-cyan)',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              padding: '0.4rem 1rem',
              cursor: 'pointer',
              fontSize: '0.85rem',
              fontWeight: 500,
            }}
          >
            + 新增等級
          </button>
        </div>

        {loading ? (
          <div style={{ color: 'var(--text-muted)', padding: '2rem', textAlign: 'center' }}>載入中…</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {levels.map(lvl => (
              <LevelCard
                key={lvl.id}
                level={lvl}
                onEdit={() => openEdit(lvl)}
                onDelete={() => handleDelete(lvl)}
                selected={editing === lvl.id}
              />
            ))}
            {levels.length === 0 && (
              <div style={{
                border: '1px dashed var(--border-primary)',
                borderRadius: '8px',
                padding: '2rem',
                textAlign: 'center',
                color: 'var(--text-muted)',
                fontSize: '0.9rem',
              }}>
                尚無等級設定。點擊「新增等級」建立第一個等級。
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right: edit panel */}
      {editing !== null && (
        <div style={{
          width: '360px',
          flexShrink: 0,
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-primary)',
          borderRadius: '10px',
          padding: '1.25rem',
          alignSelf: 'flex-start',
        }}>
          <h3 style={{ color: 'var(--text-primary)', fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>
            {editing === 'new' ? '新增等級' : '編輯等級'}
          </h3>

          {/* Preview badge */}
          <div style={{ marginBottom: '1rem' }}>
            <span style={{
              background: form.color + '33',
              color: form.color,
              borderRadius: '20px',
              padding: '0.25rem 0.75rem',
              fontSize: '0.85rem',
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3rem',
            }}>
              {form.icon} {form.name || '等級名稱'}
            </span>
          </div>

          <FormRow label="等級名稱">
            <input
              value={form.name}
              onChange={e => setField('name', e.target.value)}
              placeholder="例：銀級會員"
              style={inputStyle}
            />
          </FormRow>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <FormRow label="顯示圖示（Emoji）">
              <input value={form.icon} onChange={e => setField('icon', e.target.value)} style={inputStyle} maxLength={4} />
            </FormRow>
            <FormRow label="顏色">
              <input type="color" value={form.color} onChange={e => setField('color', e.target.value)} style={{ ...inputStyle, padding: '2px', height: '36px', cursor: 'pointer' }} />
            </FormRow>
          </div>

          <FormRow label="排序（0 = 最低）">
            <input type="number" min={0} value={form.rank} onChange={e => setField('rank', e.target.value)} style={inputStyle} />
          </FormRow>

          <FormRow label="升級條件類型">
            <select value={form.criteria_type} onChange={e => setField('criteria_type', e.target.value)} style={inputStyle}>
              {Object.entries(CRITERIA_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </FormRow>

          {form.criteria_type !== 'manual' && (
            <FormRow label={CRITERIA_LABELS[form.criteria_type]}>
              <input type="number" min={0} value={form.criteria_value} onChange={e => setField('criteria_value', e.target.value)} style={inputStyle} />
            </FormRow>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <FormRow label="積分倍率">
              <input type="number" min={0.1} step={0.1} value={form.point_multiplier} onChange={e => setField('point_multiplier', e.target.value)} style={inputStyle} />
            </FormRow>
            <FormRow label="生日倍率">
              <input type="number" min={1} step={0.1} value={form.birthday_multiplier} onChange={e => setField('birthday_multiplier', e.target.value)} style={inputStyle} />
            </FormRow>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <FormRow label="歡迎點數">
              <input type="number" min={0} value={form.welcome_points} onChange={e => setField('welcome_points', e.target.value)} style={inputStyle} />
            </FormRow>
            <FormRow label="降級閒置月數">
              <input type="number" min={1} value={form.downgrade_inactive_months} onChange={e => setField('downgrade_inactive_months', e.target.value)} style={inputStyle} />
            </FormRow>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={form.is_default}
              onChange={e => setField('is_default', e.target.checked)}
            />
            設為預設入會等級
          </label>

          {error && (
            <div style={{ background: 'var(--accent-red-dim)', color: 'var(--accent-red)', borderRadius: '6px', padding: '0.5rem 0.75rem', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                flex: 1,
                background: saving ? 'var(--bg-tertiary)' : 'var(--accent-cyan)',
                color: saving ? 'var(--text-muted)' : '#fff',
                border: 'none',
                borderRadius: '6px',
                padding: '0.5rem',
                cursor: saving ? 'not-allowed' : 'pointer',
                fontWeight: 600,
                fontSize: '0.875rem',
              }}
            >
              {saving ? '儲存中…' : '儲存'}
            </button>
            <button
              onClick={closePanel}
              style={{
                padding: '0.5rem 1rem',
                background: 'var(--bg-tertiary)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-primary)',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '0.875rem',
              }}
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function LevelCard({ level, onEdit, onDelete, selected }) {
  return (
    <div style={{
      background: selected ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
      border: `1px solid ${selected ? 'var(--accent-cyan)' : 'var(--border-primary)'}`,
      borderRadius: '8px',
      padding: '0.875rem 1rem',
      display: 'flex',
      alignItems: 'center',
      gap: '1rem',
    }}>
      <span style={{
        background: level.color + '33',
        color: level.color,
        borderRadius: '20px',
        padding: '0.2rem 0.65rem',
        fontSize: '0.8rem',
        fontWeight: 600,
        whiteSpace: 'nowrap',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.25rem',
        minWidth: '80px',
        justifyContent: 'center',
      }}>
        {level.icon} {level.name}
      </span>

      <div style={{ flex: 1, display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
        <Stat label="升級條件" value={
          level.criteria_type === 'manual'
            ? '手動'
            : `${CRITERIA_LABELS[level.criteria_type]?.split('（')[0]} ≥ ${Number(level.criteria_value).toLocaleString()}`
        } />
        <Stat label="積分倍率" value={`×${level.point_multiplier}`} />
        <Stat label="歡迎點" value={level.welcome_points > 0 ? level.welcome_points : '—'} />
        {level.is_default && (
          <span style={{
            background: 'var(--accent-blue-dim)',
            color: 'var(--accent-blue)',
            borderRadius: '4px',
            padding: '0.1rem 0.5rem',
            fontSize: '0.7rem',
            fontWeight: 600,
            alignSelf: 'center',
          }}>
            預設入會
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
        <button
          onClick={onEdit}
          style={{
            background: 'var(--bg-tertiary)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-primary)',
            borderRadius: '6px',
            padding: '0.3rem 0.65rem',
            cursor: 'pointer',
            fontSize: '0.8rem',
          }}
        >
          編輯
        </button>
        {!level.is_default && (
          <button
            onClick={onDelete}
            style={{
              background: 'var(--accent-red-dim)',
              color: 'var(--accent-red)',
              border: 'none',
              borderRadius: '6px',
              padding: '0.3rem 0.65rem',
              cursor: 'pointer',
              fontSize: '0.8rem',
            }}
          >
            刪除
          </button>
        )}
      </div>
    </div>
  )
}

function FormRow({ label, children }) {
  return (
    <div style={{ marginBottom: '0.75rem' }}>
      <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '0.25rem' }}>
        {label}
      </label>
      {children}
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div>
      <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{label}</div>
      <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', fontWeight: 500 }}>{value}</div>
    </div>
  )
}

const inputStyle = {
  width: '100%',
  background: 'var(--bg-primary)',
  border: '1px solid var(--border-primary)',
  borderRadius: '6px',
  padding: '0.4rem 0.6rem',
  color: 'var(--text-primary)',
  fontSize: '0.875rem',
  boxSizing: 'border-box',
}
