import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Wallet, Receipt, FileText, ClipboardList } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'

// 業務申請中心 — 從 HR 表單中心拉出來的 4 種申請
// 分兩組：費用組（3 個）、非費用組（1+ 個）
// 自訂表單依 form_templates.scope 自動歸位
//   - scope='business_expense'      → 費用組
//   - scope='business_non_expense'  → 非費用組

const FIXED_EXPENSE = [
  { icon: Wallet,  name: '申請費用', desc: '預算申請 → 核准 → 核銷兩階段', action: '/process/expense-requests', color: 'var(--accent-cyan)', dim: 'var(--accent-cyan-dim)', tag: '兩階段' },
  { icon: Receipt, name: '費用報銷', desc: '出差交通、住宿、餐費申報（單階段直接核銷）', action: '/process/expenses', color: 'var(--accent-green)', dim: 'var(--accent-green-dim)' },
]

const COLOR_MAP = {
  cyan:   { color: 'var(--accent-cyan)',   dim: 'var(--accent-cyan-dim)' },
  blue:   { color: 'var(--accent-blue)',   dim: 'var(--accent-blue-dim)' },
  green:  { color: 'var(--accent-green)',  dim: 'var(--accent-green-dim)' },
  orange: { color: 'var(--accent-orange)', dim: 'var(--accent-orange-dim)' },
  red:    { color: 'var(--accent-red)',    dim: 'var(--accent-red-dim)' },
  purple: { color: 'var(--accent-purple)', dim: 'var(--accent-purple-dim)' },
  yellow: { color: 'var(--accent-yellow)', dim: 'var(--accent-yellow-dim)' },
}

export default function BusinessApplications() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [customExpense, setCustomExpense] = useState([])
  const [customNonExpense, setCustomNonExpense] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const orgId = profile?.organization_id
    if (!orgId) return
    supabase.from('form_templates')
      .select('id, name, description, color, scope')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .in('scope', ['business_expense', 'business_non_expense'])
      .order('sort_order')
      .then(({ data }) => {
        const exp = [], nonExp = []
        for (const t of (data || [])) {
          const c = COLOR_MAP[t.color] || COLOR_MAP.cyan
          const card = {
            icon: FileText,
            name: t.name,
            desc: t.description || '自訂表單',
            color: c.color,
            dim: c.dim,
            action: `/process/forms/custom/${t.id}`,
            tag: '自訂',
          }
          if (t.scope === 'business_expense') exp.push(card)
          else nonExp.push(card)
        }
        setCustomExpense(exp)
        setCustomNonExpense(nonExp)
        setLoading(false)
      })
  }, [profile?.organization_id])

  if (loading) return <LoadingSpinner />

  const expenseGroup = [...FIXED_EXPENSE, ...customExpense]
  const nonExpenseGroup = customNonExpense

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><ClipboardList size={20} style={{ display: 'inline', marginRight: 6 }} />業務申請中心</h2>
            <p>費用 / 非費用類表單入口（被任務綁定時也從這些表單填寫）</p>
          </div>
        </div>
      </div>

      <FormGroup title="💰 費用組" desc="會產生費用支出，需核銷" items={expenseGroup} navigate={navigate} />
      <FormGroup title="📋 非費用組" desc="純流程申請，不涉及核銷" items={nonExpenseGroup} navigate={navigate} />

      {expenseGroup.length === 0 && nonExpenseGroup.length === 0 && (
        <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
          目前沒有業務申請項目
        </div>
      )}
    </div>
  )
}

function FormGroup({ title, desc, items, navigate }) {
  if (items.length === 0) return null
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ marginBottom: 12 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>{title}</h3>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{desc}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
        {items.map(f => {
          const Icon = f.icon
          return (
            <div key={f.name} className="card"
              onClick={() => navigate(f.action)}
              style={{
                display: 'flex', flexDirection: 'column', gap: 10, padding: 16,
                cursor: 'pointer', transition: 'transform .12s, box-shadow .12s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)' }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = '' }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 10,
                  background: f.dim, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <Icon size={20} style={{ color: f.color }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {f.name}
                    {f.tag && (
                      <span style={{
                        padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                        background: 'var(--accent-orange-dim)', color: 'var(--accent-orange)',
                      }}>{f.tag}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>{f.desc}</div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
