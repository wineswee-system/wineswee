import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { ModalOverlay } from '../../../components/Modal'
import Badge from '../../../components/ui/Badge'
import { findUsefulLife } from '../../../lib/accounting/fixedAssetOps'

// ─── F-A5 資產表單（新增/編輯）＋ 行政院耐用年數表 picker ───────────
// 選類別/細目 → 自動帶入法定耐用年數（useful_life_ref_id）；
// 手動覆寫年數 → 顯示 ⚠ 與稅法年限不符 Badge，並強制填寫覆寫原因。

const CATEGORIES = ['土地', '建築物', '機器設備', '運輸設備', '辦公設備', '其他']
const METHODS = [
  { value: 'straight_line', label: '直線法（平均法）' },
  { value: 'declining_balance', label: '定率遞減法' },
  { value: 'sum_of_years', label: '年數合計法' },
]
const STATUSES = ['使用中', '已處分', '已報廢']

const inputStyle = { width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }
const labelStyle = { display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }

export default function AssetFormModal({ form, set, editingId, saving, lifeTable, onSubmit, onClose }) {
  const currentRef = useMemo(
    () => (lifeTable || []).find(r => r.id === form.useful_life_ref_id) || null,
    [lifeTable, form.useful_life_ref_id]
  )
  const [pickCategory, setPickCategory] = useState(currentRef?.category || '')

  const lifeCategories = useMemo(
    () => [...new Set((lifeTable || []).map(r => r.category))],
    [lifeTable]
  )
  const lifeItems = useMemo(
    () => (lifeTable || []).filter(r => r.category === pickCategory),
    [lifeTable, pickCategory]
  )

  // 已選參考年限、且輸入年數不同 → 與稅法年限不符
  const lifeMismatch = currentRef && Number(form.useful_life) !== currentRef.useful_life_years

  const handlePickItem = (itemName) => {
    const row = findUsefulLife(lifeTable, pickCategory, itemName)
    if (!row) {
      set('useful_life_ref_id', null)
      return
    }
    set('useful_life_ref_id', row.id)
    set('useful_life', String(row.useful_life_years))
    set('life_override_reason', '')
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 24, width: 'min(560px, calc(100vw - 32px))', maxHeight: 'min(90vh, calc(100vh - 32px))', overflow: 'auto', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ margin: 0 }}>{editingId ? '編輯資產' : '新增固定資產'}</h3>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={onClose}><X size={20} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>資產名稱 <span style={{ color: 'var(--accent-red)' }}>*</span></label>
              <input type="text" value={form.name} onChange={e => set('name', e.target.value)} placeholder="例：商用咖啡機" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>資產編號</label>
              <input type="text" value={form.asset_code} onChange={e => set('asset_code', e.target.value)} placeholder="自動產生" style={inputStyle} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>類別</label>
              <select value={form.category} onChange={e => set('category', e.target.value)} style={inputStyle}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>折舊方法</label>
              <select value={form.method} onChange={e => set('method', e.target.value)} style={inputStyle}>
                {METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
          </div>

          {/* 行政院固定資產耐用年數表 picker */}
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, background: 'var(--bg-main)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
              耐用年數表（行政院固定資產耐用年數表）
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 12 }}>
              <select value={pickCategory} onChange={e => { setPickCategory(e.target.value); set('useful_life_ref_id', null) }} style={inputStyle}>
                <option value="">選擇資產類別…</option>
                {lifeCategories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={currentRef?.item_name || ''} onChange={e => handlePickItem(e.target.value)} disabled={!pickCategory} style={inputStyle}>
                <option value="">選擇細目（自動帶入年限）…</option>
                {lifeItems.map(r => <option key={r.id} value={r.item_name}>{r.item_name}（{r.useful_life_years} 年）</option>)}
              </select>
            </div>
            {currentRef && (
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                法定耐用年數：{currentRef.useful_life_years} 年（{currentRef.source_ref}）
                {lifeMismatch && <Badge color="orange" size="sm">⚠ 與稅法年限不符</Badge>}
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>原始成本 <span style={{ color: 'var(--accent-red)' }}>*</span></label>
              <input type="number" value={form.cost} onChange={e => set('cost', e.target.value)} placeholder="0" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>殘值</label>
              <input type="number" value={form.salvage_value} onChange={e => set('salvage_value', e.target.value)} placeholder="0" style={inputStyle} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>耐用年數 <span style={{ color: 'var(--accent-red)' }}>*</span></label>
              <input type="number" value={form.useful_life} onChange={e => set('useful_life', e.target.value)} placeholder="年" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>取得日期</label>
              <input type="date" value={form.acquired_date} onChange={e => set('acquired_date', e.target.value)} style={inputStyle} />
            </div>
          </div>

          {/* 覆寫法定年限 → 必填原因 */}
          {lifeMismatch && (
            <div>
              <label style={labelStyle}>
                覆寫原因 <span style={{ color: 'var(--accent-red)' }}>*</span>
                <span style={{ fontWeight: 400, color: 'var(--text-secondary)' }}>（與法定 {currentRef.useful_life_years} 年不同，須說明理由）</span>
              </label>
              <input type="text" value={form.life_override_reason || ''} onChange={e => set('life_override_reason', e.target.value)} placeholder="例：二手取得，剩餘耐用年數較短" style={inputStyle} />
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>部門</label>
              <input type="text" value={form.department} onChange={e => set('department', e.target.value)} placeholder="例：門市部" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>存放地點</label>
              <input type="text" value={form.location} onChange={e => set('location', e.target.value)} placeholder="例：台北總部" style={inputStyle} />
            </div>
          </div>

          {editingId && (
            <div>
              <label style={labelStyle}>狀態</label>
              <select value={form.status} onChange={e => set('status', e.target.value)} style={inputStyle}>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}

          <div>
            <label style={labelStyle}>備註</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} placeholder="選填" style={{ ...inputStyle, resize: 'vertical' }} />
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button className="btn btn-secondary" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={onSubmit} disabled={saving}>{saving ? '儲存中...' : editingId ? '更新' : '新增'}</button>
        </div>
      </div>
    </ModalOverlay>
  )
}
