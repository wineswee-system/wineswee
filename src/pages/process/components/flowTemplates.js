// Rule-based flow generator (fallback when no AI key)
export function generateFlowByRules(prompt) {
  const p = prompt.toLowerCase()
  const TEMPLATES = {
    onboard: {
      match: ['新人', '到職', '入職', '報到', 'onboard', '新員工'],
      name: '新人到職 SOP', category: 'HR',
      description: '新進員工到職標準流程，從報到到獨立上線',
      steps: [
        { title: '人事資料建檔', role: '人資部', priority: '高', description: '身分證影本、存摺影本、勞保加保' },
        { title: '設備與帳號開通', role: '管理部', priority: '高', description: 'Email、系統帳號、POS 權限、LINE 群組' },
        { title: '工作環境介紹', role: '店長', priority: '中', description: '門市導覽、設備使用、安全逃生路線' },
        { title: '公司制度說明', role: '人資部', priority: '中', description: '出勤規則、請假流程、薪資結構、福利制度' },
        { title: '營運 SOP 教學', role: '店長', priority: '高', description: '開關店流程、收銀、商品知識、客服話術' },
        { title: 'POS 系統實操訓練', role: '管理部', priority: '高', description: '結帳、退貨、庫存查詢、電子發票' },
        { title: '實習跟班（3天）', role: '店長', priority: '中', description: '跟隨資深人員實習，熟悉日常流程' },
        { title: '獨立上線確認', role: '督導', priority: '高', description: '考核通過、正式排班' },
      ],
    },
    inventory: {
      match: ['盤點', '庫存', 'inventory', '倉庫'],
      name: '每月盤點 SOP', category: '倉管',
      description: '每月庫存盤點標準流程，確保帳實相符',
      steps: [
        { title: '盤點日期通知', role: '督導', priority: '中', description: '提前 3 天通知各門市' },
        { title: '列印盤點表', role: '倉儲物流部', priority: '中', description: '匯出庫存清單' },
        { title: '實體商品清點', role: '店長', priority: '高', description: '逐項清點數量，記錄在盤點表' },
        { title: '差異比對', role: '倉儲物流部', priority: '高', description: '系統帳面 vs 實際數量' },
        { title: '差異原因調查', role: '督導', priority: '高', description: '損耗、破損、失竊、系統錯誤' },
        { title: '庫存調整', role: '倉儲物流部', priority: '中', description: '系統調整，填寫異動原因' },
        { title: '盤點報告', role: '倉儲物流部', priority: '中', description: '彙整結果、計算盤差率' },
        { title: '主管審核', role: '營運部', priority: '高', description: '審閱報告、簽核歸檔' },
      ],
    },
    store: {
      match: ['開店', '新店', '展店', '開幕', '門市'],
      name: '新店開幕 SOP', category: '展店',
      description: '開設新門市完整標準作業流程',
      steps: [
        { title: '場地評估與選址', role: '展店事業部', priority: '高', description: '商圈分析、人流、租金比較' },
        { title: '租約簽訂', role: '總經理室', priority: '高', description: '議價、合約審閱、簽約' },
        { title: '營業登記與許可', role: '管理部', priority: '高', description: '營業登記、許可證辦理' },
        { title: '裝潢設計確認', role: '品牌行銷部', priority: '高', description: '平面圖、施工圖、品牌規範' },
        { title: '裝潢施工', role: '管理部', priority: '高', description: '發包、進度追蹤、工程會議' },
        { title: '設備採購安裝', role: '管理部', priority: '高', description: 'POS、監視器、冷藏設備' },
        { title: '人員招募', role: '人資部', priority: '中', description: '開缺、面試、錄取' },
        { title: '教育訓練', role: '營運部', priority: '中', description: 'SOP 教學、POS 訓練' },
        { title: '首批進貨', role: '倉儲物流部', priority: '中', description: '備貨、驗收入庫、系統建檔' },
        { title: '陳列上架', role: '營運部', priority: '中', description: '商品陳列、標價、動線確認' },
        { title: '行銷規劃', role: '品牌行銷部', priority: '中', description: '開幕優惠、社群宣傳' },
        { title: '試營運', role: '營運部', priority: '高', description: '模擬消費、測試流程、修正' },
        { title: '正式開幕', role: '營運部', priority: '高', description: '開幕活動、首日數據追蹤' },
      ],
    },
    complaint: {
      match: ['客訴', '投訴', '客戶抱怨', '客服'],
      name: '客訴處理 SOP', category: '營運',
      description: '顧客投訴處理標準流程',
      steps: [
        { title: '接收客訴', role: '門市人員', priority: '高', description: '記錄內容、客戶資訊、訴求' },
        { title: '初步安撫', role: '門市人員', priority: '高', description: '致歉、表達重視、告知處理時程' },
        { title: '事件調查', role: '店長', priority: '高', description: '了解經過、調閱監視器' },
        { title: '擬定方案', role: '督導', priority: '中', description: '退換貨/賠償方案' },
        { title: '回覆客戶', role: '店長', priority: '高', description: '通知處理結果、執行補救' },
        { title: '內部檢討', role: '營運部', priority: '中', description: '檢討會議、制定預防措施' },
        { title: '結案歸檔', role: '管理部', priority: '低', description: '更新紀錄、歸檔' },
      ],
    },
    purchase: {
      match: ['採購', '進貨', '購買', '供應商'],
      name: '採購申請 SOP', category: '採購',
      description: '設備與原物料採購標準流程',
      steps: [
        { title: '需求提出', role: '店長', priority: '中', description: '填寫品項、數量、規格、預算' },
        { title: '採購審核', role: '採購部', priority: '中', description: '確認需求合理性、預算' },
        { title: '供應商詢價', role: '採購部', priority: '中', description: '向 2-3 家詢價比較' },
        { title: '比價與議價', role: '採購部', priority: '中', description: '選定供應商' },
        { title: '主管核准', role: '總經理室', priority: '高', description: '大額採購需核准' },
        { title: '到貨驗收', role: '倉儲物流部', priority: '高', description: '核對品項、數量、品質' },
        { title: '入庫建檔', role: '倉儲物流部', priority: '中', description: '系統入庫、設定庫存' },
        { title: '請款付款', role: '管理部', priority: '中', description: '核對發票、安排付款' },
      ],
    },
    marketing: {
      match: ['行銷', '活動', '促銷', '企劃', '宣傳'],
      name: '行銷活動企劃 SOP', category: '行銷',
      description: '行銷活動從企劃到執行的完整流程',
      steps: [
        { title: '活動目標設定', role: '行銷部', priority: '高', description: '確認目標（營收/會員/曝光）、KPI' },
        { title: '企劃案撰寫', role: '行銷部', priority: '高', description: '活動內容、預算、時程表' },
        { title: '主管審核', role: '營運部', priority: '中', description: '審核企劃、預算核准' },
        { title: '素材設計', role: '設計部', priority: '中', description: '視覺設計、文案、印刷物' },
        { title: '通路準備', role: '行銷部', priority: '中', description: '社群排程、EDM、門市佈置' },
        { title: '活動執行', role: '門市/行銷部', priority: '高', description: '上線執行、即時監控' },
        { title: '數據追蹤', role: '行銷部', priority: '中', description: '追蹤 KPI、每日回報' },
        { title: '結案報告', role: '行銷部', priority: '中', description: '成效分析、ROI 計算、檢討' },
      ],
    },
    finance: {
      match: ['報帳', '報銷', '核銷', '費用', '財務'],
      name: '費用報銷 SOP', category: '財務',
      description: '員工費用報銷申請流程',
      steps: [
        { title: '填寫報銷單', role: '申請人', priority: '中', description: '金額、用途、附上收據' },
        { title: '主管審核', role: '部門主管', priority: '中', description: '確認費用合理性' },
        { title: '財務覆核', role: '財務部', priority: '高', description: '核對金額、收據、科目' },
        { title: '款項撥付', role: '財務部', priority: '中', description: '匯款或現金發放' },
        { title: '記帳歸檔', role: '財務部', priority: '低', description: '入帳、收據歸檔' },
      ],
    },
    training: {
      match: ['訓練', '培訓', '教育', '課程'],
      name: '員工培訓 SOP', category: 'HR',
      description: '員工教育訓練規劃與執行流程',
      steps: [
        { title: '需求評估', role: '人資部', priority: '中', description: '蒐集各部門訓練需求' },
        { title: '課程規劃', role: '人資部', priority: '中', description: '排定課程、講師、場地' },
        { title: '通知與報名', role: '人資部', priority: '中', description: '發布公告、確認出席' },
        { title: '教材準備', role: '講師', priority: '中', description: '準備教材、測驗題目' },
        { title: '課程執行', role: '講師', priority: '高', description: '授課、實作演練' },
        { title: '測驗評核', role: '人資部', priority: '中', description: '考試或實作評核' },
        { title: '成果紀錄', role: '人資部', priority: '低', description: '登錄時數、成績歸檔' },
      ],
    },
  }

  // Match keywords
  for (const tpl of Object.values(TEMPLATES)) {
    if (tpl.match.some(kw => p.includes(kw))) {
      return { name: tpl.name, category: tpl.category, description: tpl.description, steps: tpl.steps }
    }
  }

  // Generic fallback
  const name = prompt.length > 20 ? prompt.slice(0, 20) + '...' : prompt
  return {
    name: `${name} SOP`,
    category: '營運',
    description: `根據「${prompt}」自動生成的流程`,
    steps: [
      { title: '需求確認', role: '負責人', priority: '高', description: '確認目標、範圍、時程' },
      { title: '方案規劃', role: '負責人', priority: '高', description: '擬定執行計畫' },
      { title: '資源準備', role: '負責人', priority: '中', description: '人力、物料、預算確認' },
      { title: '主管核准', role: '主管', priority: '中', description: '審核計畫、核准執行' },
      { title: '任務執行', role: '執行團隊', priority: '高', description: '依計畫執行' },
      { title: '進度追蹤', role: '負責人', priority: '中', description: '定期回報進度' },
      { title: '成果驗收', role: '主管', priority: '高', description: '確認完成、品質檢查' },
      { title: '結案歸檔', role: '負責人', priority: '低', description: '文件整理、經驗記錄' },
    ],
  }
}
