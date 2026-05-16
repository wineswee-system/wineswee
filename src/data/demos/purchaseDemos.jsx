import { MockTable, MockStat, MockBadge, MockBtn, MockField, MockCard, MockRow } from '../../components/ui/FeatureCarousel'

// ━━━━━━━━━━━━━━━━━━━━ 採購管理 ━━━━━━━━━━━━━━━━━━━━
export const PURCHASE_STEPS = [
  {
    title: '供應商管理與評等',
    desc: '建立供應商檔案，記錄付款條件、交期表現、品質評分，定期自動更新評等。',
    screenTitle: '採購 / 供應商管理',
    screen: (
      <div>
        <MockTable headers={['供應商', '評等', '準時率', '合格率', '合作年數']} rows={[
          ['統一食品', <MockBadge color="#059669">A</MockBadge>, '96%', '99%', '5 年'],
          ['大成長城', <MockBadge color="#059669">A</MockBadge>, '92%', '97%', '3 年'],
          ['新東陽', <MockBadge color="#d97706">B</MockBadge>, '85%', '94%', '1 年'],
        ]} />
      </div>
    ),
  },
  {
    title: '採購申請與動態簽核',
    desc: '採購人員填寫需求，系統依金額和類別自動路由到對應主管審核。',
    screenTitle: '採購 / 採購申請',
    screen: (
      <div>
        <MockCard title="採購申請 #PR-2026-0198">
          <MockRow>
            <MockField label="申請人" value="張大偉" />
            <MockField label="金額" value="$85,000" />
          </MockRow>
          <MockTable headers={['品項', '數量', '預估單價']} rows={[['有機牛奶', '500', '$45'], ['鮮奶油', '200', '$80'], ['雞胸肉', '300', '$65']]} />
          <div style={{ marginTop: 8, fontSize: 11, color: '#64748b' }}>
            簽核流程：採購主管 → 財務主管（金額 ≥ $50,000）
          </div>
        </MockCard>
      </div>
    ),
  },
  {
    title: '三方比對（PO / GR / Invoice）',
    desc: '採購單、進貨驗收單、供應商發票三方自動比對，差異即時標示。',
    screenTitle: '採購 / 三方比對',
    screen: (
      <div>
        <MockCard title="比對結果 — PO-2026-0410">
          <MockTable headers={['品項', '採購單', '驗收單', '發票', '狀態']} rows={[
            ['有機牛奶', '100', '100', '100', <MockBadge color="#059669">一致</MockBadge>],
            ['鮮奶油', '50', '48', '50', <MockBadge color="#ef4444">差異</MockBadge>],
            ['雞胸肉', '80', '80', '80', <MockBadge color="#059669">一致</MockBadge>],
          ]} />
          <div style={{ marginTop: 8, padding: 8, borderRadius: 6, background: '#fef2f2', border: '1px solid #fecaca', fontSize: 12, color: '#991b1b' }}>
            鮮奶油：驗收數量 48 與採購單 50 不符，請確認短少原因
          </div>
        </MockCard>
      </div>
    ),
  },
]
