import { useState, useEffect, Fragment } from 'react'
import { Plus, Search, ChevronDown, ChevronRight, Play, AlertTriangle, ShoppingCart, ClipboardList, Package, Factory, Settings } from 'lucide-react'
import { getMRPResults, createMRPResult, getSalesOrders, getBOMs, getPurchaseOrders, createPurchaseRequest, createManufacturingOrder } from '../../lib/db'
import { runMRP, generatePurchaseSuggestions, runMRPFromDB } from '../../lib/mrpEngine'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

export default function MRP() {
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [form, setForm] = useState({
    product_name: '', order_qty: 1, status: '待處理',
    components: [{ name: '', need: 0, stock: 0 }]
  })

  // MRP engine state
  const [mrpRunning, setMrpRunning] = useState(false)
  const [mrpResults, setMrpResults] = useState(null) // array from runMRPFromDB
  const [activeTab, setActiveTab] = useState('engine') // 'engine' | 'manual'

  // MRP options
  const [showOptions, setShowOptions] = useState(false)
  const [demandSource, setDemandSource] = useState('sales_orders')
  const [planningHorizon, setPlanningHorizon] = useState(30)

  // Action feedback
  const [actionMsg, setActionMsg] = useState(null)

  useEffect(() => {
    getMRPResults().then(({ data }) => { setResults(data || []) }).catch(err => { console.error('Failed to load data:', err); setError('資料載入失敗，請重新整理頁面') }).finally(() => { setLoading(false) })
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const setComponent = (idx, k, v) => {
    setForm(f => {
      const comps = [...f.components]
      comps[idx] = { ...comps[idx], [k]: v }
      return { ...f, components: comps }
    })
  }

  const addComponent = () => setForm(f => ({
    ...f, components: [...f.components, { name: '', need: 0, stock: 0 }]
  }))

  const removeComponent = (idx) => setForm(f => ({
    ...f, components: f.components.filter((_, i) => i !== idx)
  }))

  /**
   * Execute real MRP calculation from Supabase data
   */
  const handleRunMRP = async () => {
    setMrpRunning(true)
    setMrpResults(null)
    setError(null)
    setActionMsg(null)
    try {
      const results = await runMRPFromDB({
        demandSource,
        planningHorizon,
      })
      setMrpResults(results)
      setActiveTab('engine')
    } catch (err) {
      console.error('MRP run failed:', err)
      setError('MRP 執行失敗: ' + (err.message || '未知錯誤'))
    } finally {
      setMrpRunning(false)
    }
  }

  /**
   * Create a purchase request from an MRP suggestion row
   */
  const handleCreatePR = async (row) => {
    try {
      const { data, error: err } = await createPurchaseRequest({
        title: `MRP 採購建議 — ${row.sku_code}`,
        items: JSON.stringify([{
          product_code: row.sku_code,
          product_name: row.sku_name,
          qty: row.suggested_quantity,
        }]),
        total_amount: 0,
        status: '待審核',
        requester: 'MRP 系統',
      })
      if (err) throw err
      setActionMsg(`已建立採購單: ${row.sku_code} x ${row.suggested_quantity}`)
      setTimeout(() => setActionMsg(null), 3000)
    } catch (err) {
      console.error('建立採購單失敗:', err)
      setActionMsg('建立採購單失敗: ' + (err.message || '未知錯誤'))
    }
  }

  /**
   * Create a manufacturing order from an MRP suggestion row
   */
  const handleCreateMO = async (row) => {
    try {
      const { data, error: err } = await createManufacturingOrder({
        product_name: row.sku_name,
        product_code: row.sku_code,
        bom_id: row.bom_id,
        quantity: row.suggested_quantity,
        status: '待排程',
        planned_date: row.suggested_date,
      })
      if (err) throw err
      setActionMsg(`已建立製令: ${row.sku_code} x ${row.suggested_quantity}`)
      setTimeout(() => setActionMsg(null), 3000)
    } catch (err) {
      console.error('建立製令失敗:', err)
      setActionMsg('建立製令失敗: ' + (err.message || '未知錯誤'))
    }
  }

  const handleSubmit = async () => {
    if (!form.product_name) return
    const hasShortage = form.components.some(c => c.need > c.stock)
    const status = form.status === '待處理' ? '待處理' : hasShortage ? '有缺料' : '無缺料'
    const { data } = await createMRPResult({ ...form, status })
    if (data) {
      setResults(prev => [...prev, data])
      setShowModal(false)
      setForm({ product_name: '', order_qty: 1, status: '待處理', components: [{ name: '', need: 0, stock: 0 }] })
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => { setError(null); window.location.reload() }} style={{ marginTop: 16 }}>重新載入</button></div>

  const filtered = results.filter(r =>
    search === '' || r.product_name?.includes(search)
  )

  const shortage = filtered.filter(r => r.status === '有缺料').length
  const noShortage = filtered.filter(r => r.status === '無缺料').length
  const pending = filtered.filter(r => r.status === '待處理').length

  // MRP engine summary stats
  const engineNeedMfg = mrpResults ? mrpResults.filter(r => r.action === 'manufacture' && r.net_requirement > 0).length : 0
  const engineNeedPurchase = mrpResults ? mrpResults.filter(r => r.action === 'purchase' && r.net_requirement > 0).length : 0
  const engineSufficient = mrpResults ? mrpResults.filter(r => r.net_requirement <= 0).length : 0

  const statusBadge = (status) => {
    const cls = status === '有缺料' ? 'badge-danger' : status === '無缺料' ? 'badge-success' : 'badge-warning'
    return <span className={`badge ${cls}`}><span className="badge-dot"></span>{status}</span>
  }

  const toggleExpand = (id) => setExpandedId(prev => prev === id ? null : id)

  const fmt = (n) => `NT$ ${(n || 0).toLocaleString()}`

  const mainTabStyle = (tab) => ({
    padding: '12px 24px',
    cursor: 'pointer',
    fontWeight: activeTab === tab ? 700 : 400,
    color: activeTab === tab ? 'var(--accent-blue)' : 'var(--text-secondary)',
    borderBottom: activeTab === tab ? '3px solid var(--accent-blue)' : '3px solid transparent',
    background: 'none',
    border: 'none',
    borderBottomStyle: 'solid',
    fontSize: 14,
    transition: 'all 0.2s ease',
  })

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📊</span> MRP 物料需求計畫</h2>
            <p>物料需求分析、缺料管理與採購建議</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn btn-primary"
              style={{ padding: '8px 12px', fontSize: 13, background: 'transparent', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
              onClick={() => setShowOptions(!showOptions)}
            >
              <Settings size={14} /> 選項
            </button>
            <button
              className="btn btn-primary"
              onClick={handleRunMRP}
              disabled={mrpRunning}
              style={{ background: 'var(--accent-green)', borderColor: 'var(--accent-green)' }}
            >
              {mrpRunning ? <LoadingSpinner size={14} /> : <Play size={14} />}
              {mrpRunning ? ' 計算中...' : ' 執行 MRP'}
            </button>
          </div>
        </div>
      </div>

      {/* Options Panel */}
      {showOptions && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">⚙️</span> MRP 參數設定</div>
          </div>
          <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="需求來源">
              <select className="form-input" style={{ width: '100%' }} value={demandSource} onChange={e => setDemandSource(e.target.value)}>
                <option value="sales_orders">銷售訂單</option>
                <option value="manual">手動輸入</option>
              </select>
            </Field>
            <Field label="規劃天數">
              <input className="form-input" type="number" style={{ width: '100%' }} value={planningHorizon} onChange={e => setPlanningHorizon(Number(e.target.value))} min={1} max={365} />
            </Field>
          </div>
        </div>
      )}

      {/* Action feedback */}
      {actionMsg && (
        <div style={{
          padding: '10px 16px', marginBottom: 16, borderRadius: 8,
          background: actionMsg.includes('失敗') ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
          color: actionMsg.includes('失敗') ? 'var(--accent-red)' : 'var(--accent-green)',
          fontWeight: 600, fontSize: 13,
        }}>
          {actionMsg}
        </div>
      )}

      {/* Summary stats */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-blue)', '--card-accent-dim': 'var(--accent-blue-dim)' }}>
          <div className="stat-card-label">需製造</div>
          <div className="stat-card-value">{mrpResults ? engineNeedMfg : shortage}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">需採購</div>
          <div className="stat-card-value">{mrpResults ? engineNeedPurchase : pending}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">庫存充足</div>
          <div className="stat-card-value">{mrpResults ? engineSufficient : noShortage}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">分析品項</div>
          <div className="stat-card-value">{mrpResults ? mrpResults.length : filtered.length}</div>
        </div>
      </div>

      {/* Main Tab Navigation */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', marginBottom: 16 }}>
        <button style={mainTabStyle('engine')} onClick={() => setActiveTab('engine')}>
          <ClipboardList size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
          MRP 運算結果
        </button>
        <button style={mainTabStyle('manual')} onClick={() => setActiveTab('manual')}>
          <Plus size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
          手動記錄 ({filtered.length})
        </button>
      </div>

      {/* Tab: MRP Engine Results */}
      {activeTab === 'engine' && (
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">⚙️</span> MRP 運算結果</div>
            {mrpResults && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                共 {mrpResults.length} 品項 | 需求來源: {demandSource === 'sales_orders' ? '銷售訂單' : '手動'} | 規劃天數: {planningHorizon}
              </div>
            )}
          </div>

          {!mrpResults ? (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
              <Play size={32} style={{ marginBottom: 12, opacity: 0.4 }} />
              <div style={{ fontSize: 15 }}>點擊「執行 MRP」開始物料需求計算</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>系統會讀取銷售訂單、BOM、庫存及採購單資料進行分析</div>
            </div>
          ) : mrpResults.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--accent-green)' }}>
              <Package size={32} style={{ marginBottom: 12 }} />
              <div style={{ fontSize: 15 }}>無物料需求 — 目前無未完成銷售訂單或庫存已充足</div>
            </div>
          ) : (
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>品號</th>
                    <th>品名</th>
                    <th>毛需求</th>
                    <th>庫存</th>
                    <th>在途</th>
                    <th>淨需求</th>
                    <th>建議動作</th>
                    <th>建議數量</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {mrpResults.map((row, idx) => {
                    const isManufacture = row.action === 'manufacture'
                    const hasNeed = row.net_requirement > 0
                    return (
                      <tr key={idx} style={hasNeed ? { background: isManufacture ? 'rgba(59,130,246,0.04)' : 'rgba(249,115,22,0.04)' } : {}}>
                        <td><code style={{ fontWeight: 600 }}>{row.sku_code}</code></td>
                        <td>{row.sku_name}</td>
                        <td style={{ fontWeight: 600 }}>{row.gross_requirement}</td>
                        <td>{row.on_hand}</td>
                        <td>{row.on_order}</td>
                        <td style={{
                          fontWeight: 700,
                          color: hasNeed ? 'var(--accent-red)' : 'var(--accent-green)',
                        }}>
                          {hasNeed ? row.net_requirement : '充足'}
                        </td>
                        <td>
                          {hasNeed ? (
                            <span className={`badge ${isManufacture ? 'badge-info' : 'badge-warning'}`}>
                              <span className="badge-dot"></span>
                              {isManufacture ? '製造' : '採購'}
                            </span>
                          ) : (
                            <span className="badge badge-success"><span className="badge-dot"></span>無需動作</span>
                          )}
                        </td>
                        <td style={{ fontWeight: hasNeed ? 600 : 400 }}>
                          {hasNeed ? row.suggested_quantity : '—'}
                        </td>
                        <td>
                          {hasNeed && (
                            <div style={{ display: 'flex', gap: 4 }}>
                              {isManufacture ? (
                                <button
                                  className="btn btn-primary"
                                  style={{ padding: '3px 8px', fontSize: 11, background: 'var(--accent-blue)', borderColor: 'var(--accent-blue)' }}
                                  onClick={() => handleCreateMO(row)}
                                  title="產生製造工單"
                                >
                                  <Factory size={11} /> 產生製令
                                </button>
                              ) : (
                                <button
                                  className="btn btn-primary"
                                  style={{ padding: '3px 8px', fontSize: 11, background: 'var(--accent-orange)', borderColor: 'var(--accent-orange)' }}
                                  onClick={() => handleCreatePR(row)}
                                  title="產生採購單"
                                >
                                  <ShoppingCart size={11} /> 產生採購單
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab: Manual MRP Records */}
      {activeTab === 'manual' && (
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">📋</span> MRP 手動記錄</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div className="search-bar">
                <Search className="search-icon" />
                <input type="text" placeholder="搜尋產品名稱..." className="form-input" style={{ paddingLeft: 38 }} value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 手動新增</button>
            </div>
          </div>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr><th style={{ width: 32 }}></th><th>產品名稱</th><th>訂單數量</th><th>零件數</th><th>缺料項目</th><th>狀態</th></tr>
              </thead>
              <tbody>
                {filtered.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無 MRP 資料</td></tr>}
                {filtered.map(r => {
                  const comps = r.components || []
                  const shortages = comps.filter(c => (c.need || 0) > (c.stock || 0))
                  const isExpanded = expandedId === r.id
                  return (
                    <Fragment key={r.id}>
                      <tr onClick={() => toggleExpand(r.id)} style={{ cursor: 'pointer' }}>
                        <td>{isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</td>
                        <td style={{ fontWeight: 600 }}>{r.product_name}</td>
                        <td>{r.order_qty}</td>
                        <td>{comps.length}</td>
                        <td>{shortages.length > 0 ? <span style={{ color: 'var(--accent-red)', fontWeight: 600 }}>{shortages.length} 項</span> : <span style={{ color: 'var(--accent-green)' }}>無</span>}</td>
                        <td>{statusBadge(r.status)}</td>
                      </tr>
                      {isExpanded && comps.length > 0 && (
                        <tr key={`${r.id}-detail`}>
                          <td colSpan={6} style={{ padding: 0, background: 'var(--bg-secondary)' }}>
                            <table className="data-table" style={{ margin: 0, borderRadius: 0 }}>
                              <thead>
                                <tr><th>零件名稱</th><th>需求量</th><th>庫存量</th><th>缺料量</th></tr>
                              </thead>
                              <tbody>
                                {comps.map((c, i) => {
                                  const shortageQty = Math.max(0, (c.need || 0) - (c.stock || 0))
                                  return (
                                    <tr key={i} style={shortageQty > 0 ? { background: 'rgba(239, 68, 68, 0.05)' } : {}}>
                                      <td>{c.name}</td>
                                      <td>{c.need}</td>
                                      <td>{c.stock}</td>
                                      <td style={{ color: shortageQty > 0 ? 'var(--accent-red)' : 'var(--accent-green)', fontWeight: 600 }}>
                                        {shortageQty > 0 ? shortageQty : '充足'}
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
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
      )}

      {/* Manual Add Modal */}
      {showModal && (
        <Modal title="手動新增 MRP 記錄" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
            <Field label="產品名稱 *">
              <input className="form-input" style={{ width: '100%' }} placeholder="產品名稱" value={form.product_name} onChange={e => set('product_name', e.target.value)} />
            </Field>
            <Field label="訂單數量">
              <input className="form-input" type="number" style={{ width: '100%' }} value={form.order_qty} onChange={e => set('order_qty', Number(e.target.value))} />
            </Field>
          </div>
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <strong>零件需求</strong>
              <button type="button" className="btn btn-primary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={addComponent}><Plus size={12} /> 新增零件</button>
            </div>
            {form.components.map((c, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: 8, marginBottom: 8, alignItems: 'end' }}>
                <Field label={i === 0 ? '名稱' : undefined}>
                  <input className="form-input" style={{ width: '100%' }} placeholder="零件名稱" value={c.name} onChange={e => setComponent(i, 'name', e.target.value)} />
                </Field>
                <Field label={i === 0 ? '需求量' : undefined}>
                  <input className="form-input" type="number" style={{ width: '100%' }} value={c.need} onChange={e => setComponent(i, 'need', Number(e.target.value))} />
                </Field>
                <Field label={i === 0 ? '庫存量' : undefined}>
                  <input className="form-input" type="number" style={{ width: '100%' }} value={c.stock} onChange={e => setComponent(i, 'stock', Number(e.target.value))} />
                </Field>
                <button type="button" style={{ background: 'none', border: 'none', color: 'var(--accent-red)', cursor: 'pointer', fontSize: 18, padding: 4 }} onClick={() => removeComponent(i)}>&times;</button>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  )
}
