import { useState, useEffect } from 'react'
import { Calculator, Download, Save } from 'lucide-react'
import { getInventoryValuation, saveValuationSnapshot } from '../../lib/inventoryCosting'
import LoadingSpinner from '../../components/LoadingSpinner'

const COSTING_METHODS = [
  { value: 'fifo', label: 'FIFO 先進先出' },
  { value: 'weighted_avg', label: '加權平均' },
]

export default function Valuation() {
  const [costingMethod, setCostingMethod] = useState('weighted_avg')
  const [valuationDate, setValuationDate] = useState(() => new Date().toISOString().split('T')[0])
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const loadValuation = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await getInventoryValuation(costingMethod)
      setData(result)
      setLoaded(true)
    } catch (err) {
      console.error('估價計算失敗:', err)
      setError('估價計算失敗，請確認成本層資料是否存在')
    } finally {
      setLoading(false)
    }
  }

  const handleSaveSnapshot = async () => {
    if (data.length === 0) return
    setSaving(true)
    try {
      await saveValuationSnapshot(data, valuationDate)
      alert('快照已儲存')
    } catch (err) {
      console.error('儲存快照失敗:', err)
      alert('儲存快照失敗: ' + (err.message || '未知錯誤'))
    } finally {
      setSaving(false)
    }
  }

  const handleExportPDF = () => {
    // Build a printable HTML table and trigger print dialog
    const totalQty = data.reduce((s, v) => s + v.total_quantity, 0)
    const totalValue = data.reduce((s, v) => s + v.total_value, 0)
    const methodLabel = COSTING_METHODS.find(m => m.value === costingMethod)?.label || costingMethod

    const rows = data.map(v =>
      `<tr>
        <td>${v.sku_code}</td>
        <td>${v.sku_name}</td>
        <td>${v.unit}</td>
        <td style="text-align:right">${v.total_quantity.toLocaleString()}</td>
        <td style="text-align:right">$${v.unit_cost.toLocaleString()}</td>
        <td style="text-align:right">$${v.total_value.toLocaleString()}</td>
      </tr>`
    ).join('')

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>庫存估價報表</title>
      <style>body{font-family:sans-serif;padding:24px}table{width:100%;border-collapse:collapse;margin-top:16px}
      th,td{border:1px solid #ccc;padding:8px 12px;font-size:13px}th{background:#f5f5f5;text-align:left}
      .total{font-weight:700;background:#fafafa}h1{font-size:20px}p{color:#666;font-size:13px}</style></head>
      <body><h1>庫存估價報表 Inventory Valuation</h1>
      <p>估價日期: ${valuationDate} | 成本方法: ${methodLabel}</p>
      <table><thead><tr><th>品號</th><th>品名</th><th>單位</th><th style="text-align:right">庫存數量</th><th style="text-align:right">單位成本</th><th style="text-align:right">庫存價值</th></tr></thead>
      <tbody>${rows}
      <tr class="total"><td colspan="3">合計</td><td style="text-align:right">${totalQty.toLocaleString()}</td><td></td><td style="text-align:right">$${totalValue.toLocaleString()}</td></tr>
      </tbody></table></body></html>`

    const w = window.open('', '_blank')
    w.document.write(html)
    w.document.close()
    w.print()
  }

  const totalQty = data.reduce((s, v) => s + v.total_quantity, 0)
  const totalValue = data.reduce((s, v) => s + v.total_value, 0)

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon"><Calculator size={20} /></span> 庫存估價 Inventory Valuation</h2>
            <p>依成本層計算 FIFO / 加權平均庫存價值</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={handleExportPDF} disabled={data.length === 0}>
              <Download size={14} /> 匯出 PDF
            </button>
            <button className="btn btn-primary" onClick={handleSaveSnapshot} disabled={data.length === 0 || saving}>
              <Save size={14} /> {saving ? '儲存中...' : '儲存快照'}
            </button>
          </div>
        </div>
      </div>

      {/* 控制列 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ padding: '12px 16px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>成本方法</label>
            <div style={{ display: 'flex', gap: 4, background: 'var(--bg-main)', borderRadius: 8, padding: 3, border: '1px solid var(--border-subtle)' }}>
              {COSTING_METHODS.map(m => (
                <button
                  key={m.value}
                  onClick={() => setCostingMethod(m.value)}
                  style={{
                    padding: '5px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
                    fontSize: 12, fontWeight: 500,
                    background: costingMethod === m.value ? 'var(--accent-cyan)' : 'transparent',
                    color: costingMethod === m.value ? '#fff' : 'var(--text-muted)',
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>估價日期</label>
            <input
              type="date"
              className="form-input"
              style={{ fontSize: 12 }}
              value={valuationDate}
              onChange={e => setValuationDate(e.target.value)}
            />
          </div>
          <button className="btn btn-primary" onClick={loadValuation} disabled={loading} style={{ marginLeft: 'auto' }}>
            <Calculator size={14} /> {loading ? '計算中...' : '計算估價'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: 16, marginBottom: 16, background: 'var(--accent-red-dim)', border: '1px solid var(--accent-red)', borderRadius: 8, color: 'var(--accent-red)', fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading && <LoadingSpinner />}

      {!loading && loaded && (
        <>
          {/* 統計卡片 */}
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 16 }}>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)' }}>
              <div className="stat-card-label">品項數</div>
              <div className="stat-card-value">{data.length}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-green)', '--card-accent-dim': 'var(--accent-green-dim)' }}>
              <div className="stat-card-label">總庫存數量</div>
              <div className="stat-card-value">{totalQty.toLocaleString()}</div>
            </div>
            <div className="stat-card" style={{ '--card-accent': 'var(--accent-purple)', '--card-accent-dim': 'var(--accent-purple-dim)' }}>
              <div className="stat-card-label">總庫存價值</div>
              <div className="stat-card-value">${totalValue.toLocaleString()}</div>
            </div>
          </div>

          {/* 估價表 */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">
                <span className="card-title-icon"><Calculator size={16} /></span>
                估價明細 ({COSTING_METHODS.find(m => m.value === costingMethod)?.label})
              </div>
            </div>
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>品號</th>
                    <th>品名</th>
                    <th>單位</th>
                    <th style={{ textAlign: 'right' }}>庫存數量</th>
                    <th style={{ textAlign: 'right' }}>單位成本</th>
                    <th style={{ textAlign: 'right' }}>庫存價值</th>
                  </tr>
                </thead>
                <tbody>
                  {data.length === 0 && (
                    <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>
                      尚無成本層資料，請先透過進貨管理建立成本層
                    </td></tr>
                  )}
                  {data.map(v => (
                    <tr key={v.sku_id}>
                      <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{v.sku_code}</td>
                      <td>{v.sku_name}</td>
                      <td>{v.unit || '-'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{v.total_quantity.toLocaleString()}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>${v.unit_cost.toLocaleString()}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, fontFamily: 'monospace', color: 'var(--accent-green)' }}>${v.total_value.toLocaleString()}</td>
                    </tr>
                  ))}
                  {data.length > 0 && (
                    <tr style={{ background: 'var(--bg-main)', fontWeight: 700 }}>
                      <td colSpan={3} style={{ textAlign: 'right' }}>合計</td>
                      <td style={{ textAlign: 'right' }}>{totalQty.toLocaleString()}</td>
                      <td></td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: 'var(--accent-green)', fontSize: 15 }}>${totalValue.toLocaleString()}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {!loading && !loaded && (
        <div className="card" style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
          <Calculator size={40} style={{ opacity: 0.3, marginBottom: 12 }} />
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>選擇成本方法後按「計算估價」</div>
          <div style={{ fontSize: 13 }}>系統將依據成本層資料計算各品項庫存價值</div>
        </div>
      )}
    </div>
  )
}
