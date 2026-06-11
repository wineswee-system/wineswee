import { useState, useEffect } from 'react'
import { Plus, Search, ChevronDown, ChevronRight } from 'lucide-react'
import { getQualityInspections, createQualityInspection } from '../../lib/db'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

const RESULT_OPTIONS = ['通過', '條件通過', '不通過']
const TYPE_OPTIONS = ['進料檢驗', '製程檢驗', '出貨檢驗', '巡檢']

export default function QualityInspection() {
  const [inspections, setInspections] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [form, setForm] = useState({
    type: '進料檢驗', reference: '', inspector: '', inspection_date: new Date().toISOString().slice(0, 10),
    result: '通過', notes: '',
    items: [{ name: '', qty: 0, passed: 0, failed: 0, reason: '' }]
  })

  useEffect(() => {
    getQualityInspections().then(({ data }) => { setInspections(data || []) }).catch(err => { console.error('Failed to load data:', err); setError('資料載入失敗，請重新整理頁面') }).finally(() => { setLoading(false) })
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const setItem = (idx, k, v) => {
    setForm(f => {
      const items = [...f.items]
      items[idx] = { ...items[idx], [k]: v }
      return { ...f, items }
    })
  }

  const addItem = () => setForm(f => ({
    ...f, items: [...f.items, { name: '', qty: 0, passed: 0, failed: 0, reason: '' }]
  }))

  const removeItem = (idx) => setForm(f => ({
    ...f, items: f.items.filter((_, i) => i !== idx)
  }))

  const handleSubmit = async () => {
    if (!form.reference || !form.inspector) return
    const totalQty = form.items.reduce((s, it) => s + (it.qty || 0), 0)
    const totalPassed = form.items.reduce((s, it) => s + (it.passed || 0), 0)
    const pass_rate = totalQty > 0 ? Math.round((totalPassed / totalQty) * 10000) / 100 : 0
    const { data } = await createQualityInspection({ ...form, pass_rate })
    if (data) {
      setInspections(prev => [...prev, data])
      setShowModal(false)
      setForm({
        type: '進料檢驗', reference: '', inspector: '', inspection_date: new Date().toISOString().slice(0, 10),
        result: '通過', notes: '',
        items: [{ name: '', qty: 0, passed: 0, failed: 0, reason: '' }]
      })
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const filtered = inspections.filter(q =>
    search === '' || q.reference?.includes(search) || q.inspector?.includes(search) || q.type?.includes(search)
  )

  const passed = filtered.filter(q => q.result === '通過').length
  const conditional = filtered.filter(q => q.result === '條件通過').length
  const failed = filtered.filter(q => q.result === '不通過').length
  const avgPassRate = filtered.length > 0
    ? (filtered.reduce((s, q) => s + (q.pass_rate || 0), 0) / filtered.length).toFixed(1)
    : '0.0'

  const resultBadge = (result) => {
    const cls = result === '通過' ? 'badge-success' : result === '條件通過' ? 'badge-warning' : 'badge-danger'
    return <span className={`badge ${cls}`}><span className="badge-dot"></span>{result}</span>
  }

  const rateColor = (rate) => {
    if (rate >= 95) return 'var(--accent-green)'
    if (rate >= 80) return 'var(--accent-orange)'
    return 'var(--accent-red)'
  }

  const toggleExpand = (id) => setExpandedId(prev => prev === id ? null : id)

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">✅</span> 品質管理</h2>
            <p>品質檢驗記錄與合格率追蹤</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增檢驗</button>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">通過</div>
          <div className="stat-card-value">{passed}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">條件通過</div>
          <div className="stat-card-value">{conditional}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">不通過</div>
          <div className="stat-card-value">{failed}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">平均合格率</div>
          <div className="stat-card-value">{avgPassRate}%</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📋</span> 檢驗記錄</div>
          <div className="search-bar">
            <Search className="search-icon" />
            <input type="text" placeholder="搜尋參考單號、檢驗員..." className="form-input" style={{ paddingLeft: 38 }} value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th style={{ width: 32 }}></th><th>類型</th><th>參考單號</th><th>檢驗員</th><th>檢驗日期</th><th>合格率</th><th>結果</th><th>備註</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無檢驗記錄</td></tr>}
              {filtered.map(q => {
                const items = q.items || []
                const isExpanded = expandedId === q.id
                return (
                  <>
                    <tr key={q.id} onClick={() => toggleExpand(q.id)} style={{ cursor: 'pointer' }}>
                      <td>{isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</td>
                      <td><span className="badge badge-info"><span className="badge-dot"></span>{q.type}</span></td>
                      <td style={{ fontWeight: 600 }}>{q.reference}</td>
                      <td>{q.inspector}</td>
                      <td>{q.inspection_date}</td>
                      <td style={{ fontWeight: 600, color: rateColor(q.pass_rate || 0) }}>{(q.pass_rate || 0).toFixed(1)}%</td>
                      <td>{resultBadge(q.result)}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.notes}</td>
                    </tr>
                    {isExpanded && items.length > 0 && (
                      <tr key={`${q.id}-detail`}>
                        <td colSpan={8} style={{ padding: 0, background: 'var(--bg-secondary)' }}>
                          <div className="data-table-wrapper">
                            <table className="data-table" style={{ margin: 0, borderRadius: 0 }}>
                              <thead>
                                <tr><th>檢驗項目</th><th>數量</th><th>合格</th><th>不合格</th><th>不合格原因</th></tr>
                              </thead>
                              <tbody>
                                {items.map((it, i) => (
                                  <tr key={i}>
                                    <td>{it.name}</td>
                                    <td>{it.qty}</td>
                                    <td style={{ color: 'var(--accent-green)', fontWeight: 600 }}>{it.passed}</td>
                                    <td style={{ color: it.failed > 0 ? 'var(--accent-red)' : 'inherit', fontWeight: it.failed > 0 ? 600 : 400 }}>{it.failed}</td>
                                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{it.reason || '-'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <Modal title="新增品質檢驗" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="類型">
              <select className="form-input" style={{ width: '100%' }} value={form.type} onChange={e => set('type', e.target.value)}>
                {TYPE_OPTIONS.map(t => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="參考單號" required>
              <input className="form-input" style={{ width: '100%' }} placeholder="PO-001" value={form.reference} onChange={e => set('reference', e.target.value)} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="檢驗員" required>
              <input className="form-input" style={{ width: '100%' }} placeholder="檢驗員姓名" value={form.inspector} onChange={e => set('inspector', e.target.value)} />
            </Field>
            <Field label="檢驗日期">
              <input className="form-input" type="date" style={{ width: '100%' }} value={form.inspection_date} onChange={e => set('inspection_date', e.target.value)} />
            </Field>
            <Field label="結果">
              <select className="form-input" style={{ width: '100%' }} value={form.result} onChange={e => set('result', e.target.value)}>
                {RESULT_OPTIONS.map(r => <option key={r}>{r}</option>)}
              </select>
            </Field>
          </div>
          <Field label="備註">
            <input className="form-input" style={{ width: '100%' }} placeholder="備註說明" value={form.notes} onChange={e => set('notes', e.target.value)} />
          </Field>
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <strong>檢驗項目</strong>
              <button type="button" className="btn btn-primary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={addItem}><Plus size={12} /> 新增項目</button>
            </div>
            {form.items.map((it, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 2fr auto', gap: 8, marginBottom: 8, alignItems: 'end' }}>
                <Field label={i === 0 ? '項目名稱' : undefined}>
                  <input className="form-input" style={{ width: '100%' }} placeholder="項目名稱" value={it.name} onChange={e => setItem(i, 'name', e.target.value)} />
                </Field>
                <Field label={i === 0 ? '數量' : undefined}>
                  <input className="form-input" type="number" style={{ width: '100%' }} value={it.qty} onChange={e => setItem(i, 'qty', Number(e.target.value))} />
                </Field>
                <Field label={i === 0 ? '合格' : undefined}>
                  <input className="form-input" type="number" style={{ width: '100%' }} value={it.passed} onChange={e => setItem(i, 'passed', Number(e.target.value))} />
                </Field>
                <Field label={i === 0 ? '不合格' : undefined}>
                  <input className="form-input" type="number" style={{ width: '100%' }} value={it.failed} onChange={e => setItem(i, 'failed', Number(e.target.value))} />
                </Field>
                <Field label={i === 0 ? '原因' : undefined}>
                  <input className="form-input" style={{ width: '100%' }} placeholder="不合格原因" value={it.reason} onChange={e => setItem(i, 'reason', e.target.value)} />
                </Field>
                <button type="button" style={{ background: 'none', border: 'none', color: 'var(--accent-red)', cursor: 'pointer', fontSize: 18, padding: 4 }} onClick={() => removeItem(i)}>&times;</button>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  )
}
