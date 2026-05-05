import { useNavigate } from 'react-router-dom'
import {
  CalendarDays, Clock, Fingerprint, Briefcase, Receipt,
  TrendingUp, ArrowLeftRight, BarChart2, UserCheck, GraduationCap,
  LogOut, Users, AlertTriangle, MessageSquare, FileSignature,
  XCircle, AlarmClock, RotateCcw, Pause,
} from 'lucide-react'

// 4 大類分類，每類底下列出可申請的表單
const CATEGORIES = [
  {
    key: 'attendance',
    title: '📅 假勤申請',
    desc: '請假、加班、補登、銷假等出勤類表單',
    forms: [
      { icon: CalendarDays, name: '請假申請', desc: '年假、事假、病假等各類假別', color: 'var(--accent-cyan)', dim: 'var(--accent-cyan-dim)', action: '/hr/leave' },
      { icon: Clock,        name: '加班申請（事後）', desc: '已加完班的補登申請', color: 'var(--accent-orange)', dim: 'var(--accent-orange-dim)', action: '/hr/overtime' },
      { icon: AlarmClock,   name: '預先加班申請', desc: '事前申請加班、避免先做後請', color: 'var(--accent-orange)', dim: 'var(--accent-orange-dim)', action: '/hr/overtime?pre=1', tag: '新' },
      { icon: RotateCcw,    name: '銷假申請', desc: '取消已核准的請假', color: 'var(--accent-blue)', dim: 'var(--accent-blue-dim)', action: '/hr/forms/leave-cancellation', tag: '新' },
      { icon: Fingerprint,  name: '忘刷補登', desc: '補登忘刷打卡紀錄', color: 'var(--accent-purple)', dim: 'var(--accent-purple-dim)', action: '/hr/punch-correction' },
    ],
  },
  {
    key: 'personnel',
    title: '🏃 人事異動',
    desc: '離職、留停、調職、升遷等人事變動',
    forms: [
      { icon: LogOut,         name: '離職申請', desc: '員工離職申請與交接', color: 'var(--accent-red)', dim: 'var(--accent-red-dim)', action: '/hr/forms/resignation', tag: '新' },
      { icon: Pause,          name: '留職停薪', desc: '產假/育嬰/兵役/進修留停申請', color: 'var(--accent-orange)', dim: 'var(--accent-orange-dim)', action: '/hr/forms/leave-of-absence', tag: '新' },
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
      { icon: Receipt,   name: '費用報銷', desc: '出差交通、住宿、餐費申報', color: 'var(--accent-green)', dim: 'var(--accent-green-dim)', action: '/hr/expenses' },
    ],
  },
  {
    key: 'other',
    title: '📋 其他',
    desc: '招募、訓練、文件、職災等',
    forms: [
      { icon: Users,         name: '招募職缺申請', desc: '部門新增人力需求提報', color: 'var(--accent-cyan)', dim: 'var(--accent-cyan-dim)', action: '/hr/recruitment' },
      { icon: GraduationCap, name: '教育訓練', desc: '內外訓課程報名與費用', color: 'var(--accent-blue)', dim: 'var(--accent-blue-dim)', action: '/hr/training' },
      { icon: FileSignature, name: '文件簽核', desc: '合約、協議書、重要文件簽核', color: 'var(--accent-purple)', dim: 'var(--accent-purple-dim)', action: '/hr/documents' },
      { icon: AlertTriangle, name: '工傷通報', desc: '職場意外事故通報', color: 'var(--accent-red)', dim: 'var(--accent-red-dim)', action: '/hr/labor-inspection' },
      { icon: MessageSquare, name: '員工意見反映', desc: '建議、申訴與意見回饋', color: 'var(--accent-orange)', dim: 'var(--accent-orange-dim)', action: '/hr/surveys' },
    ],
  },
]

export default function HRForms() {
  const navigate = useNavigate()
  const totalForms = CATEGORIES.reduce((s, c) => s + c.forms.length, 0)

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2>HR 表單中心</h2>
            <p>{totalForms} 種人資表單，依類別分組</p>
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
            {cat.forms.map((f) => {
              const Icon = f.icon
              return (
                <div key={f.name} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16 }}>
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
                    onClick={() => navigate(f.action)}>
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
