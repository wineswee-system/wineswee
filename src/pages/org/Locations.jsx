import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { getStores, createStore, updateStore, deleteStore, getEmployees, getCompanies } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import { empLabel } from '../../lib/empLabel'

import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
const EMPTY_FORM = { name: '', company: '', company_id: '', address: '', phone: '', manager: '', manager_id: '', status: '營運中', store_code: '', store_type: 'retail', city: '', lat: '', lng: '', clock_radius: 150, allowed_wifi: '', late_tolerance_minutes: 5, early_clock_minutes: 30, clock_in_method: 'any' }

export default function Locations() {
  const [stores, setStores] = useState([])
  const [employees, setEmployees] = useState([])
  const [companies, setCompanies] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [editingStore, setEditingStore] = useState(null) // null = new, object = editing
  const [form, setForm] = useState(EMPTY_FORM)

  useEffect(() => {
    Promise.all([getStores(), getEmployees(), getCompanies()]).then(([s, e, c]) => {
      setStores(s.data || [])
      setEmployees(e.data || [])
      setCompanies(c.data || [])
    }).catch(err => {
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
      company_id: s.company_id || '',
      address: s.address || '',
      phone: s.phone || '',
      manager_id: s.manager_id || '',
      status: s.status || '營運中',
      store_code: s.store_code || '',
      store_type: s.store_type || 'retail',
      city: s.city || '',
      lat: s.lat ?? '',
      lng: s.lng ?? '',
      clock_radius: s.clock_radius ?? 150,
      allowed_wifi: Array.isArray(s.allowed_wifi) ? s.allowed_wifi.join(', ') : '',
      late_tolerance_minutes: s.late_tolerance_minutes ?? 5,
      early_clock_minutes: s.early_clock_minutes ?? 30,
      clock_in_method: s.clock_in_method || 'any',
    })
    setShowModal(true)
  }

  const handleDelete = async (s) => {
    if (!(await confirm({ message: `確定要刪除「${s.name}」嗎？此操作無法復原。` }))) return
    try {
      await deleteStore(s.id)
      setStores(prev => prev.filter(x => x.id !== s.id))
    } catch (err) {
      toast.error('刪除失敗：' + (err.message || '未知錯誤'))
    }
  }

  const handleSubmit = async () => {
    if (!form.name) return
    const payload = {
      name: form.name,
      company_id: form.company_id ? parseInt(form.company_id) : null,
      manager_id: form.manager_id ? parseInt(form.manager_id) : null,
      address: form.address,
      phone: form.phone,
      status: form.status,
      store_code: form.store_code || null,
      store_type: form.store_type || 'retail',
      city: form.city || null,
      lat: form.lat !== '' ? parseFloat(form.lat) : null,
      lng: form.lng !== '' ? parseFloat(form.lng) : null,
      clock_radius: parseInt(form.clock_radius) || 150,
      allowed_wifi: form.allowed_wifi ? form.allowed_wifi.split(',').map(s => s.trim()).filter(Boolean) : null,
      late_tolerance_minutes: parseInt(form.late_tolerance_minutes) || 5,
      early_clock_minutes: parseInt(form.early_clock_minutes) || 30,
      clock_in_method: form.clock_in_method || 'any',
    }
    try {
      if (editingStore) {
        const { data, error } = await updateStore(editingStore.id, payload)
        if (error) throw error
        if (data) setStores(prev => prev.map(s => s.id === data.id ? data : s))
      } else {
        const { data, error } = await createStore(payload)
        if (error) throw error
        if (data) setStores(prev => [...prev, data])
      }
      setShowModal(false)
      setForm(EMPTY_FORM)
      setEditingStore(null)
    } catch (err) {
      console.error('Operation failed:', err)
      toast.error('操作失敗：' + (err.message || '未知錯誤'))
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
          <div className="stat-card-value">{employees.filter(e => e.status === '在職').length}</div>
        </div>
      </div>

      <div className="card">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>代碼</th><th>門市名稱</th><th>類型</th><th>所屬公司</th><th>地址</th><th>電話</th><th>負責人</th><th>員工數</th><th>打卡範圍</th><th>狀態</th><th>操作</th></tr>
            </thead>
            <tbody>
              {stores.map(s => (
                <tr key={s.id}>
                  <td><span style={{ fontFamily: 'monospace', fontSize: 11, padding: '2px 6px', borderRadius: 4, background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)', fontWeight: 600 }}>{s.store_code || '-'}</span></td>
                  <td style={{ fontWeight: 600 }}>{s.name}</td>
                  <td><span className={`badge ${s.store_type === 'headquarters' ? 'badge-purple' : 'badge-cyan'}`}>{s.store_type === 'headquarters' ? '總部' : '門市'}</span></td>
                  <td>{companies.find(c => c.id === s.company_id)?.name || s.company || '-'}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{s.address}</td>
                  <td>{s.phone}</td>
                  <td>{employees.find(e => e.id === s.manager_id)?.name || s.manager || '-'}</td>
                  <td>{employees.filter(e => (e.store_id === s.id || e.store === s.name) && e.status === '在職').length}</td>
                  <td style={{ fontSize: 12 }}>
                    {s.lat != null && s.lng != null ? (
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="門市名稱 *">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="台北忠孝店" value={form.name} onChange={e => set('name', e.target.value)} />
            </Field>
            <Field label="門市代碼">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="S-001" value={form.store_code} onChange={e => set('store_code', e.target.value)} />
            </Field>
            <Field label="類型">
              <select className="form-input" style={{ width: '100%' }} value={form.store_type} onChange={e => set('store_type', e.target.value)}>
                <option value="retail">門市</option>
                <option value="headquarters">總部</option>
              </select>
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="所屬公司">
              <select className="form-input" style={{ width: '100%' }} value={form.company_id} onChange={e => set('company_id', e.target.value)}>
                <option value="">請選擇</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="城市">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="台北市" value={form.city} onChange={e => set('city', e.target.value)} />
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
              <select className="form-input" style={{ width: '100%' }} value={form.manager_id} onChange={e => set('manager_id', e.target.value)}>
                <option value="">請選擇</option>
                {employees.filter(emp => emp.status === '在職').map(emp => <option key={emp.id} value={emp.id}>{empLabel(emp)}{emp.position ? ` - ${emp.position}` : ''}</option>)}
              </select>
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
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10 }}>⏰ 打卡設定</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
              <Field label="打卡驗證方式">
                <select className="form-input" style={{ width: '100%' }} value={form.clock_in_method} onChange={e => set('clock_in_method', e.target.value)}>
                  <option value="any">任一通過（GPS 或 WiFi）</option>
                  <option value="gps_required">僅限 GPS</option>
                  <option value="gps_or_wifi">GPS 或 WiFi 擇一</option>
                </select>
              </Field>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                💡 變形工時類型 / 起算日請至「<strong>排班 → 門市設定 → 變形工時制度</strong>」設定
              </div>
            </div>
          </div>
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
          <div style={{ borderTop: '1px solid var(--border-subtle)', margin: '8px 0', paddingTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10 }}>⏱️ 遲到判定設定</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="遲到容許（分鐘）">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input className="form-input" type="number" min={0} max={60} style={{ width: 80, textAlign: 'center' }}
                    value={form.late_tolerance_minutes} onChange={e => set('late_tolerance_minutes', e.target.value)} />
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>分鐘內不算遲到</span>
                </div>
              </Field>
              <Field label="提前打卡容許（分鐘）">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input className="form-input" type="number" min={0} max={120} style={{ width: 80, textAlign: 'center' }}
                    value={form.early_clock_minutes} onChange={e => set('early_clock_minutes', e.target.value)} />
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>分鐘前可打卡</span>
                </div>
              </Field>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
