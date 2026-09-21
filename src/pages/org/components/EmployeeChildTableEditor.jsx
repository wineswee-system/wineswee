import { useState, useEffect } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { supabase } from '../../../lib/supabase'

import { toast } from '../../../lib/toast'
import { confirm } from '../../../lib/confirm'
// 單一子表的 CRUD 編輯器（給編輯 modal 內各 tab 重用）
// props:
//   employeeId: number
//   table: 'family_members' | 'education_records' | 'work_experiences' | 'certifications' | 'employee_skills'

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
    { key: 'level',       label: '等級',   type: 'text' },
    { key: 'evaluated_date', label: '評估日期', type: 'date' },
    { key: 'evaluator',   label: '評估人', type: 'text' },
    { key: 'notes',       label: '備註',   type: 'text' },
  ],
}

export default function EmployeeChildTableEditor({ employeeId, table }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const fieldDefs = TABLE_FIELDS[table] || []

  useEffect(() => {
    if (!employeeId) return
    setLoading(true)
    supabase.from(table).select('*').eq('employee_id', employeeId).order('id')
      .then(({ data }) => setRows(data || []))
      .finally(() => setLoading(false))
  }, [employeeId, table])

  const addRow = () => {
    const blank = { _isNew: true, _localId: Date.now() + Math.random(), employee_id: employeeId }
    fieldDefs.forEach(f => { blank[f.key] = f.type === 'checkbox' ? false : '' })
    setRows([...rows, blank])
  }

  const updateRow = (idx, field, value) => {
    setRows(rows.map((r, i) => i === idx ? { ...r, [field]: value } : r))
  }

  const deleteRow = async (idx) => {
    const row = rows[idx]
    if (!row._isNew && row.id) {
      if (!(await confirm({ message: '確定刪除這筆？' }))) return
      await supabase.from(table).delete().eq('id', row.id)
    }
    setRows(rows.filter((_, i) => i !== idx))
  }

  const saveAll = async () => {
    setSaving(true)
    try {
      const inserts = []
      const updates = []
      for (const r of rows) {
        const { _isNew, _localId, id, created_at, organization_id, ...payload } = r
        for (const k of Object.keys(payload)) {
          if (payload[k] === '') payload[k] = null
        }
        payload.employee_id = employeeId
        if (_isNew) inserts.push(payload)
        else updates.push({ id, ...payload })
      }
      if (inserts.length > 0) {
        const { error } = await supabase.from(table).insert(inserts)
        if (error) throw error
      }
      for (const u of updates) {
        const { id, ...payload } = u
        const { error } = await supabase.from(table).update(payload).eq('id', id)
        if (error) throw error
      }
      const { data: fresh } = await supabase.from(table).select('*').eq('employee_id', employeeId).order('id')
      setRows(fresh || [])
      toast.success('已儲存')
    } catch (err) {
      toast.error('儲存失敗：' + (err.message || '未知錯誤'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>載入中…</div>

  return (
    <div>
      {rows.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>沒有資料</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((row, idx) => (
            <div key={row.id || row._localId} style={{
              border: '1px solid var(--border-medium)', borderRadius: 8, padding: 10,
              background: row._isNew ? 'var(--accent-yellow-dim)' : 'var(--bg-secondary)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
                <button onClick={() => deleteRow(idx)} className="btn btn-sm btn-secondary"
                  style={{ width: 'auto', padding: '2px 8px', fontSize: 11, color: 'var(--accent-red)' }}>
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
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, gap: 8 }}>
        <button onClick={addRow} className="btn btn-secondary" style={{ width: 'auto', padding: '5px 12px', fontSize: 12 }}>
          <Plus size={12} /> 新增一筆
        </button>
        <button onClick={saveAll} disabled={saving} className="btn btn-primary" style={{ width: 'auto', padding: '5px 14px', fontSize: 12 }}>
          {saving ? '儲存中…' : '💾 儲存此區'}
        </button>
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
