// ── 主功能配置（104 風格）──
// 每個 feature 對應 1 個查詢 perm 和/或 1 個修改 perm。
// 沒有 view = 該功能本身就是動作（如「假單核可」），只顯示「修改」
// 沒有 edit = 該功能只能查看（如「全公司薪資」），只顯示「查詢」
// 規則：點修改 ON → 自動帶上查詢 ON；點查詢 OFF → 自動帶上修改 OFF
export const FEATURES = [
  // 組織架構
  { module: '組織架構', label: '員工基本資料',   view: 'org.employee.view',     edit: 'org.employee.edit' },
  { module: '組織架構', label: '員工完整個資',   view: 'org.employee.view_full', edit: null },
  { module: '組織架構', label: '刪除員工 / 離職', view: null, edit: 'org.employee.delete' },
  { module: '組織架構', label: '組織架構編輯',   view: null, edit: 'org.structure.edit' },
  // 出勤與請假
  { module: '出勤與請假', label: '打卡紀錄', view: 'attendance.view_all', edit: 'attendance.edit' },
  { module: '出勤與請假', label: '假單核可', view: null, edit: 'leave.approve' },
  { module: '出勤與請假', label: '加班核可', view: null, edit: 'ot.approve' },
  { module: '出勤與請假', label: '出差核可', view: null, edit: 'trip.approve' },
  { module: '出勤與請假', label: '假別設定', view: null, edit: 'leave_type.edit' },
  // 排班管理
  { module: '排班管理', label: '排班',            view: 'schedule.view_all', edit: 'schedule.edit' },
  { module: '排班管理', label: '排班演算法',      view: null, edit: 'schedule.algo' },
  { module: '排班管理', label: '排班規則 / 班別', view: null, edit: 'schedule.rule_edit' },
  // HR 表單
  { module: 'HR 表單', label: '審核 HR 表單', view: 'hr_form.view', edit: 'hr_form.approve' },
  { module: 'HR 表單', label: 'HR 表單範本',  view: null,           edit: 'hr_form.template_edit' },
  // 薪酬與福利
  { module: '薪酬與福利', label: '部門薪資',   view: 'salary.view_dept',     edit: null },
  { module: '薪酬與福利', label: '全公司薪資', view: 'salary.view_all',      edit: null },
  { module: '薪酬與福利', label: '薪資結構',   view: null,                   edit: 'salary.edit' },
  { module: '薪酬與福利', label: '批次計薪',   view: null,                   edit: 'salary.compute' },
  { module: '薪酬與福利', label: '逐筆調整薪資', view: null,                 edit: 'salary.adjust' },
  { module: '薪酬與福利', label: '薪資發放 / 銀行帳號 / 代發薪檔', view: null,  edit: 'salary.pay' },
  { module: '薪酬與福利', label: '資遣',       view: 'severance.view',       edit: 'severance.execute' },
  { module: '薪酬與福利', label: '法扣',       view: 'legal_deduction.view', edit: 'legal_deduction.edit' },
  { module: '薪酬與福利', label: '績效獎金',   view: 'bonus.view',           edit: 'bonus.compute' },
  { module: '薪酬與福利', label: '門市業績獎金', view: null,                 edit: 'bonus.store.compute' },
  { module: '薪酬與福利', label: '勞健保級距', view: 'insurance_rate.view',  edit: 'insurance_rate.edit' },
  // 人才發展
  { module: '人才發展', label: '招募管理',   view: 'recruit.view',   edit: 'recruit.manage' },
  { module: '人才發展', label: '教育訓練',   view: 'training.view',  edit: 'training.manage' },
  { module: '人才發展', label: '試用期評核', view: 'probation.view', edit: 'probation.evaluate' },
  // 員工體驗
  { module: '員工體驗', label: '滿意度調查結果', view: 'survey.view_result', edit: null },
  { module: '員工體驗', label: 'AI 離職預測',    view: 'ai_attrition.view',  edit: null },
  // 行政庶務
  { module: '行政庶務', label: '費用申請審核', view: 'expense.view',         edit: 'expense.approve' },
  { module: '行政庶務', label: '費用核銷(驗收)', view: 'expense.settle_view',  edit: 'expense.settle' },
  { module: '行政庶務', label: '會計科目',     view: 'expense.account_view', edit: 'expense.account_edit' },
  { module: '行政庶務', label: '文件',         view: 'doc.view',             edit: 'doc.delete' },
  // 專案流程
  { module: '專案流程', label: '專案',         view: 'project.view',         edit: 'project.manage' },
  { module: '專案流程', label: '任務指派',     view: null,                   edit: 'task.assign' },
  { module: '專案流程', label: '簽核鏈設定',   view: 'approval_chain.view',  edit: 'approval_chain.edit' },
  // 系統設定
  { module: '系統設定', label: '使用者管理',     view: 'system.user_view',       edit: 'system.user_manage' },
  { module: '系統設定', label: '員工個別權限',   view: 'system.permission_view', edit: 'system.permission_manage' },
  { module: '系統設定', label: '操作紀錄',       view: 'audit.view',             edit: null },
  { module: '系統設定', label: '系統設定編輯',   view: null,                     edit: 'system.admin' },
  { module: '系統設定', label: '租戶管理',       view: null,                     edit: 'system.tenant_manage' },
  // 財務（未交付，super_admin 才看得到）
  { module: '財務', label: '財務查看', view: 'finance.view', edit: null },
  { module: '財務', label: '財務編輯', view: null,           edit: 'finance.edit' },
  // 導航顯示（sidebar 顯示控制，單一 toggle）
  { module: '導航顯示', label: 'CRM 群組顯示',          view: null, edit: 'nav.group.crm' },
  { module: '導航顯示', label: '供應鏈群組顯示',        view: null, edit: 'nav.group.supply' },
  { module: '導航顯示', label: '分析群組顯示',          view: null, edit: 'nav.group.analytics' },
  { module: '導航顯示', label: '系統群組顯示',          view: null, edit: 'nav.group.system' },
  { module: '導航顯示', label: '超管群組顯示',          view: null, edit: 'nav.group.super_admin' },
  { module: '導航顯示', label: '組織完整管理',          view: null, edit: 'nav.org.full' },
  { module: '導航顯示', label: '組織內部資料',          view: null, edit: 'nav.org.internal' },
  { module: '導航顯示', label: '排班與假日',            view: null, edit: 'nav.schedule.basic' },
  { module: '導航顯示', label: '排班規則 / 工時設定',   view: null, edit: 'nav.schedule.config' },
  { module: '導航顯示', label: '薪資查看與發放',        view: null, edit: 'nav.salary.basic' },
  { module: '導航顯示', label: '進階薪資',              view: null, edit: 'nav.salary.advanced' },
  { module: '導航顯示', label: '法令工資設定',          view: null, edit: 'nav.salary.law' },
  { module: '導航顯示', label: '人才發展',              view: null, edit: 'nav.talent' },
  { module: '導航顯示', label: '員工體驗管理',          view: null, edit: 'nav.experience_mgr' },
  { module: '導航顯示', label: '行政庶務',              view: null, edit: 'nav.admin_office' },
  { module: '導航顯示', label: '表單建立器',            view: null, edit: 'nav.hr_form.builder' },
  { module: '導航顯示', label: '專案工作管理',          view: null, edit: 'nav.project.work' },
  { module: '導航顯示', label: '專案設定 / AI 助理',    view: null, edit: 'nav.project.admin' },
]
