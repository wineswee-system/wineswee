-- ════════════════════════════════════════════════════════════════════════════
-- 全導航逐入口權限（自動生成，勿手改；來源 sidebarConfig.js + Sidebar.jsx）
-- 2026-08-06  每個 top tab 一個 nav.top.<key>、每個 leaf 一個 nav.entry.<path>
-- 預設「沿用現況」：角色現在看得到才 seed（不放寬不縮緊）；super_admin 全給。
-- 共 251 個權限碼（top 9 + leaf 去重後）；重複 path 略過 0 筆。idempotent。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO public.permissions (code, name, module, is_active) VALUES
  ('nav.entry.system.enabled', '（系統）逐入口權限已啟用', '導航 · 系統', true),
  ('nav.top.dashboard', '導航：儀表板', '導航 · 上排', true),
  ('nav.top.commerce', '導航：商務營運', '導航 · 上排', true),
  ('nav.top.supply', '導航：供應鏈', '導航 · 上排', true),
  ('nav.top.dispatch', '導航：物流調度', '導航 · 上排', true),
  ('nav.top.finance', '導航：財務會計', '導航 · 上排', true),
  ('nav.top.people', '導航：人員組織', '導航 · 上排', true),
  ('nav.top.project', '導航：專案流程', '導航 · 上排', true),
  ('nav.top.comms', '導航：通訊協作', '導航 · 上排', true),
  ('nav.top.analytics', '導航：數據分析', '導航 · 上排', true),
  ('nav.entry.crm.overview', '商務營運 · 總覽', '導航 · 商務營運', true),
  ('nav.entry.crm.leads', '商務營運 · 線索管理', '導航 · 商務營運', true),
  ('nav.entry.crm.customers', '商務營運 · 客戶管理', '導航 · 商務營運', true),
  ('nav.entry.crm.contacts', '商務營運 · 聯絡人', '導航 · 商務營運', true),
  ('nav.entry.crm.customer-360', '商務營運 · 客戶 360', '導航 · 商務營運', true),
  ('nav.entry.crm.segments', '商務營運 · 客戶分群', '導航 · 商務營運', true),
  ('nav.entry.crm.pipeline', '商務營運 · 銷售漏斗', '導航 · 商務營運', true),
  ('nav.entry.crm.activities', '商務營運 · 活動排程', '導航 · 商務營運', true),
  ('nav.entry.crm.members', '商務營運 · 會員管理', '導航 · 商務營運', true),
  ('nav.entry.crm.levels', '商務營運 · 會員等級設定', '導航 · 商務營運', true),
  ('nav.entry.crm.groups', '商務營運 · 會員群組', '導航 · 商務營運', true),
  ('nav.entry.crm.coupons', '商務營運 · 優惠券管理', '導航 · 商務營運', true),
  ('nav.entry.crm.purchases', '商務營運 · 消費紀錄', '導航 · 商務營運', true),
  ('nav.entry.crm.surveys', '商務營運 · 問卷管理', '導航 · 商務營運', true),
  ('nav.entry.crm.pilots', '商務營運 · Pilot 試跑', '導航 · 商務營運', true),
  ('nav.entry.crm.marketing', '商務營運 · 行銷活動', '導航 · 商務營運', true),
  ('nav.entry.crm.drip-campaigns', '商務營運 · Drip Campaign', '導航 · 商務營運', true),
  ('nav.entry.crm.forms', '商務營運 · 表單建立器', '導航 · 商務營運', true),
  ('nav.entry.crm.workflows', '商務營運 · 工作流程', '導航 · 商務營運', true),
  ('nav.entry.crm.messages', '商務營運 · 發送紀錄', '導航 · 商務營運', true),
  ('nav.entry.crm.service', '商務營運 · 客服工單', '導航 · 商務營運', true),
  ('nav.entry.crm.reports', '商務營運 · CRM 報表', '導航 · 商務營運', true),
  ('nav.entry.sales', '商務營運 · 銷售總覽', '導航 · 商務營運', true),
  ('nav.entry.sales.quotations', '商務營運 · 報價管理', '導航 · 商務營運', true),
  ('nav.entry.sales.orders', '商務營運 · 銷售訂單', '導航 · 商務營運', true),
  ('nav.entry.sales.promotions', '商務營運 · 促銷活動', '導航 · 商務營運', true),
  ('nav.entry.sales.pricing', '商務營運 · 價格規則', '導航 · 商務營運', true),
  ('nav.entry.sales.commission', '商務營運 · 業務佣金', '導航 · 商務營運', true),
  ('nav.entry.sales.returns', '商務營運 · 銷售退貨', '導航 · 商務營運', true),
  ('nav.entry.sales.allowances', '商務營運 · 銷貨折讓單', '導航 · 商務營運', true),
  ('nav.entry.sales.shipments', '商務營運 · 物流追蹤', '導航 · 商務營運', true),
  ('nav.entry.pos', '商務營運 · 營運總覽', '導航 · 商務營運', true),
  ('nav.entry.pos.terminal', '商務營運 · 收銀台', '導航 · 商務營運', true),
  ('nav.entry.pos.shifts', '商務營運 · 交班日結', '導航 · 商務營運', true),
  ('nav.entry.pos.z-report', '商務營運 · Z 報表', '導航 · 商務營運', true),
  ('nav.entry.pos.menu', '商務營運 · 菜單管理', '導航 · 商務營運', true),
  ('nav.entry.pos.products', '商務營運 · 商品目錄', '導航 · 商務營運', true),
  ('nav.entry.pos.waiter', '商務營運 · 服務員點餐', '導航 · 商務營運', true),
  ('nav.entry.pos.kitchen', '商務營運 · 廚房顯示', '導航 · 商務營運', true),
  ('nav.entry.pos.qr-settings', '商務營運 · QR 點餐設定', '導航 · 商務營運', true),
  ('nav.entry.pos.qr-tables', '商務營運 · QR 桌台管理', '導航 · 商務營運', true),
  ('nav.entry.pos.staff-performance', '商務營運 · 員工業績', '導航 · 商務營運', true),
  ('nav.entry.pos.orders', '商務營運 · 訂單記錄', '導航 · 商務營運', true),
  ('nav.entry.pos.x-report', '商務營運 · X 報表', '導航 · 商務營運', true),
  ('nav.entry.pos.monthly-report', '商務營運 · 月業績報表', '導航 · 商務營運', true),
  ('nav.entry.pos.invoices', '商務營運 · 發票查詢', '導航 · 商務營運', true),
  ('nav.entry.reservations.overview', '商務營運 · 今日總覽', '導航 · 商務營運', true),
  ('nav.entry.reservations.list', '商務營運 · 訂位清單', '導航 · 商務營運', true),
  ('nav.entry.reservations.seating', '商務營運 · 座位地圖', '導航 · 商務營運', true),
  ('nav.entry.reservations.tables', '商務營運 · 桌位設定', '導航 · 商務營運', true),
  ('nav.entry.reservations.rules', '商務營運 · 訂位規則', '導航 · 商務營運', true),
  ('nav.entry.purchase.suppliers', '供應鏈 · 供應商', '導航 · 供應鏈', true),
  ('nav.entry.purchase.categories', '供應鏈 · 供應商分類', '導航 · 供應鏈', true),
  ('nav.entry.purchase.performance', '供應鏈 · 供應商績效', '導航 · 供應鏈', true),
  ('nav.entry.purchase.onboarding', '供應鏈 · 廠商入駐', '導航 · 供應鏈', true),
  ('nav.entry.purchase.requests', '供應鏈 · 採購申請', '導航 · 供應鏈', true),
  ('nav.entry.purchase.orders', '供應鏈 · 採購單', '導航 · 供應鏈', true),
  ('nav.entry.purchase.receipts', '供應鏈 · 進貨驗收', '導航 · 供應鏈', true),
  ('nav.entry.purchase.allowances', '供應鏈 · 進貨折讓單', '導航 · 供應鏈', true),
  ('nav.entry.purchase.contracts', '供應鏈 · 合約管理', '導航 · 供應鏈', true),
  ('nav.entry.purchase.blanket', '供應鏈 · 長期採購協議', '導航 · 供應鏈', true),
  ('nav.entry.purchase.pipeline', '供應鏈 · 採購管線', '導航 · 供應鏈', true),
  ('nav.entry.purchase.workflow', '供應鏈 · 採購流程', '導航 · 供應鏈', true),
  ('nav.entry.purchase.matching', '供應鏈 · 三方比對', '導航 · 供應鏈', true),
  ('nav.entry.wms.overview', '供應鏈 · 倉庫總覽', '導航 · 供應鏈', true),
  ('nav.entry.wms.skus', '供應鏈 · 商品主檔', '導航 · 供應鏈', true),
  ('nav.entry.wms.bins', '供應鏈 · 儲位管理', '導航 · 供應鏈', true),
  ('nav.entry.wms.inbound', '供應鏈 · 進貨管理', '導航 · 供應鏈', true),
  ('nav.entry.wms.inventory', '供應鏈 · 庫存管理', '導航 · 供應鏈', true),
  ('nav.entry.wms.outbound', '供應鏈 · 出貨管理', '導航 · 供應鏈', true),
  ('nav.entry.wms.pick-pack-ship', '供應鏈 · 揀貨/包裝/出貨', '導航 · 供應鏈', true),
  ('nav.entry.wms.transfers', '供應鏈 · 倉庫調撥', '導航 · 供應鏈', true),
  ('nav.entry.wms.returns', '供應鏈 · RMA / 倉退', '導航 · 供應鏈', true),
  ('nav.entry.wms.kitting', '供應鏈 · 組合商品', '導航 · 供應鏈', true),
  ('nav.entry.wms.lots', '供應鏈 · 批號追蹤', '導航 · 供應鏈', true),
  ('nav.entry.wms.stock-count', '供應鏈 · 盤點作業', '導航 · 供應鏈', true),
  ('nav.entry.wms.valuation', '供應鏈 · 庫存估價', '導航 · 供應鏈', true),
  ('nav.entry.wms.reports', '供應鏈 · 異常與報表', '導航 · 供應鏈', true),
  ('nav.entry.wms.ai', '供應鏈 · AI 庫存管理', '導航 · 供應鏈', true),
  ('nav.entry.manufacturing.bom', '供應鏈 · BOM 物料清單', '導航 · 供應鏈', true),
  ('nav.entry.manufacturing.mrp', '供應鏈 · MRP 需求計畫', '導航 · 供應鏈', true),
  ('nav.entry.manufacturing.orders', '供應鏈 · 製令管理', '導航 · 供應鏈', true),
  ('nav.entry.manufacturing.scheduling', '供應鏈 · 生產排程', '導航 · 供應鏈', true),
  ('nav.entry.manufacturing.shop-floor', '供應鏈 · 生產現場', '導航 · 供應鏈', true),
  ('nav.entry.manufacturing.work-centers', '供應鏈 · 工作中心', '導航 · 供應鏈', true),
  ('nav.entry.manufacturing.qm', '供應鏈 · 品質管理', '導航 · 供應鏈', true),
  ('nav.entry.manufacturing.subcontracting', '供應鏈 · 託外加工', '導航 · 供應鏈', true),
  ('nav.entry.finance.overview', '財務會計 · 財務總覽', '導航 · 財務會計', true),
  ('nav.entry.finance.journal', '財務會計 · 傳票管理', '導航 · 財務會計', true),
  ('nav.entry.finance.ar', '財務會計 · 應收帳款', '導航 · 財務會計', true),
  ('nav.entry.finance.ap', '財務會計 · 應付帳款', '導航 · 財務會計', true),
  ('nav.entry.finance.invoices', '財務會計 · 電子發票', '導航 · 財務會計', true),
  ('nav.entry.finance.bank', '財務會計 · 銀行對帳', '導航 · 財務會計', true),
  ('nav.entry.finance.open-items', '財務會計 · 立沖帳管理', '導航 · 財務會計', true),
  ('nav.entry.finance.notes', '財務會計 · 票據管理', '導航 · 財務會計', true),
  ('nav.entry.finance.settlement-batches', '財務會計 · 卡款結算批次', '導航 · 財務會計', true),
  ('nav.entry.finance.trial-balance', '財務會計 · 試算表', '導航 · 財務會計', true),
  ('nav.entry.finance.balance-sheet', '財務會計 · 資產負債表', '導航 · 財務會計', true),
  ('nav.entry.finance.profit-loss', '財務會計 · 損益表', '導航 · 財務會計', true),
  ('nav.entry.finance.cash-flow', '財務會計 · 現金流量表', '導航 · 財務會計', true),
  ('nav.entry.finance.general-ledger', '財務會計 · 總分類帳', '導航 · 財務會計', true),
  ('nav.entry.finance.journal-book', '財務會計 · 日記簿', '導航 · 財務會計', true),
  ('nav.entry.finance.cost-of-goods', '財務會計 · 營業成本表', '導航 · 財務會計', true),
  ('nav.entry.finance.tax-reports', '財務會計 · 稅務申報', '導航 · 財務會計', true),
  ('nav.entry.finance.tax-filing', '財務會計 · 營業稅申報', '導航 · 財務會計', true),
  ('nav.entry.finance.tax-report', '財務會計 · 401 營業稅報表', '導航 · 財務會計', true),
  ('nav.entry.finance.invoice-tracks', '財務會計 · 發票字軌配號', '導航 · 財務會計', true),
  ('nav.entry.finance.chart-of-accounts', '財務會計 · 會計科目', '導航 · 財務會計', true),
  ('nav.entry.finance.currencies', '財務會計 · 幣別管理', '導航 · 財務會計', true),
  ('nav.entry.finance.budgets', '財務會計 · 預算管理', '導航 · 財務會計', true),
  ('nav.entry.finance.cost-centers', '財務會計 · 成本中心', '導航 · 財務會計', true),
  ('nav.entry.finance.profit-loss-by-dept', '財務會計 · 部門損益表', '導航 · 財務會計', true),
  ('nav.entry.finance.fixed-assets', '財務會計 · 固定資產', '導航 · 財務會計', true),
  ('nav.entry.finance.exchange-rates', '財務會計 · 匯率管理', '導航 · 財務會計', true),
  ('nav.entry.finance.period-close', '財務會計 · 期間關帳', '導航 · 財務會計', true),
  ('nav.entry.finance.posting-rules', '財務會計 · 過帳規則', '導航 · 財務會計', true),
  ('nav.entry.org.overview', '人員組織 · 總覽', '導航 · 人員組織', true),
  ('nav.entry.org.organizations', '人員組織 · 組織', '導航 · 人員組織', true),
  ('nav.entry.org.chart', '人員組織 · 組織圖', '導航 · 人員組織', true),
  ('nav.entry.org.companies', '人員組織 · 公司', '導航 · 人員組織', true),
  ('nav.entry.org.departments', '人員組織 · 部門', '導航 · 人員組織', true),
  ('nav.entry.org.locations', '人員組織 · 門市', '導航 · 人員組織', true),
  ('nav.entry.org.employees', '人員組織 · 員工', '導航 · 人員組織', true),
  ('nav.entry.hr.attendance', '人員組織 · 打卡追蹤', '導航 · 人員組織', true),
  ('nav.entry.hr.clock-rules', '人員組織 · 打卡規則設定', '導航 · 人員組織', true),
  ('nav.entry.hr.attendance-diff-report', '人員組織 · 月結核對報表', '導航 · 人員組織', true),
  ('nav.entry.hr.punch-correction', '人員組織 · 補登申請', '導航 · 人員組織', true),
  ('nav.entry.hr.overtime', '人員組織 · 加班申請', '導航 · 人員組織', true),
  ('nav.entry.hr.leave', '人員組織 · 請假管理', '導航 · 人員組織', true),
  ('nav.entry.hr.leave-calendar', '人員組織 · 請假日曆', '導航 · 人員組織', true),
  ('nav.entry.hr.leave-balances', '人員組織 · 假別餘額', '導航 · 人員組織', true),
  ('nav.entry.hr.comp-time-balance', '人員組織 · 補休餘額', '導航 · 人員組織', true),
  ('nav.entry.hr.disaster', '人員組織 · 天災管理', '導航 · 人員組織', true),
  ('nav.entry.hr.import', '人員組織 · 資料匯入', '導航 · 人員組織', true),
  ('nav.entry.hr.schedule', '人員組織 · 排班', '導航 · 人員組織', true),
  ('nav.entry.hr.my-schedule', '人員組織 · 我的班表', '導航 · 人員組織', true),
  ('nav.entry.hr.off-requests', '人員組織 · 希望休', '導航 · 人員組織', true),
  ('nav.entry.hr.shift-swaps', '人員組織 · 換班', '導航 · 人員組織', true),
  ('nav.entry.hr.schedule-rules', '人員組織 · 排班規則', '導航 · 人員組織', true),
  ('nav.entry.hr.work-unit-settings', '人員組織 · 工時/假別單位', '導航 · 人員組織', true),
  ('nav.entry.hr.holidays', '人員組織 · 假日管理', '導航 · 人員組織', true),
  ('nav.entry.hr.schedule-xlsx-import', '人員組織 · 排班總表匯入', '導航 · 人員組織', true),
  ('nav.entry.hr.forms', '人員組織 · HR 表單中心', '導航 · 人員組織', true),
  ('nav.entry.hr.form-query', '人員組織 · 表單查詢', '導航 · 人員組織', true),
  ('nav.entry.hr.forms.submissions', '人員組織 · 我的提交', '導航 · 人員組織', true),
  ('nav.entry.hr.forms.resignation', '人員組織 · 離職申請', '導航 · 人員組織', true),
  ('nav.entry.hr.forms.loa', '人員組織 · 留職停薪', '導航 · 人員組織', true),
  ('nav.entry.hr.forms.transfer', '人員組織 · 人事異動', '導航 · 人員組織', true),
  ('nav.entry.hr.forms.headcount', '人員組織 · 人力需求', '導航 · 人員組織', true),
  ('nav.entry.org.templates', '人員組織 · 文件範本', '導航 · 人員組織', true),
  ('nav.entry.hr.recently-deleted', '人員組織 · 最近刪除', '導航 · 人員組織', true),
  ('nav.entry.hr.salary', '人員組織 · 薪資管理', '導航 · 人員組織', true),
  ('nav.entry.hr.salary-structures', '人員組織 · 薪資結構', '導航 · 人員組織', true),
  ('nav.entry.hr.payroll', '人員組織 · 薪資發放', '導航 · 人員組織', true),
  ('nav.entry.hr.severance', '人員組織 · 資遣管理', '導航 · 人員組織', true),
  ('nav.entry.hr.legal-deductions', '人員組織 · 法扣管理', '導航 · 人員組織', true),
  ('nav.entry.hr.tax-forms', '人員組織 · 扣繳憑單', '導航 · 人員組織', true),
  ('nav.entry.hr.nhi-supplement', '人員組織 · 二代健保補充保費', '導航 · 人員組織', true),
  ('nav.entry.hr.performance', '人員組織 · 績效管理', '導航 · 人員組織', true),
  ('nav.entry.hr.bonus', '人員組織 · 績效獎金', '導航 · 人員組織', true),
  ('nav.entry.hr.store-bonus', '人員組織 · 門市業績獎金', '導航 · 人員組織', true),
  ('nav.entry.hr.compensation', '人員組織 · 薪酬基準', '導航 · 人員組織', true),
  ('nav.entry.hr.benefit-settings', '人員組織 · 福利政策', '導航 · 人員組織', true),
  ('nav.entry.hr.labor-law-rates', '人員組織 · 法令工資設定', '導航 · 人員組織', true),
  ('nav.entry.hr.insurance-grade', '人員組織 · 健保級距監控', '導航 · 人員組織', true),
  ('nav.entry.hr.recruitment', '人員組織 · 招募管理', '導航 · 人員組織', true),
  ('nav.entry.system.offer-letter-templates', '人員組織 · 通知書範本', '導航 · 人員組織', true),
  ('nav.entry.lms.admin', '人員組織 · 課程管理', '導航 · 人員組織', true),
  ('nav.entry.lms.courses', '人員組織 · 我的學習', '導航 · 人員組織', true),
  ('nav.entry.lms.progress', '人員組織 · 學習進度', '導航 · 人員組織', true),
  ('nav.entry.lms.certificates', '人員組織 · 結業證書', '導航 · 人員組織', true),
  ('nav.entry.hr.probation', '人員組織 · 試用期管理', '導航 · 人員組織', true),
  ('nav.entry.hr.transfer', '人員組織 · 轉調紀錄', '導航 · 人員組織', true),
  ('nav.entry.hr.contract-employees', '人員組織 · 約聘管理', '導航 · 人員組織', true),
  ('nav.entry.hr.foreign-workers', '人員組織 · 外籍移工', '導航 · 人員組織', true),
  ('nav.entry.hr.self-service', '人員組織 · 員工自助', '導航 · 人員組織', true),
  ('nav.entry.hr.surveys', '人員組織 · 滿意度調查', '導航 · 人員組織', true),
  ('nav.entry.hr.assistant', '人員組織 · HR AI 助理', '導航 · 人員組織', true),
  ('nav.entry.hr.attrition', '人員組織 · AI 離職預測', '導航 · 人員組織', true),
  ('nav.entry.hr.report', '人員組織 · HR 報表', '導航 · 人員組織', true),
  ('nav.entry.hr.travel', '人員組織 · 公出差旅', '導航 · 人員組織', true),
  ('nav.entry.hr.documents', '人員組織 · 文件管理', '導航 · 人員組織', true),
  ('nav.entry.hr.labor-inspection', '人員組織 · 勞檢報表', '導航 · 人員組織', true),
  ('nav.entry.process.overview', '專案流程 · 總覽', '導航 · 專案流程', true),
  ('nav.entry.process.projects', '專案流程 · 專案', '導航 · 專案流程', true),
  ('nav.entry.process.workflows', '專案流程 · 流程', '導航 · 專案流程', true),
  ('nav.entry.process.sop', '專案流程 · SOP 範本庫', '導航 · 專案流程', true),
  ('nav.entry.process.approvals', '專案流程 · 簽核', '導航 · 專案流程', true),
  ('nav.entry.process.applications', '專案流程 · 表單設定', '導航 · 專案流程', true),
  ('nav.entry.process.store-audits', '專案流程 · 門市稽核', '導航 · 專案流程', true),
  ('nav.entry.process.tasks', '專案流程 · 任務', '導航 · 專案流程', true),
  ('nav.entry.process.task-confirmations', '專案流程 · 任務確認', '導航 · 專案流程', true),
  ('nav.entry.process.checklists', '專案流程 · 查核清單', '導航 · 專案流程', true),
  ('nav.entry.system.approval-rules', '專案流程 · 簽核規則', '導航 · 專案流程', true),
  ('nav.entry.process.settings.chains', '專案流程 · 簽核鏈設定', '導航 · 專案流程', true),
  ('nav.entry.process.settings.expense-chains', '專案流程 · 費用簽核設定', '導航 · 專案流程', true),
  ('nav.entry.process.settings.categories', '專案流程 · 分類管理', '導航 · 專案流程', true),
  ('nav.entry.process.settings.tags', '專案流程 · 標籤管理', '導航 · 專案流程', true),
  ('nav.entry.ai.nav-assistant', '專案流程 · 導覽助理', '導航 · 專案流程', true),
  ('nav.entry.ai.agent', '專案流程 · Agent 控制台', '導航 · 專案流程', true),
  ('nav.entry.ai.help', '專案流程 · 說明中心', '導航 · 專案流程', true),
  ('nav.entry.ai.tutorial', '專案流程 · 教學中心', '導航 · 專案流程', true),
  ('nav.entry.comms.inbox', '通訊協作 · 收件匣', '導航 · 通訊協作', true),
  ('nav.entry.comms.compose', '通訊協作 · 撰寫郵件', '導航 · 通訊協作', true),
  ('nav.entry.comms.drafts', '通訊協作 · 草稿', '導航 · 通訊協作', true),
  ('nav.entry.comms.sent', '通訊協作 · 寄件備份', '導航 · 通訊協作', true),
  ('nav.entry.comms.mailboxes', '通訊協作 · 共用信箱', '導航 · 通訊協作', true),
  ('nav.entry.comms.calendar', '通訊協作 · 行事曆', '導航 · 通訊協作', true),
  ('nav.entry.comms.booking', '通訊協作 · 預約連結', '導航 · 通訊協作', true),
  ('nav.entry.comms.ooo', '通訊協作 · 不在辦公室', '導航 · 通訊協作', true),
  ('nav.entry.comms.contacts', '通訊協作 · 聯絡人', '導航 · 通訊協作', true),
  ('nav.entry.comms.contacts.import', '通訊協作 · 匯入聯絡人', '導航 · 通訊協作', true),
  ('nav.entry.comms.contacts.sync', '通訊協作 · 同步設定', '導航 · 通訊協作', true),
  ('nav.entry.comms.skills', '通訊協作 · AI 技能', '導航 · 通訊協作', true),
  ('nav.entry.comms.labels', '通訊協作 · 標籤管理', '導航 · 通訊協作', true),
  ('nav.entry.comms.categories', '通訊協作 · 分類管理', '導航 · 通訊協作', true),
  ('nav.entry.comms.rules', '通訊協作 · 郵件規則', '導航 · 通訊協作', true),
  ('nav.entry.comms.accounts', '通訊協作 · 帳號設定', '導航 · 通訊協作', true),
  ('nav.entry.dispatch', '物流調度 · 調度總覽', '導航 · 物流調度', true),
  ('nav.entry.dispatch.queue', '物流調度 · 任務佇列', '導航 · 物流調度', true),
  ('nav.entry.dispatch.routes', '物流調度 · 路線管理', '導航 · 物流調度', true),
  ('nav.entry.dispatch.schedule', '物流調度 · 排程日曆', '導航 · 物流調度', true),
  ('nav.entry.dispatch.tracking', '物流調度 · 追蹤中心', '導航 · 物流調度', true),
  ('nav.entry.dispatch.analytics', '物流調度 · 物流分析', '導航 · 物流調度', true),
  ('nav.entry.dispatch.fleet', '物流調度 · 車輛管理', '導航 · 物流調度', true),
  ('nav.entry.dispatch.fleet.drivers', '物流調度 · 司機管理', '導航 · 物流調度', true),
  ('nav.entry.wms.picklist', '物流調度 · 揀貨管理', '導航 · 物流調度', true),
  ('nav.entry.wms.pack', '物流調度 · 包裝站', '導航 · 物流調度', true),
  ('nav.entry.wms.dock', '物流調度 · 碼頭交接', '導航 · 物流調度', true),
  ('nav.entry.analytics', '數據分析 · 營運總覽', '導航 · 數據分析', true),
  ('nav.entry.analytics.alerts', '數據分析 · 預警中心', '導航 · 數據分析', true),
  ('nav.entry.analytics.cross-system', '數據分析 · 跨系統分析', '導航 · 數據分析', true),
  ('nav.entry.analytics.builder', '數據分析 · 自訂儀表板', '導航 · 數據分析', true),
  ('nav.entry.analytics.process', '數據分析 · 流程分析', '導航 · 數據分析', true),
  ('nav.entry.analytics.finance', '數據分析 · 財務分析', '導航 · 數據分析', true),
  ('nav.entry.analytics.sales', '數據分析 · 銷售績效', '導航 · 數據分析', true),
  ('nav.entry.analytics.hr', '數據分析 · 人資分析', '導航 · 數據分析', true),
  ('nav.entry.analytics.inventory', '數據分析 · 庫存分析', '導航 · 數據分析', true),
  ('nav.entry.analytics.pos', '數據分析 · POS 分析', '導航 · 數據分析', true),
  ('nav.entry.analytics.manufacturing', '數據分析 · 製造分析', '導航 · 數據分析', true),
  ('nav.entry.analytics.crm', '數據分析 · CRM 分析', '導航 · 數據分析', true)
ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, module=EXCLUDED.module, is_active=true;

INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.system.enabled' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.top.dashboard' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.top.commerce'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.top.supply'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.supply') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.top.dispatch' AND r.name='super_admin' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.top.finance'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='finance.view') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.top.people' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.top.project'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.project.work') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.top.comms' AND r.name='super_admin' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.top.analytics'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.analytics') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.crm.overview'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.crm.leads'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.crm.customers'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.crm.contacts'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.crm.customer-360'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.crm.segments'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.crm.pipeline'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.crm.activities'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.crm.members'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.crm.levels'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.crm.groups'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.crm.coupons'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.crm.purchases'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.crm.surveys'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.crm.pilots'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.crm.marketing'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.crm.drip-campaigns'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.crm.forms'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.crm.workflows'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.crm.messages'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.crm.service'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.crm.reports'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.sales'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.sales.quotations'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.sales.orders'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.sales.promotions'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.sales.pricing'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.sales.commission'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.sales.returns'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.sales.allowances'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.sales.shipments'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.pos'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.pos.terminal'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.pos.shifts'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.pos.z-report'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.pos.menu'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.pos.products'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.pos.waiter'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.pos.kitchen'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.pos.qr-settings'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.pos.qr-tables'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.pos.staff-performance'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.pos.orders'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.pos.x-report'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.pos.monthly-report'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.pos.invoices'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.reservations.overview'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.reservations.list'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.reservations.seating'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.reservations.tables'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.reservations.rules'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.crm') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.purchase.suppliers'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.supply') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.purchase.categories'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.supply') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.purchase.performance'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.supply') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.purchase.onboarding'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.supply') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.purchase.requests'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.supply') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.purchase.orders'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.supply') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.purchase.receipts'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.supply') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.purchase.allowances'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.supply') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.purchase.contracts'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.supply') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.purchase.blanket'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.supply') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.purchase.pipeline'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.supply') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.purchase.workflow'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.supply') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.purchase.matching'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.supply') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.wms.overview'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.supply') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.wms.skus'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.supply') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.wms.bins'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.supply') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.wms.inbound'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.supply') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.wms.inventory'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.supply') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.wms.outbound'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.supply') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.wms.pick-pack-ship'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.supply') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.wms.transfers'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.supply') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.wms.returns'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.supply') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.wms.kitting'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.supply') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.wms.lots'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.supply') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.wms.stock-count'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.supply') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.wms.valuation'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.supply') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.wms.reports'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.supply') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.wms.ai'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.supply') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.manufacturing.bom'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.supply') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.manufacturing.mrp'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.supply') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.manufacturing.orders'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.supply') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.manufacturing.scheduling'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.supply') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.manufacturing.shop-floor'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.supply') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.manufacturing.work-centers'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.supply') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.manufacturing.qm'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.supply') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.manufacturing.subcontracting'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.supply') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.finance.overview'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='finance.view') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.finance.journal'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='finance.view') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.finance.ar'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='finance.view') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.finance.ap'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='finance.view') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.finance.invoices'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='finance.view') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.finance.bank'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='finance.view') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.finance.open-items'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='finance.view') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.finance.notes'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='finance.view') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.finance.settlement-batches'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='finance.view') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.finance.trial-balance'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='finance.view') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.finance.balance-sheet'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='finance.view') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.finance.profit-loss'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='finance.view') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.finance.cash-flow'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='finance.view') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.finance.general-ledger'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='finance.view') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.finance.journal-book'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='finance.view') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.finance.cost-of-goods'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='finance.view') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.finance.tax-reports'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='finance.view') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.finance.tax-filing'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='finance.view') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.finance.tax-report'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='finance.view') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.finance.invoice-tracks'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='finance.view') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.finance.chart-of-accounts'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='finance.view') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.finance.currencies'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='finance.view') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.finance.budgets'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='finance.view') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.finance.cost-centers'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='finance.view') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.finance.profit-loss-by-dept'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='finance.view') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.finance.fixed-assets'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='finance.view') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.finance.exchange-rates'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='finance.view') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.finance.period-close'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='finance.view') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.finance.posting-rules'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='finance.view') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.org.overview'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.org.full') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.org.organizations'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.org.full') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.org.chart'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.org.full') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.org.companies'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.org.full') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.org.departments'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.org.departments') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.org.locations'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.org.locations') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.org.employees'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.org.employees') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.attendance' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.clock-rules'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.schedule.config') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.attendance-diff-report'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.schedule.basic') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.punch-correction' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.overtime' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.leave' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.leave-calendar' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.leave-balances' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.comp-time-balance' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.disaster' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.import'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.hr_form.builder') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.schedule'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='schedule.edit') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.my-schedule' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.off-requests' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.shift-swaps' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.schedule-rules'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.schedule.config') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.work-unit-settings'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.schedule.config') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.holidays'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.schedule.basic') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.schedule-xlsx-import'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.schedule.basic') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.forms' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.form-query' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.forms.submissions' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.forms.resignation' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.forms.loa' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.forms.transfer'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.talent') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.forms.headcount'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.talent') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.org.templates'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.hr_form.builder') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.recently-deleted'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.org.full') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.salary'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.salary.basic') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.salary-structures'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.salary.basic') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.payroll'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.salary.basic') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.severance'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.salary.advanced') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.legal-deductions'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.salary.advanced') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.tax-forms'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.salary.advanced') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.nhi-supplement' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.performance'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.salary.advanced') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.bonus'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.salary.advanced') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.store-bonus'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='bonus.store.compute') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.compensation'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.salary.advanced') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.benefit-settings'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.salary.advanced') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.labor-law-rates'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.salary.law') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.insurance-grade'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.salary.law') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.recruitment'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.talent') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.system.offer-letter-templates'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.lms.admin') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.lms.admin'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.lms.admin') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.lms.courses' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.lms.progress'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.schedule.basic') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.lms.certificates' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.probation'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.talent') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.transfer'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.talent') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.contract-employees'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.talent') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.foreign-workers'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.talent') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.self-service' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.surveys'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.experience_mgr') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.assistant'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.experience_mgr') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.attrition'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.experience_mgr') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.report'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.admin_office') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.travel'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.admin_office') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.documents'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.admin_office') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.hr.labor-inspection'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.admin_office') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.process.overview'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.project.work')
         AND EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.project.work') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.process.projects'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.project.work')
         AND EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.project.work') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.process.workflows'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.project.work')
         AND EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.project.work') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.process.sop'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.project.work') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.process.approvals'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.project.work')
         AND EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.project.work') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.process.applications'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.project.work') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.process.store-audits'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.project.work') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.process.tasks'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.project.work')
         AND EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.project.tasks') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.process.task-confirmations'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.project.work') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.process.checklists'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.project.work')
         AND EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.project.work') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.system.approval-rules'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.project.work')
         AND EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.project.admin') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.process.settings.chains'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.project.work')
         AND EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.project.admin') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.process.settings.expense-chains'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.project.work')
         AND EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.project.admin') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.process.settings.categories'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.project.work')
         AND EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.project.admin') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.process.settings.tags'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.project.work')
         AND EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.project.admin') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.ai.nav-assistant'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.project.work')
         AND EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.project.admin') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.ai.agent'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.project.work')
         AND EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.project.admin') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.ai.help'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.project.work')
         AND EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.project.admin') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.ai.tutorial'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.project.work')
         AND EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.project.admin') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.comms.inbox' AND r.name='super_admin' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.comms.compose' AND r.name='super_admin' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.comms.drafts' AND r.name='super_admin' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.comms.sent' AND r.name='super_admin' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.comms.mailboxes' AND r.name='super_admin' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.comms.calendar' AND r.name='super_admin' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.comms.booking' AND r.name='super_admin' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.comms.ooo' AND r.name='super_admin' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.comms.contacts' AND r.name='super_admin' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.comms.contacts.import' AND r.name='super_admin' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.comms.contacts.sync' AND r.name='super_admin' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.comms.skills' AND r.name='super_admin' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.comms.labels' AND r.name='super_admin' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.comms.categories' AND r.name='super_admin' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.comms.rules' AND r.name='super_admin' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.comms.accounts' AND r.name='super_admin' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.dispatch' AND r.name='super_admin' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.dispatch.queue' AND r.name='super_admin' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.dispatch.routes' AND r.name='super_admin' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.dispatch.schedule' AND r.name='super_admin' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.dispatch.tracking' AND r.name='super_admin' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.dispatch.analytics' AND r.name='super_admin' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.dispatch.fleet' AND r.name='super_admin' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.dispatch.fleet.drivers' AND r.name='super_admin' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.wms.picklist' AND r.name='super_admin' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.wms.pack' AND r.name='super_admin' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.wms.dock' AND r.name='super_admin' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.analytics'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.analytics') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.analytics.alerts'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.analytics') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.analytics.cross-system'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.analytics') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.analytics.builder'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.analytics') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.analytics.process'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.analytics') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.analytics.finance'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.analytics') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.analytics.sales'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.analytics') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.analytics.hr'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.analytics') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.analytics.inventory'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.analytics') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.analytics.pos'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.analytics') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.analytics.manufacturing'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.analytics') ))
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p
  WHERE p.code='nav.entry.analytics.crm'
    AND ( r.name='super_admin' OR (
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions pg ON pg.id=rp.permission_id WHERE rp.role_id=r.id AND pg.code='nav.group.analytics') ))
  ON CONFLICT DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';
