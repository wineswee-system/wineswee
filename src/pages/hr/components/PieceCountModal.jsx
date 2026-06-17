import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Package, X } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { toast } from '../../../lib/toast'

// 計件件數（按月）— 在薪資管理頁開，跟著當前月份填當月件數，存進 employee_piece_counts。
// 計薪時 _compute_payroll_for_employee 會讀當月件數（找不到才用員工檔的 current_piece_count）。
export default function PieceCountModal({ month, employees, orgId, onClose }) {
  const pieceEmps = (employees || []).filter(
    e => (e.employment_category || '') === 'piece' && e.status === '在職'
  )
  const [counts, setCounts] = useState({})   // { employee_id: count }
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    supabase
      .from('employee_piece_counts')
      .select('employee_id, piece_count')
      .eq('year_month', month)
      .in('employee_id', pieceEmps.map(e => e.id).length ? pieceEmps.map(e => e.id) : [-1])
      .then(({ data }) => {
        if (!alive) return
        const m = {}
        ;(data || []).forEach(r => { m[r.employee_id] = r.piece_count })
        setCounts(m)
        setLoading(false)
      })
    return () => { alive = false }
  }, [month])  // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    setSaving(true)
    const rows = pieceEmps.map(e => ({
      employee_id: e.id,
      year_month: month,
      piece_count: Number(counts[e.id]) || 0,
      organization_id: orgId,
      updated_at: new Date().toISOString(),
    }))
    const { error } = await supabase
      .from('employee_piece_counts')
      .upsert(rows, { onConflict: 'employee_id,year_month' })
    setSaving(false)
    if (error) { toast.error('儲存失敗：' + error.message); return }
    toast.success(`已儲存 ${month} 件數（${rows.length} 位計件員工）`)
    onClose()
  }

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'var(--bg-modal-overlay)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-medium)', borderRadius: 16, width: '92%', maxWidth: 620, maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-xl)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', borderBottom: '1px solid var(--border-subtle)' }}>
          <h3 style={{ fontSize: 15, fontWeight: 700 }}>
            <Package size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            計件件數 — {month}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
            填入每位計件員工「{month}」的件數，計薪時用 件數 × 單價 算當月薪。換月份可分別填。
          </div>
          {loading ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>載入中…</div>
          ) : pieceEmps.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>目前沒有「計件」分類的在職員工。<br />（員工分類在員工詳情設為「計件」才會出現在這）</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {pieceEmps.map(e => {
                const rate = Number(e.piece_rate) || 0
                const cnt = Number(counts[e.id]) || 0
                return (
                  <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{e.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{e.store || e.dept || '-'} · 單價 NT$ {rate.toLocaleString()}</div>
                    </div>
                    <input
                      className="form-input" type="number" min="0" placeholder="0"
                      value={counts[e.id] ?? ''}
                      onChange={ev => setCounts(c => ({ ...c, [e.id]: ev.target.value }))}
                      style={{ width: 110, textAlign: 'right' }}
                    />
                    <div style={{ width: 110, textAlign: 'right', fontSize: 13, fontWeight: 700, color: cnt > 0 ? 'var(--accent-cyan)' : 'var(--text-muted)' }}>
                      {cnt > 0 && rate > 0 ? `NT$ ${(cnt * rate).toLocaleString()}` : '—'}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-secondary" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || pieceEmps.length === 0}>
            {saving ? '儲存中…' : '儲存件數'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
