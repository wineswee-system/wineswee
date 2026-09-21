import { MockTable, MockStat, MockBadge, MockBtn, MockField, MockCard, MockRow } from '../../components/ui/FeatureCarousel'
import { Check } from 'lucide-react'

// ━━━━━━━━━━━━━━━━━━━━ HR 人事管理 ━━━━━━━━━━━━━━━━━━━━
export const HR_STEPS = [
  {
    title: '員工 GPS 打卡',
    desc: '員工到門市後按下打卡，系統自動比對 GPS 座標和 WiFi IP，確認在合理範圍內才算有效打卡。',
    screenTitle: 'HR / 出勤管理',
    screen: (
      <div>
        <MockRow>
          <MockStat label="今日出勤" value="23/25" color="#059669" />
          <MockStat label="遲到" value="1" color="#d97706" />
          <MockStat label="請假中" value="1" color="#2563eb" />
        </MockRow>
        <MockCard title="王小明 — 打卡紀錄">
          <MockRow>
            <MockField label="上班打卡" value="08:52" />
            <MockField label="驗證方式" value="GPS 定位 + WiFi" />
          </MockRow>
          <MockRow>
            <MockField label="門市" value="台北信義店" />
            <MockField label="狀態" value={<MockBadge color="#059669">正常</MockBadge>} />
          </MockRow>
        </MockCard>
      </div>
    ),
  },
  {
    title: '假單申請與主管簽核',
    desc: '員工選擇假別和日期後送出，系統自動判斷假別餘額，並通知直屬主管審核（LINE 即時推播）。',
    screenTitle: 'HR / 請假管理',
    screen: (
      <div>
        <MockCard title="請假申請">
          <MockRow>
            <MockField label="假別" value="特休假" />
            <MockField label="剩餘" value="7 天" />
          </MockRow>
          <MockRow>
            <MockField label="日期" value="2026/04/10 ~ 04/11" />
            <MockField label="天數" value="2 天" />
          </MockRow>
          <MockField label="事由" value="家庭旅遊" />
          <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
            <MockBtn primary>送出申請</MockBtn>
            <MockBtn>取消</MockBtn>
          </div>
        </MockCard>
      </div>
    ),
  },
  {
    title: '薪資計算與明細',
    desc: '系統根據出勤、請假、加班、扣款自動計算月薪，每筆扣款都有明確分類和計算依據。',
    screenTitle: 'HR / 薪資管理',
    screen: (
      <div>
        <MockCard title="2026-04 薪資明細 — 王小明">
          <MockTable
            headers={['項目', '金額']}
            rows={[
              ['底薪', 'NT$ 40,000'],
              ['職務津貼', '+3,000'],
              ['加班費（12 hr）', '+5,200'],
              ['事假扣薪（1 天）', '-1,333'],
              ['勞保自付', '-1,042'],
              ['健保自付', '-826'],
            ]}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontWeight: 700, fontSize: 13 }}>
            <span>實發薪資</span>
            <span style={{ color: '#059669' }}>NT$ 44,999</span>
          </div>
        </MockCard>
      </div>
    ),
  },
  {
    title: '智慧排班與法規檢核',
    desc: '拖拉式排班，系統即時檢查勞基法（七休一、連續工時上限），違規時自動標紅警示。',
    screenTitle: 'HR / 排班系統',
    screen: (
      <div>
        <MockCard title="本週排班 — 台北信義店">
          <MockTable
            headers={['員工', '一', '二', '三', '四', '五', '六', '日']}
            rows={[
              ['王小明', '早', '早', '晚', '休', '早', '早', '休'],
              ['李美玲', '晚', '休', '早', '早', '晚', '休', '早'],
              ['張大偉', '休', '早', '早', '晚', '休', '早', '早'],
            ]}
          />
          <div style={{ marginTop: 8, fontSize: 11, color: '#059669', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Check size={12} /> 排班合規檢核通過（勞基法 / 性平法）
          </div>
        </MockCard>
      </div>
    ),
  },
  {
    title: '績效考核與獎金',
    desc: '設定 KPI 項目與權重，考核結果自動連動獎金計算，主管可線上評分並留下評語。',
    screenTitle: 'HR / 績效管理',
    screen: (
      <div>
        <MockCard title="2026 Q1 績效 — 王小明">
          <MockTable
            headers={['KPI 項目', '目標', '實際', '達成率']}
            rows={[
              ['業績達標', '$500K', '$620K', <MockBadge color="#059669">124%</MockBadge>],
              ['客戶滿意度', '90%', '92%', <MockBadge color="#059669">102%</MockBadge>],
              ['專案準時率', '95%', '88%', <MockBadge color="#d97706">93%</MockBadge>],
            ]}
          />
          <MockRow>
            <MockField label="綜合評等" value={<MockBadge color="#059669">A</MockBadge>} />
            <MockField label="獎金" value="NT$ 15,000" />
          </MockRow>
        </MockCard>
      </div>
    ),
  },
]
