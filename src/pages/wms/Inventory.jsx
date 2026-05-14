import { useState, useEffect, useRef } from 'react'
import { Plus, Search, ArrowRightLeft, AlertTriangle, ScanBarcode, Package, History, ArrowUpDown, DollarSign } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { getInventoryAdjustments, getWarehouses } from '../../lib/db'
import { getEventBus } from '../../lib/events/index.js'
import { calculateFIFO, calculateWeightedAverage, valuateInventory } from '../../lib/inventoryCosting'
import { playBeep } from '../../lib/barcodeScanner'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import BarcodeInput from '../../components/BarcodeInput'

import { toast } from '../../lib/toast'
const COSTING_METHODS = [
  { value: 'FIFO', label: 'FIFO 先進先出' },
  { value: 'WEIGHTED_AVG', label: '加權平均' },
  { value: 'MOVING_AVG', label: '移動平均' },
]

export default function Inventory() {
  const { profile } = useAuth()
  const [stocks, setStocks] = useState([])
  const [adjustments, setAdjustments] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('stock')
  const [showAdjModal, setShowAdjModal] = useState(false)
  const [showTransferModal, setShowTransferModal] = useState(false)
  const [adjForm, setAdjForm] = useState({ sku_code: '', sku_name: '', bin_code: '', warehouse: '', quantity: '', reason: '', operator: '' })
  const [transferForm, setTransferForm] = useState({ sku_code: '', from_bin: '', to_bin: '', quantity: '' })

  // Inventory valuation state
  const [costingMethod, setCostingMethod] = useState('WEIGHTED_AVG')
  const [valuationData, setValuationData] = useState([])
  const [showValuation, setShowValuation] = useState(false)

  // Barcode scanning state
  const [barcodeInput, setBarcodeInput] = useState('')
  const [scannedItem, setScannedItem] = useState(null)
  const barcodeRef = useRef(null)

  const loadInventory = async (orgId) => {
    const [s, a, w] = await Promise.all([
      supabase.from('stock_levels').select('*, skus(code, name), bins(code, zone)').order('id'),
      getInventoryAdjustments(orgId),
      getWarehouses(orgId),
    ])
    setStocks(s.data || [])
    setAdjustments(a.data || [])
    setWarehouses(w.data || [])
  }

  useEffect(() => {
    const orgId = profile?.organization_id
    if (!orgId) { setLoading(false); return }
    loadInventory(orgId).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => {
      setLoading(false)
    })
  }, [profile?.organization_id])

  const setA = (k, v) => setAdjForm(f => ({ ...f, [k]: v }))
  const setT = (k, v) => setTransferForm(f => ({ ...f, [k]: v }))

  const handleAdjust = async () => {
    if (!adjForm.sku_code || !adjForm.quantity || !adjForm.reason) return
    if (!profile?.organization_id) { toast.error('身份未載入，請重新登入'); return }
    // ★ 用 atomic RPC：原子更新 stock_levels + 寫 audit
    //   舊路徑只 INSERT audit 不動 stock_levels → 帳面跟實際對不上
    //   warehouse 必填（從表單選或 scan 帶入）
    let warehouseName = adjForm.warehouse
    if (!warehouseName) {
      // fallback: 從 scannedItem 或既有 stock 找該 SKU 的倉庫
      const stockHit = stocks.find(s => s.skus?.code === adjForm.sku_code)
      const wh = warehouses.find(w => w.id === stockHit?.warehouse_id)
      warehouseName = wh?.name || ''
    }
    if (!warehouseName) {
      toast.warning('請選擇倉庫（atomic 更新 stock_levels 必須）')
      return
    }
    const { data: result, error: rpcErr } = await supabase.rpc('apply_inventory_adjustment_atomic', {
      p_sku_code:       adjForm.sku_code,
      p_warehouse:      warehouseName,
      p_qty_delta:      Number(adjForm.quantity),
      p_reason:         adjForm.reason,
      p_operator:       adjForm.operator || profile?.name || '系統',
      p_bin_code:       adjForm.bin_code || null,
      p_organization_id: profile.organization_id,
    })
    if (rpcErr || !result?.ok) {
      const msgMap = {
        INSUFFICIENT_STOCK: `庫存不足（現有 ${result?.have}，欲扣 ${result?.requested_decrease}）`,
        STOCK_NOT_FOUND_FOR_DECREASE: '此倉庫無此 SKU 的庫存紀錄，無法做負調整',
        WAREHOUSE_REQUIRED: '請選擇倉庫',
        QTY_DELTA_ZERO: '調整數量不可為 0',
      }
      toast.error(msgMap[result?.error] || ('調整失敗：' + (rpcErr?.message || result?.error || '未知')))
      return
    }
    await loadInventory(profile.organization_id)
    setShowAdjModal(false)
    setAdjForm({ sku_code: '', sku_name: '', bin_code: '', warehouse: '', quantity: '', reason: '', operator: '' })
  }

  const handleTransfer = async () => {
    if (!transferForm.sku_code || !transferForm.from_bin || !transferForm.to_bin) return
    if (!profile?.organization_id) { toast.error('身份未載入，請重新登入'); return }
    // ⚠️ 注意：這裡的 transfer 是「儲位 (bin) 級」，不是 stock_levels 的 warehouse 級
    // 真正改 stock_levels 數量還是另一條路徑。本處只寫 audit 紀錄 + 補 org_id。
    // 為避免「源 insert 成功但目標 insert 失敗」的半成功，包成 try 並補償回滾
    const orgId = profile.organization_id
    const { data: from, error: fromErr } = await supabase.from('inventory_adjustments').insert({
      sku_code: transferForm.sku_code, bin_code: transferForm.from_bin,
      quantity: -Number(transferForm.quantity),
      reason: `庫內移倉至 ${transferForm.to_bin}`, operator: '系統',
      organization_id: orgId,
    }).select().single()
    if (fromErr) { toast.error('移倉失敗（源）：' + fromErr.message); return }
    const { error: toErr } = await supabase.from('inventory_adjustments').insert({
      sku_code: transferForm.sku_code, bin_code: transferForm.to_bin,
      quantity: Number(transferForm.quantity),
      reason: `從 ${transferForm.from_bin} 移入`, operator: '系統',
      organization_id: orgId,
    })
    if (toErr) {
      // 補償：刪掉剛剛源的紀錄，避免帳面消失
      await supabase.from('inventory_adjustments').delete().eq('id', from.id)
      toast.error('移倉失敗（目標），已自動回滾源紀錄：' + toErr.message)
      return
    }
    await loadInventory(orgId)
    setShowTransferModal(false)
    setTransferForm({ sku_code: '', from_bin: '', to_bin: '', quantity: '' })
  }

  // Inventory valuation calculation
  const handleValuate = () => {
    // Build stock levels array from current stocks
    const stockLevels = stocks.map(s => ({
      sku: s.skus?.code || '',
      qty: s.quantity || 0,
    }))

    // Build mock transactions from adjustments (IN for positive, OUT for negative)
    const txnsBySku = {}
    adjustments.forEach(a => {
      const sku = a.sku_code
      if (!txnsBySku[sku]) txnsBySku[sku] = []
      txnsBySku[sku].push({
        type: a.quantity >= 0 ? 'IN' : 'OUT',
        qty: Math.abs(a.quantity),
        unit_cost: a.unit_cost || 100, // fallback unit cost
        date: a.created_at,
      })
    })

    const result = valuateInventory(stockLevels, costingMethod, txnsBySku)
    setValuationData(result)
    setShowValuation(true)
  }

  // Barcode scan handler (legacy manual input)
  const handleBarcodeScan = (value) => {
    setBarcodeInput(value)
    if (!value) {
      setScannedItem(null)
      return
    }
    const found = stocks.find(s =>
      s.skus?.code?.toLowerCase() === value.toLowerCase() ||
      s.skus?.name?.includes(value) ||
      s.skus?.code?.includes(value)
    )
    setScannedItem(found || null)
  }

  const handleBarcodeKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleBarcodeScan(barcodeInput)
    }
  }

  // 新版條碼掃描 handler — 使用 BarcodeInput 元件
  const handleBarcodeComponentScan = (code, lookupResult) => {
    // 在庫存中尋找所有匹配的品項（跨倉庫）
    const matchedItems = stocks.filter(s =>
      s.skus?.code?.toLowerCase() === code.toLowerCase()
    )
    if (matchedItems.length > 0) {
      setSearch(code) // 篩選庫存表顯示該 SKU
      setScannedItem(matchedItems[0])
      setBarcodeInput(code)
      setTab('stock')
      playBeep(true)
    } else {
      setScannedItem(null)
      playBeep(false)
    }
  }

  // Quick actions from barcode scan
  const handleQuickAdjust = () => {
    if (!scannedItem) return
    setAdjForm({
      sku_code: scannedItem.skus?.code || '',
      sku_name: scannedItem.skus?.name || '',
      bin_code: scannedItem.bins?.code || '',
      quantity: '',
      reason: '',
      operator: ''
    })
    setShowAdjModal(true)
  }

  const handleQuickTransfer = () => {
    if (!scannedItem) return
    setTransferForm({
      sku_code: scannedItem.skus?.code || '',
      from_bin: scannedItem.bins?.code || '',
      to_bin: '',
      quantity: String(scannedItem.quantity || 0)
    })
    setShowTransferModal(true)
  }

  const [whFilter, setWhFilter] = useState('')

  const filtered = stocks.filter(s =>
    (whFilter === '' || s.warehouse_id === Number(whFilter)) &&
    (s.skus?.code?.includes(search) || s.skus?.name?.includes(search) || s.bins?.code?.includes(search))
  )

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const totalQty = stocks.reduce((s, i) => s + (i.quantity || 0), 0)
  const expiringCount = stocks.filter(s => {
    if (!s.expiry_date) return false
    const diff = (new Date(s.expiry_date) - new Date()) / (1000 * 60 * 60 * 24)
    return diff <= 30 && diff >= 0
  }).length
  const totalValuation = valuationData.reduce((s, v) => s + (v.total_value || 0), 0)

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div><h2><span className="header-icon">📊</span> 庫存管理</h2><p>即時庫存查詢與調整</p></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => setShowTransferModal(true)}><ArrowRightLeft size={14} /> 庫內移倉</button>
            <button className="btn btn-secondary" onClick={async () => {
              const lowItems = stocks.filter(s => (s.quantity || 0) <= (s.min_qty || 10))
              if (lowItems.length === 0) { toast.error('目前沒有低庫存品項'); return }
              const items = lowItems.map(s => ({ name: s.sku_name, qty: (s.min_qty || 10) * 2, unit: s.unit, price: s.unit_cost || 0 }))
              getEventBus().publish('sales.order.created', {
                order_id: `LOW-STOCK-${Date.now()}`,
                items,
                total_amount: items.reduce((sum, i) => sum + (i.price * i.qty), 0),
              }, { source: 'Inventory.jsx' })
              toast.success(`已發送低庫存採購事件（${lowItems.length} 項缺料）`)
            }}><AlertTriangle size={14} /> 低庫存檢查</button>
            <button className="btn btn-primary" onClick={() => setShowAdjModal(true)}><Plus size={14} /> 庫存調整</button>
          </div>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">庫存筆數</div><div className="stat-card-value">{stocks.length}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">總在庫數量</div><div className="stat-card-value">{totalQty.toLocaleString()}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">30天內效期</div><div className="stat-card-value">{expiringCount}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
          <div className="stat-card-label">調整紀錄</div><div className="stat-card-value">{adjustments.length}</div>
        </div>
      </div>

      {/* 條碼掃描 — 支援 USB/藍牙掃描器 + 相機 */}
      <BarcodeInput
        onScan={handleBarcodeComponentScan}
        placeholder="掃描條碼快速查詢庫存..."
        autoLookup={false}
      />

      {/* 掃描結果快速操作 */}
      {scannedItem && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ padding: '12px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div>
                <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 15 }}>{scannedItem.skus?.code}</span>
                <span style={{ marginLeft: 8, color: 'var(--text-secondary)' }}>{scannedItem.skus?.name}</span>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="badge badge-neutral">{scannedItem.bins?.code || '-'}</span>
                <span style={{ fontWeight: 700, fontSize: 16 }}>數量: {scannedItem.quantity}</span>
              </div>
            </div>
            {/* 顯示該 SKU 在所有倉庫的庫存 */}
            {(() => {
              const allMatched = stocks.filter(s => s.skus?.code === scannedItem.skus?.code)
              if (allMatched.length > 1) {
                return (
                  <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
                    跨倉庫庫存：{allMatched.map((s, i) => (
                      <span key={s.id} style={{ marginRight: 12 }}>
                        <span className="badge badge-neutral" style={{ marginRight: 4 }}>{s.bins?.code || '未指定'}</span>
                        <strong>{s.quantity}</strong>
                      </span>
                    ))}
                    &nbsp;| 合計: <strong>{allMatched.reduce((sum, s) => sum + (s.quantity || 0), 0)}</strong>
                  </div>
                )
              }
              return null
            })()}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary" onClick={handleQuickAdjust} style={{ fontSize: 12 }}>
                <ArrowUpDown size={12} /> 調整庫存
              </button>
              <button className="btn btn-secondary" onClick={() => { setSearch(scannedItem.skus?.code || ''); setTab('adjustments') }} style={{ fontSize: 12 }}>
                <History size={12} /> 查看紀錄
              </button>
              <button className="btn btn-secondary" onClick={handleQuickTransfer} style={{ fontSize: 12 }}>
                <ArrowRightLeft size={12} /> 移倉
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: 'var(--bg-card)', borderRadius: 10, padding: 4, border: '1px solid var(--border-subtle)', width: 'fit-content' }}>
        {[['stock', '📦 庫存總覽'], ['adjustments', '📝 調整紀錄'], ['valuation', '💰 庫存評價']].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{ padding: '6px 16px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, background: tab === key ? 'var(--accent-cyan)' : 'transparent', color: tab === key ? '#fff' : 'var(--text-muted)' }}>{label}</button>
        ))}
      </div>

      {tab === 'stock' && (
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">📦</span> 庫存清單</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <select className="form-input" style={{ fontSize: 12 }} value={whFilter} onChange={e => setWhFilter(e.target.value)}>
                <option value="">全部倉庫</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              <div className="search-bar"><Search className="search-icon" /><input type="text" placeholder="品號/品名/儲位..." className="form-input" style={{ paddingLeft: 38 }} value={search} onChange={e => setSearch(e.target.value)} /></div>
            </div>
          </div>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead><tr><th>品號</th><th>品名</th><th>儲位</th><th>區域</th><th>數量</th><th>效期</th></tr></thead>
              <tbody>
                {filtered.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無庫存資料</td></tr>}
                {filtered.map(s => {
                  const daysLeft = s.expiry_date ? Math.round((new Date(s.expiry_date) - new Date()) / (1000 * 60 * 60 * 24)) : null
                  return (
                    <tr key={s.id}>
                      <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{s.skus?.code}</td>
                      <td>{s.skus?.name}</td>
                      <td><span className="badge badge-neutral">{s.bins?.code || '-'}</span></td>
                      <td>{s.bins?.zone || '-'}</td>
                      <td style={{ fontWeight: 700, color: s.quantity <= 0 ? 'var(--accent-red)' : 'var(--text-primary)' }}>{s.quantity}</td>
                      <td>
                        {s.expiry_date ? (
                          <span style={{ fontSize: 12, color: daysLeft <= 7 ? 'var(--accent-red)' : daysLeft <= 30 ? 'var(--accent-orange)' : 'var(--text-secondary)' }}>
                            {s.expiry_date} {daysLeft !== null && `(${daysLeft}天)`}
                          </span>
                        ) : '-'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'adjustments' && (
        <div className="card">
          <div className="card-header"><div className="card-title"><span className="card-title-icon">📝</span> 庫存調整紀錄</div></div>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead><tr><th>時間</th><th>品號</th><th>品名</th><th>儲位</th><th>調整數量</th><th>原因</th><th>操作人</th></tr></thead>
              <tbody>
                {adjustments.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無調整紀錄</td></tr>}
                {adjustments.map(a => (
                  <tr key={a.id}>
                    <td style={{ fontSize: 12 }}>{new Date(a.created_at).toLocaleString('zh-TW')}</td>
                    <td style={{ fontFamily: 'monospace' }}>{a.sku_code}</td>
                    <td>{a.sku_name}</td>
                    <td>{a.bin_code}</td>
                    <td style={{ fontWeight: 700, color: a.quantity > 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                      {a.quantity > 0 ? '+' : ''}{a.quantity}
                    </td>
                    <td style={{ fontSize: 12 }}>{a.reason}</td>
                    <td>{a.operator}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'valuation' && (
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon"><DollarSign size={16} /></span> 庫存評價</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select className="form-input" style={{ fontSize: 12 }} value={costingMethod} onChange={e => setCostingMethod(e.target.value)}>
                {COSTING_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
              <button className="btn btn-primary" onClick={handleValuate} style={{ fontSize: 12 }}>
                <DollarSign size={12} /> 計算評價
              </button>
            </div>
          </div>

          {showValuation && valuationData.length > 0 && (
            <>
              <div style={{ padding: '12px 16px', background: 'var(--bg-main)', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  成本方法: <span className="badge badge-cyan">{COSTING_METHODS.find(m => m.value === costingMethod)?.label}</span>
                </div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>
                  總庫存價值: <span style={{ color: 'var(--accent-green)' }}>${totalValuation.toLocaleString()}</span>
                </div>
              </div>
              <div className="data-table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr><th>品號</th><th>數量</th><th>單位成本</th><th>總價值</th><th>成本方法</th></tr>
                  </thead>
                  <tbody>
                    {valuationData.map((v, i) => (
                      <tr key={i}>
                        <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{v.sku}</td>
                        <td>{v.qty}</td>
                        <td style={{ fontFamily: 'monospace' }}>${v.unit_cost.toLocaleString()}</td>
                        <td style={{ fontWeight: 700, fontFamily: 'monospace' }}>${v.total_value.toLocaleString()}</td>
                        <td><span className="badge badge-info">{v.method}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {showValuation && valuationData.length === 0 && (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
              無庫存資料可供評價
            </div>
          )}

          {!showValuation && (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
              選擇成本方法後按「計算評價」查看庫存評價結果
            </div>
          )}
        </div>
      )}

      {showAdjModal && (
        <Modal title="庫存調整" onClose={() => setShowAdjModal(false)} onSubmit={handleAdjust}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="品號" required><input className="form-input" type="text" style={{ width: '100%' }} placeholder="SKU-001" value={adjForm.sku_code} onChange={e => setA('sku_code', e.target.value)} /></Field>
            <Field label="品名"><input className="form-input" type="text" style={{ width: '100%' }} placeholder="商品名稱" value={adjForm.sku_name} onChange={e => setA('sku_name', e.target.value)} /></Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="倉庫" required>
              <select className="form-input" style={{ width: '100%' }} value={adjForm.warehouse} onChange={e => setA('warehouse', e.target.value)}>
                <option value="">— 自動偵測或選擇 —</option>
                {warehouses.map(w => <option key={w.id} value={w.name}>{w.name}</option>)}
              </select>
            </Field>
            <Field label="儲位"><input className="form-input" type="text" style={{ width: '100%' }} placeholder="A-01-01（選填，僅 audit 用）" value={adjForm.bin_code} onChange={e => setA('bin_code', e.target.value)} /></Field>
          </div>
          <Field label="調整數量" required><input className="form-input" type="number" style={{ width: '100%' }} placeholder="負數=減少，正數=增加" value={adjForm.quantity} onChange={e => setA('quantity', e.target.value)} /></Field>
          <Field label="原因" required><input className="form-input" type="text" style={{ width: '100%' }} placeholder="損壞/遺失/盤點調整..." value={adjForm.reason} onChange={e => setA('reason', e.target.value)} /></Field>
          <Field label="操作人"><input className="form-input" type="text" style={{ width: '100%' }} placeholder="姓名" value={adjForm.operator} onChange={e => setA('operator', e.target.value)} /></Field>
        </Modal>
      )}

      {showTransferModal && (
        <Modal title="庫內移倉" onClose={() => setShowTransferModal(false)} onSubmit={handleTransfer} submitLabel="確認移倉">
          <Field label="品號" required><input className="form-input" type="text" style={{ width: '100%' }} placeholder="SKU-001" value={transferForm.sku_code} onChange={e => setT('sku_code', e.target.value)} /></Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="來源儲位" required><input className="form-input" type="text" style={{ width: '100%' }} placeholder="A-01-01" value={transferForm.from_bin} onChange={e => setT('from_bin', e.target.value)} /></Field>
            <Field label="目標儲位" required><input className="form-input" type="text" style={{ width: '100%' }} placeholder="B-02-03" value={transferForm.to_bin} onChange={e => setT('to_bin', e.target.value)} /></Field>
          </div>
          <Field label="移倉數量" required><input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={transferForm.quantity} onChange={e => setT('quantity', e.target.value)} /></Field>
        </Modal>
      )}
    </div>
  )
}
