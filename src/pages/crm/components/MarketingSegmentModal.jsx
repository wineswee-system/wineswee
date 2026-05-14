import React, { useMemo } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { evaluateSegment, SEGMENT_OPERATORS, CUSTOMER_FIELDS } from '../../../lib/crmEngine'
import Modal, { Field } from '../../../components/Modal'

export default function MarketingSegmentModal({
  allCustomers, segmentBuilder, setSegmentBuilder,
  addCondition, removeCondition, updateCondition, saveSegment, onClose,
}) {
  const segmentPreview = useMemo(() => {
    if (segmentBuilder.conditions.length === 0) return allCustomers
    const validConditions = segmentBuilder.conditions.filter(c => c.value !== '' || c.operator === 'is_empty' || c.operator === 'is_not_empty')
    if (validConditions.length === 0) return allCustomers
    return evaluateSegment(allCustomers, { logic: segmentBuilder.logic, conditions: validConditions })
  }, [segmentBuilder, allCustomers])

  return (
    <Modal title="建立自訂分群" onClose={onClose} onSubmit={saveSegment}>
      <Field label="分群名稱" required>
        <input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：高消費活躍客戶" value={segmentBuilder.name} onChange={e => setSegmentBuilder(prev => ({ ...prev, name: e.target.value }))} />
      </Field>

      <Field label="邏輯運算">
        <select className="form-input" style={{ width: '100%' }} value={segmentBuilder.logic} onChange={e => setSegmentBuilder(prev => ({ ...prev, logic: e.target.value }))}>
          <option value="and">AND - 全部條件都必須符合</option>
          <option value="or">OR - 任一條件符合即可</option>
        </select>
      </Field>

      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text-primary)' }}>篩選條件</div>
        {segmentBuilder.conditions.map((cond, idx) => (
          <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
            <select className="form-input" style={{ flex: 1 }} value={cond.field} onChange={e => updateCondition(idx, 'field', e.target.value)}>
              {CUSTOMER_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
            <select className="form-input" style={{ flex: 1 }} value={cond.operator} onChange={e => updateCondition(idx, 'operator', e.target.value)}>
              {SEGMENT_OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {cond.operator !== 'is_empty' && cond.operator !== 'is_not_empty' && (
              (() => {
                const fieldDef = CUSTOMER_FIELDS.find(f => f.value === cond.field)
                if (fieldDef?.type === 'select') {
                  return (
                    <select className="form-input" style={{ flex: 1 }} value={cond.value} onChange={e => updateCondition(idx, 'value', e.target.value)}>
                      <option value="">-- 選擇 --</option>
                      {fieldDef.options.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  )
                }
                return (
                  <input className="form-input" type={fieldDef?.type === 'number' ? 'number' : 'text'} style={{ flex: 1 }} placeholder="值" value={cond.value} onChange={e => updateCondition(idx, 'value', fieldDef?.type === 'number' ? Number(e.target.value) : e.target.value)} />
                )
              })()
            )}
            <button className="btn" style={{ padding: '4px 8px', background: 'var(--accent-red-dim)', color: 'var(--accent-red)', border: '1px solid var(--accent-red)' }} onClick={() => removeCondition(idx)} disabled={segmentBuilder.conditions.length <= 1}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        <button className="btn" style={{ fontSize: 12, padding: '4px 12px', background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)', border: '1px solid var(--accent-cyan)' }} onClick={addCondition}>
          <Plus size={12} /> 新增條件
        </button>
      </div>

      {/* Segment Preview */}
      <div style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--glass-light)', border: '1px solid var(--border-subtle)' }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
          預覽結果：<strong style={{ color: 'var(--accent-cyan)', fontSize: 16 }}>{segmentPreview.length}</strong> 位客戶符合
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {segmentPreview.slice(0, 8).map((c, i) => (
            <span key={i} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
              {c.name}
            </span>
          ))}
          {segmentPreview.length > 8 && <span style={{ fontSize: 11, color: 'var(--text-muted)', padding: '2px 4px' }}>...還有 {segmentPreview.length - 8} 位</span>}
        </div>
      </div>
    </Modal>
  )
}
