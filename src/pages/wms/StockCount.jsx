import { useState, useEffect } from 'react'
import { Plus, Search, ClipboardList, Calendar, AlertTriangle, CheckCircle, ScanBarcode, Trash2 } from 'lucide-react'
import { getStockCounts, createStockCount } from '../../lib/db'
import { supabase } from '../../lib/supabase'
import { calculateWeightedAverage } from '../../lib/inventoryCosting'
import { playBeep } from '../../lib/barcodeScanner'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import BarcodeInput from '../../components/BarcodeInput'
import { getEventBus } from '../../lib/events/index.js'

import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
const CYCLE_FREQUENCIES = [
  { value: 'daily', label: '每日' },
  { value: 'weekly', label: '每週' },
  { value: 'monthly', label: '每月' },
  { value: 'quarterly', label: '每季' },
]

const TOLERANCE_PERCENT = 5 // 5% variance tolerance

export default function StockCount() {
  const [counts, setCounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [showScheduleModal, setShowScheduleModal] = useState(false)
  const [showVarianceModal, setShowVarianceModal] = useState(false)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('counts')
  const [form, setForm] = useState({ count_date: '', warehouse: '', counter: '', total_items: '', discrepancies: '0', status: '盤點中', notes: '' })
  const [scheduleForm, setScheduleForm] = useState({ warehouse: '', frequency: 'monthly', zone: '', next_date: '', counter: '' })
  const [schedules, setSchedules] = useState([
    { id: 1, warehouse: '主倉庫', frequency: 'monthly', zone: 'A區', next_date: '2026-05-01', counter: '王大明', status: '啟用' },
    { id: 2, warehouse: '主倉庫', frequency: 'weekly', zone: 'B區 (高價值)', next_date: '2026-04-12', counter: '李小華', status: '啟用' },
    { id: 3, warehouse: '副倉庫', frequency: 'quarterly', zone: '全區', next_date: '2026-07-01', counter: '張三', status: '暫停' },
  ])

  // Variance analysis state
  const [varianceItems, setVarianceItems] = useState([])
  const [selectedCount, setSelectedCount] = useState(null)

  // 條碼盤點清單 state
  const [scanSheet, setScanSheet] = useState([]) // [{ sku_code, sku_name, count }]

  useEffect(() => {
    getStockCounts().then(({ data }) => { setCounts(data || []) }).catch(err => {
      console.error('Failed to load data:', err)
      setError('資料載入失敗，請重新整理頁面')
    }).finally(() => { setLoading(false) })
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setSch = (k, v) => setScheduleForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.warehouse || !form.counter) return
    try {
      const { data, error } = await createStockCount({
        ...form,
        total_items: parseInt(form.total_items) || 0,
        discrepancies: parseInt(form.discrepancies) || 0,
      })
      if (error) throw error
      if (data) {
        setCounts(prev => [...prev, data])
        setShowModal(false)
        setForm({ count_date: '', warehouse: '', counter: '', total_items: '', discrepancies: '0', status: '盤點中', notes: '' })
      }
    } catch (err) {
      console.error('Operation failed:', err)
      toast.error('操作失敗：' + (err.message || '未知錯誤'))
    }
  }

  const handleScheduleSubmit = () => {
    if (!scheduleForm.warehouse || !scheduleForm.next_date) return
    const newSchedule = {
      id: Date.now(),
      ...scheduleForm,
      status: '啟用',
    }
    setSchedules(prev => [...prev, newSchedule])
    setShowScheduleModal(false)
    setScheduleForm({ warehouse: '', frequency: 'monthly', zone: '', next_date: '', counter: '' })
  }

  const toggleScheduleStatus = (id) => {
    setSchedules(prev => prev.map(s =>
      s.id === id ? { ...s, status: s.status === '啟用' ? '暫停' : '啟用' } : s
    ))
  }

  // Open variance analysis for a count — load real stock data
  const openVariance = async (count) => {
    setSelectedCount(count)
    try {
      // Load real SKUs and stock levels for this warehouse
      const [{ data: skus }, { data: stocks }] = await Promise.all([
        supabase.from('skus').select('*'),
        supabase.from('stock_levels').select('*').eq('warehouse', count.warehouse)
      ])
      if (skus && stocks) {
        const items = stocks.map(s => {
          const sku = skus.find(k => k.id === s.sku_id) || {}
          return {
            sku: sku.code || `SKU-${s.sku_id}`,
            name: sku.name || '未知品項',
            system_qty: s.quantity || 0,
            counted_qty: s.quantity || 0, // Default to system qty — user edits during count
            unit_cost: sku.unit_cost || 0,
            editable: true,
          }
        })
        setVarianceItems(items)
      } else {
        setVarianceItems([])
      }
    } catch (err) {
      console.error('Failed to load stock data:', err)
      setVarianceItems([])
    }
    setShowVarianceModal(true)
  }

  // Update counted quantity for a variance item
  const updateCountedQty = (index, qty) => {
    setVarianceItems(prev => prev.map((v, i) => i === index ? { ...v, counted_qty: parseInt(qty) || 0 } : v))
  }

  // Create adjustment from variance
  const handleVarianceAdjust = async (item) => {
    const diff = item.counted_qty - item.system_qty
    if (diff === 0) return
    try {
      await supabase.from('inventory_adjustments').insert({
        sku_code: item.sku,
        sku_name: item.name,
        quantity: diff,
        reason: `盤點調整 (系統: ${item.system_qty}, 實盤: ${item.counted_qty})`,
        operator: selectedCount?.counter || '系統',
      })
      const bus = getEventBus()
      await bus.publish('wms.stock.adjusted', {
        sku_code: item.sku,
        adjustment: diff,
        reason: '盤點差異調整',
        warehouse: selectedCount?.warehouse || '',
        count_id: String(selectedCount?.id || ''),
      })
      toast.error(`已建立 ${item.sku} 庫存調整: ${diff > 0 ? '+' : ''}${diff}`)
    } catch (err) {
      toast.error('調整失敗: ' + (err.message || '未知錯誤'))
    }
  }

  // Adjust all variances at once
  const handleAdjustAll = async () => {
    const itemsWithVariance = varianceItems.filter(v => v.counted_qty !== v.system_qty)
    if (itemsWithVariance.length === 0) { toast.error('無差異需要調整'); return }
    if (!(await confirm({ message: `確定要調整 ${itemsWithVariance.length} 個品項的庫存差異？` }))) return

    for (const item of itemsWithVariance) {
      const diff = item.counted_qty - item.system_qty
      await supabase.from('inventory_adjustments').insert({
        sku_code: item.sku,
        sku_name: item.name,
        quantity: diff,
        reason: `盤點調整 (系統: ${item.system_qty}, 實盤: ${item.counted_qty})`,
        operator: selectedCount?.counter || '系統',
      })
    }
    const bus = getEventBus()
    for (const item of itemsWithVariance) {
      const diff = item.counted_qty - item.system_qty
      await bus.publish('wms.stock.adjusted', {
        sku_code: item.sku,
        adjustment: diff,
        reason: '盤點批次調整',
        warehouse: selectedCount?.warehouse || '',
        count_id: String(selectedCount?.id || ''),
      })
    }
    toast.error(`已建立 ${itemsWithVariance.length} 筆庫存調整`)
    setShowVarianceModal(false)
  }

  // 條碼盤點掃描
  const handleCountScan = async (code, lookupResult) => {
    // 查 SKU 名稱
    let skuName = ''
    if (lookupResult && lookupResult.type === 'sku') {
      skuName = lookupResult.data.name || ''
    }

    setScanSheet(prev => {
      const idx = prev.findIndex(s => s.sku_code.toLowerCase() === code.toLowerCase())
      if (idx >= 0) {
        // 已在清單中，+1
        const updated = [...prev]
        updated[idx] = { ...updated[idx], count: updated[idx].count + 1 }
        return updated
      }
      // 新增到清單
      return [...prev, { sku_code: code, sku_name: skuName || code, count: 1 }]
    })
    playBeep(true)
  }

  const removeScanItem = (skuCode) => {
    setScanSheet(prev => prev.filter(s => s.sku_code !== skuCode))
  }

  const clearScanSheet = () => {
    setScanSheet([])
  }

  if (loading) return <LoadingSpinner />
  if (error) return <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}><h3>{error}</h3><button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button></div>

  const filtered = counts.filter(c =>
    search === '' || c.warehouse?.includes(search) || c.counter?.includes(search)
  )

  const inProgress = filtered.filter(c => c.status === '盤點中').length
  const completed = filtered.filter(c => c.status === '已完成').length
  const totalDiscrepancies = filtered.reduce((sum, c) => sum + (c.discrepancies || 0), 0)
  const activeSchedules = schedules.filter(s => s.status === '啟用').length

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">📋</span> 盤點作業</h2>
            <p>庫存盤點、差異分析與循環盤點排程</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => setShowScheduleModal(true)}><Calendar size={14} /> 排程盤點</button>
            <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14} /> 新增盤點</button>
          </div>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-orange)', '--card-accent-dim': 'var(--accent-orange-dim)' }}>
          <div className="stat-card-label">盤點中</div>
          <div className="stat-card-value">{inProgress}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
          <div className="stat-card-label">已完成</div>
          <div className="stat-card-value">{completed}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-red)', '--card-accent-dim': 'var(--accent-red-dim)' }}>
          <div className="stat-card-label">總差異數</div>
          <div className="stat-card-value">{totalDiscrepancies}</div>
        </div>
        <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
          <div className="stat-card-label">啟用排程</div>
          <div className="stat-card-value">{activeSchedules}</div>
        </div>
      </div>

      {/* 條碼盤點掃描 */}
      <BarcodeInput
        onScan={handleCountScan}
        placeholder="掃描條碼加入盤點清單..."
        autoLookup={true}
      />

      {/* 掃描盤點清單 */}
      {scanSheet.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <div className="card-title">
              <span className="card-title-icon"><ScanBarcode size={16} /></span> 掃描盤點清單
              <span className="badge badge-cyan" style={{ marginLeft: 8 }}>{scanSheet.length} 項 / {scanSheet.reduce((s, i) => s + i.count, 0)} 次</span>
            </div>
            <button className="btn btn-secondary" style={{ fontSize: 11 }} onClick={clearScanSheet}>
              <Trash2 size={12} /> 清空
            </button>
          </div>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead><tr><th>品號</th><th>品名</th><th>掃描次數</th><th>操作</th></tr></thead>
              <tbody>
                {scanSheet.map(item => (
                  <tr key={item.sku_code}>
                    <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{item.sku_code}</td>
                    <td>{item.sku_name}</td>
                    <td style={{ fontWeight: 700, fontSize: 16 }}>{item.count}</td>
                    <td>
                      <button className="btn btn-secondary" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => removeScanItem(item.sku_code)}>
                        <Trash2 size={11} /> 移除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: 'var(--bg-card)', borderRadius: 10, padding: 4, border: '1px solid var(--border-subtle)', width: 'fit-content' }}>
        {[['counts', '📋 盤點記錄'], ['schedules', '📅 循環排程']].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{ padding: '6px 16px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, background: tab === key ? 'var(--accent-cyan)' : 'transparent', color: tab === key ? '#fff' : 'var(--text-muted)' }}>{label}</button>
        ))}
      </div>

      {tab === 'counts' && (
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon"><ClipboardList size={16} /></span> 盤點記錄</div>
            <div className="search-bar">
              <Search className="search-icon" />
              <input type="text" placeholder="搜尋盤點..." className="form-input" style={{ paddingLeft: 38 }} value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr><th>盤點日期</th><th>倉庫</th><th>盤點人</th><th>總品項</th><th>差異數</th><th>狀態</th><th>備註</th><th>操作</th></tr>
              </thead>
              <tbody>
                {filtered.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無盤點記錄</td></tr>}
                {filtered.map(c => (
                  <tr key={c.id}>
                    <td>{c.count_date}</td>
                    <td style={{ fontWeight: 600 }}>{c.warehouse}</td>
                    <td>{c.counter}</td>
                    <td>{(c.total_items || 0).toLocaleString()}</td>
                    <td style={{ color: c.discrepancies > 0 ? 'var(--accent-red)' : undefined, fontWeight: c.discrepancies > 0 ? 600 : undefined }}>
                      {c.discrepancies || 0}
                    </td>
                    <td>
                      <span className={`badge ${c.status === '已完成' ? 'badge-success' : c.status === '盤點中' ? 'badge-warning' : 'badge-info'}`}>
                        <span className="badge-dot"></span>{c.status}
                      </span>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.notes}</td>
                    <td>
                      <button className="btn btn-secondary" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => openVariance(c)}>
                        <AlertTriangle size={11} /> 差異分析
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'schedules' && (
        <div className="card">
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon"><Calendar size={16} /></span> 循環盤點排程</div>
            <button className="btn btn-primary" onClick={() => setShowScheduleModal(true)} style={{ fontSize: 12 }}><Plus size={12} /> 新增排程</button>
          </div>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr><th>倉庫</th><th>區域</th><th>頻率</th><th>下次盤點</th><th>盤點人</th><th>狀態</th><th>操作</th></tr>
              </thead>
              <tbody>
                {schedules.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無排程</td></tr>}
                {schedules.map(s => {
                  const daysUntil = Math.round((new Date(s.next_date) - new Date()) / (1000 * 60 * 60 * 24))
                  return (
                    <tr key={s.id}>
                      <td style={{ fontWeight: 600 }}>{s.warehouse}</td>
                      <td>{s.zone || '全區'}</td>
                      <td><span className="badge badge-cyan">{CYCLE_FREQUENCIES.find(f => f.value === s.frequency)?.label || s.frequency}</span></td>
                      <td>
                        <span style={{ color: daysUntil <= 3 ? 'var(--accent-red)' : daysUntil <= 7 ? 'var(--accent-orange)' : 'var(--text-primary)', fontWeight: daysUntil <= 7 ? 600 : 400 }}>
                          {s.next_date} {daysUntil >= 0 ? `(${daysUntil}天後)` : `(已逾期${Math.abs(daysUntil)}天)`}
                        </span>
                      </td>
                      <td>{s.counter}</td>
                      <td>
                        <span className={`badge ${s.status === '啟用' ? 'badge-success' : 'badge-neutral'}`}>
                          <span className="badge-dot"></span>{s.status}
                        </span>
                      </td>
                      <td>
                        <button className="btn btn-secondary" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => toggleScheduleStatus(s.id)}>
                          {s.status === '啟用' ? '暫停' : '啟用'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* New Count Modal */}
      {showModal && (
        <Modal title="新增盤點" onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="盤點日期">
              <input className="form-input" type="date" style={{ width: '100%' }} value={form.count_date} onChange={e => set('count_date', e.target.value)} />
            </Field>
            <Field label="倉庫 *">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="主倉庫" value={form.warehouse} onChange={e => set('warehouse', e.target.value)} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="盤點人 *">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="王大明" value={form.counter} onChange={e => set('counter', e.target.value)} />
            </Field>
            <Field label="狀態">
              <select className="form-input" style={{ width: '100%' }} value={form.status} onChange={e => set('status', e.target.value)}>
                <option>盤點中</option>
                <option>已完成</option>
              </select>
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="總品項">
              <input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.total_items} onChange={e => set('total_items', e.target.value)} />
            </Field>
            <Field label="差異數">
              <input className="form-input" type="number" style={{ width: '100%' }} placeholder="0" value={form.discrepancies} onChange={e => set('discrepancies', e.target.value)} />
            </Field>
          </div>
          <Field label="備註">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="備註說明" value={form.notes} onChange={e => set('notes', e.target.value)} />
          </Field>
        </Modal>
      )}

      {/* Schedule Modal */}
      {showScheduleModal && (
        <Modal title="新增循環盤點排程" onClose={() => setShowScheduleModal(false)} onSubmit={handleScheduleSubmit} submitLabel="建立排程">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="倉庫 *">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="主倉庫" value={scheduleForm.warehouse} onChange={e => setSch('warehouse', e.target.value)} />
            </Field>
            <Field label="區域">
              <input className="form-input" type="text" style={{ width: '100%' }} placeholder="A區 / 全區" value={scheduleForm.zone} onChange={e => setSch('zone', e.target.value)} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="盤點頻率">
              <select className="form-input" style={{ width: '100%' }} value={scheduleForm.frequency} onChange={e => setSch('frequency', e.target.value)}>
                {CYCLE_FREQUENCIES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </Field>
            <Field label="下次盤點日 *">
              <input className="form-input" type="date" style={{ width: '100%' }} value={scheduleForm.next_date} onChange={e => setSch('next_date', e.target.value)} />
            </Field>
          </div>
          <Field label="盤點人">
            <input className="form-input" type="text" style={{ width: '100%' }} placeholder="指派盤點人" value={scheduleForm.counter} onChange={e => setSch('counter', e.target.value)} />
          </Field>
        </Modal>
      )}

      {/* Variance Analysis Modal */}
      {showVarianceModal && (
        <Modal title={`差異分析 - ${selectedCount?.warehouse || ''} (${selectedCount?.count_date || ''})`} onClose={() => setShowVarianceModal(false)} onSubmit={handleAdjustAll} submitLabel="全部調整" width={800}>
          <div style={{ marginBottom: 12, padding: 10, background: 'var(--bg-main)', borderRadius: 8, fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>容差範圍: <strong>{TOLERANCE_PERCENT}%</strong></span>
            <span>
              差異品項: <strong style={{ color: 'var(--accent-red)' }}>{varianceItems.filter(v => v.counted_qty !== v.system_qty).length}</strong> / {varianceItems.length}
            </span>
          </div>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>品號</th>
                  <th>品名</th>
                  <th>系統數量</th>
                  <th>實盤數量</th>
                  <th>差異</th>
                  <th>差異%</th>
                  <th>$ 差異</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {varianceItems.map((v, i) => {
                  const diff = v.counted_qty - v.system_qty
                  const pct = v.system_qty > 0 ? ((diff / v.system_qty) * 100) : 0
                  const absPct = Math.abs(pct)
                  const withinTolerance = absPct <= TOLERANCE_PERCENT
                  const dollarVariance = diff * v.unit_cost

                  return (
                    <tr key={i}>
                      <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{v.sku}</td>
                      <td>{v.name}</td>
                      <td>{v.system_qty}</td>
                      <td>
                        <input type="number" className="form-input" style={{ width: 80, padding: '2px 6px', fontWeight: 600, textAlign: 'center' }} value={v.counted_qty} onChange={e => updateCountedQty(i, e.target.value)} />
                      </td>
                      <td style={{
                        fontWeight: 700,
                        color: diff === 0 ? 'var(--text-muted)' : withinTolerance ? 'var(--accent-green)' : 'var(--accent-red)'
                      }}>
                        {diff === 0 ? '-' : (diff > 0 ? '+' : '') + diff}
                      </td>
                      <td>
                        <span style={{
                          padding: '2px 6px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                          background: diff === 0 ? 'var(--bg-main)' : withinTolerance ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                          color: diff === 0 ? 'var(--text-muted)' : withinTolerance ? 'var(--accent-green)' : 'var(--accent-red)',
                        }}>
                          {pct === 0 ? '0%' : (pct > 0 ? '+' : '') + pct.toFixed(1) + '%'}
                        </span>
                      </td>
                      <td style={{
                        fontFamily: 'monospace', fontWeight: 600,
                        color: dollarVariance === 0 ? 'var(--text-muted)' : dollarVariance > 0 ? 'var(--accent-green)' : 'var(--accent-red)'
                      }}>
                        {dollarVariance === 0 ? '-' : (dollarVariance > 0 ? '+$' : '-$') + Math.abs(dollarVariance).toLocaleString()}
                      </td>
                      <td>
                        {diff !== 0 ? (
                          <button className="btn btn-secondary" style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => handleVarianceAdjust(v)}>
                            <CheckCircle size={10} /> 調整
                          </button>
                        ) : (
                          <span style={{ fontSize: 11, color: 'var(--accent-green)' }}>相符</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 12, padding: 10, background: 'var(--bg-main)', borderRadius: 8, display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span>
              總 $ 差異: <strong style={{
                color: varianceItems.reduce((s, v) => s + (v.counted_qty - v.system_qty) * v.unit_cost, 0) >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'
              }}>
                ${Math.abs(varianceItems.reduce((s, v) => s + (v.counted_qty - v.system_qty) * v.unit_cost, 0)).toLocaleString()}
              </strong>
            </span>
            <span>
              超出容差: <strong style={{ color: 'var(--accent-red)' }}>
                {varianceItems.filter(v => {
                  const pct = v.system_qty > 0 ? Math.abs((v.counted_qty - v.system_qty) / v.system_qty * 100) : 0
                  return pct > TOLERANCE_PERCENT
                }).length}
              </strong> 項
            </span>
          </div>
        </Modal>
      )}
    </div>
  )
}
