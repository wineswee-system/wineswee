import { useState, useEffect } from 'react'
import { Plus, Search, Package, Trash2, Layers } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

export default function Kitting() {
  const [kits, setKits] = useState([])
  const [skus, setSkus] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [showDetail, setShowDetail] = useState(null)
  const [components, setComponents] = useState([])
  const [form, setForm] = useState({
    kit_sku_id: '', kit_type: 'kit', name: '', description: '',
    components: [{ component_sku_id: '', quantity: 1 }],
  })

  useEffect(() => {
    Promise.all([
      supabase.from('kit_definitions').select('*, skus!kit_definitions_kit_sku_id_fkey(code, name)').order('id'),
      supabase.from('skus').select('id, code, name, unit_cost, stock_qty').eq('status', '啟用').order('code'),
    ]).then(([kitRes, skuRes]) => {
      setKits(kitRes.data || [])
      setSkus(skuRes.data || [])
    }).catch(err => { console.error(err); setError('資料載入失敗') })
      .finally(() => setLoading(false))
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const updateComponent = (idx, field, value) => {
    setForm(f => ({
      ...f,
      components: f.components.map((c, i) => i === idx ? { ...c, [field]: value } : c)
    }))
  }

  const addComponent = () => setForm(f => ({ ...f, components: [...f.components, { component_sku_id: '', quantity: 1 }] }))
  const removeComponent = (idx) => setForm(f => ({ ...f, components: f.components.filter((_, i) => i !== idx) }))

  const handleCreate = async () => {
    if (!form.kit_sku_id || !form.name || form.components.some(c => !c.component_sku_id)) return

    const { data: kitDef } = await supabase.from('kit_definitions').insert({
      kit_sku_id: Number(form.kit_sku_id),
      kit_type: form.kit_type,
      name: form.name,
      description: form.description,
    }).select('*, skus!kit_definitions_kit_sku_id_fkey(code, name)').single()

    if (kitDef) {
      const comps = form.components.map((c, i) => ({
        kit_id: kitDef.id,
        component_sku_id: Number(c.component_sku_id),
        quantity: Number(c.quantity),
        sort_order: i,
      }))
      await supabase.from('kit_components').insert(comps)

      setKits(prev => [...prev, kitDef])
      setShowCreate(false)
      setForm({ kit_sku_id: '', kit_type: 'kit', name: '', description: '', components: [{ component_sku_id: '', quantity: 1 }] })
    }
  }

  const loadComponents = async (kit) => {
    const { data } = await supabase.from('kit_components')
      .select('*, skus!kit_components_component_sku_id_fkey(code, name, unit_cost, stock_qty)')
      .eq('kit_id', kit.id)
      .order('sort_order')
    setComponents(data || [])
    setShowDetail(kit)
  }

  const toggleActive = async (kit) => {
    const { data } = await supabase.from('kit_definitions')
      .update({ is_active: !kit.is_active })
      .eq('id', kit.id)
      .select('*, skus!kit_definitions_kit_sku_id_fkey(code, name)')
      .single()
    if (data) setKits(prev => prev.map(k => k.id === kit.id ? data : k))
  }

  const filtered = kits.filter(k =>
    k.name?.includes(search) || k.skus?.code?.includes(search)
  )

  // 計算組合商品可組裝數量
  const calcAvailable = () => {
    if (components.length === 0) return 0
    let min = Infinity
    for (const c of components) {
      const stock = c.skus?.stock_qty || 0
      const possible = c.quantity > 0 ? Math.floor(stock / c.quantity) : 0
      if (possible < min) min = possible
    }
    return min === Infinity ? 0 : min
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3></div>

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div><h2><span className="header-icon"><Layers size={20} /></span> 組合商品管理</h2><p>Kit / Bundle 組合定義與組件管理</p></div>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}><Plus size={14} /> 新增組合</button>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">組合商品數</div><div className="stat-card-value">{kits.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">啟用中</div><div className="stat-card-value">{kits.filter(k => k.is_active).length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">Kit / Bundle</div>
          <div className="stat-card-value">{kits.filter(k => k.kit_type === 'kit').length} / {kits.filter(k => k.kit_type === 'bundle').length}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon"><Package size={16} /></span> 組合列表</div>
          <div className="search-bar">
            <Search className="search-icon" />
            <input type="text" placeholder="搜尋組合名稱/品號..." className="form-input" style={{ paddingLeft: 38 }} value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead><tr><th>組合品號</th><th>名稱</th><th>類型</th><th>說明</th><th>狀態</th><th>操作</th></tr></thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無組合商品</td></tr>}
              {filtered.map(k => (
                <tr key={k.id}>
                  <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>{k.skus?.code || '-'}</td>
                  <td>{k.name}</td>
                  <td><span className={`badge ${k.kit_type === 'kit' ? 'badge-cyan' : 'badge-purple'}`}>{k.kit_type === 'kit' ? '固定組合' : '促銷組合'}</span></td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{k.description}</td>
                  <td>
                    <span className={`badge ${k.is_active ? 'badge-success' : 'badge-neutral'}`}>
                      <span className="badge-dot"></span>{k.is_active ? '啟用' : '停用'}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-secondary" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => loadComponents(k)}>查看組件</button>
                      <button className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => toggleActive(k)}>
                        {k.is_active ? '停用' : '啟用'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 組件明細 */}
      {showDetail && (
        <Modal title={`組件明細 — ${showDetail.name}`} onClose={() => { setShowDetail(null); setComponents([]) }}>
          <div style={{ marginBottom: 12, padding: '8px 12px', background: 'var(--glass-light)', borderRadius: 8, display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13 }}>可組裝數量</span>
            <span style={{ fontWeight: 700, color: 'var(--accent-green)' }}>{calcAvailable()} 組</span>
          </div>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead><tr><th>組件品號</th><th>品名</th><th>需用量</th><th>庫存</th><th>可供組數</th></tr></thead>
              <tbody>
                {components.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無組件</td></tr>}
                {components.map(c => {
                  const stock = c.skus?.stock_qty || 0
                  const possible = c.quantity > 0 ? Math.floor(stock / c.quantity) : 0
                  return (
                    <tr key={c.id}>
                      <td style={{ fontFamily: 'monospace' }}>{c.skus?.code}</td>
                      <td>{c.skus?.name}</td>
                      <td style={{ fontWeight: 600 }}>{c.quantity}</td>
                      <td>{stock}</td>
                      <td>
                        <span className={`badge ${possible > 0 ? 'badge-success' : 'badge-danger'}`}>{possible}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Modal>
      )}

      {/* 新增組合 Modal */}
      {showCreate && (
        <Modal title="新增組合商品" onClose={() => setShowCreate(false)} onSubmit={handleCreate}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="組合品號 (SKU)" required>
              <select className="form-input" style={{ width: '100%' }} value={form.kit_sku_id} onChange={e => set('kit_sku_id', e.target.value)}>
                <option value="">-- 選擇 SKU --</option>
                {skus.map(s => <option key={s.id} value={s.id}>{s.code} - {s.name}</option>)}
              </select>
            </Field>
            <Field label="類型">
              <select className="form-input" style={{ width: '100%' }} value={form.kit_type} onChange={e => set('kit_type', e.target.value)}>
                <option value="kit">固定組合 (Kit)</option>
                <option value="bundle">促銷組合 (Bundle)</option>
              </select>
            </Field>
          </div>
          <Field label="組合名稱" required><input className="form-input" style={{ width: '100%' }} placeholder="如：新年禮盒組" value={form.name} onChange={e => set('name', e.target.value)} /></Field>
          <Field label="說明"><input className="form-input" style={{ width: '100%' }} placeholder="組合說明" value={form.description} onChange={e => set('description', e.target.value)} /></Field>

          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>組件清單</span>
              <button type="button" className="btn btn-secondary" style={{ fontSize: 11 }} onClick={addComponent}><Plus size={12} /> 新增組件</button>
            </div>
            {form.components.map((comp, idx) => (
              <div key={idx} style={{ display: 'grid', gridTemplateColumns: '2fr 80px 30px', gap: 8, marginBottom: 6 }}>
                <select className="form-input" value={comp.component_sku_id} onChange={e => updateComponent(idx, 'component_sku_id', e.target.value)}>
                  <option value="">-- 選擇組件 SKU --</option>
                  {skus.map(s => <option key={s.id} value={s.id}>{s.code} - {s.name}</option>)}
                </select>
                <input className="form-input" type="number" min={1} placeholder="數量" value={comp.quantity} onChange={e => updateComponent(idx, 'quantity', Number(e.target.value))} />
                {form.components.length > 1 && (
                  <button type="button" className="btn btn-ghost" style={{ color: 'var(--accent-red)', padding: 0 }} onClick={() => removeComponent(idx)}><Trash2 size={14} /></button>
                )}
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  )
}
