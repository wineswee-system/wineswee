import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getTenantOrgId } from '../../lib/events/middleware/tenantContext'
import { Wallet, Receipt, FileText, ClipboardList, Package, ShoppingCart, Building2, Banknote, Hammer, Wrench } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'

// 業務申請中心 — 從 HR 表單中心拉出來的 4 種申請
// 分兩組：費用組（3 個）、非費用組（1+ 個）
// 自訂表單依 form_templates.scope 自動歸位
//   - scope='business_expense'      → 費用組
//   - scope='business_non_expense'  → 非費用組

const FIXED_EXPENSE = [
  { icon: Wallet,  name: '非經常性費用申請', desc: '單次或特定、偶發性的支出', action: '/process/expense-requests', color: 'var(--accent-cyan)', dim: 'var(--accent-cyan-dim)', tag: '兩階段' },
  { icon: Receipt, name: '經常性費用報銷', desc: '日常營運而週期性發生的常態支出', action: '/process/expenses', color: 'var(--accent-green)', dim: 'var(--accent-green-dim)' },
  { icon: ShoppingCart, name: '叫貨申請單', desc: '向廠商叫貨 / 補貨 → 申請核准 + 到貨入庫核銷', action: '/process/order-requests', color: 'var(--accent-purple)', dim: 'var(--accent-purple-dim)', tag: '兩階段' },
]

const FIXED_NON_EXPENSE = [
  { icon: Package, name: '商品調撥', desc: '總倉 ↔ 門市 / 跨門市調貨 → 申請審核 + 驗收兩階段', action: '/process/transfer-requests', color: 'var(--accent-orange)', dim: 'var(--accent-orange-dim)', tag: '兩階段' },
  { icon: Building2, name: '跨部門工單', desc: '請其他部門協助處理事項 → 受理排程 → 完成結案', action: '/process/work-orders', color: 'var(--accent-blue)', dim: 'var(--accent-blue-dim)', tag: '派工' },
]

// 維修單:鎖 repair_order.manage(admin 以上預設有,權限頁逐人開)
const FIXED_REPAIR = [
  { icon: Wrench, name: '維修單', desc: '工務處理維修:自己修 / 找廠商 → 需採購串費用申請 → 回報完工上傳', action: '/process/repair-orders', color: 'var(--accent-cyan)', dim: 'var(--accent-cyan-dim)', tag: '工務' },
]

// 收款組（純記帳，不走簽核）— 訂金 + 加盟金整合成單一入口（頁內分 tab）
const FIXED_COLLECTION = [
  { icon: Banknote, name: '收款', desc: '訂金（固定 30 萬）＋ 加盟金（多位投資人分攤、每人各自三期 45/45/10）收款記錄', action: '/process/collections', color: 'var(--accent-cyan)', dim: 'var(--accent-cyan-dim)', tag: '記帳' },
]

// 裝潢工程組（純記錄，不走簽核）
const FIXED_RENOVATION = [
  { icon: Hammer, name: '裝潢報價', desc: '門市裝潢工程報價記錄：廠商/負責人/電話 + 工程費/監工/稅金/總價 + 可自訂付款分期', action: '/process/renovation-quotes', color: 'var(--accent-orange)', dim: 'var(--accent-orange-dim)', tag: '記錄' },
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
  const { profile, hasPermission } = useAuth()
  const [customExpense, setCustomExpense] = useState([])
  const [customNonExpense, setCustomNonExpense] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const orgId = profile?.organization_id ?? getTenantOrgId()
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
            // 跳 FormSubmissions list 統計頁（?template=ID）→ 統計卡 + table + 簽核鏈，
            // 跟「人力需求」一致。用 /process/ 路徑保持業務申請跟 HR 表單分離
            // （ProcessModule 內已有 forms/submissions route 指向同個 FormSubmissions component）
            action: `/process/forms/submissions?template=${t.id}`,
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
  const nonExpenseGroup = [...FIXED_NON_EXPENSE, ...(hasPermission('repair_order.manage') ? FIXED_REPAIR : []), ...customNonExpense]
  const collectionGroup = hasPermission('collection.manage') ? FIXED_COLLECTION : []

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2><ClipboardList size={20} style={{ display: 'inline', marginRight: 6 }} />業務申請中心</h2>
            <p>費用 / 非費用類表單入口（被任務綁定時也從這些表單填寫）</p>
          </div>
          {hasPermission('nav.admin_office') && (
            <button className="btn btn-secondary" onClick={() => navigate('/process/expense-query')}
              style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}
              title="查所有費用單(非經常性/叫貨/經常性報銷),看金額與簽核進度">
              💰 費用查詢
            </button>
          )}
        </div>
      </div>

      <FormGroup title="💰 費用組" desc="會產生費用支出，需驗收" items={expenseGroup} navigate={navigate} />
      <FormGroup title="📋 非費用組" desc="純流程申請，不涉及驗收" items={nonExpenseGroup} navigate={navigate} />
      <FormGroup title="💵 收款" desc="訂金 / 加盟金收款記錄（純記帳，加總滿額自動完成）" items={collectionGroup} navigate={navigate} />
      <FormGroup title="🔨 裝潢工程" desc="門市裝潢報價記錄（純記錄，含付款分期）" items={hasPermission('renovation.manage') ? FIXED_RENOVATION : []} navigate={navigate} />

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
