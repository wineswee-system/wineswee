import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CalendarDays, Clock, Fingerprint, Briefcase, Receipt,
  TrendingUp, ArrowLeftRight, BarChart2, UserCheck, GraduationCap,
  LogOut, Users, AlertTriangle, MessageSquare, FileSignature,
  XCircle, AlarmClock, RotateCcw, Pause, FileText, Settings,
  Wallet,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'

// 4 大類分類，每類底下列出可申請的表單
const CATEGORIES = [
  {
    key: 'attendance',
    title: '📅 假勤申請',
    desc: '請假、加班、補登、銷假等出勤類表單',
    forms: [
      { icon: CalendarDays, name: '請假申請', desc: '年假、事假、病假等各類假別', color: 'var(--accent-cyan)', dim: 'var(--accent-cyan-dim)', action: '/hr/leave' },
      { icon: Clock,        name: '加班申請（事後）', desc: '已加完班的補登申請', color: 'var(--accent-orange)', dim: 'var(--accent-orange-dim)', action: '/hr/overtime' },
      // 預先加班、銷假 — 透過 builder 自訂建立（admin 進 /hr/form-builder 拉欄位即可）
      { icon: Fingerprint,  name: '忘刷補登', desc: '補登忘刷打卡紀錄', color: 'var(--accent-purple)', dim: 'var(--accent-purple-dim)', action: '/hr/punch-correction' },
    ],
  },
  {
    key: 'personnel',
    title: '🏃 人事異動',
    desc: '離職、留停、調職、升遷等人事變動',
    forms: [
      { icon: LogOut,         name: '離職申請', desc: '員工離職申請與交接', color: 'var(--accent-red)', dim: 'var(--accent-red-dim)', action: '/hr/forms/resignation', tag: '新' },
      // 留職停薪 — 透過 builder 自訂建立
      { icon: ArrowLeftRight, name: '人事異動', desc: '調職、升遷、調薪、跨部門調動', color: 'var(--accent-purple)', dim: 'var(--accent-purple-dim)', action: '/hr/forms/transfer', tag: '新' },
      { icon: UserCheck,      name: '試用期評核', desc: '新進員工試用期滿考核', color: 'var(--accent-green)', dim: 'var(--accent-green-dim)', action: '/hr/probation' },
      { icon: BarChart2,      name: '績效考核', desc: '定期績效評核與目標設定', color: 'var(--accent-purple)', dim: 'var(--accent-purple-dim)', action: '/hr/performance' },
    ],
  },
  {
    key: 'expense',
    title: '💰 費用 / 出差',
    desc: '出差、費用、報銷類表單',
    forms: [
      { icon: Briefcase, name: '出差申請', desc: '外出辦公、洽公申請', color: 'var(--accent-blue)', dim: 'var(--accent-blue-dim)', action: '/hr/travel' },
      { icon: Wallet,    name: '申請費用', desc: '預算申請 → 核准 → 核銷兩階段（採購／預算／事項）', color: 'var(--accent-cyan)', dim: 'var(--accent-cyan-dim)', action: '/hr/expense-requests', tag: '兩階段' },
      { icon: Receipt,   name: '費用報銷', desc: '出差交通、住宿、餐費申報（單階段直接核銷）', color: 'var(--accent-green)', dim: 'var(--accent-green-dim)', action: '/hr/expenses' },
    ],
  },
  {
    key: 'other',
    title: '📋 其他',
    desc: '招募、訓練、文件、職災等',
    forms: [
      { icon: Users,         name: '人力需求申請', desc: '部門新增人力需求提報（走簽核鏈）', color: 'var(--accent-cyan)', dim: 'var(--accent-cyan-dim)', action: '/hr/forms/headcount', tag: '新' },
      { icon: Users,         name: '招募追蹤', desc: '已核准單的招募進度看板', color: 'var(--accent-blue)', dim: 'var(--accent-blue-dim)', action: '/hr/recruitment' },
      { icon: GraduationCap, name: '教育訓練', desc: '內外訓課程報名與費用', color: 'var(--accent-blue)', dim: 'var(--accent-blue-dim)', action: '/hr/training' },
      { icon: FileSignature, name: '文件簽核', desc: '合約、協議書、重要文件簽核', color: 'var(--accent-purple)', dim: 'var(--accent-purple-dim)', action: '/hr/documents' },
      { icon: AlertTriangle, name: '工傷通報', desc: '職場意外事故通報', color: 'var(--accent-red)', dim: 'var(--accent-red-dim)', action: '/hr/labor-inspection' },
      { icon: MessageSquare, name: '員工意見反映', desc: '建議、申訴與意見回饋', color: 'var(--accent-orange)', dim: 'var(--accent-orange-dim)', action: '/hr/surveys' },
    ],
  },
]

// 自訂表單顏色 → CSS variable
const COLOR_MAP = {
  cyan:   { color: 'var(--accent-cyan)',   dim: 'var(--accent-cyan-dim)' },
  blue:   { color: 'var(--accent-blue)',   dim: 'var(--accent-blue-dim)' },
  green:  { color: 'var(--accent-green)',  dim: 'var(--accent-green-dim)' },
  orange: { color: 'var(--accent-orange)', dim: 'var(--accent-orange-dim)' },
  red:    { color: 'var(--accent-red)',    dim: 'var(--accent-red-dim)' },
  purple: { color: 'var(--accent-purple)', dim: 'var(--accent-purple-dim)' },
  yellow: { color: 'var(--accent-yellow)', dim: 'var(--accent-yellow-dim)' },
}

export default function HRForms() {
  const navigate = useNavigate()
  const [customByCategory, setCustomByCategory] = useState({})
  useEffect(() => {
    supabase.from('form_templates').select('*').eq('is_active', true).order('sort_order').then(({ data }) => {
      const grouped = {}
      for (const t of (data || [])) {
        if (!grouped[t.category]) grouped[t.category] = []
        const c = COLOR_MAP[t.color] || COLOR_MAP.cyan
        grouped[t.category].push({
          icon: FileText,
          name: t.name,
          desc: t.description || '自訂表單',
          color: c.color,
          dim: c.dim,
          action: `/hr/forms/submissions?template=${t.id}`,
          tag: '自訂',
        })
      }
      setCustomByCategory(grouped)
    })
  }, [])

  const totalForms = CATEGORIES.reduce((s, c) => s + c.forms.length, 0)
    + Object.values(customByCategory).reduce((s, arr) => s + arr.length, 0)

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2>HR 表單中心</h2>
            <p>{totalForms} 種人資表單，依類別分組</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => navigate('/hr/forms/submissions')} style={{ width: 'auto', fontSize: 12 }}>
              <FileText size={12} /> 我的提交
            </button>
            <button className="btn btn-secondary" onClick={() => navigate('/hr/form-builder')} style={{ width: 'auto', fontSize: 12 }}>
              <Settings size={12} /> 表單建立器
            </button>
          </div>
        </div>
      </div>

      {CATEGORIES.map((cat) => (
        <div key={cat.key} style={{ marginBottom: 28 }}>
          <div style={{ marginBottom: 12 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>{cat.title}</h3>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{cat.desc}</div>
          </div>
          <div className="hr-forms-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
            {[...cat.forms, ...(customByCategory[cat.key] || [])].map((f) => {
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
                            fontSize: 9, padding: '1px 6px', borderRadius: 4,
                            background: 'var(--accent-orange)', color: '#fff', fontWeight: 700,
                          }}>{f.tag}</span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>{f.desc}</div>
                    </div>
                  </div>
                  <button className="btn btn-primary" style={{ alignSelf: 'flex-start', fontSize: 11, padding: '4px 12px' }}
                    onClick={(e) => { e.stopPropagation(); navigate(f.action) }}>
                    申請
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      <style>{`
        @media (max-width: 900px) {
          .hr-forms-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
        @media (max-width: 560px) {
          .hr-forms-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  )
}
