import { MockTable, MockStat, MockBadge, MockBtn, MockField, MockCard, MockRow } from '../../components/ui/FeatureCarousel'

// ━━━━━━━━━━━━━━━━━━━━ 銷售管理 ━━━━━━━━━━━━━━━━━━━━
export const SALES_STEPS = [
  {
    title: '報價單版本管理',
    desc: '建立報價單支援版本控管（v1, v2...），客戶確認後一鍵轉為銷售訂單。',
    screenTitle: '銷售 / 報價管理',
    screen: (
      <div>
        <MockCard title="報價單 QT-2026-0089 v2">
          <MockRow>
            <MockField label="客戶" value="好吃餐飲" />
            <MockField label="狀態" value={<MockBadge color="#d97706">待確認</MockBadge>} />
          </MockRow>
          <MockTable headers={['品項', '數量', '單價', '小計']} rows={[['有機牛奶', '200', '$45', '$9,000'], ['全麥吐司', '100', '$35', '$3,500'], ['鮮奶油', '50', '$80', '$4,000']]} />
          <div style={{ marginTop: 8, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <MockBtn>編輯</MockBtn>
            <MockBtn primary>轉為訂單</MockBtn>
          </div>
        </MockCard>
      </div>
    ),
  },
  {
    title: '促銷引擎',
    desc: '設定滿額折、階梯折、VIP 價、組合優惠等規則，訂單成立時自動套用。',
    screenTitle: '銷售 / 促銷活動',
    screen: (
      <div>
        <MockCard title="進行中的促銷">
          <MockTable headers={['活動名稱', '類型', '折扣', '狀態']} rows={[
            ['春季大促', '滿額折', '滿 $5,000 折 $500', <MockBadge color="#059669">進行中</MockBadge>],
            ['VIP 專屬', 'VIP 價', '9 折', <MockBadge color="#059669">進行中</MockBadge>],
            ['買三送一', '組合優惠', '買 3 件送 1', <MockBadge color="#94a3b8">排程中</MockBadge>],
          ]} />
        </MockCard>
      </div>
    ),
  },
  {
    title: '銷售訂單與信用檢核',
    desc: '建立訂單時自動比對客戶信用額度，超過 80% 橘色警示、超過 100% 紅色阻擋。',
    screenTitle: '銷售 / 銷售訂單',
    screen: (
      <div>
        <MockCard title="訂單 #ORD-2026-1042">
          <MockRow>
            <MockField label="客戶" value="好吃餐飲" />
            <MockField label="信用額度" value="$500,000" />
          </MockRow>
          <MockRow>
            <MockField label="已用額度" value="$420,000 (84%)" />
            <MockField label="本單金額" value="$16,500" />
          </MockRow>
          <div style={{ marginTop: 8, padding: 8, borderRadius: 6, background: '#fef3c7', border: '1px solid #fcd34d', fontSize: 12, color: '#92400e' }}>
            信用額度使用率已達 87%，請注意應收帳款回收進度
          </div>
        </MockCard>
      </div>
    ),
  },
]
