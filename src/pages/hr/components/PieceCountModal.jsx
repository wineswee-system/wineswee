import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Package, X } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { toast } from '../../../lib/toast'

// 計件件數（按月）— 在薪資管理頁開，跟著當前月份填當月件數，存進 employee_piece_counts。
// 計件分類/單價在 salary_structures（employment_category='piece' / piece_rate），不是 employees。
// 計薪時 _compute_payroll_for_employee 會讀當月件數（找不到才用 salary_structures.current_piece_count）。
export default function PieceCountModal({ month, employees, orgId, onClose }) {
  const empById = useMemo(() => new Map((employees || []).map(e => [e.id, e])), [employees])
  const [list, setList] = useState([])      // [{ id, name, store, dept, rate }]
  const [counts, setCounts] = useState({})  // { employee_id: count }
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    const empIds = (employees || []).map(e => e.id)
    ;(async () => {
      // 1. 計件員工（從 salary_structures 撈分類與單價）
      const { data: ss } = await supabase
        .from('salary_structures')
        .select('employee_id, piece_rate, employment_category')
        .eq('employment_category', 'piece')
        .in('employee_id', empIds.length ? empIds : [-1])
      const pieceList = (ss || [])
        .map(s => {
          const e = empById.get(s.employee_id)
          if (!e || e.status !== '在職') return null
          return { id: s.employee_id, name: e.name, store: e.store, dept: e.dept, rate: Number(s.piece_rate) || 0 }
        })
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
      // 2. 當月既有件數
      const { data: pc } = await supabase
        .from('employee_piece_counts')
        .select('employee_id, piece_count')
        .eq('year_month', month)
        .in('employee_id', pieceList.length ? pieceList.map(p => p.id) : [-1])
      if (!alive) return
      const m = {}
      ;(pc || []).forEach(r => { m[r.employee_id] = r.piece_count })
      setList(pieceList)
      setCounts(m)
      setLoading(false)
    })()
    return () => { alive = false }
  }, [month, empById, employees])

  const handleSave = async () => {
    setSaving(true)
    const rows = list.map(p => ({
      employee_id: p.id,
      year_month: month,
      piece_count: Number(counts[p.id]) || 0,
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
          ) : list.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>目前沒有「計件」分類的在職員工。<br />（員工分類在員工詳情 → 人事 → 薪資 設為「計件」才會出現在這）</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {list.map(p => {
                const cnt = Number(counts[p.id]) || 0
                return (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: p.rate > 0 ? 'var(--text-muted)' : 'var(--accent-orange)' }}>
                        {p.store || p.dept || '-'} · 單價 NT$ {p.rate.toLocaleString()}{p.rate === 0 ? '（未設單價！）' : ''}
                      </div>
                    </div>
                    <input
                      className="form-input" type="number" min="0" placeholder="0"
                      value={counts[p.id] ?? ''}
                      onChange={ev => setCounts(c => ({ ...c, [p.id]: ev.target.value }))}
                      style={{ width: 110, textAlign: 'right' }}
                    />
                    <div style={{ width: 110, textAlign: 'right', fontSize: 13, fontWeight: 700, color: cnt > 0 && p.rate > 0 ? 'var(--accent-cyan)' : 'var(--text-muted)' }}>
                      {cnt > 0 && p.rate > 0 ? `NT$ ${(cnt * p.rate).toLocaleString()}` : '—'}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-secondary" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || list.length === 0}>
            {saving ? '儲存中…' : '儲存件數'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
