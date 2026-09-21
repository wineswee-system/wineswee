import { Send, CheckCircle } from 'lucide-react'

const MODULE_OPTIONS = ['HR 人資', 'CRM 客戶', 'WMS 倉儲', '銷售', 'POS', '採購', '財務', '製造品管', '流程', '組織', '數據分析', 'AI', '全部都要']

export default function DemoContactSection({ inquiry, setInquiry, inquiryStatus, onSubmit, toggleModule }) {
  return (
    <>
      {inquiryStatus === 'success' ? (
        <div className="demo-form-done">
          <CheckCircle size={40} strokeWidth={1.5} />
          <h3>感謝您的諮詢</h3>
          <p>我們會在 1 個工作天內與您聯繫。</p>
        </div>
      ) : (
        <div className="demo-form">
          <div className="demo-form-row">
            {[
              { key: 'company_name', label: '公司名稱 *', ph: '例：好吃餐飲有限公司' },
              { key: 'contact_name', label: '聯絡人 *', ph: '王小明' },
              { key: 'phone', label: '電話 *', ph: '0912-345-678' },
              { key: 'email', label: 'Email', ph: 'example@company.com' },
            ].map(f => (
              <label key={f.key} className="demo-field">
                <span>{f.label}</span>
                <input
                  type="text" placeholder={f.ph} value={inquiry[f.key]}
                  onChange={e => setInquiry(prev => ({ ...prev, [f.key]: e.target.value }))}
                />
              </label>
            ))}
          </div>

          <label className="demo-field">
            <span>公司人數</span>
            <select value={inquiry.company_size} onChange={e => setInquiry(prev => ({ ...prev, company_size: e.target.value }))}>
              <option value="">請選擇</option>
              {['1-10 人', '11-30 人', '31-50 人', '51-100 人', '100 人以上'].map(o => <option key={o}>{o}</option>)}
            </select>
          </label>

          <div className="demo-field">
            <span>感興趣的模組</span>
            <div className="demo-chips">
              {MODULE_OPTIONS.map(mod => (
                <button
                  key={mod}
                  className={`demo-chip ${inquiry.interested_modules.includes(mod) ? 'on' : ''}`}
                  onClick={() => toggleModule(mod)}
                >{mod}</button>
              ))}
            </div>
          </div>

          {inquiryStatus === 'error' && <p style={{ color: 'var(--accent-red)', fontSize: 13, textAlign: 'center' }}>提交失敗，請稍後再試</p>}

          <button
            className={`demo-submit ${inquiry.company_name && inquiry.contact_name && inquiry.phone ? 'ready' : ''}`}
            onClick={onSubmit}
            disabled={inquiryStatus === 'sending' || !inquiry.company_name || !inquiry.contact_name || !inquiry.phone}
          >
            <Send size={15} />
            {inquiryStatus === 'sending' ? '提交中...' : '提交諮詢'}
          </button>
        </div>
      )}
    </>
  )
}
