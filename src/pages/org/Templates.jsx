import { useState } from 'react'
import { Plus, Copy } from 'lucide-react'
import Modal, { Field } from '../../components/Modal'

const CATEGORIES = ['人資', '出勤', '流程', '薪資', '差旅', '其他']
const CHANNELS = ['LINE Notify', 'Messaging API', 'Email']

const initialTemplates = [
  { id: 1, name: '請假申請通知', category: '人資', channel: 'LINE Notify', content: '【請假通知】{{員工姓名}} 申請 {{假別}}，日期：{{日期}}，請主管審核。', status: '啟用' },
  { id: 2, name: '核准通知', category: '人資', channel: 'LINE Notify', content: '【核准通知】您的 {{申請類型}} 申請已獲 {{核准人}} 核准。', status: '啟用' },
  { id: 3, name: '遲到提醒', category: '出勤', channel: 'LINE Notify', content: '【出勤提醒】{{員工姓名}}，您今日 {{時間}} 打卡，已記錄為遲到。', status: '啟用' },
  { id: 4, name: '任務逾期通知', category: '流程', channel: 'LINE Notify', content: '【任務提醒】任務「{{任務名稱}}」已逾期，截止日期：{{截止日期}}。', status: '啟用' },
  { id: 5, name: '薪資單通知', category: '薪資', channel: 'LINE Notify', content: '【薪資通知】{{月份}} 薪資單已核發，實領 NT$ {{金額}}，請查收。', status: '啟用' },
  { id: 6, name: '差旅申請確認', category: '差旅', channel: 'LINE Notify', content: '【差旅申請】{{員工姓名}} 申請前往 {{目的地}} 出差，預算 NT$ {{金額}}。', status: '草稿' },
]

export default function Templates() {
  const [templates, setTemplates] = useState(initialTemplates)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ name: '', category: CATEGORIES[0], channel: CHANNELS[0], content: '' })

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = () => {
    if (!form.name || !form.content) return
    setTemplates(prev => [...prev, { id: Date.now(), ...form, status: '草稿' }])
    setShowModal(false)
    setForm({ name: '', category: CATEGORIES[0], channel: CHANNELS[0], content: '' })
  }

  const handleCopy = (t) => {
    setTemplates(prev => [...prev, { ...t, id: Date.now(), name: t.name + ' (複製)', status: '草稿' }])
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📝</span> 模板</h2>
            <p>通知訊息模板管理</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增模板</button>
        </div>
      </div>

      <div className="card">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>模板名稱</th><th>分類</th><th>發送管道</th><th>內容預覽</th><th>狀態</th><th>操作</th></tr>
            </thead>
            <tbody>
              {templates.map(t => (
                <tr key={t.id}>
                  <td style={{ fontWeight: 600 }}>{t.name}</td>
                  <td><span className="badge badge-cyan">{t.category}</span></td>
                  <td><span className="badge badge-info">{t.channel}</span></td>
                  <td style={{ fontSize: 11, color: 'var(--text-secondary)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.content}
                  </td>
                  <td>
                    <span className={`badge ${t.status === '啟用' ? 'badge-success' : 'badge-warning'}`}>
                      <span className="badge-dot"></span>{t.status}
                    </span>
                  </td>
                  <td><button className="btn btn-sm btn-secondary" onClick={() => handleCopy(t)}><Copy size={12} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <Modal title="新增模板" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <Field label="模板名稱" required>
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="例：加班申請通知" value={form.name} onChange={e => set('name', e.target.value)} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="分類">
              <select className="form-input" style={{ width: '100%' }} value={form.category} onChange={e => set('category', e.target.value)}>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="發送管道">
              <select className="form-input" style={{ width: '100%' }} value={form.channel} onChange={e => set('channel', e.target.value)}>
                {CHANNELS.map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
          </div>
          <Field label="訊息內容" required>
            <textarea className="form-input" style={{ width: '100%', height: 100, resize: 'vertical' }} placeholder="使用 {{變數名稱}} 作為動態欄位" value={form.content} onChange={e => set('content', e.target.value)} />
          </Field>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--glass-light)', padding: '8px 10px', borderRadius: 6 }}>
            常用變數：{'{{員工姓名}}'} {'{{日期}}'} {'{{部門}}'} {'{{金額}}'} {'{{狀態}}'}
          </div>
        </Modal>
      )}
    </div>
  )
}
