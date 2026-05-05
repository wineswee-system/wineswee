import { useState, useEffect } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import { supabase } from '../../../lib/supabase'

// 4 個子表的 CRUD 集中在這裡：family_members / education_records / work_experiences / certifications
// 加上 employee_skills（語言 / 工具 / 工作技能 / 職能）

const TABS = [
  { key: 'family',     label: '👪 家庭', table: 'family_members',    titleField: 'name' },
  { key: 'education',  label: '🎓 學歷', table: 'education_records', titleField: 'school' },
  { key: 'work',       label: '💼 經歷', table: 'work_experiences',  titleField: 'company' },
  { key: 'cert',       label: '📜 證照', table: 'certifications',    titleField: 'name' },
  { key: 'skills',     label: '🛠 技能', table: 'employee_skills',   titleField: 'skill_name' },
]

const TABLE_FIELDS = {
  family_members: [
    { key: 'name',         label: '姓名',     type: 'text' },
    { key: 'relationship', label: '關係',     type: 'select', options: ['配偶','父','母','子','女','兄','弟','姊','妹','其他'] },
    { key: 'gender',       label: '性別',     type: 'select', options: ['男','女'] },
    { key: 'birth_date',   label: '出生日期', type: 'date' },
    { key: 'occupation',   label: '職業',     type: 'text' },
    { key: 'notes',        label: '備註',     type: 'text' },
  ],
  education_records: [
    { key: 'degree',      label: '學歷', type: 'select', options: ['博士','碩士','大學','專科','高中','國中','其他'] },
    { key: 'school',      label: '學校', type: 'text' },
    { key: 'major',       label: '科系', type: 'text' },
    { key: 'study_start', label: '就學起', type: 'date' },
    { key: 'study_end',   label: '就學迄', type: 'date' },
    { key: 'status',      label: '狀態', type: 'select', options: ['畢業','肄業','在學'] },
    { key: 'is_highest',  label: '最高學歷', type: 'checkbox' },
  ],
  work_experiences: [
    { key: 'status',      label: '狀態', type: 'select', options: ['前職','現職'] },
    { key: 'company',     label: '公司', type: 'text' },
    { key: 'position',    label: '職位', type: 'text' },
    { key: 'start_date',  label: '起日', type: 'date' },
    { key: 'end_date',    label: '迄日', type: 'date' },
    { key: 'description', label: '說明', type: 'textarea' },
  ],
  certifications: [
    { key: 'name',           label: '證照名稱', type: 'text' },
    { key: 'issued_by',      label: '發證單位', type: 'text' },
    { key: 'issued_date',    label: '取得日期', type: 'date' },
    { key: 'expiry_date',    label: '到期日期', type: 'date' },
    { key: 'certificate_no', label: '證書編號', type: 'text' },
    { key: 'notes',          label: '備註',     type: 'text' },
  ],
  employee_skills: [
    { key: 'skill_type',  label: '類別', type: 'select', options: [
      { v: 'language',    l: '語言能力' },
      { v: 'tool',        l: '擅長工具' },
      { v: 'work_skill',  l: '工作技能' },
      { v: 'competency',  l: '職能' },
    ]},
    { key: 'skill_name',  label: '名稱', type: 'text' },
    { key: 'proficiency', label: '熟練度', type: 'select', options: ['精通','熟練','普通','略懂'] },
    { key: 'level',       label: '等級',   type: 'text' }, // 既有欄位
    { key: 'evaluated_date', label: '評估日期', type: 'date' },
    { key: 'evaluator',   label: '評估人', type: 'text' },
    { key: 'notes',       label: '備註',   type: 'text' },
  ],
}

export default function EmployeeDetailsModal({ employee, onClose }) {
  const [activeTab, setActiveTab] = useState('family')
  const [data, setData] = useState({}) // { family_members: [...], ... }
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!employee) return
    setLoading(true)
    Promise.all(TABS.map(t =>
      supabase.from(t.table).select('*').eq('employee_id', employee.id).order('id')
    )).then(results => {
      const next = {}
      TABS.forEach((t, i) => { next[t.table] = results[i].data || [] })
      setData(next)
    }).finally(() => setLoading(false))
  }, [employee])

  if (!employee) return null

  const currentTab = TABS.find(t => t.key === activeTab)
  const tableName = currentTab.table
  const rows = data[tableName] || []
  const fieldDefs = TABLE_FIELDS[tableName]

  const addBlankRow = () => {
    const blank = { _isNew: true, _localId: Date.now() + Math.random(), employee_id: employee.id }
    fieldDefs.forEach(f => {
      blank[f.key] = f.type === 'checkbox' ? false : ''
    })
    setData(d => ({ ...d, [tableName]: [...rows, blank] }))
  }

  const updateRow = (idx, field, value) => {
    setData(d => ({
      ...d,
      [tableName]: rows.map((r, i) => i === idx ? { ...r, [field]: value } : r),
    }))
  }

  const deleteRow = async (idx) => {
    const row = rows[idx]
    if (!row._isNew && row.id) {
      if (!confirm('確定刪除這筆？')) return
      await supabase.from(tableName).delete().eq('id', row.id)
    }
    setData(d => ({ ...d, [tableName]: rows.filter((_, i) => i !== idx) }))
  }

  const saveAll = async () => {
    setSaving(true)
    try {
      const inserts = []
      const updates = []
      for (const r of rows) {
        const { _isNew, _localId, id, created_at, organization_id, ...payload } = r
        // 清空字串轉 null（避免 numeric / date 欄塞空字串）
        for (const k of Object.keys(payload)) {
          if (payload[k] === '') payload[k] = null
        }
        payload.employee_id = employee.id
        if (_isNew) inserts.push(payload)
        else updates.push({ id, ...payload })
      }
      if (inserts.length > 0) {
        const { error } = await supabase.from(tableName).insert(inserts)
        if (error) throw error
      }
      for (const u of updates) {
        const { id, ...payload } = u
        const { error } = await supabase.from(tableName).update(payload).eq('id', id)
        if (error) throw error
      }
      // 重抓
      const { data: fresh } = await supabase.from(tableName).select('*').eq('employee_id', employee.id).order('id')
      setData(d => ({ ...d, [tableName]: fresh || [] }))
      alert('已儲存')
    } catch (err) {
      alert('儲存失敗：' + (err.message || '未知錯誤'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg-card)', borderRadius: 14, padding: 24,
        width: '92%', maxWidth: 1100, maxHeight: '90vh', overflow: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>📁 員工詳細資料 — {employee.name}{employee.name_en ? ` ${employee.name_en}` : ''}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--text-muted)' }}><X size={20} /></button>
        </div>

        {/* Tab 列 */}
        <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border-medium)', borderRadius: 8, overflow: 'hidden', marginBottom: 14 }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
              padding: '8px 14px', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              background: activeTab === t.key ? 'var(--accent-cyan)' : 'var(--bg-card)',
              color: activeTab === t.key ? '#fff' : 'var(--text-muted)',
              flex: 1,
            }}>{t.label}（{(data[t.table] || []).length}）</button>
          ))}
        </div>

        {/* 內容 */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>載入中…</div>
        ) : (
          <>
            {rows.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)', fontSize: 13 }}>沒有資料</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {rows.map((row, idx) => (
                  <div key={row.id || row._localId} style={{
                    border: '1px solid var(--border-medium)', borderRadius: 10, padding: 12,
                    background: row._isNew ? 'var(--accent-yellow-dim)' : 'var(--bg-secondary)',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
                      <button onClick={() => deleteRow(idx)} className="btn btn-sm btn-secondary"
                        style={{ width: 'auto', padding: '3px 8px', fontSize: 11, color: 'var(--accent-red)' }}>
                        <Trash2 size={11} /> 刪除
                      </button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      {fieldDefs.map(f => (
                        <FieldInput key={f.key} field={f} value={row[f.key]} onChange={v => updateRow(idx, f.key, v)} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, gap: 8 }}>
              <button onClick={addBlankRow} className="btn btn-secondary" style={{ width: 'auto', padding: '6px 14px' }}>
                <Plus size={14} /> 新增一筆
              </button>
              <button onClick={saveAll} disabled={saving} className="btn btn-primary" style={{ width: 'auto', padding: '6px 18px' }}>
                {saving ? '儲存中…' : '💾 儲存全部變更'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function FieldInput({ field, value, onChange }) {
  const wrapper = { display: 'flex', flexDirection: 'column', gap: 3 }
  const label = <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>{field.label}</label>

  if (field.type === 'select') {
    return (
      <div style={wrapper}>{label}
        <select className="form-input" style={{ fontSize: 13 }} value={value || ''} onChange={e => onChange(e.target.value)}>
          <option value="">— 不選 —</option>
          {field.options.map((opt, i) => {
            const v = typeof opt === 'string' ? opt : opt.v
            const l = typeof opt === 'string' ? opt : opt.l
            return <option key={i} value={v}>{l}</option>
          })}
        </select>
      </div>
    )
  }
  if (field.type === 'checkbox') {
    return (
      <div style={wrapper}>{label}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0' }}>
          <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} />
          <span style={{ fontSize: 12 }}>是</span>
        </label>
      </div>
    )
  }
  if (field.type === 'textarea') {
    return (
      <div style={{ ...wrapper, gridColumn: '1 / -1' }}>{label}
        <textarea className="form-input" style={{ fontSize: 13, minHeight: 60 }} value={value || ''} onChange={e => onChange(e.target.value)} />
      </div>
    )
  }
  return (
    <div style={wrapper}>{label}
      <input className="form-input" type={field.type} style={{ fontSize: 13 }} value={value || ''} onChange={e => onChange(e.target.value)} />
    </div>
  )
}
