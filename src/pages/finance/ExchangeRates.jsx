import { useState, useEffect } from 'react'
import { Plus, Search, Trash2, TrendingUp, TrendingDown, RefreshCw } from 'lucide-react'
import { getCurrencies, getExchangeRates, getExchangeRateHistory, saveExchangeRate, deleteExchangeRate, formatCurrency, DEFAULT_RATES } from '../../lib/currency'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'

import { confirm } from '../../lib/confirm'
export default function ExchangeRates() {
  const [currencies, setCurrencies] = useState([])
  const [currentRates, setCurrentRates] = useState([])
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [filterCurrency, setFilterCurrency] = useState('')
  const [historyLoading, setHistoryLoading] = useState(false)

  const [form, setForm] = useState({
    from_currency: 'USD',
    rate: '',
    effective_date: new Date().toISOString().split('T')[0],
  })
  const [formError, setFormError] = useState('')

  const loadData = async () => {
    try {
      const today = new Date().toISOString().split('T')[0]
      const [currData, ratesData] = await Promise.all([
        getCurrencies(),
        getExchangeRates(today),
      ])
      setCurrencies(currData)
      setCurrentRates(ratesData)
    } catch (err) {
      console.error('Failed to load exchange rate data:', err)
      setError('資料載入失敗')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  const loadHistory = async (currencyCode) => {
    setFilterCurrency(currencyCode)
    setHistoryLoading(true)
    try {
      const data = await getExchangeRateHistory(currencyCode || undefined)
      setHistory(data)
    } catch (err) {
      console.error('Failed to load history:', err)
    } finally {
      setHistoryLoading(false)
    }
  }

  useEffect(() => { loadHistory('') }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    setFormError('')
    if (!form.from_currency || !form.rate || !form.effective_date) {
      setFormError('請填寫所有欄位')
      return
    }
    const rateNum = parseFloat(form.rate)
    if (isNaN(rateNum) || rateNum <= 0) {
      setFormError('匯率必須為正數')
      return
    }
    try {
      await saveExchangeRate(form.from_currency, rateNum, form.effective_date)
      setShowModal(false)
      setForm({ from_currency: 'USD', rate: '', effective_date: new Date().toISOString().split('T')[0] })
      setFormError('')
      // Reload data
      await Promise.all([loadData(), loadHistory(filterCurrency)])
    } catch (err) {
      console.error('Failed to save rate:', err)
      setFormError('儲存失敗：' + (err.message || '未知錯誤'))
    }
  }

  const handleDelete = async (id) => {
    if (!(await confirm({ message: '確定要刪除此匯率紀錄？' }))) return
    try {
      await deleteExchangeRate(id)
      await Promise.all([loadData(), loadHistory(filterCurrency)])
    } catch (err) {
      console.error('Failed to delete rate:', err)
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return (
    <div style={{ padding: 32, color: 'var(--accent-red)', textAlign: 'center' }}>
      <h3>{error}</h3>
      <button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>重新載入</button>
    </div>
  )

  // Build current rates display — merge DB rates with defaults for currencies without DB rates
  const foreignCurrencies = currencies.filter(c => !c.is_base)
  const rateMap = {}
  currentRates.forEach(r => { rateMap[r.from_currency] = r })

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon">💱</span> 匯率管理 Exchange Rates</h2>
            <p>管理外幣匯率，支援多幣別交易換算</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => { loadData(); loadHistory(filterCurrency) }}>
              <RefreshCw size={14} /> 重新整理
            </button>
            <button className="btn btn-primary" onClick={() => setShowModal(true)}>
              <Plus size={14} /> 新增匯率
            </button>
          </div>
        </div>
      </div>

      {/* Current Rates Cards */}
      <div className="stat-grid" style={{ gridTemplateColumns: `repeat(${Math.min(foreignCurrencies.length, 6)}, 1fr)` }}>
        {foreignCurrencies.map(c => {
          const dbRate = rateMap[c.code]
          const rate = dbRate ? Number(dbRate.rate) : DEFAULT_RATES[c.code]
          const dateLabel = dbRate ? dbRate.effective_date : '預設'
          return (
            <div className="stat-card" key={c.code} style={{ '--card-accent': 'var(--accent-cyan)', '--card-accent-dim': 'var(--accent-cyan-dim)', cursor: 'pointer' }}
              onClick={() => loadHistory(c.code)}>
              <div className="stat-card-label">{c.symbol} {c.code} {c.name}</div>
              <div className="stat-card-value" style={{ fontSize: 20 }}>
                {rate ? rate.toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : '--'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                1 {c.code} = {rate ? formatCurrency(rate, 'NTD') : '--'} | {dateLabel}
              </div>
            </div>
          )
        })}
      </div>

      {/* Current Rates Table */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📊</span> 目前匯率</div>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>幣別</th>
                <th>名稱</th>
                <th>匯率 (對NTD)</th>
                <th>生效日期</th>
                <th>來源</th>
                <th>範例換算</th>
              </tr>
            </thead>
            <tbody>
              {foreignCurrencies.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無幣別資料，請先在 Supabase 執行 schema</td></tr>
              )}
              {foreignCurrencies.map(c => {
                const dbRate = rateMap[c.code]
                const rate = dbRate ? Number(dbRate.rate) : DEFAULT_RATES[c.code]
                return (
                  <tr key={c.code}>
                    <td style={{ fontWeight: 600 }}>{c.symbol} {c.code}</td>
                    <td>{c.name}</td>
                    <td style={{ fontWeight: 600, color: 'var(--accent-cyan)' }}>
                      {rate ? rate.toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : '--'}
                    </td>
                    <td>{dbRate ? dbRate.effective_date : <span style={{ color: 'var(--text-muted)' }}>預設匯率</span>}</td>
                    <td>
                      <span className={`badge ${dbRate ? 'badge-info' : 'badge-warning'}`}>
                        <span className="badge-dot"></span>
                        {dbRate ? dbRate.source || 'manual' : '預設'}
                      </span>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {rate ? `1,000 ${c.code} = ${formatCurrency(1000 * rate, 'NTD')}` : '--'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Historical Rates */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><span className="card-title-icon">📈</span> 歷史匯率</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select className="form-input" style={{ width: 160 }} value={filterCurrency} onChange={e => loadHistory(e.target.value)}>
              <option value="">全部幣別</option>
              {foreignCurrencies.map(c => (
                <option key={c.code} value={c.code}>{c.code} - {c.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="data-table-wrapper">
          {historyLoading ? (
            <div style={{ textAlign: 'center', padding: 24 }}>載入中...</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>幣別</th>
                  <th>匯率 (對NTD)</th>
                  <th>生效日期</th>
                  <th>來源</th>
                  <th>建立時間</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {history.length === 0 && (
                  <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>尚無歷史匯率紀錄</td></tr>
                )}
                {history.map((r, i) => {
                  const prevRate = history[i + 1]?.from_currency === r.from_currency ? Number(history[i + 1].rate) : null
                  const currRate = Number(r.rate)
                  const trend = prevRate ? (currRate > prevRate ? 'up' : currRate < prevRate ? 'down' : 'flat') : null
                  return (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 600 }}>{r.from_currency}</td>
                      <td style={{ fontWeight: 600 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {currRate.toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                          {trend === 'up' && <TrendingUp size={12} style={{ color: 'var(--accent-red)' }} />}
                          {trend === 'down' && <TrendingDown size={12} style={{ color: 'var(--accent-green)' }} />}
                        </span>
                      </td>
                      <td>{r.effective_date}</td>
                      <td>
                        <span className="badge badge-info"><span className="badge-dot"></span>{r.source || 'manual'}</span>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {r.created_at ? new Date(r.created_at).toLocaleString('zh-TW') : '-'}
                      </td>
                      <td>
                        <button
                          onClick={() => handleDelete(r.id)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 4 }}
                          title="刪除"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Add Rate Modal */}
      {showModal && (
        <Modal title="新增匯率" onClose={() => { setShowModal(false); setFormError('') }} onSubmit={handleSubmit}>
          {formError && (
            <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--accent-red-dim)', color: 'var(--accent-red)', fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
              {formError}
            </div>
          )}
          <Field label="幣別 *">
            <select className="form-input" style={{ width: '100%' }} value={form.from_currency} onChange={e => set('from_currency', e.target.value)}>
              {foreignCurrencies.map(c => (
                <option key={c.code} value={c.code}>{c.code} - {c.name}</option>
              ))}
              {foreignCurrencies.length === 0 && (
                <>
                  <option value="USD">USD - 美元</option>
                  <option value="EUR">EUR - 歐元</option>
                  <option value="JPY">JPY - 日圓</option>
                  <option value="CNY">CNY - 人民幣</option>
                  <option value="GBP">GBP - 英鎊</option>
                  <option value="HKD">HKD - 港幣</option>
                </>
              )}
            </select>
          </Field>
          <Field label="匯率 (1 外幣 = ? NTD) *">
            <input
              className="form-input"
              type="number"
              step="0.0001"
              min="0"
              style={{ width: '100%' }}
              placeholder="例：31.50"
              value={form.rate}
              onChange={e => set('rate', e.target.value)}
            />
            {form.rate && form.from_currency && (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                1 {form.from_currency} = {formatCurrency(parseFloat(form.rate) || 0, 'NTD')}
              </div>
            )}
          </Field>
          <Field label="生效日期 *">
            <input
              className="form-input"
              type="date"
              style={{ width: '100%' }}
              value={form.effective_date}
              onChange={e => set('effective_date', e.target.value)}
            />
          </Field>
        </Modal>
      )}
    </div>
  )
}
