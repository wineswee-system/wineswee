import { MockTable, MockStat, MockBadge, MockCard, MockRow } from '../../components/ui/FeatureCarousel'

// ━━━━━━━━━━━━━━━━━━━━ 數據分析 ━━━━━━━━━━━━━━━━━━━━
export const ANALYTICS_STEPS = [
  {
    title: 'BI 營運看板',
    desc: '即時營運數據圖表化呈現，營收趨勢、庫存狀態、人力配置一目瞭然。',
    screenTitle: '分析 / BI 看板',
    screen: (
      <div>
        <MockRow>
          <MockStat label="月營收" value="$3.2M" color="#059669" />
          <MockStat label="毛利率" value="34%" color="#2563eb" />
          <MockStat label="出勤率" value="96%" color="#7c3aed" />
        </MockRow>
        <MockCard title="營收趨勢（近 6 月）">
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 80 }}>
            {[55, 62, 58, 71, 68, 78].map((h, i) => (
              <div key={i} style={{ flex: 1, background: i === 5 ? '#2563eb' : '#2563eb30', borderRadius: 3, height: `${h}%` }} />
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#94a3b8', marginTop: 4 }}>
            <span>11月</span><span>12月</span><span>1月</span><span>2月</span><span>3月</span><span>4月</span>
          </div>
        </MockCard>
      </div>
    ),
  },
  {
    title: '異常偵測',
    desc: 'AI 自動掃描營運數據，標記異常值（如突然的成本飆升、庫存異常消耗）。',
    screenTitle: '分析 / 異常偵測',
    screen: (
      <div>
        <MockTable headers={['偵測時間', '類型', '描述', '嚴重度']} rows={[
          ['04/06', '成本異常', '鮮奶油單價較上月上漲 23%', <MockBadge color="#ef4444">高</MockBadge>],
          ['04/05', '庫存異常', 'A001 有機牛奶消耗速度異常加快', <MockBadge color="#d97706">中</MockBadge>],
          ['04/03', '出勤異常', '台中店連續 3 天遲到人數偏高', <MockBadge color="#d97706">中</MockBadge>],
        ]} />
      </div>
    ),
  },
  {
    title: '自訂儀表板',
    desc: '拖拉式配置個人化看板，選擇關心的指標和圖表類型，儲存後每次登入自動載入。',
    screenTitle: '分析 / 自訂儀表板',
    screen: (
      <div>
        <MockCard title="我的看板 — 老闆日報">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <MockStat label="今日營收" value="$98K" color="#059669" />
            <MockStat label="待收帳款" value="$890K" color="#d97706" />
            <MockStat label="低庫存品" value="12" color="#ef4444" />
            <MockStat label="待審假單" value="3" color="#2563eb" />
          </div>
        </MockCard>
        <div style={{ marginTop: 8, fontSize: 11, color: '#94a3b8', textAlign: 'center' }}>
          拖拉即可調整配置 · 支援匯出 PDF · 可排程 Email 寄送
        </div>
      </div>
    ),
  },
]
