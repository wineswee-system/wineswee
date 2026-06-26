import { useRef, useState, useEffect, useCallback } from 'react'
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
        申請單位 <span style={{ color: 'var(--accent-red)' }}>*</span>
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
        <option value="">— 請選擇申請單位 —</option>
        {storeNames.map(name => <option key={name} value={name}>{name}</option>)}
        <option value="__OTHER__">其他（自填）</option>
      </select>
      {isOther && (
        <input
          type="text"
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          placeholder="請輸入申請單位名稱"
          autoFocus
          style={{ width: '100%', marginTop: 6, padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}
        />
      )}
      {error && <div className="field-error-msg">⚠ 請選擇或輸入申請單位</div>}
    </div>
  )
}

// 核銷(驗收)單位 — 級聯:選部門→部門主管;選營運部→再選門市→店長。
// 解析出的核銷人即時預覽(實際核銷人由 DB trigger 在「已核准」時依 dept/store 重算寫入)。
function SettleUnitField({ departments, stores, employees, deptId, storeId, onDept, onStore, errorDept, errorStore }) {
  const dept = departments.find(d => String(d.id) === String(deptId))
  const isOps = dept?.name === '營運部'
  const isHQ = storeId === '__HQ__'  // 營運部→總部:落回營運部經理(營運部 dept manager)
  const store = stores.find(s => String(s.id) === String(storeId))
  // 營運部選總部 → 營運部經理(dept.manager_id);選門市 → 店長(store.manager_id);其他部門 → 部門主管
  const managerId = isOps ? (isHQ ? dept?.manager_id : store?.manager_id) : dept?.manager_id
  const managerName = managerId ? (employees.find(e => String(e.id) === String(managerId))?.name) : null
  const selPicked = isOps ? !!storeId : !!deptId

  return (
    <div className={(errorDept || errorStore) ? 'field-error' : undefined}>
      <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>
        核銷(驗收)單位 <span style={{ color: 'var(--accent-red)' }}>*</span>
      </label>
      <select
        value={deptId || ''}
        onChange={e => onDept(e.target.value)}
        style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}
      >
        <option value="">— 請選擇部門 —</option>
        {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      {isOps && (
        <select
          value={storeId || ''}
          onChange={e => onStore(e.target.value)}
          style={{ width: '100%', marginTop: 6, padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}
        >
          <option value="">— 請選擇門市 —</option>
          <option value="__HQ__">總部（營運部經理）</option>
          {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
      {/* 核銷人預覽 */}
      {selPicked && (
        managerName
          ? <div style={{ fontSize: 12, color: 'var(--accent-cyan)', marginTop: 6 }}>→ 核銷人:{managerName}</div>
          : <div style={{ fontSize: 12, color: 'var(--accent-orange)', marginTop: 6 }}>⚠ 此單位尚未設定主管，將無人收到核銷通知</div>
      )}
      {(errorDept || errorStore) && <div className="field-error-msg">⚠ 請選擇核銷(驗收)單位{isOps ? '的門市' : ''}</div>}
    </div>
  )
}

// 驗收單位 — 多選門市（checkbox dropdown）
function AcceptanceUnitsField({ stores, selected = [], onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const toggle = useCallback((name) => {
    onChange(selected.includes(name) ? selected.filter(n => n !== name) : [...selected, name])
  }, [selected, onChange])
  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>驗收單位</label>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', padding: '8px 12px', borderRadius: 6, textAlign: 'left', cursor: 'pointer',
          border: '1px solid var(--border)', background: 'var(--bg-main)', fontSize: 13,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}
      >
        <span style={{ color: selected.length ? 'var(--text-primary)' : 'var(--text-muted)' }}>
          {selected.length ? selected.join('、') : '選填，可多選'}
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
          background: 'var(--bg-card)', border: '1px solid var(--border-medium)',
          borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          maxHeight: 220, overflowY: 'auto', padding: '4px 0',
        }}>
          {stores.length === 0
            ? <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)' }}>無門市資料</div>
            : stores.map(s => (
              <label key={s.id} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 12px', cursor: 'pointer', fontSize: 13,
                background: selected.includes(s.name) ? 'var(--accent-cyan-dim)' : 'transparent',
              }}>
                <input type="checkbox" checked={selected.includes(s.name)} onChange={() => toggle(s.name)} style={{ accentColor: 'var(--accent-cyan)' }} />
                <span style={{ color: selected.includes(s.name) ? 'var(--accent-cyan)' : 'var(--text-primary)' }}>{s.name}</span>
              </label>
            ))
          }
        </div>
      )}
      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
          {selected.map(name => (
            <span key={name} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600,
              background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)',
            }}>
              {name}
              <button type="button" onClick={() => toggle(name)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--accent-cyan)', padding: 0, lineHeight: 1, fontSize: 13 }}>×</button>
            </span>
          ))}
        </div>
      )}
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
  carriedAtts = [], onRemoveCarried,
  employees, accounts, stores,
  editingId,
  isExpense, setIsExpense,
  onSubmit, saving, errors, setErrors,
  currency, currencies = [], onCurrencyChange,
  departments = [],
  docType = 'expense',  // 'order' = 叫貨/採購 → 一律費用，不顯示「非費用」切換
}) {
  const isOrder = docType === 'order'
  const csvRef = useRef(null)

  // 早退放在所有 hook 之後，避免條件式 hook（open 切換時 hook 數量改變會炸）
  if (!open) return null
  // 幣別符號:優先用 currencies 表(資料驅動),fallback 靜態/代碼
  const curSym = Object.fromEntries((currencies || []).map(c => [c.code, c.symbol]))

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const updateItem = (i, k, v) => setLineItems(items => {
    const n = [...items]
    n[i] = { ...n[i], [k]: v }
    if (k === 'qty' || k === 'unit_price') n[i].subtotal = (Number(n[i].qty) || 0) * (Number(n[i].unit_price) || 0)
    return n
  })

  const lineTotal = lineItems.reduce((s, li) => s + (li.subtotal || 0), 0)
  const fmtAmt = (n) => n != null ? `${curSym[currency] ?? CURRENCY_PREFIX[currency] ?? currency} ${Number(n).toLocaleString()}` : '-'

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
        className="modal-shell modal-md"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-shell-header">
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{editingId ? '✏️ 編輯重送（駁回後修改）' : (isOrder ? '🛒 新增叫貨申請（採購）' : '新增申請（事項 / 採購 / 預算）')}</h3>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', flexShrink: 0 }} onClick={onClose}><X size={20} /></button>
        </div>

        {/* Body */}
        <div className="modal-shell-body">

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

          {/* Expense / Non-expense toggle — 叫貨/採購一律費用，不顯示切換 */}
          {!isOrder && (
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
          )}

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

          {/* Supplier + Store — expense only.
              用 auto-fit minmax — 寬夠就兩欄、不夠就自動降一欄，不需要 media query */}
          {isExpense && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
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

          {/* Currency + 核銷(驗收)單位 — expense only.
              auto-fit minmax：寬夠兩欄(幣別 | 核銷單位)、窄則降一欄 */}
          {isExpense && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, alignItems: 'start' }}>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>幣別</label>
                <select
                  value={currency || 'TWD'}
                  onChange={e => onCurrencyChange(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }}
                >
                  {(currencies && currencies.length > 0
                    ? currencies.map(c => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)
                    : [['TWD','台幣'],['USD','美元'],['JPY','日幣'],['CNY','人民幣'],['EUR','歐元'],['NZD','紐西蘭幣'],['AUD','澳幣']]
                        .map(([code, name]) => <option key={code} value={code}>{code} — {name}</option>))}
                </select>
              </div>
              {departments.length > 0 && (
                <SettleUnitField
                  departments={departments} stores={stores} employees={employees}
                  deptId={form.settle_department_id} storeId={form.settle_store_id}
                  onDept={(v) => { set('settle_department_id', v); set('settle_store_id', ''); clearError('settle_department_id', setErrors) }}
                  onStore={(v) => { set('settle_store_id', v); clearError('settle_store_id', setErrors) }}
                  errorDept={errors.settle_department_id} errorStore={errors.settle_store_id}
                />
              )}
            </div>
          )}

          {/* 驗收單位 — 費用/叫貨皆顯示，可多選門市 */}
          {isExpense && (
            <AcceptanceUnitsField
              stores={stores || []}
              selected={form.acceptance_units || []}
              onChange={(v) => set('acceptance_units', v)}
            />
          )}

          {/* Line items — expense only.
              用 form-table（CSS grid + container query）取代 table，窄容器自動變兩排排版：
              品名 + [X] / 數量 × 單價 = 小計 */}
          {isExpense && (
            <div className={errors._total ? 'field-error' : undefined}>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>品項明細 <span style={{ color: 'var(--accent-red)' }}>*</span></label>
              {errors._total && <div className="field-error-msg" style={{ marginBottom: 4 }}>⚠ 請至少填一個品項（含數量 &gt; 0）</div>}
              <div className="form-table">
                <div className="form-table-head">
                  <div className="form-table-cell-name">品名</div>
                  <div className="form-table-cell-qty">數量</div>
                  <div className="form-table-cell-price">單價</div>
                  <div className="form-table-cell-total">小計</div>
                  <div className="form-table-cell-action"></div>
                </div>
                {lineItems.map((li, i) => (
                  <div key={i} className="form-table-row">
                    <div className="form-table-cell-name">
                      <input type="text" value={li.name} onChange={e => updateItem(i, 'name', e.target.value)} placeholder="品名" />
                    </div>
                    {/* 寬容器：display: contents 讓 3 個 cell 直接當 grid items；
                        窄容器：CSS 改成 display: grid，自己接管 qty / price / total 三欄排版 */}
                    <div className="form-table-calc-row">
                      <div className="form-table-cell-qty" data-label="數量">
                        <input type="number" value={li.qty} onChange={e => updateItem(i, 'qty', e.target.value)} placeholder="0" inputMode="decimal" />
                      </div>
                      <div className="form-table-cell-price" data-label="單價">
                        <input type="number" value={li.unit_price} onChange={e => updateItem(i, 'unit_price', e.target.value)} placeholder="0" inputMode="decimal" />
                      </div>
                      <div className="form-table-cell-total">{li.subtotal ? fmtAmt(li.subtotal) : '-'}</div>
                    </div>
                    <div className="form-table-cell-action">
                      {lineItems.length > 1 && (
                        <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 4 }}
                          onClick={() => setLineItems(items => items.filter((_, j) => j !== i))}
                          aria-label="刪除此品項">
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                <div className="form-table-foot">
                  <div className="form-table-foot-actions">
                    <button className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 10px' }}
                      onClick={() => setLineItems(items => [...items, emptyItem()])}>
                      <Plus size={11} /> 新增品項
                    </button>
                    <button className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 10px' }}
                      onClick={() => csvRef.current?.click()}
                      title="3 欄：品名,數量,單價（小計自動算）— UTF-8 編碼">
                      <Upload size={11} /> 匯入 CSV
                    </button>
                    <button className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 10px', color: 'var(--accent-cyan)' }}
                      onClick={handleDownloadTemplate}
                      title="下載空白 CSV 範本（含標題列 + 2 筆範例）">
                      <Download size={11} /> 下載範本
                    </button>
                    <input ref={csvRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleCsvImport} />
                  </div>
                  <div className="form-table-foot-total">{fmtAmt(lineTotal)}</div>
                </div>
              </div>
            </div>
          )}

          {/* Description */}
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>說明</label>
            <textarea value={form.description} onChange={e => set('description', e.target.value)} placeholder="用途、規格..."
              style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)', minHeight: 50, resize: 'vertical' }} />
          </div>

          {/* File upload — 動態多檔（最多 20）*/}
          <div>
            <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 600 }}>
              附件（訂購單、報價單...）<span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 12 }}> · {(files || []).filter(Boolean).length}/20</span>
            </label>
            {/* 複製重送：從原單帶入的舊附件（會一起送出，可逐一移除） */}
            {carriedAtts.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>📎 從原單帶入（送出時一併複製，可移除）</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {carriedAtts.map((a, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 8px', background: 'var(--accent-cyan-dim)', borderRadius: 6 }}>
                      <FileText size={12} style={{ color: 'var(--accent-cyan)', flexShrink: 0 }} />
                      {a.url
                        ? <a href={a.url} target="_blank" rel="noreferrer" title="點開檢視" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--accent-cyan)', textDecoration: 'underline', cursor: 'pointer' }}>{a.file_name}</a>
                        : <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.file_name}</span>}
                      <button type="button" onClick={() => onRemoveCarried?.(i)} aria-label="移除"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 0, lineHeight: 1, flexShrink: 0 }}>
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {(files || []).filter(Boolean).length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8, marginBottom: 8 }}>
                {(files || []).filter(Boolean).map((file, i) => (
                  <div key={i} style={{
                    position: 'relative', border: '1px solid var(--accent-red)', background: 'var(--accent-red-dim)',
                    borderRadius: 8, padding: 10, minHeight: 80, textAlign: 'center',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}>
                    {file.type?.startsWith('image')
                      ? <Image size={20} style={{ color: 'var(--accent-red)' }} />
                      : <FileText size={20} style={{ color: 'var(--accent-red)' }} />}
                    <div style={{ fontSize: 11, color: 'var(--text-primary)', wordBreak: 'break-all', lineHeight: 1.3 }}>{file.name}</div>
                    <button type="button"
                      onClick={() => setFiles(prev => prev.filter(Boolean).filter((_, j) => j !== i))}
                      style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.5)', border: 'none', borderRadius: '50%', color: '#fff', width: 20, height: 20, padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {(files || []).filter(Boolean).length < 20 && (
              <label style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                border: '2px dashed var(--accent-red)', borderRadius: 8, padding: '12px', cursor: 'pointer',
                color: 'var(--accent-red)', fontSize: 13, fontWeight: 600,
              }}>
                <input type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv" style={{ display: 'none' }}
                  onChange={e => {
                    const picked = Array.from(e.target.files || [])
                    e.target.value = ''
                    if (!picked.length) return
                    setFiles(prev => {
                      const cur = (prev || []).filter(Boolean)
                      return [...cur, ...picked].slice(0, 20)
                    })
                  }} />
                <Upload size={16} /> 新增附件（可多選）
              </label>
            )}
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5 }}>
              支援格式：JPG / PNG / GIF / WebP / PDF / Excel (XLS、XLSX) / CSV
              <br />
              單檔最大 10MB · 最多 20 個附件
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="modal-shell-footer">
          <button className="btn btn-secondary" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={onSubmit} disabled={saving}>{saving ? '提交中...' : '提交申請'}</button>
        </div>
      </div>
    </ModalOverlay>
  )
}
