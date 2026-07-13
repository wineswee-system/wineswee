import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import LoadingSpinner from '../../../components/LoadingSpinner'
import { Send, Inbox, FileText, ShoppingCart } from 'lucide-react'

// 待送驗收 — 「我是驗收負責人、申請已核准、還沒送驗收單」的清單。
// 跟簽核中心分開：這是「我要去送單」，不是「我要簽別人的單」。
export default function SettleTodoView({ onCount }) {
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    supabase.rpc('web_list_my_settle_todos').then(({ data }) => {
      const list = Array.isArray(data) ? data : []
      setRows(list)
      onCount?.(list.length)
      setLoading(false)
    })
  }
  useEffect(() => { load() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const goSettle = (r) => {
    const route = r.doc_type === 'order' ? '/process/order-requests' : '/hr/expense-requests'
    navigate(`${route}?focus=${r.id}&settle=1&returnTo=/`)
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><LoadingSpinner /></div>

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
        以下是<b>你負責驗收</b>、申請已核准、<b>等你送驗收單</b>的單據。送出後才會進入驗收簽核流程。
      </div>
      {rows.length === 0 ? (
        <div style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>
          <Inbox size={44} style={{ color: 'var(--accent-green)', marginBottom: 12 }} />
          <div style={{ fontSize: 14 }}>目前沒有待送驗收的單據 🎉</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map(r => {
            const isOrder = r.doc_type === 'order'
            const rejected = r.status === '核銷已退回'
            return (
              <div key={r.id} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderRadius: 10,
                border: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)',
              }}>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6, flexShrink: 0,
                  display: 'flex', alignItems: 'center', gap: 4,
                  background: 'var(--accent-orange)', color: '#fff',
                }}>
                  {isOrder ? <ShoppingCart size={12} /> : <FileText size={12} />}
                  {isOrder ? '叫貨' : '費用'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                    {r.title || '（未命名）'} <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' }}>#{r.id}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    申請人 {r.employee || '—'}
                    {r.settle_unit && ` · 驗收單位 ${r.settle_unit}`}
                    {r.estimated_amount != null && ` · 預估 NT$ ${Number(r.estimated_amount).toLocaleString()}`}
                    {rejected && <span style={{ marginLeft: 6, color: 'var(--accent-red)', fontWeight: 600 }}>· 驗收被退回</span>}
                  </div>
                </div>
                <button onClick={() => goSettle(r)} style={{
                  flexShrink: 0, padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: rejected ? 'var(--accent-orange)' : 'var(--accent-cyan)', color: '#fff',
                  fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <Send size={13} /> {rejected ? '重送驗收單' : '去送驗收單'}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
