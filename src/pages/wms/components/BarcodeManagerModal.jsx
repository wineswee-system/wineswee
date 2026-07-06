import { useState, useEffect, useCallback } from 'react'
import { Barcode, Star, Trash2, Plus } from 'lucide-react'
import Modal, { Field } from '../../../components/Modal'
import Badge from '../../../components/ui/Badge'
import { listSkuBarcodes, addSkuBarcode, removeSkuBarcode, setPrimaryBarcode } from '../../../lib/db/skuBarcodes'
import { classifyBarcode, validateGTIN13 } from '../../../lib/barcode'
import { logger } from '../../../lib/logger'
import { toast } from 'sonner'

// 條碼主檔管理（F-C4）：一品多碼 — 列表 / 新增（即時型別偵測 + GTIN 檢查碼驗證）/ 設主要 / 刪除

const TYPES = ['GTIN-13', '店內碼', '秤重碼']

const TYPE_COLOR = { 'GTIN-13': 'cyan', '店內碼': 'blue', '秤重碼': 'purple' }

export default function BarcodeManagerModal({ sku, orgId, onClose, onChanged }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [barcode, setBarcode] = useState('')
  const [type, setType] = useState('店內碼')
  const [typeTouched, setTypeTouched] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await listSkuBarcodes(sku.id)
    if (error) {
      logger.error('listSkuBarcodes failed', { skuId: sku.id, error: error.message })
      toast.error('條碼載入失敗')
    }
    setRows(data || [])
    setLoading(false)
  }, [sku.id])

  useEffect(() => { load() }, [load])

  // 即時型別偵測（使用者手動改過型別後不再覆蓋）
  const detected = classifyBarcode(barcode)
  useEffect(() => {
    if (!typeTouched && detected !== 'unknown') setType(detected)
  }, [detected, typeTouched])

  const is13Digits = /^\d{13}$/.test(barcode.trim())
  const gtinValid = is13Digits && validateGTIN13(barcode.trim())
  const checksumWarning = is13Digits && !gtinValid
  const duplicate = rows.some(r => r.barcode === barcode.trim())

  const handleAdd = async () => {
    const code = barcode.trim()
    if (!code) { toast.error('請輸入條碼'); return }
    if (duplicate) { toast.error('此條碼已存在於本品項'); return }
    if (type === 'GTIN-13' && !gtinValid) { toast.error('GTIN-13 檢查碼錯誤，請確認條碼'); return }
    setSaving(true)
    const { error } = await addSkuBarcode({
      organization_id: orgId,
      sku_id: sku.id,
      barcode: code,
      type,
      is_primary: rows.length === 0, // 第一筆自動設為主要
    })
    setSaving(false)
    if (error) {
      logger.error('addSkuBarcode failed', { skuId: sku.id, error: error.message })
      toast.error(error.code === '23505' ? '此條碼已被其他品項使用（同組織條碼唯一）' : '條碼新增失敗')
      return
    }
    toast.success('條碼已新增')
    setBarcode('')
    setTypeTouched(false)
    load()
    onChanged?.()
  }

  const handleSetPrimary = async (row) => {
    const { error } = await setPrimaryBarcode(sku.id, row.id)
    if (error) {
      logger.error('setPrimaryBarcode failed', { skuId: sku.id, id: row.id, error: error.message })
      toast.error('主要條碼設定失敗')
      return
    }
    toast.success(`已設「${row.barcode}」為主要條碼`)
    load()
    onChanged?.()
  }

  const handleRemove = async (row) => {
    const { error } = await removeSkuBarcode(row.id)
    if (error) {
      logger.error('removeSkuBarcode failed', { id: row.id, error: error.message })
      toast.error('條碼刪除失敗')
      return
    }
    toast.success('條碼已刪除')
    load()
    onChanged?.()
  }

  return (
    <Modal title={`條碼管理 — ${sku.code} ${sku.name}`} onClose={onClose}>
      {/* 現有條碼 */}
      <div style={{ marginBottom: 16 }}>
        <span style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, display: 'block' }}>
          現有條碼（{rows.length}）
        </span>
        {loading ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 8 }}>載入中…</div>
        ) : (
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead><tr><th>條碼</th><th>類型</th><th>主要</th><th style={{ width: 110 }}>操作</th></tr></thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 16 }}>此品項尚無條碼</td></tr>
                )}
                {rows.map(r => (
                  <tr key={r.id}>
                    <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{r.barcode}</td>
                    <td><Badge color={TYPE_COLOR[r.type] || 'gray'} size="sm">{r.type}</Badge></td>
                    <td>
                      {r.is_primary
                        ? <Badge status="success" size="sm"><Star size={10} style={{ marginRight: 2 }} /> 主要</Badge>
                        : <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>-</span>}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {!r.is_primary && (
                          <button className="btn btn-secondary" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => handleSetPrimary(r)}>
                            設主要
                          </button>
                        )}
                        <button className="btn btn-secondary" style={{ fontSize: 11, padding: '2px 6px', color: 'var(--accent-red)' }}
                          title="刪除條碼" onClick={() => handleRemove(r)}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 新增條碼 */}
      <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
        <span style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, display: 'block' }}>新增條碼</span>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
          <Field label="條碼（可直接掃描輸入）">
            <input className="form-input" type="text" style={{ width: '100%', fontFamily: 'monospace' }}
              placeholder="4710… / SKU-001 / 2 開頭秤重碼"
              value={barcode}
              onChange={e => setBarcode(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAdd() } }} />
          </Field>
          <Field label="類型">
            <select className="form-input" style={{ width: '100%' }} value={type}
              onChange={e => { setType(e.target.value); setTypeTouched(true) }}>
              {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
        </div>

        {/* 即時偵測回饋（色彩皆伴隨文字，非僅色彩表意） */}
        {barcode.trim() && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
            <Barcode size={13} style={{ color: 'var(--text-muted)' }} />
            {detected !== 'unknown' && <Badge color={TYPE_COLOR[detected]} size="sm">偵測：{detected}</Badge>}
            {gtinValid && <Badge status="success" size="sm">✓ 檢查碼正確</Badge>}
            {checksumWarning && <Badge status="error" size="sm">✗ 檢查碼錯誤（EAN-13）</Badge>}
            {detected === 'unknown' && !is13Digits && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>無法自動判別類型，請手動選擇</span>
            )}
            {duplicate && <Badge status="warning" size="sm">此條碼已在清單中</Badge>}
          </div>
        )}

        <button className="btn btn-primary" style={{ fontSize: 12 }} disabled={saving || !barcode.trim()} onClick={handleAdd}>
          <Plus size={12} /> {saving ? '儲存中…' : '新增條碼'}
        </button>
      </div>
    </Modal>
  )
}
