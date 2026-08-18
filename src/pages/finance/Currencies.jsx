import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, Coins } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import Modal, { Field } from '../../components/Modal'
import { toast } from '../../lib/toast'
import { confirm } from '../../lib/confirm'
import { getExchangeRates, saveExchangeRate } from '../../lib/currency'

const emptyForm = { code: '', name: '', symbol: '', decimals: '0', sort_order: '99', is_active: true, rate: '' }

// 本位幣(台幣)不需匯率
const isBaseCode = (code) => code === 'TWD' || code === 'NTD'

export default function Currencies() {
  const { hasPermission } = useAuth()
  const canEdit = hasPermission('finance.edit')
  const [rows, setRows] = useState([])
  const [rateMap, setRateMap] = useState({})   // { CODE: number }
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)   // null=新增, 物件=編輯
  const [form, setForm] = useState(emptyForm)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const load = async () => {
    setLoading(true)
    const today = new Date().toISOString().split('T')[0]
    const [{ data: curr }, rates] = await Promise.all([
      supabase.from('currencies').select('*').order('sort_order').order('code'),
      getExchangeRates(today).catch(() => []),
    ])
    const map = {}
    ;(rates || []).forEach(r => { map[r.from_currency] = Number(r.rate) })
    setRows(curr || [])
    setRateMap(map)
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const openAdd = () => { setEditing(null); setForm(emptyForm); setShowModal(true) }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      code: r.code, name: r.name, symbol: r.symbol,
      decimals: String(r.decimals ?? 0), sort_order: String(r.sort_order ?? 99),
      is_active: r.is_active,
      rate: rateMap[r.code] != null ? String(rateMap[r.code]) : '',
    })
    setShowModal(true)
  }

  const handleSubmit = async () => {
    const code = form.code.trim().toUpperCase()
    if (!code || !form.name.trim() || !form.symbol.trim()) { toast.warning('代碼 / 名稱 / 符號為必填'); return }
    const payload = {
      name: form.name.trim(),
      symbol: form.symbol.trim(),
      decimals: Number(form.decimals) || 0,
      sort_order: Number(form.sort_order) || 99,
      is_active: !!form.is_active,
    }
    // 匯率(外幣才有;有填且與現值不同才寫新的一筆 exchange_rates)
    const wantsRate = !isBaseCode(code) && String(form.rate).trim() !== ''
    const rateNum = Number(form.rate)
    if (wantsRate && (isNaN(rateNum) || rateNum <= 0)) { toast.warning('匯率必須為正數'); return }

    try {
      if (editing) {
        const { error } = await supabase.from('currencies').update(payload).eq('code', editing.code)
        if (error) throw error
      } else {
        const { error } = await supabase.from('currencies').insert({ code, ...payload })
        if (error) throw error
      }
      if (wantsRate && rateNum !== rateMap[code]) {
        const today = new Date().toISOString().split('T')[0]
        await saveExchangeRate(code, rateNum, today)
      }
      toast.success('已儲存')
      setShowModal(false)
      load()
    } catch (err) {
      toast.error('儲存失敗：' + (err.message || '未知錯誤'))
    }
  }

  const toggleActive = async (r) => {
    const { error } = await supabase.from('currencies').update({ is_active: !r.is_active }).eq('code', r.code)
    if (error) { toast.error('更新失敗：' + error.message); return }
    setRows(prev => prev.map(x => x.code === r.code ? { ...x, is_active: !x.is_active } : x))
  }

  const handleDelete = async (r) => {
    if (!(await confirm({ message: `確定刪除幣別「${r.code} ${r.name}」？\n若已被費用申請使用會刪不掉(請改用停用)。` }))) return
    const { error } = await supabase.from('currencies').delete().eq('code', r.code)
    if (error) { toast.error('刪不掉(可能已被使用),請改用「停用」：' + error.message); return }
    toast.success('已刪除')
    load()
  }

  if (loading) return <LoadingSpinner />

  const fmtRate = (v) => Number(v).toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 4 })

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><span className="header-icon"><Coins size={20} /></span> 幣別管理</h2>
            <p>新增 / 停用幣別、設定對台幣匯率 — 全系統(費用申請下拉、分流換匯、LINE 卡片)自動帶出</p>
          </div>
          {canEdit && (
            <button className="btn btn-primary" onClick={openAdd}><Plus size={14} /> 新增幣別</button>
          )}
        </div>
      </div>

      <div className="card">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>代碼</th><th>名稱</th><th>符號</th><th>匯率 (1 外幣 = ? 台幣)</th><th>小數位</th><th>排序</th><th>狀態</th><th>操作</th></tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>尚無幣別</td></tr>}
              {rows.map(r => {
                const base = isBaseCode(r.code)
                const rate = rateMap[r.code]
                return (
                  <tr key={r.code} style={{ opacity: r.is_active ? 1 : 0.5 }}>
                    <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{r.code}</td>
                    <td>{r.name}</td>
                    <td>{r.symbol}</td>
                    <td>
                      {base ? (
                        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>本位幣</span>
                      ) : rate != null ? (
                        <span style={{ fontWeight: 700, color: 'var(--accent-cyan)' }}>{fmtRate(rate)}</span>
                      ) : (
                        <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 700,
                          background: 'var(--accent-orange-dim)', color: 'var(--accent-orange)' }}>未設匯率</span>
                      )}
                    </td>
                    <td>{r.decimals}</td>
                    <td>{r.sort_order}</td>
                    <td>
                      <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700,
                        background: r.is_active ? 'var(--accent-green-dim)' : 'var(--bg-tertiary)',
                        color: r.is_active ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                        {r.is_active ? '啟用' : '停用'}
                      </span>
                    </td>
                    <td>
                      {canEdit && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-sm btn-secondary" onClick={() => openEdit(r)} title="編輯"><Pencil size={12} /></button>
                          <button className="btn btn-sm btn-secondary" onClick={() => toggleActive(r)}>{r.is_active ? '停用' : '啟用'}</button>
                          <button className="btn btn-sm btn-secondary" style={{ color: 'var(--accent-red)' }} onClick={() => handleDelete(r)} title="刪除"><Trash2 size={12} /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <Modal title={editing ? `編輯幣別 — ${editing.code}` : '新增幣別'} onClose={() => setShowModal(false)} onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="代碼 (ISO，如 USD)" required>
              <input className="form-input" style={{ width: '100%', textTransform: 'uppercase' }} maxLength={5}
                value={form.code} disabled={!!editing}
                onChange={e => set('code', e.target.value.toUpperCase())} placeholder="USD" />
            </Field>
            <Field label="名稱" required>
              <input className="form-input" style={{ width: '100%' }} value={form.name} onChange={e => set('name', e.target.value)} placeholder="美元" />
            </Field>
            <Field label="符號" required>
              <input className="form-input" style={{ width: '100%' }} value={form.symbol} onChange={e => set('symbol', e.target.value)} placeholder="US$" />
            </Field>
            <Field label="小數位 (TWD/JPY=0，其餘=2)">
              <input className="form-input" type="number" min={0} max={4} style={{ width: '100%' }} value={form.decimals} onChange={e => set('decimals', e.target.value)} />
            </Field>
            <Field label="排序">
              <input className="form-input" type="number" style={{ width: '100%' }} value={form.sort_order} onChange={e => set('sort_order', e.target.value)} />
            </Field>
            <Field label="狀態">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <input type="checkbox" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} /> 啟用
              </label>
            </Field>
            {!isBaseCode(form.code.trim().toUpperCase()) && (
              <Field label={`匯率 (1 ${form.code.trim().toUpperCase() || '外幣'} = ? 台幣)`}>
                <input className="form-input" type="number" step="0.0001" min="0" style={{ width: '100%' }}
                  value={form.rate} onChange={e => set('rate', e.target.value)} placeholder="例：31.50" />
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  用於費用申請分流換算台幣。改了會存成一筆新匯率(保留歷史)；沒改就留空。
                </div>
              </Field>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
