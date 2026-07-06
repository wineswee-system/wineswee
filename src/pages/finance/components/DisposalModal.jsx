import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { ModalOverlay } from '../../../components/Modal'
import Badge from '../../../components/ui/Badge'
import { computeDisposal, disposeAsset } from '../../../lib/accounting/fixedAssetOps'
import { toast } from '../../../lib/toast'
import { fmtNT as fmt } from '../../../lib/currency'

// ─── F-A5 固定資產處分（出售/報廢）────────────────────────────────
// 損益試算（純前端，與 secure_dispose_fixed_asset 同口徑）→ RPC：
// 沖銷成本與累計折舊、認列處分損益、自動拋轉 'asset_disposal' 傳票。

const inputStyle = { width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)' }
const labelStyle = { display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }

export default function DisposalModal({ asset, onClose, onDisposed }) {
  const [disposalType, setDisposalType] = useState('出售')
  const [proceeds, setProceeds] = useState('')
  const [disposalDate, setDisposalDate] = useState(new Date().toISOString().slice(0, 10))
  const [submitting, setSubmitting] = useState(false)

  const effectiveProceeds = disposalType === '報廢' ? 0 : (Number(proceeds) || 0)

  const preview = useMemo(
    () => computeDisposal(asset, { proceeds: effectiveProceeds, disposalDate }),
    [asset, effectiveProceeds, disposalDate]
  )

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      const result = await disposeAsset(asset.id, disposalType, effectiveProceeds, disposalDate)
      const gl = result?.gain_loss ?? preview.gainLoss
      toast.success(
        `已${disposalType}「${asset.name}」，處分${gl >= 0 ? '利益' : '損失'} ${fmt(Math.abs(gl))}（傳票草稿，請至傳票管理過帳）`
      )
      onDisposed?.()
      onClose()
    } catch (err) {
      toast.error(err.message)
    }
    setSubmitting(false)
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 24, width: 'min(480px, calc(100vw - 32px))', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>資產處分 — {asset.name}</h3>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={onClose}><X size={20} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>處分方式</label>
              <select value={disposalType} onChange={e => setDisposalType(e.target.value)} style={inputStyle}>
                <option value="出售">出售</option>
                <option value="報廢">報廢</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>處分日期</label>
              <input type="date" value={disposalDate} onChange={e => setDisposalDate(e.target.value)} style={inputStyle} />
            </div>
          </div>

          {disposalType === '出售' && (
            <div>
              <label style={labelStyle}>處分價款</label>
              <input type="number" value={proceeds} onChange={e => setProceeds(e.target.value)} placeholder="0" style={inputStyle} />
            </div>
          )}

          {/* 損益試算 */}
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, background: 'var(--bg-main)', fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
              <span style={{ color: 'var(--text-secondary)' }}>原始成本</span>
              <span style={{ fontFamily: 'monospace' }}>{fmt(asset.cost)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
              <span style={{ color: 'var(--text-secondary)' }}>累計折舊（至處分月前一月底）</span>
              <span style={{ fontFamily: 'monospace' }}>{fmt(preview.accumulatedDepreciation)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
              <span style={{ color: 'var(--text-secondary)' }}>帳面價值</span>
              <span style={{ fontFamily: 'monospace' }}>{fmt(preview.bookValue)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
              <span style={{ color: 'var(--text-secondary)' }}>處分價款</span>
              <span style={{ fontFamily: 'monospace' }}>{fmt(effectiveProceeds)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0 0', marginTop: 6, borderTop: '1px solid var(--border)' }}>
              <span style={{ fontWeight: 600 }}>預估處分損益</span>
              {preview.gainLoss >= 0 ? (
                <Badge status="success" size="sm">利益 {fmt(preview.gainLoss)}</Badge>
              ) : (
                <Badge status="error" size="sm">損失 ({fmt(Math.abs(preview.gainLoss))})</Badge>
              )}
            </div>
          </div>

          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)' }}>
            確認後將沖銷資產成本與累計折舊、認列處分損益並自動拋轉傳票，資產狀態改為
            {disposalType === '出售' ? '「已處分」' : '「已報廢」'}，此動作無法復原。
          </p>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button className="btn btn-secondary" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? '處理中...' : `確認${disposalType}`}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}
