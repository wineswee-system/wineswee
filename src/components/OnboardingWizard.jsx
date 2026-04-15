import { useState } from 'react'
import { ModalOverlay } from './Modal'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Building2, MapPin, Users, CheckCircle, ArrowRight, ArrowLeft, Sparkles } from 'lucide-react'

const STEPS = [
  {
    icon: Sparkles, title: '歡迎使用 SME OPS', color: 'var(--accent-cyan)',
    desc: '只需 3 個步驟，即可完成系統初始設定。讓我們開始吧！',
    type: 'welcome',
  },
  {
    icon: Building2, title: '建立公司資料', color: 'var(--accent-blue)',
    desc: '輸入公司基本資訊，作為系統的組織根節點。',
    type: 'company', link: '/org/companies',
  },
  {
    icon: MapPin, title: '新增門市據點', color: 'var(--accent-green)',
    desc: '設定門市地址與 GPS 座標，啟用打卡地理圍籬。',
    type: 'location', link: '/org/locations',
  },
  {
    icon: Users, title: '匯入員工', color: 'var(--accent-purple)',
    desc: '新增員工資料並指派部門、門市，完成後即可開始使用。',
    type: 'employee', link: '/org/employees',
  },
]

export default function OnboardingWizard({ onComplete }) {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const current = STEPS[step]
  const Icon = current.icon
  const isLast = step === STEPS.length - 1
  const isFirst = step === 0

  const handleNext = () => {
    if (isLast) {
      localStorage.setItem('sme_onboarded', 'true')
      if (onComplete) onComplete()
    } else {
      setStep(s => s + 1)
    }
  }

  const handleGoSetup = () => {
    localStorage.setItem('sme_onboarded', 'true')
    if (onComplete) onComplete()
    navigate(current.link)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }}>
      <div style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-medium)',
        borderRadius: 24, width: '100%', maxWidth: 520,
        overflow: 'hidden',
        boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
      }}>
        {/* Progress bar */}
        <div style={{
          height: 4, background: 'var(--border-subtle)',
        }}>
          <div style={{
            height: '100%', width: `${((step + 1) / STEPS.length) * 100}%`,
            background: `linear-gradient(90deg, var(--accent-cyan), ${current.color})`,
            borderRadius: 2, transition: 'width 0.4s ease',
          }} />
        </div>

        <div style={{ padding: '48px 40px 36px', textAlign: 'center' }}>
          {/* Icon */}
          <div style={{
            width: 72, height: 72, borderRadius: 22,
            background: `${current.color}15`,
            border: `1.5px solid ${current.color}30`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 24px',
            boxShadow: `0 8px 32px ${current.color}15`,
          }}>
            <Icon size={32} style={{ color: current.color }} />
          </div>

          {/* Step indicator */}
          <div style={{
            fontSize: 11, fontWeight: 700, color: current.color,
            letterSpacing: '2px', marginBottom: 12,
          }}>
            {isFirst ? 'GET STARTED' : `STEP ${step} / ${STEPS.length - 1}`}
          </div>

          <h2 style={{
            fontSize: 24, fontWeight: 800, color: 'var(--text-primary)',
            margin: '0 0 12px',
          }}>{current.title}</h2>

          <p style={{
            fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7,
            maxWidth: 380, margin: '0 auto 32px',
          }}>{current.desc}</p>

          {/* Dots */}
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 32 }}>
            {STEPS.map((_, i) => (
              <div key={i} style={{
                width: i === step ? 24 : 8, height: 8, borderRadius: 4,
                background: i === step ? current.color : 'var(--border-medium)',
                transition: 'all 0.3s ease',
              }} />
            ))}
          </div>

          {/* Buttons */}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            {!isFirst && (
              <button
                onClick={() => setStep(s => s - 1)}
                style={{
                  padding: '12px 24px', borderRadius: 12,
                  background: 'var(--glass-medium)', border: '1px solid var(--border-medium)',
                  color: 'var(--text-secondary)', fontSize: 14, fontWeight: 600,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                <ArrowLeft size={16} /> 上一步
              </button>
            )}

            {current.link && (
              <button
                onClick={handleGoSetup}
                style={{
                  padding: '12px 24px', borderRadius: 12,
                  background: 'var(--glass-medium)', border: `1px solid ${current.color}40`,
                  color: current.color, fontSize: 14, fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                前往設定
              </button>
            )}

            <button
              onClick={handleNext}
              style={{
                padding: '12px 28px', borderRadius: 12, border: 'none',
                background: `linear-gradient(135deg, ${current.color}, var(--accent-blue))`,
                color: '#fff', fontSize: 14, fontWeight: 700,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                boxShadow: `0 4px 20px ${current.color}30`,
              }}
            >
              {isLast ? (
                <><CheckCircle size={16} /> 完成設定</>
              ) : (
                <>{isFirst ? '開始設定' : '下一步'} <ArrowRight size={16} /></>
              )}
            </button>
          </div>

          {/* Skip */}
          {!isLast && (
            <button
              onClick={() => { localStorage.setItem('sme_onboarded', 'true'); if (onComplete) onComplete() }}
              style={{
                background: 'none', border: 'none', color: 'var(--text-muted)',
                fontSize: 12, cursor: 'pointer', marginTop: 20,
              }}
            >
              跳過導覽
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
