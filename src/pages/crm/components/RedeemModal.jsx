import Modal, { Field } from '../../../components/Modal'

export default function RedeemModal({
  redeemMember,
  redeemAmount,
  setRedeemAmount,
  handleRedeem,
  onClose,
  levelBadge,
}) {
  return (
    <Modal
      title={`兌換點數 — ${redeemMember.name}`}
      onClose={onClose}
      onSubmit={handleRedeem}
      submitLabel="確認兌換"
    >
      <div style={{ padding: '8px 12px', background: 'var(--bg-tertiary)', borderRadius: 8, fontSize: 12, marginBottom: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span>目前等級</span>
          <span className={`badge ${levelBadge(redeemMember.level)}`}>
            <span className="badge-dot"></span>{redeemMember.level}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>可用點數</span>
          <span style={{ fontWeight: 700 }}>{(redeemMember.available_points || 0).toLocaleString()}</span>
        </div>
      </div>
      <Field label="兌換點數">
        <input
          className="form-input" type="number" style={{ width: '100%' }}
          placeholder="輸入要兌換的點數" value={redeemAmount}
          onChange={e => setRedeemAmount(e.target.value)}
          min="1" max={redeemMember.available_points || 0}
        />
      </Field>
      {redeemAmount && Number(redeemAmount) > 0 && (
        <div style={{ padding: '10px 12px', background: 'var(--bg-tertiary)', borderRadius: 8, fontSize: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span>折抵金額</span>
            <span style={{ fontWeight: 700, color: 'var(--accent-orange)' }}>
              NT$ {Math.floor(Number(redeemAmount) * 0.5).toLocaleString()}
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            匯率：1 點 = $0.5
          </div>
          {Number(redeemAmount) > (redeemMember.available_points || 0) && (
            <div style={{ color: 'var(--accent-red)', fontSize: 12, marginTop: 6 }}>
              點數不足！可用點數為 {(redeemMember.available_points || 0).toLocaleString()}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
