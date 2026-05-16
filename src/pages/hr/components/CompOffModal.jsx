import { useState } from 'react'
import { ModalOverlay } from '../../../components/Modal'

// ══════════════════════════════════════════════════════════════
//  Comp-Off Assignment Modal (指派補休)
// ══════════════════════════════════════════════════════════════
export default function CompOffModal({ employees, activeDates, schedules, onAssign, onClose }) {
  const [selected, setSelected] = useState({}) // { "empName_date": true }
  const [saving, setSaving] = useState(false)

  const toggle = (emp, date) => {
    const key = `${emp}_${date}`
    setSelected(prev => {
      const next = { ...prev }
      if (next[key]) delete next[key]
      else next[key] = true
      return next
    })
  }

  const handleSave = async () => {
    const assignments = Object.keys(selected).map(key => {
      const [employee, date] = key.split('_')
      return { employee, date }
    })
    if (assignments.length === 0) return
    setSaving(true)
    await onAssign(assignments)
    setSaving(false)
  }

  const selectedCount = Object.keys(selected).length
  const dows = ['日', '一', '二', '三', '四', '五', '六']

  return (
    <ModalOverlay onClose={onClose}>
      <div style={{ background: 'var(--bg-card)', borderRadius: 16, padding: 24, width: '90%', maxWidth: 800, maxHeight: '80vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>🔄 指派補休</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}>✕</button>
        </div>

        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
          點選格子指派補休，已有班的格子會被覆蓋為補休。
          {selectedCount > 0 && <strong style={{ color: 'var(--accent-cyan)', marginLeft: 8 }}>已選 {selectedCount} 格</strong>}
        </p>

        {/* Grid: employees × dates */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ padding: '6px 8px', textAlign: 'left', position: 'sticky', left: 0, background: 'var(--bg-card)', zIndex: 1 }}>員工</th>
                {activeDates.map(d => {
                  const dow = new Date(d).getDay()
                  return (
                    <th key={d} style={{ padding: '4px 2px', textAlign: 'center', minWidth: 36, color: dow === 0 || dow === 6 ? 'var(--accent-red)' : 'var(--text-muted)' }}>
                      <div>{parseInt(d.slice(8))}</div>
                      <div style={{ fontSize: 10 }}>{dows[dow]}</div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {employees.map(emp => (
                <tr key={emp.name}>
                  <td style={{ padding: '4px 8px', fontWeight: 600, whiteSpace: 'nowrap', position: 'sticky', left: 0, background: 'var(--bg-card)', zIndex: 1 }}>
                    {emp.name}
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 4 }}>
                      {emp.employment_type === '兼職' || emp.employment_type === 'PT' ? 'PT' : ''}
                    </span>
                  </td>
                  {activeDates.map(date => {
                    const key = `${emp.name}_${date}`
                    const isSelected = selected[key]
                    const existingShift = schedules.find(s => s.employee === emp.name && s.date === date)?.shift
                    const isAlreadyCompOff = existingShift === '補休'

                    return (
                      <td key={date} style={{ padding: 1, textAlign: 'center' }}>
                        <button
                          onClick={() => !isAlreadyCompOff && toggle(emp.name, date)}
                          style={{
                            width: 34, height: 28, borderRadius: 6, fontSize: 10, fontWeight: 600,
                            border: isSelected ? '2px solid #3b82f6' : '1px solid var(--border-subtle)',
                            background: isAlreadyCompOff ? 'rgba(59,130,246,0.15)' : isSelected ? 'rgba(59,130,246,0.2)' : 'transparent',
                            color: isAlreadyCompOff ? '#3b82f6' : isSelected ? '#3b82f6' : 'var(--text-muted)',
                            cursor: isAlreadyCompOff ? 'default' : 'pointer',
                            opacity: isAlreadyCompOff ? 0.6 : 1,
                          }}
                        >
                          {isAlreadyCompOff ? '補' : isSelected ? '補' : existingShift ? existingShift.slice(0, 3) : '—'}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn btn-secondary" onClick={onClose} style={{ padding: '8px 20px' }}>取消</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={selectedCount === 0 || saving}
            style={{ padding: '8px 20px', background: '#3b82f6' }}>
            {saving ? '儲存中...' : `確認指派 ${selectedCount} 筆補休`}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}
