import React from 'react'
import { isUnsubscribed } from '../../../lib/crmEngine'
import Modal, { Field } from '../../../components/Modal'

export default function MarketingUnsubscribeModal({
  allCustomers, unsubscribeList, unsubForm, setUnsubForm, handleAddUnsub, onClose,
}) {
  return (
    <Modal title="新增退訂" onClose={onClose} onSubmit={handleAddUnsub}>
      <Field label="客戶 *">
        <select className="form-input" style={{ width: '100%' }} value={unsubForm.customer_id} onChange={e => setUnsubForm(prev => ({ ...prev, customer_id: e.target.value }))}>
          <option value="">-- 選擇客戶 --</option>
          {allCustomers.filter(c => !isUnsubscribed(unsubscribeList, c.id, 'all')).map(c => (
            <option key={c.id} value={c.id}>{c.name} ({c.email})</option>
          ))}
        </select>
      </Field>
      <Field label="退訂管道">
        <select className="form-input" style={{ width: '100%' }} value={unsubForm.channel} onChange={e => setUnsubForm(prev => ({ ...prev, channel: e.target.value }))}>
          <option value="email">Email</option>
          <option value="sms">SMS</option>
          <option value="line">LINE</option>
          <option value="all">全部管道</option>
        </select>
      </Field>
      <Field label="退訂原因">
        <input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：不想再收到行銷訊息" value={unsubForm.reason} onChange={e => setUnsubForm(prev => ({ ...prev, reason: e.target.value }))} />
      </Field>
    </Modal>
  )
}
