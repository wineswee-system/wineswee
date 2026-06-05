import { useRef, useState, useEffect } from 'react'
import { X, Plus, Upload, FileText, Image, Download } from 'lucide-react'
import { ModalOverlay } from '../../../components/Modal'
import SearchableSelect, { empOptions } from '../../../components/SearchableSelect'
import { clearError } from '../../../lib/formValidation'
import { toast } from '../../../lib/toast'

const CURRENCY_PREFIX = { TWD: 'NT$' }

const emptyItem = () => ({ name: '', qty: '', unit_price: '', subtotal: 0 })

// 門市下拉 + 其他自填子組件
function StoreSelect({ value, onChange, stores, error }) {
  const storeNames = stores.map(s => s.name)
  // 進場時若 value 不在清單但非空 → 「其他」模式（編輯舊單時觸發）
  const [isOther, setIsOther] = useState(() => !!value && !storeNames.includes(value))

  useEffect(() => {
    if (value && !storeNames.includes(value)) setIsOther(true)
  }, [value, storeNames])

  const selectValue = isOther ? '__OTHER__' : (value || '')

  return (
    <div className={error ? 'field-error' : undefined}>
      <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>
        門市 <span style={{ color: 'var(--accent-red)' }}>*</span>
      </label>
      <select
        value={selectValue}
        onChange={e => {
          const v = e.target.value
          if (v === '__OTHER__') {
            setIsOther(true)
            onChange('')  // 清空等使用者填
          } else {
            setIsOther(false)
            onChange(v)
          }
        }}
        style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}
      >
        <option value="">— 請選擇門市 —</option>
        {storeNames.map(name => <option key={name} value={name}>{name}</option>)}
        <option value="__OTHER__">其他（自填）</option>
      </select>
      {isOther && (
        <input
          type="text"
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          placeholder="請輸入門市名稱"
          autoFocus
          style={{ width: '100%', marginTop: 6, padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}
        />
      )}
      {error && <div className="field-error-msg">⚠ 請選擇或輸入門市</div>}
    </div>
  )
}

/**
 * ExpenseFormModal — create/edit expense request form modal with line items editor.
 *
 * Props:
 *   open         boolean
 *   onClose      () => void
 *   form         object        { employee, account_code, title, description, estimated_amount, store, supplier }
 *   setForm      updater fn
 *   lineItems    array         [{ name, qty, unit_price, subtotal }]
 *   setLineItems updater fn
 *   files        File[]
 *   setFiles     updater fn
 *   employees    array
 *   accounts     array
 *   editingId    number|null   null = new, number = edit/resubmit
 *   isExpense    boolean
 *   setIsExpense (bool) => void
 *   onSubmit     () => void
 *   saving       boolean
 *   errors       object
 *   setErrors    updater fn
 */
export default function ExpenseFormModal({
  open, onClose,
  form, setForm,
  lineItems, setLineItems,
  files, setFiles,
  employees, accounts, stores,
  editingId,
  isExpense, setIsExpense,
  onSubmit, saving, errors, setErrors,
  currency, onCurrencyChange,
}) {
  if (!open) return null

  const csvRef = useRef(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const updateItem = (i, k, v) => setLineItems(items => {
    const n = [...items]
    n[i] = { ...n[i], [k]: v }
    if (k === 'qty' || k === 'unit_price') n[i].subtotal = (Number(n[i].qty) || 0) * (Number(n[i].unit_price) || 0)
    return n
  })

  const lineTotal = lineItems.reduce((s, li) => s + (li.subtotal || 0), 0)
  const fmtAmt = (n) => n != null ? `${CURRENCY_PREFIX[currency] ?? currency} ${Number(n).toLocaleString()}` : '-'

  // 下載 CSV 範本（含標題列 + 2 筆範例，UTF-8 BOM 讓 Excel 認得）
  const handleDownloadTemplate = () => {
    const sample = [
      '品名,數量,單價',
      '辦公椅,5,1800',
      'A4 影印紙,10,120',
    ].join('\r\n')
    const BOM = '﻿'
    const blob = new Blob([BOM + sample], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = '品項明細範本.csv'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const handleCsvImport = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target.result
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
      const start = /^(品名|name)/i.test(lines[0]) ? 1 : 0
      const parsed = lines.slice(start).map(line => {
        const cols = line.split(',')
        const name = (cols[0] || '').trim()
        const qty = Number((cols[1] || '').trim()) || 0
        const unit_price = Number((cols[2] || '').trim()) || 0
        return { name, qty, unit_price, subtotal: qty * unit_price }
      }).filter(li => li.name)
      if (parsed.length === 0) { toast.error('CSV 沒有有效資料'); return }
      setLineItems(prev => {
        const cleaned = prev.filter(li => li.name || li.qty || li.unit_price)
        return [...cleaned, ...parsed]
      })
      toast.success(`已匯入 ${parsed.length} 筆品項`)
    }
    reader.readAsText(file, 'UTF-8')
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div
        style={{ background: 'var(--bg-card)', borderRadius: 12, width: 520, maxHeight: '80vh', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', border: '1px solid var(--border)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-card)' }}>
          <h3 style={{ margin: 0 }}>{editingId ? '✏️ 編輯重送（駁回後修改）' : '新增申請（事項 / 採購 / 預算）'}</h3>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={onClose}><X size={20} /></button>
        </div>

        {/* Body */}
        <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Applicant */}
          <div className={errors.employee ? 'field-error' : undefined}>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>申請人 <span style={{ color: 'var(--accent-red)' }}>*</span></label>
            <SearchableSelect
              value={form.employee}
              onChange={(v) => { set('employee', v || ''); clearError('employee', setErrors) }}
              options={empOptions(employees, { keyBy: 'name' })}
              placeholder="搜尋申請人姓名/部門/門市..."
            />
            {errors.employee && <div className="field-error-msg">⚠ 請選擇申請人</div>}
          </div>

          {/* Expense / Non-expense toggle */}
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>申請類型</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {[{ val: true, label: '費用' }, { val: false, label: '非費用' }].map(opt => (
                <button key={String(opt.val)} type="button"
                  onClick={() => { setIsExpense(opt.val); set('account_code', '') }}
                  style={{
                    flex: 1, padding: '7px 0', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    background: isExpense === opt.val ? 'var(--accent-blue)' : 'var(--bg-main)',
                    color: isExpense === opt.val ? '#fff' : 'var(--text-secondary)',
                    border: isExpense === opt.val ? 'none' : '1px solid var(--border)',
                  }}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Account code — expense only */}
          {isExpense && (
            <div className={errors.account_code ? 'field-error' : undefined}>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>會計科目 <span style={{ color: 'var(--accent-red)' }}>*</span></label>
              <select
                value={form.account_code}
                onChange={e => { set('account_code', e.target.value); clearError('account_code', setErrors) }}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}
              >
                <option value="">請選擇科目</option>
                {Object.entries(
                  accounts.filter(a => a.type === '費用')
                    .reduce((groups, a) => {
                      const group = a.parent_code ? `${a.type} ─ 子科目` : a.type || '其他'
                      if (!groups[group]) groups[group] = []
                      groups[group].push(a)
                      return groups
                    }, {})
                ).map(([group, items]) => (
                  <optgroup key={group} label={`── ${group} ──`}>
                    {items.map(a => (
                      <option key={a.id} value={a.code}>
                        {a.parent_code ? '  └ ' : ''}{a.code}  {a.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {errors.account_code && <div className="field-error-msg">⚠ 請選擇會計科目</div>}
            </div>
          )}

          {/* Title */}
          <div className={errors.title ? 'field-error' : undefined}>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>{isExpense ? '項目名稱' : '主旨'} <span style={{ color: 'var(--accent-red)' }}>*</span></label>
            <input
              type="text"
              value={form.title}
              onChange={e => { set('title', e.target.value); clearError('title', setErrors) }}
              placeholder={isExpense ? '例：採購辦公椅 x5' : '例：派員出席外部研討會'}
              style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}
            />
            {errors.title && <div className="field-error-msg">⚠ 請填寫{isExpense ? '項目名稱' : '主旨'}</div>}
          </div>

          {/* Supplier + Store — expense only */}
          {isExpense && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>供應商/廠商</label>
                <input type="text" value={form.supplier} onChange={e => set('supplier', e.target.value)} placeholder="選填"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }} />
              </div>
              <StoreSelect
                value={form.store || ''}
                onChange={v => { set('store', v); clearError('store', setErrors) }}
                stores={stores || []}
                error={errors.store}
              />
            </div>
          )}

          {/* Currency — expense only */}
          {isExpense && (
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>幣別</label>
              <select
                value={currency || 'TWD'}
                onChange={e => onCurrencyChange(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}
              >
                <option value="TWD">TWD — 台幣</option>
                <option value="USD">USD — 美元</option>
                <option value="JPY">JPY — 日幣</option>
                <option value="CNY">CNY — 人民幣</option>
                <option value="EUR">EUR — 歐元</option>
              </select>
            </div>
          )}

          {/* Line items — expense only */}
          {isExpense && (
            <div className={errors._total ? 'field-error' : undefined}>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>品項明細 <span style={{ color: 'var(--accent-red)' }}>*</span></label>
              {errors._total && <div className="field-error-msg" style={{ marginBottom: 4 }}>⚠ 請至少填一個品項（含數量 &gt; 0）</div>}
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-main)' }}>
                      <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600 }}>品名</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, width: 70 }}>數量</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, width: 90 }}>單價</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, width: 90 }}>小計</th>
                      <th style={{ width: 32 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.map((li, i) => (
                      <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: 4 }}>
                          <input type="text" value={li.name} onChange={e => updateItem(i, 'name', e.target.value)} placeholder="品名"
                            style={{ width: '100%', padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg-main)', fontSize: 12 }} />
                        </td>
                        <td style={{ padding: 4 }}>
                          <input type="number" value={li.qty} onChange={e => updateItem(i, 'qty', e.target.value)} placeholder="0"
                            style={{ width: '100%', padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg-main)', fontSize: 12, textAlign: 'right' }} />
                        </td>
                        <td style={{ padding: 4 }}>
                          <input type="number" value={li.unit_price} onChange={e => updateItem(i, 'unit_price', e.target.value)} placeholder="0"
                            style={{ width: '100%', padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg-main)', fontSize: 12, textAlign: 'right' }} />
                        </td>
                        <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 600, fontFamily: 'monospace' }}>{li.subtotal ? fmtAmt(li.subtotal) : '-'}</td>
                        <td style={{ padding: 4 }}>
                          {lineItems.length > 1 && (
                            <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 0 }}
                              onClick={() => setLineItems(items => items.filter((_, j) => j !== i))}>
                              <X size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid var(--border)' }}>
                      <td colSpan={3} style={{ padding: '6px 8px', display: 'flex', gap: 6, alignItems: 'center' }}>
                        <button className="btn btn-secondary" style={{ fontSize: 11, padding: '2px 8px' }}
                          onClick={() => setLineItems(items => [...items, emptyItem()])}>
                          <Plus size={11} /> 新增品項
                        </button>
                        <button className="btn btn-secondary" style={{ fontSize: 11, padding: '2px 8px' }}
                          onClick={() => csvRef.current?.click()}
                          title="3 欄：品名,數量,單價（小計自動算）— UTF-8 編碼">
                          <Upload size={11} /> 匯入 CSV
                        </button>
                        <button className="btn btn-secondary" style={{ fontSize: 11, padding: '2px 8px', color: 'var(--accent-cyan)' }}
                          onClick={handleDownloadTemplate}
                          title="下載空白 CSV 範本（含標題列 + 2 筆範例）">
                          <Download size={11} /> 下載範本
                        </button>
                        <input ref={csvRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleCsvImport} />
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, fontFamily: 'monospace', fontSize: 14, color: 'var(--accent-blue)' }}>{fmtAmt(lineTotal)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* Description */}
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>說明</label>
            <textarea value={form.description} onChange={e => set('description', e.target.value)} placeholder="用途、規格..."
              style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)', minHeight: 50, resize: 'vertical' }} />
          </div>

          {/* File upload — 3 slots */}
          <div>
            <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 600 }}>附件（訂購單、報價單...）</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {[0, 1, 2].map(idx => {
                const file = files[idx]
                return (
                  <label key={idx} style={{
                    position: 'relative',
                    border: '2px dashed var(--accent-red)',
                    borderRadius: 8, padding: 10, minHeight: 92, textAlign: 'center', cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
                    background: file ? 'var(--accent-red-dim)' : 'transparent',
                    transition: 'background .15s',
                  }}>
                    <input
                      type="file"
                      accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv"
                      style={{ display: 'none' }}
                      onChange={e => {
                        const f = e.target.files?.[0]
                        if (!f) return
                        setFiles(prev => { const next = [...prev]; next[idx] = f; return next })
                        e.target.value = ''
                      }}
                    />
                    {file ? (
                      <>
                        {file.type?.startsWith('image')
                          ? <Image size={22} style={{ color: 'var(--accent-red)' }} />
                          : <FileText size={22} style={{ color: 'var(--accent-red)' }} />}
                        <div style={{ fontSize: 11, color: 'var(--text-primary)', wordBreak: 'break-all', lineHeight: 1.3 }}>{file.name}</div>
                        <button
                          type="button"
                          onClick={e => { e.preventDefault(); e.stopPropagation(); setFiles(prev => prev.filter((_, j) => j !== idx)) }}
                          style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.5)', border: 'none', borderRadius: '50%', color: '#fff', width: 20, height: 20, padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        >
                          <X size={12} />
                        </button>
                      </>
                    ) : (
                      <>
                        <Upload size={22} style={{ color: 'var(--accent-red)', opacity: 0.55 }} />
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>點此上傳</div>
                      </>
                    )}
                  </label>
                )
              })}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5 }}>
              支援格式：JPG / PNG / GIF / WebP / PDF / Excel (XLS、XLSX) / CSV
              <br />
              單檔最大 10MB · 最多 3 個附件
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 24px', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-card)' }}>
          <button className="btn btn-secondary" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={onSubmit} disabled={saving}>{saving ? '提交中...' : '提交申請'}</button>
        </div>
      </div>
    </ModalOverlay>
  )
}
