import { useState } from 'react'
import { Clock, Mail, Plus, Trash2, Edit, Play, Pause, Calendar } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal from '../../components/Modal'

import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
const REPORT_TYPES = ['營運摘要', '財務報表', '銷售績效', '庫存報告', 'HR 月報', 'POS 日報']
const FREQUENCIES = [
  { value: '每日', label: '每日' },
  { value: '每週一', label: '每週一' },
  { value: '每月1日', label: '每月1日' },
]
const SECTIONS = ['KPI摘要', '趨勢圖表', '明細資料']

const defaultSchedules = [
  { id: 1, name: '每日營運摘要', type: '營運摘要', recipients: 'boss@example.com, mgr@example.com', frequency: '每日', nextSend: '2026-04-06', status: '啟用', lastSent: '2026-04-05 08:00', sections: ['KPI摘要', '趨勢圖表'], format: 'PDF', enabled: true },
  { id: 2, name: '週銷售績效報告', type: '銷售績效', recipients: 'sales@example.com', frequency: '每週一', nextSend: '2026-04-06', status: '啟用', lastSent: '2026-03-30 09:00', sections: ['KPI摘要', '明細資料'], format: 'CSV', enabled: true },
  { id: 3, name: '月財務報表', type: '財務報表', recipients: 'cfo@example.com, accounting@example.com', frequency: '每月1日', nextSend: '2026-05-01', status: '啟用', lastSent: '2026-04-01 07:00', sections: ['KPI摘要', '趨勢圖表', '明細資料'], format: 'PDF', enabled: true },
  { id: 4, name: '庫存週報（已暫停）', type: '庫存報告', recipients: 'warehouse@example.com', frequency: '每週一', nextSend: '-', status: '暫停', lastSent: '2026-03-17 08:30', sections: ['明細資料'], format: 'CSV', enabled: false },
]

const emptyForm = { name: '', type: '營運摘要', frequency: '每日', recipients: '', sections: [], format: 'PDF', enabled: true }

export default function ScheduledReports() {
  const [schedules, setSchedules] = useState(defaultSchedules)
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({ ...emptyForm })

  const activeCount = schedules.filter(s => s.enabled).length
  const sentThisMonth = schedules.filter(s => s.enabled && s.lastSent?.startsWith('2026-04')).length
  const failedCount = 0

  const openCreate = () => {
    setEditingId(null)
    setForm({ ...emptyForm })
    setShowModal(true)
  }

  const openEdit = (schedule) => {
    setEditingId(schedule.id)
    setForm({ name: schedule.name, type: schedule.type, frequency: schedule.frequency, recipients: schedule.recipients, sections: [...schedule.sections], format: schedule.format, enabled: schedule.enabled })
    setShowModal(true)
  }

  const handleSave = () => {
    if (!form.name.trim() || !form.recipients.trim()) return toast.error('請填寫名稱與收件者')
    if (editingId) {
      setSchedules(prev => prev.map(s => s.id === editingId ? { ...s, ...form, status: form.enabled ? '啟用' : '暫停', nextSend: form.enabled ? computeNext(form.frequency) : '-' } : s))
    } else {
      const newId = Math.max(...schedules.map(s => s.id), 0) + 1
      setSchedules(prev => [...prev, { id: newId, ...form, status: form.enabled ? '啟用' : '暫停', nextSend: form.enabled ? computeNext(form.frequency) : '-', lastSent: '-' }])
    }
    setShowModal(false)
  }

  const computeNext = (freq) => {
    const d = new Date()
    if (freq === '每日') { d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10) }
    if (freq === '每週一') { d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); return d.toISOString().slice(0, 10) }
    d.setMonth(d.getMonth() + 1, 1); return d.toISOString().slice(0, 10)
  }

  const handleDelete = async (id) => {
    if (!(await confirm({ message: '確定刪除此排程？' }))) return
    setSchedules(prev => prev.filter(s => s.id !== id))
  }

  const toggleStatus = (id) => {
    setSchedules(prev => prev.map(s => {
      if (s.id !== id) return s
      const enabled = !s.enabled
      return { ...s, enabled, status: enabled ? '啟用' : '暫停', nextSend: enabled ? computeNext(s.frequency) : '-' }
    }))
  }

  const handleSendNow = (schedule) => {
    toast.error(`已模擬寄送「${schedule.name}」至 ${schedule.recipients}`)
    setSchedules(prev => prev.map(s => s.id === schedule.id ? { ...s, lastSent: new Date().toISOString().slice(0, 16).replace('T', ' ') } : s))
  }

  const toggleSection = (section) => {
    setForm(prev => ({ ...prev, sections: prev.sections.includes(section) ? prev.sections.filter(s => s !== section) : [...prev.sections, section] }))
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <h1>📬 排程報表</h1>
        <button className="btn btn-primary" onClick={openCreate}><Plus size={16} /> 新增排程</button>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card"><div className="stat-label">排程總數</div><div className="stat-value">{schedules.length}</div></div>
        <div className="stat-card"><div className="stat-label">啟用中</div><div className="stat-value" style={{ color: 'var(--accent-green, #34d399)' }}>{activeCount}</div></div>
        <div className="stat-card"><div className="stat-label">本月已發送</div><div className="stat-value">{sentThisMonth}</div></div>
        <div className="stat-card"><div className="stat-label">失敗次數</div><div className="stat-value" style={{ color: failedCount > 0 ? 'var(--accent-red, #f87171)' : undefined }}>{failedCount}</div></div>
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-header"><h3 className="card-title"><Clock size={18} /> 排程列表</h3></div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>名稱</th>
                <th>報表類型</th>
                <th>收件者</th>
                <th>頻率</th>
                <th>下次寄送</th>
                <th>狀態</th>
                <th>上次寄送</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {schedules.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 32, opacity: 0.6 }}>尚無排程，請新增</td></tr>
              )}
              {schedules.map(s => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>{s.name}</td>
                  <td>{s.type}</td>
                  <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.recipients}>{s.recipients}</td>
                  <td><Calendar size={14} style={{ marginRight: 4, verticalAlign: -2 }} />{s.frequency}</td>
                  <td>{s.nextSend}</td>
                  <td><span style={{ padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600, background: s.enabled ? 'rgba(52,211,153,0.15)' : 'rgba(251,191,36,0.15)', color: s.enabled ? '#34d399' : '#fbbf24' }}>{s.status}</span></td>
                  <td style={{ fontSize: 13, opacity: 0.8 }}>{s.lastSent}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn" title="編輯" onClick={() => openEdit(s)} style={{ padding: '4px 8px' }}><Edit size={14} /></button>
                      <button className="btn" title={s.enabled ? '暫停' : '啟用'} onClick={() => toggleStatus(s.id)} style={{ padding: '4px 8px' }}>{s.enabled ? <Pause size={14} /> : <Play size={14} />}</button>
                      <button className="btn" title="立即寄送" onClick={() => handleSendNow(s)} style={{ padding: '4px 8px' }}><Mail size={14} /></button>
                      <button className="btn" title="刪除" onClick={() => handleDelete(s.id)} style={{ padding: '4px 8px', color: 'var(--accent-red, #f87171)' }}><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <Modal title={editingId ? '編輯排程' : '新增排程'} onClose={() => setShowModal(false)} onSubmit={handleSave} submitLabel="儲存">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <label>報表名稱
              <input className="form-input" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="例：每日營運摘要" />
            </label>
            <label>報表類型
              <select className="form-input" value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}>
                {REPORT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label>寄送頻率
              <select className="form-input" value={form.frequency} onChange={e => setForm(p => ({ ...p, frequency: e.target.value }))}>
                {FREQUENCIES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </label>
            <label>收件者（以逗號分隔）
              <input className="form-input" value={form.recipients} onChange={e => setForm(p => ({ ...p, recipients: e.target.value }))} placeholder="email1@example.com, email2@example.com" />
            </label>
            <fieldset style={{ border: '1px solid rgba(148,163,184,0.15)', borderRadius: 8, padding: '10px 14px' }}>
              <legend style={{ fontSize: 13, opacity: 0.8 }}>包含內容</legend>
              <div style={{ display: 'flex', gap: 16 }}>
                {SECTIONS.map(sec => (
                  <label key={sec} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 14 }}>
                    <input type="checkbox" checked={form.sections.includes(sec)} onChange={() => toggleSection(sec)} /> {sec}
                  </label>
                ))}
              </div>
            </fieldset>
            <label>匯出格式
              <select className="form-input" value={form.format} onChange={e => setForm(p => ({ ...p, format: e.target.value }))}>
                <option value="PDF">PDF</option>
                <option value="CSV">CSV</option>
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.enabled} onChange={e => setForm(p => ({ ...p, enabled: e.target.checked }))} /> 啟用排程
            </label>
          </div>
        </Modal>
      )}
    </div>
  )
}
