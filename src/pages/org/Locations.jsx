import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { getStores, createStore, updateStore, deleteStore } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

const EMPTY_FORM = { name: '', company: '', address: '', phone: '', manager: '', status: '營運中', lat: '', lng: '', clock_radius: 150, allowed_wifi: '' }

export default function Locations() {
  const [stores, setStores] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [editingStore, setEditingStore] = useState(null) // null = new, object = editing
  const [form, setForm] = useState(EMPTY_FORM)

  useEffect(() => {
    getStores().then(({ data }) => { setStores(data || []) }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => { setLoading(false) })
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const openCreate = () => {
    setEditingStore(null)
    setForm(EMPTY_FORM)
    setShowModal(true)
  }

  const openEdit = (s) => {
    setEditingStore(s)
    setForm({
      name: s.name || '',
      company: s.company || '',
      address: s.address || '',
      phone: s.phone || '',
      manager: s.manager || '',
      status: s.status || '營運中',
      lat: s.lat || '',
      lng: s.lng || '',
      clock_radius: s.clock_radius || 150,
      allowed_wifi: s.allowed_wifi ? s.allowed_wifi.join(', ') : '',
    })
    setShowModal(true)
  }

  const handleDelete = async (s) => {
    if (!confirm(`確定要刪除「${s.name}」嗎？此操作無法復原。`)) return
    try {
      await deleteStore(s.id)
      setStores(prev => prev.filter(x => x.id !== s.id))
    } catch (err) {
      alert('刪除失敗：' + (err.message || '未知錯誤'))
    }
  }

  const handleSubmit = async () => {
    if (!form.name) return
    const payload = {
      name: form.name,
      company: form.company,
      address: form.address,
      phone: form.phone,
      manager: form.manager,
      status: form.status,
      lat: form.lat ? parseFloat(form.lat) : null,
      lng: form.lng ? parseFloat(form.lng) : null,
      clock_radius: parseInt(form.clock_radius) || 150,
      allowed_wifi: form.allowed_wifi ? form.allowed_wifi.split(',').map(s => s.trim()).filter(Boolean) : null,
    }
    try {
      if (editingStore) {
        const { data, error } = await updateStore(editingStore.id, payload)
        if (error) throw error
        if (data) setStores(prev => prev.map(s => s.id === data.id ? data : s))
      } else {
        payload.employee_count = 0
        const { data, error } = await createStore(payload)
        if (error) throw error
        if (data) setStores(prev => [...prev, data])
      }
      setShowModal(false)
      setForm(EMPTY_FORM)
      setEditingStore(null)
    } catch (err) {
      console.error('Operation failed:', err)
      alert('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>⚠ {error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📍</span> 門市</h2>
            <p>門市地點管理</p>
          </div>
          <button className="btn btn-primary" onClick={openCreate}><Plus size={14} /> 新增門市</button>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">營運中</div>
          <div className="stat-card-value">{stores.filter(s => s.status === '營運中').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">籌備中</div>
          <div className="stat-card-value">{stores.filter(s => s.status === '籌備中').length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">總員工數</div>
          <div className="stat-card-value">{stores.reduce((s, store) => s + (store.employee_count || 0), 0)}</div>
        </div>
      </div>

      <div className="card">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>門市名稱</th><th>所屬公司</th><th>地址</th><th>電話</th><th>負責人</th><th>員工數</th><th>打卡範圍</th><th>狀態</th><th>操作</th></tr>
            </thead>
            <tbody>
              {stores.map(s => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>{s.name}</td>
                  <td>{s.company}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{s.address}</td>
                  <td>{s.phone}</td>
                  <td>{s.manager}</td>
                  <td>{s.employee_count ?? 0}</td>
                  <td style={{ fontSize: 12 }}>
                    {s.lat && s.lng ? (
                      <span className="badge badge-success"><span className="badge-dot"></span>{s.clock_radius || 150}m</span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>未設定</span>
                    )}
                    {s.allowed_wifi?.length > 0 && (
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>WiFi: {s.allowed_wifi.length} 組</div>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${s.status === '營運中' ? 'badge-success' : s.status === '已停業' ? 'badge-danger' : 'badge-warning'}`}>
                      <span className="badge-dot"></span>{s.status}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-sm btn-secondary" onClick={() => openEdit(s)}><Pencil size={12} /></button>
                      <button className="btn btn-sm btn-secondary" onClick={() => handleDelete(s)} style={{ color: 'var(--accent-red)' }}><Trash2 size={12} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <Modal title={editingStore ? `編輯門市 — ${editingStore.name}` : '新增門市'} onClose={() => { setShowModal(false); setEditingStore(null) }} onSubmit={handleSubmit} submitLabel={editingStore ? '儲存變更' : '新增'}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="門市名稱 *">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="台北忠孝店" value={form.name} onChange={e => set('name', e.target.value)} />
            </Field>
            <Field label="所屬公司">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="公司名稱" value={form.company} onChange={e => set('company', e.target.value)} />
            </Field>
          </div>
          <Field label="地址">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="台北市大安區忠孝東路四段 1 號" value={form.address} onChange={e => set('address', e.target.value)} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="電話">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="02-1234-5678" value={form.phone} onChange={e => set('phone', e.target.value)} />
            </Field>
            <Field label="負責人">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="店長姓名" value={form.manager} onChange={e => set('manager', e.target.value)} />
            </Field>
          </div>
          <Field label="狀態">
            <select className="form-input" style={{ width: '100%' }} value={form.status} onChange={e => set('status', e.target.value)}>
              <option>營運中</option>
              <option>籌備中</option>
              <option>已停業</option>
            </select>
          </Field>
          <div style={{ borderTop: '1px solid var(--border-subtle)', margin: '8px 0', paddingTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10 }}>📍 GPS 打卡範圍設定</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <Field label="緯度 (Lat)">
                <input className="form-input" type="number" step="any" style={{ width: '100%' }} placeholder="25.0330" value={form.lat} onChange={e => set('lat', e.target.value)} />
              </Field>
              <Field label="經度 (Lng)">
                <input className="form-input" type="number" step="any" style={{ width: '100%' }} placeholder="121.5654" value={form.lng} onChange={e => set('lng', e.target.value)} />
              </Field>
              <Field label="範圍 (公尺)">
                <input className="form-input" type="number" style={{ width: '100%' }} placeholder="150" value={form.clock_radius} onChange={e => set('clock_radius', e.target.value)} />
              </Field>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              提示：可從 Google Maps 右鍵取得座標。員工需在設定範圍內才能打卡。
            </div>
          </div>
          <div style={{ borderTop: '1px solid var(--border-subtle)', margin: '8px 0', paddingTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10 }}>📶 WiFi IP 白名單</div>
            <Field label="允許的 IP 位址（逗號分隔）">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="203.69.180.0/24, 61.220.45.0/24" value={form.allowed_wifi} onChange={e => set('allowed_wifi', e.target.value)} />
            </Field>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              填入門市 WiFi 的公共 IP 或網段。員工連上門市 WiFi 時，IP 符合即可打卡（與 GPS 擇一通過即可）。
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
