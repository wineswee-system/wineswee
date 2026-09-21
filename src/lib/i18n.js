// Lightweight i18n translation system for Taiwan SME ERP
// No external dependencies — simple key-value lookup with fallback

export const DEFAULT_LOCALE = 'zh-TW'
export const AVAILABLE_LOCALES = ['zh-TW', 'en']

export const translations = {
  'zh-TW': {
    // common
    'common.save': '儲存',
    'common.cancel': '取消',
    'common.delete': '刪除',
    'common.add': '新增',
    'common.edit': '編輯',
    'common.search': '搜尋',
    'common.export': '匯出',
    'common.print': '列印',
    'common.confirm': '確認',
    'common.back': '返回',
    'common.all': '全部',
    'common.noData': '無資料',
    'common.loading': '載入中',
    'common.success': '成功',
    'common.failed': '失敗',
    'common.submit': '送出',
    'common.reset': '重設',
    'common.close': '關閉',
    'common.view': '檢視',
    'common.download': '下載',
    'common.upload': '上傳',
    'common.refresh': '重新整理',
    'common.filter': '篩選',
    'common.sort': '排序',
    'common.actions': '操作',
    'common.status': '狀態',
    'common.date': '日期',
    'common.name': '名稱',
    'common.description': '描述',
    'common.amount': '金額',
    'common.total': '合計',
    'common.quantity': '數量',
    'common.unit': '單位',
    'common.price': '價格',
    'common.note': '備註',
    'common.type': '類型',
    'common.category': '分類',
    'common.yes': '是',
    'common.no': '否',
    'common.enabled': '啟用',
    'common.disabled': '停用',

    // nav
    'nav.dashboard': '儀表板',
    'nav.analytics': '數據分析',
    'nav.hr': '人資管理',
    'nav.finance': '財務',
    'nav.sales': '銷售',
    'nav.purchase': '採購',
    'nav.inventory': '庫存',
    'nav.manufacturing': '製造',
    'nav.crm': 'CRM',
    'nav.pos': 'POS',
    'nav.process': '流程',
    'nav.system': '系統',
    'nav.settings': '設定',
    'nav.logout': '登出',

    // hr
    'hr.employee': '員工',
    'hr.employees': '員工列表',
    'hr.attendance': '出勤',
    'hr.leave': '請假',
    'hr.overtime': '加班',
    'hr.salary': '薪資',
    'hr.schedule': '排班',
    'hr.performance': '績效',
    'hr.recruitment': '招募',
    'hr.bonus': '獎金',
    'hr.expense': '費用',
    'hr.document': '文件',
    'hr.holiday': '國定假日',
    'hr.travel': '出差',
    'hr.report': '人資報表',

    // finance
    'finance.journalEntry': '傳票',
    'finance.accountsReceivable': '應收帳款',
    'finance.accountsPayable': '應付帳款',
    'finance.budget': '預算',
    'finance.invoice': '發票',
    'finance.trialBalance': '試算表',
    'finance.balanceSheet': '資產負債表',
    'finance.profitLoss': '損益表',
    'finance.bankReconciliation': '銀行對帳',
    'finance.cashFlow': '現金流量',
    'finance.taxReport': '稅務報表',
    'finance.costCenter': '成本中心',

    // crm
    'crm.customer': '客戶',
    'crm.customers': '客戶列表',
    'crm.opportunity': '商機',
    'crm.pipeline': '銷售漏斗',
    'crm.marketing': '行銷',
    'crm.member': '會員',
    'crm.service': '客服',
    'crm.campaign': '行銷活動',
    'crm.lead': '潛在客戶',
    'crm.contact': '聯絡人',

    // status
    'status.inProgress': '進行中',
    'status.completed': '已完成',
    'status.pending': '待簽核',
    'status.cancelled': '已取消',
    'status.approved': '已核准',
    'status.rejected': '已駁回',
    'status.draft': '草稿',
    'status.active': '啟用',
    'status.inactive': '停用',
    'status.trial': '試用',
    'status.suspended': '暫停',
  },

  en: {
    // common
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.delete': 'Delete',
    'common.add': 'Add',
    'common.edit': 'Edit',
    'common.search': 'Search',
    'common.export': 'Export',
    'common.print': 'Print',
    'common.confirm': 'Confirm',
    'common.back': 'Back',
    'common.all': 'All',
    'common.noData': 'No data',
    'common.loading': 'Loading',
    'common.success': 'Success',
    'common.failed': 'Failed',
    'common.submit': 'Submit',
    'common.reset': 'Reset',
    'common.close': 'Close',
    'common.view': 'View',
    'common.download': 'Download',
    'common.upload': 'Upload',
    'common.refresh': 'Refresh',
    'common.filter': 'Filter',
    'common.sort': 'Sort',
    'common.actions': 'Actions',
    'common.status': 'Status',
    'common.date': 'Date',
    'common.name': 'Name',
    'common.description': 'Description',
    'common.amount': 'Amount',
    'common.total': 'Total',
    'common.quantity': 'Quantity',
    'common.unit': 'Unit',
    'common.price': 'Price',
    'common.note': 'Note',
    'common.type': 'Type',
    'common.category': 'Category',
    'common.yes': 'Yes',
    'common.no': 'No',
    'common.enabled': 'Enabled',
    'common.disabled': 'Disabled',

    // nav
    'nav.dashboard': 'Dashboard',
    'nav.analytics': 'Analytics',
    'nav.hr': 'HR',
    'nav.finance': 'Finance',
    'nav.sales': 'Sales',
    'nav.purchase': 'Purchase',
    'nav.inventory': 'Inventory',
    'nav.manufacturing': 'Manufacturing',
    'nav.crm': 'CRM',
    'nav.pos': 'POS',
    'nav.process': 'Process',
    'nav.system': 'System',
    'nav.settings': 'Settings',
    'nav.logout': 'Logout',

    // hr
    'hr.employee': 'Employee',
    'hr.employees': 'Employee List',
    'hr.attendance': 'Attendance',
    'hr.leave': 'Leave',
    'hr.overtime': 'Overtime',
    'hr.salary': 'Salary',
    'hr.schedule': 'Schedule',
    'hr.performance': 'Performance',
    'hr.recruitment': 'Recruitment',
    'hr.bonus': 'Bonus',
    'hr.expense': 'Expense',
    'hr.document': 'Document',
    'hr.holiday': 'Public Holiday',
    'hr.travel': 'Business Travel',
    'hr.report': 'HR Report',

    // finance
    'finance.journalEntry': 'Journal Entry',
    'finance.accountsReceivable': 'Accounts Receivable',
    'finance.accountsPayable': 'Accounts Payable',
    'finance.budget': 'Budget',
    'finance.invoice': 'Invoice',
    'finance.trialBalance': 'Trial Balance',
    'finance.balanceSheet': 'Balance Sheet',
    'finance.profitLoss': 'P&L',
    'finance.bankReconciliation': 'Bank Reconciliation',
    'finance.cashFlow': 'Cash Flow',
    'finance.taxReport': 'Tax Report',
    'finance.costCenter': 'Cost Center',

    // crm
    'crm.customer': 'Customer',
    'crm.customers': 'Customer List',
    'crm.opportunity': 'Opportunity',
    'crm.pipeline': 'Pipeline',
    'crm.marketing': 'Marketing',
    'crm.member': 'Member',
    'crm.service': 'Service',
    'crm.campaign': 'Campaign',
    'crm.lead': 'Lead',
    'crm.contact': 'Contact',

    // status
    'status.inProgress': 'In Progress',
    'status.completed': 'Completed',
    'status.pending': 'Pending',
    'status.cancelled': 'Cancelled',
    'status.approved': 'Approved',
    'status.rejected': 'Rejected',
    'status.draft': 'Draft',
    'status.active': 'Active',
    'status.inactive': 'Inactive',
    'status.trial': 'Trial',
    'status.suspended': 'Suspended',
  },
}

export function createI18n(initialLocale = DEFAULT_LOCALE) {
  let currentLocale = AVAILABLE_LOCALES.includes(initialLocale) ? initialLocale : DEFAULT_LOCALE

  const t = (key) => {
    // Try current locale first
    const value = translations[currentLocale]?.[key]
    if (value !== undefined) return value
    // Fallback to zh-TW
    const fallback = translations[DEFAULT_LOCALE]?.[key]
    if (fallback !== undefined) return fallback
    // Return the key itself if nothing found
    return key
  }

  return {
    t,
    get locale() { return currentLocale },
    setLocale(loc) {
      if (AVAILABLE_LOCALES.includes(loc)) currentLocale = loc
    },
    availableLocales: AVAILABLE_LOCALES,
  }
}
