import { useNavigate } from 'react-router-dom'
import {
  CalendarDays, Clock, Fingerprint, Briefcase, Receipt,
  TrendingUp, ArrowLeftRight, BarChart2, UserCheck, GraduationCap,
  LogOut, Users, AlertTriangle, MessageSquare, FileSignature,
} from 'lucide-react'

const FORMS = [
  {
    icon: CalendarDays,
    name: '請假申請表',
    desc: '年假、事假、病假等各類假別申請',
    color: 'var(--accent-cyan)',
    colorDim: 'var(--accent-cyan-dim)',
    action: '/hr/leave',
  },
  {
    icon: Clock,
    name: '加班申請表',
    desc: '事前申請加班授權與加班費核算',
    color: 'var(--accent-orange)',
    colorDim: 'var(--accent-orange-dim)',
    action: '/hr/overtime',
  },
  {
    icon: Fingerprint,
    name: '忘刷補登申請',
    desc: '補登忘刷打卡紀錄，修正出勤異常',
    color: 'var(--accent-purple)',
    colorDim: 'var(--accent-purple-dim)',
    action: '/hr/punch-correction',
  },
  {
    icon: Briefcase,
    name: '公出申請單',
    desc: '外出辦公、洽公出勤申請與紀錄',
    color: 'var(--accent-blue)',
    colorDim: 'var(--accent-blue-dim)',
    action: '/hr/travel',
  },
  {
    icon: Receipt,
    name: '差旅費報銷單',
    desc: '出差交通、住宿、餐費費用申報',
    color: 'var(--accent-green)',
    colorDim: 'var(--accent-green-dim)',
    action: '/hr/expenses',
  },
  {
    icon: TrendingUp,
    name: '薪資調整申請',
    desc: '員工薪資異動、調薪申請與審核',
    color: 'var(--accent-cyan)',
    colorDim: 'var(--accent-cyan-dim)',
    action: '/hr/transfer',
  },
  {
    icon: ArrowLeftRight,
    name: '部門／門市調動申請',
    desc: '跨部門或跨門市人員調派申請',
    color: 'var(--accent-orange)',
    colorDim: 'var(--accent-orange-dim)',
    action: '/hr/transfer',
  },
  {
    icon: BarChart2,
    name: '績效考核表',
    desc: '定期員工績效評核與目標設定',
    color: 'var(--accent-purple)',
    colorDim: 'var(--accent-purple-dim)',
    action: '/hr/performance',
  },
  {
    icon: UserCheck,
    name: '試用期評核表',
    desc: '新進員工試用期滿考核評估',
    color: 'var(--accent-green)',
    colorDim: 'var(--accent-green-dim)',
    action: '/hr/probation',
  },
  {
    icon: GraduationCap,
    name: '教育訓練申請表',
    desc: '內訓或外訓課程報名與費用申請',
    color: 'var(--accent-blue)',
    colorDim: 'var(--accent-blue-dim)',
    action: '/hr/training',
  },
  {
    icon: LogOut,
    name: '離職申請表',
    desc: '員工離職申請、交接與辦理流程',
    color: 'var(--accent-red)',
    colorDim: 'var(--accent-red-dim)',
    action: '/org/employees',
  },
  {
    icon: Users,
    name: '人事招募申請單',
    desc: '部門新增人力需求提報與職缺開立',
    color: 'var(--accent-cyan)',
    colorDim: 'var(--accent-cyan-dim)',
    action: '/hr/recruitment',
  },
  {
    icon: AlertTriangle,
    name: '工傷／職災通報單',
    desc: '職場意外事故通報與職災處理流程',
    color: 'var(--accent-red)',
    colorDim: 'var(--accent-red-dim)',
    action: '/hr/labor-inspection',
  },
  {
    icon: MessageSquare,
    name: '員工意見反映表',
    desc: '員工建議、申訴與意見匿名回饋',
    color: 'var(--accent-orange)',
    colorDim: 'var(--accent-orange-dim)',
    action: '/hr/surveys',
  },
  {
    icon: FileSignature,
    name: '文件／合約簽核申請',
    desc: '內部合約、協議書及重要文件簽核',
    color: 'var(--accent-purple)',
    colorDim: 'var(--accent-purple-dim)',
    action: '/hr/documents',
  },
]

export default function HRForms() {
  const navigate = useNavigate()

  return (
    <div className="fade-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2>HR 表單中心</h2>
            <p>{FORMS.length} 種標準人資表單，點選申請直接進入對應功能頁面</p>
          </div>
        </div>
      </div>

      <div
        className="hr-forms-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 16,
        }}
      >
        {FORMS.map((f) => {
          const Icon = f.icon
          return (
            <div
              key={f.name}
              className="card"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                padding: 20,
              }}
            >
              {/* Colored icon area */}
              <div style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                background: f.colorDim,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                <Icon size={22} style={{ color: f.color }} />
              </div>

              {/* Text */}
              <div style={{ flex: 1 }}>
                <div style={{
                  fontWeight: 700,
                  fontSize: 14,
                  color: 'var(--text-primary)',
                  marginBottom: 4,
                }}>
                  {f.name}
                </div>
                <div style={{
                  fontSize: 12,
                  color: 'var(--text-muted)',
                  lineHeight: 1.5,
                }}>
                  {f.desc}
                </div>
              </div>

              {/* Action button */}
              <button
                className="btn btn-primary"
                style={{ alignSelf: 'flex-start', fontSize: 12, padding: '5px 14px' }}
                onClick={() => navigate(f.action)}
              >
                申請
              </button>
            </div>
          )
        })}
      </div>

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
