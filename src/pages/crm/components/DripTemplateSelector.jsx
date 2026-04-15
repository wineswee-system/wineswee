import { X } from 'lucide-react'
import { DRIP_TEMPLATES, TRIGGER_TYPES } from '../../../lib/dripCampaign'

export default function DripTemplateSelector({ onApplyTemplate, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--bg-modal-overlay)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-medium)', borderRadius: 16, width: '100%', maxWidth: 780, maxHeight: '80vh', overflow: 'auto', boxShadow: 'var(--shadow-xl)', animation: 'fadeIn 0.15s ease', padding: 24 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700 }}>選擇範本</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}><X size={18} /></button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
          {DRIP_TEMPLATES.map(tmpl => {
            const triggerInfo = TRIGGER_TYPES.find(t => t.id === tmpl.trigger)
            return (
              <div key={tmpl.id} style={{ border: '1px solid var(--border-medium)', borderRadius: 12, padding: 16, background: 'var(--bg-primary)', transition: 'all 0.15s', cursor: 'pointer' }}
                onClick={() => onApplyTemplate(tmpl)}>
                <div style={{ fontSize: 24, marginBottom: 8 }}>{triggerInfo?.icon || '📧'}</div>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{tmpl.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8, lineHeight: 1.5 }}>{tmpl.description}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span className="badge badge-info" style={{ fontSize: 10 }}>{triggerInfo?.name}</span>
                  <span className="badge badge-success" style={{ fontSize: 10 }}>{tmpl.steps.length} 步驟</span>
                </div>
                <button className="btn btn-primary" style={{ width: '100%', marginTop: 10, fontSize: 12 }}>使用此範本</button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
