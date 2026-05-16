import { MockTable, MockStat, MockBadge, MockBtn, MockField, MockCard, MockRow } from '../../components/ui/FeatureCarousel'

// ━━━━━━━━━━━━━━━━━━━━ CRM 客戶管理 ━━━━━━━━━━━━━━━━━━━━
export const CRM_STEPS = [
  {
    title: '客戶 360° 全視角',
    desc: '一個畫面看到客戶所有資訊：基本資料、交易紀錄、客服工單、行銷互動、合約狀態。',
    screenTitle: 'CRM / 客戶 360°',
    screen: (
      <div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: '#2563eb15', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14 }}>好</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>好吃餐飲有限公司</div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>VIP 客戶 · 合作 2 年</div>
          </div>
        </div>
        <MockRow>
          <MockStat label="累計營收" value="$2.4M" color="#059669" />
          <MockStat label="進行中訂單" value="3" color="#2563eb" />
          <MockStat label="待處理工單" value="1" color="#d97706" />
        </MockRow>
        <MockCard title="最近交易">
          <MockTable headers={['日期', '品項', '金額']} rows={[['04/01', '食材 A 批', '$45,000'], ['03/15', '設備維護', '$12,000']]} />
        </MockCard>
      </div>
    ),
  },
  {
    title: '銷售漏斗追蹤',
    desc: '從潛在客戶到成交，每個階段的商機數量和金額一目瞭然，拖拉即可更新階段。',
    screenTitle: 'CRM / 銷售漏斗',
    screen: (
      <div>
        <MockRow>
          <MockStat label="漏斗總額" value="$8.2M" color="#7c3aed" />
          <MockStat label="進行中" value="24" color="#2563eb" />
          <MockStat label="本月成交" value="$1.6M" color="#059669" />
        </MockRow>
        <MockCard>
          <div style={{ display: 'flex', gap: 6 }}>
            {[
              { stage: '接洽中', n: 8, color: '#94a3b8' },
              { stage: '需求確認', n: 6, color: '#2563eb' },
              { stage: '報價中', n: 5, color: '#d97706' },
              { stage: '議價', n: 3, color: '#7c3aed' },
              { stage: '成交', n: 2, color: '#059669' },
            ].map(s => (
              <div key={s.stage} style={{ flex: 1, textAlign: 'center', padding: '8px 4px', borderRadius: 6, background: `${s.color}10`, fontSize: 10 }}>
                <div style={{ fontWeight: 700, color: s.color, fontSize: 16 }}>{s.n}</div>
                <div style={{ color: '#64748b', marginTop: 2 }}>{s.stage}</div>
              </div>
            ))}
          </div>
        </MockCard>
      </div>
    ),
  },
  {
    title: '行銷自動化 Drip Campaign',
    desc: '設定觸發條件和行銷流程，系統自動發送 Email、LINE 訊息，追蹤開信率和轉換率。',
    screenTitle: 'CRM / 行銷自動化',
    screen: (
      <div>
        <MockCard title="春季促銷 Drip Campaign">
          <MockRow>
            <MockField label="狀態" value={<MockBadge color="#059669">執行中</MockBadge>} />
            <MockField label="已觸發" value="342 人" />
          </MockRow>
          <MockTable headers={['步驟', '動作', '完成率']} rows={[['Day 0', '歡迎信', '89%'], ['Day 3', '產品介紹', '67%'], ['Day 7', '限時優惠', '45%'], ['Day 14', '跟進提醒', '進行中']]} />
        </MockCard>
      </div>
    ),
  },
  {
    title: '客服工單管理',
    desc: '客戶問題統一建單追蹤，指派負責人、設定優先度，確保每個問題都有人處理。',
    screenTitle: 'CRM / 客服工單',
    screen: (
      <div>
        <MockRow>
          <MockStat label="待處理" value="5" color="#ef4444" />
          <MockStat label="處理中" value="8" color="#d97706" />
          <MockStat label="已結案" value="142" color="#059669" />
        </MockRow>
        <MockTable headers={['工單', '客戶', '優先度', '狀態']} rows={[
          ['#T-0891', '好吃餐飲', <MockBadge color="#ef4444">緊急</MockBadge>, <MockBadge color="#d97706">處理中</MockBadge>],
          ['#T-0890', '大方貿易', <MockBadge color="#d97706">中</MockBadge>, <MockBadge color="#059669">已回覆</MockBadge>],
          ['#T-0889', '科技新創', <MockBadge color="#2563eb">低</MockBadge>, <MockBadge color="#059669">已結案</MockBadge>],
        ]} />
      </div>
    ),
  },
]
