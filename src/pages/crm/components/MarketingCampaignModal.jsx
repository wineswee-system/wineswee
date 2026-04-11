import React from 'react'
import { FlaskConical } from 'lucide-react'
import { MESSAGE_TEMPLATES } from '../../../lib/messaging'
import { isUnsubscribed, filterUnsubscribed } from '../../../lib/crmEngine'
import Modal, { Field } from '../../../components/Modal'

const CAMPAIGN_TYPES = ['Email', 'LINE 訊息', 'SMS 簡訊']
const TYPE_MAP = { 'Email': 'email', 'LINE 訊息': 'line', 'SMS 簡訊': 'sms' }

export default function MarketingCampaignModal({
  form, set, locations, allSegments, selectedTemplate,
  handleTemplateChange, handleTypeChange, handleSubmit, onClose,
  segmentPreviewCount, getSegmentRecipients, unsubscribeList,
}) {
  return (
    <Modal title="新增行銷活動" onClose={onClose} onSubmit={handleSubmit}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="活動名稱 *"><input className="form-input" type="text" style={{ width: '100%' }} placeholder="夏季促銷活動..." value={form.name} onChange={e => set('name', e.target.value)} /></Field>
        <Field label="所屬分店">
          <select className="form-input" style={{ width: '100%' }} value={form.location_id} onChange={e => set('location_id', e.target.value)}>
            <option value="">全部分店</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="發送類型">
          <select className="form-input" style={{ width: '100%' }} value={form.type} onChange={e => handleTypeChange(e.target.value)}>
            {CAMPAIGN_TYPES.map(t => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="目標受眾">
          <select className="form-input" style={{ width: '100%' }} value={form.segment} onChange={e => set('segment', e.target.value)}>
            {allSegments.map(s => <option key={s.key} value={s.key}>{s.label}{s.isPreset ? '' : ' (自訂)'}</option>)}
          </select>
        </Field>
      </div>

      {/* Audience Preview */}
      <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--glass-light)', border: '1px solid var(--border-subtle)', marginBottom: 4 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
          預計發送對象：<strong style={{ color: 'var(--accent-cyan)' }}>{segmentPreviewCount} 人</strong>
          {(() => {
            const channelType = TYPE_MAP[form.type] || 'email'
            const recipients = getSegmentRecipients(form.segment)
            const afterFilter = filterUnsubscribed(recipients, unsubscribeList, channelType)
            const unsubCount = recipients.length - afterFilter.length
            if (unsubCount > 0) return <span style={{ color: 'var(--accent-orange)', marginLeft: 8 }}>(排除 {unsubCount} 位退訂)</span>
            return null
          })()}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {getSegmentRecipients(form.segment).slice(0, 10).map((r, i) => {
            const channelType = TYPE_MAP[form.type] || 'email'
            const unsub = isUnsubscribed(unsubscribeList, r.id, channelType)
            return (
              <span key={i} style={{
                fontSize: 11, padding: '2px 8px', borderRadius: 10,
                background: unsub ? 'var(--accent-red-dim)' : 'var(--bg-card)',
                border: `1px solid ${unsub ? 'var(--accent-red)' : 'var(--border-subtle)'}`,
                color: unsub ? 'var(--accent-red)' : 'var(--text-primary)',
                textDecoration: unsub ? 'line-through' : 'none',
              }}>
                {r.name}{unsub ? ' (退訂)' : ''}
              </span>
            )
          })}
          {getSegmentRecipients(form.segment).length > 10 && (
            <span style={{ fontSize: 11, padding: '2px 8px', color: 'var(--text-muted)' }}>...還有更多</span>
          )}
        </div>
      </div>

      {/* Template Selection */}
      <Field label="訊息範本">
        <select className="form-input" style={{ width: '100%' }} value={selectedTemplate} onChange={e => handleTemplateChange(e.target.value)}>
          <option value="">自訂內容</option>
          {Object.entries(MESSAGE_TEMPLATES).map(([key, tmpl]) => (
            <option key={key} value={key}>{tmpl.name}</option>
          ))}
        </select>
      </Field>

      {form.type === 'Email' && (
        <Field label="Email 主旨">
          <input className="form-input" type="text" style={{ width: '100%' }} placeholder="輸入 Email 主旨..." value={form.subject} onChange={e => set('subject', e.target.value)} />
        </Field>
      )}

      <Field label="訊息內容 *">
        <textarea
          className="form-input"
          style={{ width: '100%', minHeight: 100, fontFamily: 'monospace', fontSize: 13 }}
          placeholder={form.type === 'SMS 簡訊' ? '簡訊內容（建議 70 字以內）...' : '親愛的客戶，我們特別為您提供...'}
          value={form.message}
          onChange={e => set('message', e.target.value)}
        />
      </Field>
      {form.type === 'SMS 簡訊' && (
        <div style={{ fontSize: 11, color: form.message.length > 70 ? 'var(--accent-orange)' : 'var(--text-muted)', textAlign: 'right', marginTop: -8 }}>
          {form.message.length} / 70 字 ({Math.ceil(form.message.length / 70) || 1} 則簡訊)
        </div>
      )}

      {/* A/B Test Toggle */}
      <div style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--glass-light)', border: '1px solid var(--border-subtle)', marginBottom: 4 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
          <input type="checkbox" checked={form.abTest} onChange={e => set('abTest', e.target.checked)} />
          <FlaskConical size={14} /> 啟用 A/B 測試
        </label>
        {form.abTest && (
          <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 8, background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
              受眾將平均分為 A/B 兩組，分別發送不同內容，比較開啟率決定贏家
            </div>
            {form.type === 'Email' && (
              <Field label="B 版主旨">
                <input className="form-input" type="text" style={{ width: '100%' }} placeholder="B 版 Email 主旨..." value={form.subjectB} onChange={e => set('subjectB', e.target.value)} />
              </Field>
            )}
            <Field label="B 版訊息內容">
              <textarea
                className="form-input"
                style={{ width: '100%', minHeight: 80, fontFamily: 'monospace', fontSize: 13 }}
                placeholder="B 版訊息內容..."
                value={form.messageB}
                onChange={e => set('messageB', e.target.value)}
              />
            </Field>
          </div>
        )}
      </div>

      <Field label="排程時間（留空為儲存草稿）">
        <input className="form-input" type="datetime-local" style={{ width: '100%' }} value={form.scheduled_at} onChange={e => set('scheduled_at', e.target.value)} />
      </Field>
    </Modal>
  )
}
