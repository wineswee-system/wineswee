import React from 'react'
import { CheckCircle, AlertCircle, FlaskConical, Award } from 'lucide-react'
import Modal from '../../../components/Modal'

export default function MarketingSendResultModal({ sendResult, onClose }) {
  return (
    <Modal title="發送結果" onClose={onClose} onSubmit={onClose}>
      <div style={{ textAlign: 'center', padding: '12px 0' }}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>
          {sendResult.failed === 0 ? <CheckCircle size={48} style={{ color: 'var(--accent-green)' }} /> : <AlertCircle size={48} style={{ color: 'var(--accent-orange)' }} />}
        </div>
        <h3 style={{ margin: '8px 0', color: 'var(--text-primary)' }}>{sendResult.campaignName}</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>管道：{sendResult.channel}</p>
        {sendResult.unsubFiltered > 0 && (
          <p style={{ color: 'var(--accent-orange)', fontSize: 12 }}>已排除 {sendResult.unsubFiltered} 位退訂用戶</p>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, margin: '16px 0' }}>
        <div style={{ padding: 12, borderRadius: 10, background: 'var(--glass-light)', textAlign: 'center', border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent-cyan)' }}>{sendResult.total}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>總發送數</div>
        </div>
        <div style={{ padding: 12, borderRadius: 10, background: 'var(--glass-light)', textAlign: 'center', border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent-green)' }}>{sendResult.delivered || 0}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>成功送達</div>
        </div>
        <div style={{ padding: 12, borderRadius: 10, background: 'var(--glass-light)', textAlign: 'center', border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent-red)' }}>{sendResult.failed}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>發送失敗</div>
        </div>
      </div>

      {sendResult.metrics && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 12 }}>
          <div style={{ padding: 10, borderRadius: 8, background: 'var(--accent-green-dim)', textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent-green)' }}>{sendResult.openRate}%</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>開啟率</div>
          </div>
          <div style={{ padding: 10, borderRadius: 8, background: 'var(--accent-purple-dim)', textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent-purple)' }}>{sendResult.clickRate}%</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>點擊率</div>
          </div>
          <div style={{ padding: 10, borderRadius: 8, background: 'var(--accent-red-dim)', textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent-red)' }}>{sendResult.bounceRate}%</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>退信率</div>
          </div>
          <div style={{ padding: 10, borderRadius: 8, background: 'var(--accent-orange-dim)', textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent-orange)' }}>{sendResult.unsubRate}%</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>退訂率</div>
          </div>
        </div>
      )}

      {/* A/B Test Result */}
      {sendResult.abResult && (
        <div style={{ padding: '12px 16px', borderRadius: 10, background: 'var(--glass-light)', border: '1px solid var(--accent-purple)', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontWeight: 700, fontSize: 14, color: 'var(--accent-purple)' }}>
            <FlaskConical size={16} /> A/B 測試結果
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ padding: 10, borderRadius: 8, background: sendResult.abResult.winner === 'A' ? 'var(--accent-green-dim)' : 'var(--bg-card)', border: `1px solid ${sendResult.abResult.winner === 'A' ? 'var(--accent-green)' : 'var(--border-subtle)'}`, textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                A 版 ({sendResult.abResult.groupASize} 人)
                {sendResult.abResult.winner === 'A' && <Award size={12} style={{ marginLeft: 4, color: 'var(--accent-green)' }} />}
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{sendResult.abResult.subjectA}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: sendResult.abResult.winner === 'A' ? 'var(--accent-green)' : 'var(--text-secondary)' }}>{sendResult.abResult.openRateA}%</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>開啟率</div>
            </div>
            <div style={{ padding: 10, borderRadius: 8, background: sendResult.abResult.winner === 'B' ? 'var(--accent-green-dim)' : 'var(--bg-card)', border: `1px solid ${sendResult.abResult.winner === 'B' ? 'var(--accent-green)' : 'var(--border-subtle)'}`, textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                B 版 ({sendResult.abResult.groupBSize} 人)
                {sendResult.abResult.winner === 'B' && <Award size={12} style={{ marginLeft: 4, color: 'var(--accent-green)' }} />}
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{sendResult.abResult.subjectB}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: sendResult.abResult.winner === 'B' ? 'var(--accent-green)' : 'var(--text-secondary)' }}>{sendResult.abResult.openRateB}%</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>開啟率</div>
            </div>
          </div>
          <div style={{ textAlign: 'center', marginTop: 10, fontSize: 13, fontWeight: 700, color: 'var(--accent-green)' }}>
            <Award size={14} /> 勝出：{sendResult.abResult.winner} 版（開啟率 {sendResult.abResult.winner === 'A' ? sendResult.abResult.openRateA : sendResult.abResult.openRateB}%）
          </div>
        </div>
      )}
    </Modal>
  )
}
