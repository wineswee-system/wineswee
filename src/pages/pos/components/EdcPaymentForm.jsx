import { CreditCard } from 'lucide-react'
import { EDC_CARD_BRANDS } from '../../../lib/paymentGateway'

/**
 * 中信 EDC 端末機刷卡登錄表單（F-D1 店內刷卡）
 * 店員於中國信託刷卡機完成過卡後，登錄 卡別／末四碼／授權碼，
 * 結帳時由 POSTerminal 呼叫 recordEdcPayment() 寫入 pos_payments（gateway='ctbc_edc'）。
 */
export default function EdcPaymentForm({ value = {}, onChange, disabled = false }) {
  const set = (field, v) => onChange?.({ ...value, [field]: v })

  return (
    <div
      className="card"
      style={{ marginTop: 16, padding: 16, border: '1px solid var(--accent-cyan)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <CreditCard size={16} style={{ color: 'var(--accent-cyan)' }} />
        <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>信用卡（中信 EDC 端末機）</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
        請先於中國信託刷卡機完成過卡，再登錄以下資訊（結帳時寫入卡收明細）
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
            卡別 <span style={{ color: 'var(--accent-red)' }}>*</span>
          </label>
          <select
            className="form-input"
            style={{ width: '100%' }}
            value={value.card_brand ?? ''}
            disabled={disabled}
            onChange={e => set('card_brand', e.target.value)}
          >
            <option value="" disabled>請選擇卡別</option>
            {EDC_CARD_BRANDS.map(brand => (
              <option key={brand} value={brand}>{brand}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
            卡號末四碼 <span style={{ color: 'var(--accent-red)' }}>*</span>
          </label>
          <input
            className="form-input"
            style={{ width: '100%' }}
            type="text"
            inputMode="numeric"
            maxLength={4}
            placeholder="例：1234"
            value={value.card_last4 ?? ''}
            disabled={disabled}
            onChange={e => set('card_last4', e.target.value.replace(/\D/g, '').slice(0, 4))}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
            授權碼 <span style={{ color: 'var(--accent-red)' }}>*</span>
          </label>
          <input
            className="form-input"
            style={{ width: '100%' }}
            type="text"
            maxLength={8}
            placeholder="4–8 位英數字"
            value={value.auth_code ?? ''}
            disabled={disabled}
            onChange={e => set('auth_code', e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 8))}
          />
        </div>
      </div>
    </div>
  )
}
