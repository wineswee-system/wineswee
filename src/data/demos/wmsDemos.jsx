import { MockTable, MockStat, MockBadge, MockBtn, MockCard, MockRow } from '../../components/ui/FeatureCarousel'
import { Check } from 'lucide-react'

// ━━━━━━━━━━━━━━━━━━━━ WMS 倉儲管理 ━━━━━━━━━━━━━━━━━━━━
export const WMS_STEPS = [
  {
    title: '即時庫存總覽',
    desc: '所有商品的即時庫存量、安全存量、儲位分佈，低庫存品項自動標示警示。',
    screenTitle: 'WMS / 庫存管理',
    screen: (
      <div>
        <MockRow>
          <MockStat label="總 SKU" value="1,247" />
          <MockStat label="低庫存警示" value="12" color="#ef4444" />
          <MockStat label="本月入庫" value="340" color="#059669" />
        </MockRow>
        <MockTable headers={['商品', '庫存', '安全量', '狀態']} rows={[
          ['A001 有機牛奶', '45', '50', <MockBadge color="#ef4444">低庫存</MockBadge>],
          ['B012 全麥吐司', '200', '100', <MockBadge color="#059669">正常</MockBadge>],
          ['C003 鮮奶油', '8', '20', <MockBadge color="#ef4444">低庫存</MockBadge>],
          ['D045 雞胸肉', '150', '80', <MockBadge color="#059669">正常</MockBadge>],
        ]} />
      </div>
    ),
  },
  {
    title: '進貨入庫作業',
    desc: '掃描條碼或手動輸入，系統自動比對採購單，驗收後庫存即時更新。',
    screenTitle: 'WMS / 進貨入庫',
    screen: (
      <div>
        <MockCard title="進貨單 #PO-2026-0412">
          <MockRow>
            <MockStat label="供應商" value="統一食品" />
            <MockStat label="採購單" value="PO-20260410" />
          </MockRow>
          <MockTable headers={['品項', '訂購', '到貨', '驗收']} rows={[
            ['有機牛奶', '100', '100', <MockBadge color="#059669">合格</MockBadge>],
            ['鮮奶油', '50', '48', <MockBadge color="#d97706">短少 2</MockBadge>],
            ['雞胸肉', '80', '80', <MockBadge color="#059669">合格</MockBadge>],
          ]} />
          <div style={{ marginTop: 10 }}><MockBtn primary>確認入庫</MockBtn></div>
        </MockCard>
      </div>
    ),
  },
  {
    title: '出貨自動拋帳',
    desc: '出貨完成後系統自動建立應收帳款和會計傳票，不需要再手動到財務系統建帳。',
    screenTitle: 'WMS / 出貨管理',
    screen: (
      <div>
        <MockCard title="出貨單 #SO-2026-0856">
          <MockRow>
            <MockStat label="客戶" value="好吃餐飲" />
            <MockStat label="狀態" value={<MockBadge color="#059669">已出貨</MockBadge>} />
          </MockRow>
          <MockTable headers={['品項', '數量', '單價', '小計']} rows={[['有機牛奶', '30', '$45', '$1,350'], ['全麥吐司', '50', '$35', '$1,750']]} />
          <div style={{ borderTop: '1px solid #e2e8f0', marginTop: 8, paddingTop: 8, fontSize: 11, color: '#64748b' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Check size={12} style={{ color: '#059669' }} /> 已自動建立應收帳款 AR-2026-0856（$3,100）</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}><Check size={12} style={{ color: '#059669' }} /> 已自動建立會計傳票 JV-2026-1203</div>
          </div>
        </MockCard>
      </div>
    ),
  },
  {
    title: '盤點作業',
    desc: '建立盤點單、指派人員，盤點結果自動計算差異，盤盈盤虧即時調整庫存帳。',
    screenTitle: 'WMS / 盤點作業',
    screen: (
      <div>
        <MockCard title="盤點單 #SC-2026-004">
          <MockRow>
            <MockStat label="倉庫" value="台北主倉" />
            <MockStat label="盤點日" value="2026/04/05" />
          </MockRow>
          <MockTable headers={['品項', '系統數', '實際數', '差異']} rows={[
            ['有機牛奶', '45', '43', <MockBadge color="#ef4444">-2</MockBadge>],
            ['全麥吐司', '200', '200', <MockBadge color="#059669">0</MockBadge>],
            ['雞胸肉', '150', '152', <MockBadge color="#d97706">+2</MockBadge>],
          ]} />
          <div style={{ marginTop: 8 }}><MockBtn primary>確認調整庫存</MockBtn></div>
        </MockCard>
      </div>
    ),
  },
]
