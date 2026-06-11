import { useState, useEffect, Fragment } from 'react'
import { Plus, Search, ChevronDown, ChevronRight, GitBranch, Layers, DollarSign, Trash2, Save } from 'lucide-react'
import { getBOMs, createBOM, getSKUs, getBOMLines, createBOMLine, deleteBOMLine } from '../../lib/db'
import { explodeBOM, explodeBOMFromDB } from '../../lib/mrpEngine'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import { fmtNT as fmt } from '../../lib/currency'

export default function BOM() {
  const [boms, setBoms] = useState([])
  const [skus, setSkus] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [explodedBOM, setExplodedBOM] = useState(null)
  const [showExplodeModal, setShowExplodeModal] = useState(false)
  const [exploding, setExploding] = useState(false)

  // Structured BOM lines state
  const [structuredLines, setStructuredLines] = useState([]) // loaded bom_lines for expanded BOM
  const [loadingLines, setLoadingLines] = useState(false)
  const [showAddLine, setShowAddLine] = useState(false)
  const [newLine, setNewLine] = useState({ component_sku_id: '', quantity: 1, unit: 'pcs', scrap_rate: 0, is_sub_assembly: false, sub_bom_id: '' })

  const [form, setForm] = useState({
    product_name: '', product_code: '', version: '1.0', status: '使用中',
    components: [{ name: '', code: '', qty: 1, unit: 'pcs', cost_per_unit: 0, parent_bom_id: null }]
  })

  useEffect(() => {
    Promise.all([getBOMs(), getSKUs()])
      .then(([bomRes, skuRes]) => {
        setBoms(bomRes.data || [])
        setSkus(skuRes.data || [])
      })
      .catch(err => { console.error('Failed to load data:', err); setError('資料載入失敗，請重新整理頁面') })
      .finally(() => { setLoading(false) })
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const setComponent = (idx, k, v) => {
    setForm(f => {
      const comps = [...f.components]
      comps[idx] = { ...comps[idx], [k]: v }
      if (k === 'parent_bom_id' && v) {
        const selectedBom = boms.find(b => String(b.id) === String(v))
        if (selectedBom) {
          comps[idx] = { ...comps[idx], parent_bom_id: v, name: selectedBom.product_name, code: selectedBom.product_code }
        }
      }
      if (k === 'parent_bom_id' && !v) {
        comps[idx] = { ...comps[idx], parent_bom_id: null }
      }
      return { ...f, components: comps }
    })
  }

  const addComponent = () => setForm(f => ({
    ...f, components: [...f.components, { name: '', code: '', qty: 1, unit: 'pcs', cost_per_unit: 0, parent_bom_id: null }]
  }))

  const removeComponent = (idx) => setForm(f => ({
    ...f, components: f.components.filter((_, i) => i !== idx)
  }))

  // Load structured BOM lines when expanding a BOM row
  const loadBOMLines = async (bomId) => {
    setLoadingLines(true)
    try {
      const { data, error: err } = await getBOMLines(bomId)
      if (err) throw err
      setStructuredLines(data || [])
    } catch (err) {
      console.error('載入 BOM 明細失敗:', err)
      setStructuredLines([])
    } finally {
      setLoadingLines(false)
    }
  }

  // Add a structured BOM line
  const handleAddBOMLine = async (bomId) => {
    if (!newLine.component_sku_id) return
    try {
      const payload = {
        bom_id: bomId,
        component_sku_id: Number(newLine.component_sku_id),
        quantity: Number(newLine.quantity) || 1,
        unit: newLine.unit || 'pcs',
        scrap_rate: Number(newLine.scrap_rate) || 0,
        is_sub_assembly: newLine.is_sub_assembly,
        sub_bom_id: newLine.is_sub_assembly && newLine.sub_bom_id ? Number(newLine.sub_bom_id) : null,
      }
      const { data, error: err } = await createBOMLine(payload)
      if (err) throw err
      if (data) {
        await loadBOMLines(bomId)
        setShowAddLine(false)
        setNewLine({ component_sku_id: '', quantity: 1, unit: 'pcs', scrap_rate: 0, is_sub_assembly: false, sub_bom_id: '' })
      }
    } catch (err) {
      console.error('新增 BOM 明細失敗:', err)
    }
  }

  // Delete a structured BOM line
  const handleDeleteBOMLine = async (lineId, bomId) => {
    try {
      await deleteBOMLine(lineId)
      await loadBOMLines(bomId)
    } catch (err) {
      console.error('刪除 BOM 明細失敗:', err)
    }
  }

  /**
   * Build flat BOM records from JSONB components (backward compat)
   */
  const buildBOMRecords = () => {
    const records = []
    for (const bom of boms) {
      const comps = bom.components || []
      for (const c of comps) {
        records.push({
          parent_code: bom.product_code,
          component_code: c.code,
          component_name: c.name,
          qty_per: c.qty || 1,
          cost_per_unit: c.cost_per_unit || 0,
          unit: c.unit || 'pcs',
          has_sub_bom: !!c.parent_bom_id,
        })
      }
    }
    return records
  }

  /**
   * Explode BOM — try structured bom_lines first, fall back to JSONB
   */
  const handleExplode = async (bom) => {
    setExploding(true)
    try {
      // Try bom_lines first
      const { data: lines } = await getBOMLines(bom.id)

      if (lines && lines.length > 0) {
        // Use Supabase-backed multi-level explosion
        const tree = await explodeBOMFromDB(bom.id, 1)
        const totalCost = tree.reduce((sum, n) => sum + (n.requiredQty * (n.unitCost || 0)), 0)

        setExplodedBOM({
          bomId: bom.id,
          productName: bom.product_name,
          productCode: bom.product_code,
          tree: tree.map(n => ({
            component_code: n.skuCode,
            component_name: n.skuName,
            required_qty: Math.round(n.requiredQty * 100) / 100,
            level: n.level,
            parent: n.bomPath,
            unit: n.unit,
            unit_cost: n.unitCost || 0,
            line_cost: Math.round(n.requiredQty * (n.unitCost || 0) * 100) / 100,
            isSubAssembly: n.isSubAssembly,
          })),
          totalCost: Math.round(totalCost * 100) / 100,
        })
      } else {
        // Fall back to JSONB components
        const bomRecords = buildBOMRecords()
        const tree = explodeBOM(bom.product_code, 1, bomRecords)
        const treeWithCost = tree.map(node => {
          const record = bomRecords.find(r => r.parent_code === node.parent && r.component_code === node.component_code)
          const unitCost = record?.cost_per_unit || 0
          const lineCost = unitCost * node.required_qty
          return { ...node, unit_cost: unitCost, line_cost: lineCost, unit: record?.unit || 'pcs' }
        })
        const totalCost = treeWithCost.reduce((sum, n) => sum + n.line_cost, 0)

        setExplodedBOM({
          bomId: bom.id,
          productName: bom.product_name,
          productCode: bom.product_code,
          tree: treeWithCost,
          totalCost,
        })
      }
      setShowExplodeModal(true)
    } catch (err) {
      console.error('BOM 展開失敗:', err)
      setError('BOM 展開失敗: ' + (err.message || '未知錯誤'))
    } finally {
      setExploding(false)
    }
  }

  const handleSubmit = async () => {
    if (!form.product_name || !form.product_code) return
    const total_cost = form.components.reduce((s, c) => s + (c.qty * c.cost_per_unit), 0)
    const { data } = await createBOM({ ...form, total_cost })
    if (data) {
      setBoms(prev => [...prev, data])
      setShowModal(false)
      setForm({ product_name: '', product_code: '', version: '1.0', status: '使用中', components: [{ name: '', code: '', qty: 1, unit: 'pcs', cost_per_unit: 0, parent_bom_id: null }] })
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => { setError(null); window.location.reload() }} style={{ marginTop: 16 }}>重新載入</button></div>

  const filtered = boms.filter(b =>
    search === '' || b.product_name?.includes(search) || b.product_code?.includes(search)
  )

  const active = filtered.filter(b => b.status === '使用中').length
  const inactive = filtered.filter(b => b.status === '停用').length
  const avgCost = filtered.length > 0
    ? Math.round(filtered.reduce((s, b) => s + (b.total_cost || 0), 0) / filtered.length)
    : 0
  const multiLevelCount = boms.filter(b =>
    (b.components || []).some(c => c.parent_bom_id)
  ).length

  

  const toggleExpand = async (id) => {
    if (expandedId === id) {
      setExpandedId(null)
      setStructuredLines([])
    } else {
      setExpandedId(id)
      setShowAddLine(false)
      await loadBOMLines(id)
    }
  }

  const buildTreePrefix = (level, isLast) => {
    if (level === 0) return ''
    const indent = '    '.repeat(level - 1)
    return indent + (isLast ? '└── ' : '├── ')
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">🔧</span> BOM 物料清單</h2>
            <p>多階物料清單、成本展開與管理</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增 BOM</button>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">使用中</div>
          <div className="stat-card-value">{active}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">停用</div>
          <div className="stat-card-value">{inactive}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">平均成本</div>
          <div className="stat-card-value">{fmt(avgCost)}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">多階 BOM</div>
          <div className="stat-card-value">{multiLevelCount}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📋</span> BOM 列表</div>
          <div className="search-bar">
            <Search className="search-icon" />
            <input type="text" placeholder="搜尋產品名稱或代碼..." className="form-input" style={{ paddingLeft: 38 }} value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th style={{ width: 32 }}></th><th>產品名稱</th><th>產品代碼</th><th>版本</th><th>總成本</th><th>零件數</th><th>子組件</th><th>狀態</th><th>操作</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無 BOM 資料</td></tr>}
              {filtered.map(b => {
                const comps = b.components || []
                const subAssemblyCount = comps.filter(c => c.parent_bom_id).length
                const isExpanded = expandedId === b.id
                return (
                  <Fragment key={b.id}>
                    <tr onClick={() => toggleExpand(b.id)} style={{ cursor: 'pointer' }}>
                      <td>{isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</td>
                      <td style={{ fontWeight: 600 }}>{b.product_name}</td>
                      <td><code>{b.product_code}</code></td>
                      <td>{b.version}</td>
                      <td style={{ fontWeight: 600 }}>{fmt(b.total_cost)}</td>
                      <td>{comps.length}</td>
                      <td>
                        {subAssemblyCount > 0
                          ? <span className="badge badge-info"><span className="badge-dot"></span>{subAssemblyCount} 組件</span>
                          : <span style={{ color: 'var(--text-muted)' }}>—</span>
                        }
                      </td>
                      <td>
                        <span className={`badge ${b.status === '使用中' ? 'badge-success' : 'badge-danger'}`}>
                          <span className="badge-dot"></span>{b.status}
                        </span>
                      </td>
                      <td>
                        <button
                          className="btn btn-primary"
                          style={{ padding: '4px 10px', fontSize: 12 }}
                          onClick={(e) => { e.stopPropagation(); handleExplode(b) }}
                          disabled={exploding}
                          title="展開多階 BOM 樹狀結構"
                        >
                          <GitBranch size={12} /> {exploding ? '展開中...' : 'BOM 展開'}
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${b.id}-detail`}>
                        <td colSpan={9} style={{ padding: 0, background: 'var(--bg-secondary)' }}>
                          {/* JSONB Components Section */}
                          {comps.length > 0 && (
                            <div style={{ marginBottom: 2 }}>
                              <div style={{ padding: '8px 16px', fontWeight: 600, fontSize: 13, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)' }}>
                                JSONB 零件清單 ({comps.length})
                              </div>
                              <div className="data-table-wrapper">
                                <table className="data-table" style={{ margin: 0, borderRadius: 0 }}>
                                  <thead>
                                    <tr><th>零件名稱</th><th>零件代碼</th><th>數量</th><th>單位</th><th>單價</th><th>小計</th><th>類型</th></tr>
                                  </thead>
                                  <tbody>
                                    {comps.map((c, i) => {
                                      const isSubAssembly = !!c.parent_bom_id
                                      const subBom = isSubAssembly ? boms.find(sb => String(sb.id) === String(c.parent_bom_id)) : null
                                      return (
                                        <tr key={i}>
                                          <td>
                                            {isSubAssembly && <Layers size={14} style={{ marginRight: 4, verticalAlign: 'middle', color: 'var(--accent-purple)' }} />}
                                            {c.name}
                                          </td>
                                          <td><code>{c.code}</code></td>
                                          <td>{c.qty}</td>
                                          <td>{c.unit}</td>
                                          <td>{fmt(c.cost_per_unit)}</td>
                                          <td style={{ fontWeight: 600 }}>{fmt(c.qty * c.cost_per_unit)}</td>
                                          <td>
                                            {isSubAssembly
                                              ? <span className="badge badge-info"><span className="badge-dot"></span>子組件 ({subBom?.product_name || '?'})</span>
                                              : <span className="badge badge-success"><span className="badge-dot"></span>原物料</span>
                                            }
                                          </td>
                                        </tr>
                                      )
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}

                          {/* Structured BOM Lines Section */}
                          <div style={{ borderTop: comps.length > 0 ? '2px solid var(--border-color)' : 'none' }}>
                            <div style={{ padding: '8px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)' }}>
                              <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent-purple)' }}>
                                <Layers size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                                結構化 BOM (bom_lines)
                                {structuredLines.length > 0 && ` — ${structuredLines.length} 項`}
                              </span>
                              <button
                                className="btn btn-primary"
                                style={{ padding: '4px 10px', fontSize: 12 }}
                                onClick={(e) => { e.stopPropagation(); setShowAddLine(!showAddLine) }}
                              >
                                <Plus size={12} /> 新增組件
                              </button>
                            </div>

                            {/* Add line form */}
                            {showAddLine && (
                              <div style={{ padding: '12px 16px', background: 'var(--bg-primary)', borderBottom: '1px solid var(--border-color)' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr auto', gap: 8, alignItems: 'end' }}>
                                  <Field label="SKU 品項">
                                    <select
                                      className="form-input"
                                      style={{ width: '100%' }}
                                      value={newLine.component_sku_id}
                                      onChange={e => setNewLine(l => ({ ...l, component_sku_id: e.target.value }))}
                                    >
                                      <option value="">— 選擇 SKU —</option>
                                      {skus.map(s => (
                                        <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
                                      ))}
                                    </select>
                                  </Field>
                                  <Field label="數量">
                                    <input
                                      className="form-input" type="number" style={{ width: '100%' }}
                                      value={newLine.quantity}
                                      onChange={e => setNewLine(l => ({ ...l, quantity: Number(e.target.value) }))}
                                    />
                                  </Field>
                                  <Field label="損耗率 %">
                                    <input
                                      className="form-input" type="number" style={{ width: '100%' }}
                                      value={newLine.scrap_rate}
                                      onChange={e => setNewLine(l => ({ ...l, scrap_rate: Number(e.target.value) }))}
                                    />
                                  </Field>
                                  <Field label="單位">
                                    <input
                                      className="form-input" style={{ width: '100%' }}
                                      value={newLine.unit}
                                      onChange={e => setNewLine(l => ({ ...l, unit: e.target.value }))}
                                    />
                                  </Field>
                                  <button
                                    className="btn btn-primary"
                                    style={{ padding: '6px 12px', fontSize: 12 }}
                                    onClick={() => handleAddBOMLine(b.id)}
                                  >
                                    <Save size={12} /> 儲存
                                  </button>
                                </div>
                                <div style={{ marginTop: 8, display: 'flex', gap: 12, alignItems: 'center' }}>
                                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                                    <input
                                      type="checkbox"
                                      checked={newLine.is_sub_assembly}
                                      onChange={e => setNewLine(l => ({ ...l, is_sub_assembly: e.target.checked, sub_bom_id: '' }))}
                                    />
                                    子組件
                                  </label>
                                  {newLine.is_sub_assembly && (
                                    <select
                                      className="form-input"
                                      style={{ flex: 1 }}
                                      value={newLine.sub_bom_id}
                                      onChange={e => setNewLine(l => ({ ...l, sub_bom_id: e.target.value }))}
                                    >
                                      <option value="">— 選擇子組件 BOM —</option>
                                      {boms.filter(bb => bb.status === '使用中' && bb.id !== b.id).map(bb => (
                                        <option key={bb.id} value={bb.id}>{bb.product_name} ({bb.product_code})</option>
                                      ))}
                                    </select>
                                  )}
                                </div>
                              </div>
                            )}

                            {loadingLines ? (
                              <div style={{ padding: 24, textAlign: 'center' }}><LoadingSpinner /></div>
                            ) : structuredLines.length === 0 ? (
                              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                                尚無結構化 BOM 明細。點擊「新增組件」來建立。
                              </div>
                            ) : (
                              <div className="data-table-wrapper">
                                <table className="data-table" style={{ margin: 0, borderRadius: 0 }}>
                                  <thead>
                                    <tr><th>SKU 代碼</th><th>品名</th><th>數量</th><th>單位</th><th>損耗率 %</th><th>單價</th><th>類型</th><th style={{ width: 60 }}>操作</th></tr>
                                  </thead>
                                  <tbody>
                                    {structuredLines.map(line => {
                                      const sku = line.skus || {}
                                      const subBom = line.is_sub_assembly ? boms.find(bb => bb.id === line.sub_bom_id) : null
                                      return (
                                        <tr key={line.id}>
                                          <td><code>{sku.code || '—'}</code></td>
                                          <td>
                                            {line.is_sub_assembly && <Layers size={14} style={{ marginRight: 4, verticalAlign: 'middle', color: 'var(--accent-purple)' }} />}
                                            {sku.name || '—'}
                                          </td>
                                          <td>{line.quantity}</td>
                                          <td>{line.unit}</td>
                                          <td>{line.scrap_rate > 0 ? `${line.scrap_rate}%` : '—'}</td>
                                          <td>{fmt(sku.cost || 0)}</td>
                                          <td>
                                            {line.is_sub_assembly
                                              ? <span className="badge badge-info"><span className="badge-dot"></span>子組件 {subBom ? `(${subBom.product_name})` : ''}</span>
                                              : <span className="badge badge-success"><span className="badge-dot"></span>原物料</span>
                                            }
                                          </td>
                                          <td>
                                            <button
                                              style={{ background: 'none', border: 'none', color: 'var(--accent-red)', cursor: 'pointer', padding: 4 }}
                                              onClick={(e) => { e.stopPropagation(); handleDeleteBOMLine(line.id, b.id) }}
                                              title="刪除此組件"
                                            >
                                              <Trash2 size={14} />
                                            </button>
                                          </td>
                                        </tr>
                                      )
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create BOM Modal */}
      {showModal && (
        <Modal title="新增 BOM" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="產品名稱" required>
              <input className="form-input" style={{ width: '100%' }} placeholder="產品名稱" value={form.product_name} onChange={e => set('product_name', e.target.value)} />
            </Field>
            <Field label="產品代碼" required>
              <input className="form-input" style={{ width: '100%' }} placeholder="P-001" value={form.product_code} onChange={e => set('product_code', e.target.value)} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="版本">
              <input className="form-input" style={{ width: '100%' }} placeholder="1.0" value={form.version} onChange={e => set('version', e.target.value)} />
            </Field>
            <Field label="狀態">
              <select className="form-input" style={{ width: '100%' }} value={form.status} onChange={e => set('status', e.target.value)}>
                <option>使用中</option>
                <option>停用</option>
              </select>
            </Field>
          </div>
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <strong>零件清單</strong>
              <button type="button" className="btn btn-primary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={addComponent}><Plus size={12} /> 新增零件</button>
            </div>
            {form.components.map((c, i) => (
              <div key={i} style={{ marginBottom: 12, padding: 12, border: '1px solid var(--border-color)', borderRadius: 8, background: 'var(--bg-secondary)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr auto', gap: 8, alignItems: 'end' }}>
                  <Field label={i === 0 ? '名稱' : undefined}>
                    <input className="form-input" style={{ width: '100%' }} placeholder="零件名稱" value={c.name} onChange={e => setComponent(i, 'name', e.target.value)} />
                  </Field>
                  <Field label={i === 0 ? '代碼' : undefined}>
                    <input className="form-input" style={{ width: '100%' }} placeholder="代碼" value={c.code} onChange={e => setComponent(i, 'code', e.target.value)} />
                  </Field>
                  <Field label={i === 0 ? '數量' : undefined}>
                    <input className="form-input" type="number" style={{ width: '100%' }} value={c.qty} onChange={e => setComponent(i, 'qty', Number(e.target.value))} />
                  </Field>
                  <Field label={i === 0 ? '單位' : undefined}>
                    <input className="form-input" style={{ width: '100%' }} value={c.unit} onChange={e => setComponent(i, 'unit', e.target.value)} />
                  </Field>
                  <Field label={i === 0 ? '單價' : undefined}>
                    <input className="form-input" type="number" style={{ width: '100%' }} value={c.cost_per_unit} onChange={e => setComponent(i, 'cost_per_unit', Number(e.target.value))} />
                  </Field>
                  <button type="button" style={{ background: 'none', border: 'none', color: 'var(--accent-red)', cursor: 'pointer', fontSize: 18, padding: 4 }} onClick={() => removeComponent(i)}>&times;</button>
                </div>
                <div style={{ marginTop: 8 }}>
                  <Field label="子組件 BOM（選填）">
                    <select
                      className="form-input"
                      style={{ width: '100%' }}
                      value={c.parent_bom_id || ''}
                      onChange={e => setComponent(i, 'parent_bom_id', e.target.value || null)}
                    >
                      <option value="">— 無（原物料）—</option>
                      {boms.filter(b => b.status === '使用中').map(b => (
                        <option key={b.id} value={b.id}>{b.product_name} ({b.product_code})</option>
                      ))}
                    </select>
                  </Field>
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {/* Explode BOM Tree Modal */}
      {showExplodeModal && explodedBOM && (
        <Modal
          title={`BOM 展開 — ${explodedBOM.productName} (${explodedBOM.productCode})`}
          onClose={() => { setShowExplodeModal(false); setExplodedBOM(null) }}
          onSubmit={() => { setShowExplodeModal(false); setExplodedBOM(null) }}
          submitLabel="關閉"
        >
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', padding: '12px 16px', background: 'var(--bg-secondary)', borderRadius: 8, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <DollarSign size={18} style={{ color: 'var(--accent-green)' }} />
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>多階成本總計</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent-green)' }}>{fmt(explodedBOM.totalCost)}</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 24 }}>
                <Layers size={18} style={{ color: 'var(--accent-purple)' }} />
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>展開項目</div>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>{explodedBOM.tree.length}</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 24 }}>
                <GitBranch size={18} style={{ color: 'var(--accent-cyan)' }} />
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>最深層級</div>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>
                    {explodedBOM.tree.length > 0 ? Math.max(...explodedBOM.tree.map(n => n.level)) : 0}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {explodedBOM.tree.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>
              此 BOM 無可展開的子件（沒有零件資料）
            </div>
          ) : (
            <div style={{ fontFamily: 'monospace', fontSize: 13, lineHeight: 1.8 }}>
              <div style={{ fontWeight: 700, marginBottom: 8, padding: '6px 12px', background: 'var(--bg-secondary)', borderRadius: 6 }}>
                {explodedBOM.productName} ({explodedBOM.productCode})
              </div>
              {explodedBOM.tree.map((node, idx) => {
                const isLast = (() => {
                  for (let j = idx + 1; j < explodedBOM.tree.length; j++) {
                    if (explodedBOM.tree[j].level === node.level && explodedBOM.tree[j].parent === node.parent) return false
                    if (explodedBOM.tree[j].level < node.level) break
                  }
                  return true
                })()
                const prefix = buildTreePrefix(node.level, isLast)

                return (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '4px 12px',
                      borderBottom: '1px solid var(--border-color)',
                      background: node.level > 1 ? 'var(--bg-secondary)' : 'transparent',
                    }}
                  >
                    <span style={{ whiteSpace: 'pre' }}>
                      <span style={{ color: 'var(--text-muted)' }}>{prefix}</span>
                      {node.isSubAssembly && <span style={{ color: 'var(--accent-purple)', marginRight: 4 }}>[Sub]</span>}
                      <span style={{ fontWeight: node.line_cost > 0 ? 600 : 400 }}>{node.component_name}</span>
                      <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>({node.component_code})</span>
                    </span>
                    <span style={{ display: 'flex', gap: 16, fontSize: 12 }}>
                      <span>x{node.required_qty} {node.unit}</span>
                      <span style={{ color: 'var(--accent-green)', fontWeight: 600, minWidth: 100, textAlign: 'right' }}>
                        {fmt(node.line_cost)}
                      </span>
                    </span>
                  </div>
                )
              })}
              <div style={{
                display: 'flex', justifyContent: 'flex-end', padding: '8px 12px',
                fontWeight: 700, fontSize: 14, borderTop: '2px solid var(--border-color)',
                background: 'var(--bg-secondary)', borderRadius: '0 0 6px 6px'
              }}>
                成本總計: {fmt(explodedBOM.totalCost)}
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}
