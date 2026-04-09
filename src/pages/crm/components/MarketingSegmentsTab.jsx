import React from 'react'
import { Target, Filter, Trash2 } from 'lucide-react'
import {
  evaluateSegment, PRESET_SEGMENTS, SEGMENT_OPERATORS, CUSTOMER_FIELDS,
} from '../../../lib/crmEngine'

export default function MarketingSegmentsTab({
  allCustomers, customSegments, deleteSegment,
}) {
  return (
    <>
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">預設分群</div><div className="stat-card-value">{Object.keys(PRESET_SEGMENTS).length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">自訂分群</div><div className="stat-card-value">{customSegments.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">客戶總數</div><div className="stat-card-value">{allCustomers.length}</div>
        </div>
      </div>

      {/* Preset Segments */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon"><Target size={16} /></span> 預設分群</div>
        </div>
        <div style={{ padding: '0 16px 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
          {Object.entries(PRESET_SEGMENTS).map(([key, seg]) => {
            const count = evaluateSegment(allCustomers, seg).length
            return (
              <div key={key} style={{ padding: '12px 16px', borderRadius: 10, background: 'var(--glass-light)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{seg.label}</div>
                  <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent-cyan)' }}>{count}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  {seg.conditions.length === 0 ? '所有客戶' : seg.conditions.map(c => {
                    const fieldLabel = CUSTOMER_FIELDS.find(f => f.value === c.field)?.label || c.field
                    const opLabel = SEGMENT_OPERATORS.find(o => o.value === c.operator)?.label || c.operator
                    return `${fieldLabel} ${opLabel} ${c.value}`
                  }).join(` ${seg.logic === 'and' ? '且' : '或'} `)}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Custom Segments */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon"><Filter size={16} /></span> 自訂分群</div>
        </div>
        {customSegments.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            尚無自訂分群，點擊「建立自訂分群」開始建立
          </div>
        ) : (
          <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {customSegments.map(seg => {
              const count = evaluateSegment(allCustomers, { logic: seg.logic, conditions: seg.conditions }).length
              return (
                <div key={seg.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderRadius: 10, background: 'var(--glass-light)', border: '1px solid var(--border-subtle)' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{seg.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                      邏輯：{seg.logic === 'and' ? '全部符合 (AND)' : '任一符合 (OR)'} | 條件：{seg.conditions.length} 個
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                      {seg.conditions.map(c => {
                        const fl = CUSTOMER_FIELDS.find(f => f.value === c.field)?.label || c.field
                        const ol = SEGMENT_OPERATORS.find(o => o.value === c.operator)?.label || c.operator
                        return `${fl} ${ol} ${c.value}`
                      }).join(` ${seg.logic === 'and' ? '且' : '或'} `)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--accent-purple)' }}>{count} 人</span>
                    <button className="btn" style={{ fontSize: 11, padding: '4px 8px', background: 'var(--accent-red-dim)', color: 'var(--accent-red)', border: '1px solid var(--accent-red)' }} onClick={() => deleteSegment(seg.key)}>
                      <Trash2 size={11} /> 刪除
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
