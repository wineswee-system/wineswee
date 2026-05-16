import {
  Users, CreditCard, ShoppingCart, Warehouse, Building2,
  HeadphonesIcon, Monitor, PieChart, Shield, Factory,
} from 'lucide-react'

export * from './demos/hrDemos'
export * from './demos/crmDemos'
export * from './demos/wmsDemos'
export * from './demos/financeDemos'
export * from './demos/salesDemos'
export * from './demos/posDemos'
export * from './demos/purchaseDemos'
export * from './demos/manufacturingDemos'
export * from './demos/orgDemos'
export * from './demos/analyticsDemos'
export * from './demos/systemDemos'

import { HR_STEPS } from './demos/hrDemos'
import { CRM_STEPS } from './demos/crmDemos'
import { WMS_STEPS } from './demos/wmsDemos'
import { FINANCE_STEPS } from './demos/financeDemos'
import { SALES_STEPS } from './demos/salesDemos'
import { POS_STEPS } from './demos/posDemos'
import { PURCHASE_STEPS } from './demos/purchaseDemos'
import { MFG_STEPS } from './demos/manufacturingDemos'
import { ORG_STEPS } from './demos/orgDemos'
import { ANALYTICS_STEPS } from './demos/analyticsDemos'
import { SYSTEM_STEPS } from './demos/systemDemos'

/** All demos bundled */
export const ALL_DEMOS = [
  { key: 'hr',        label: '人事管理', icon: Users,           color: '#2563eb', steps: HR_STEPS },
  { key: 'crm',       label: '客戶經營', icon: HeadphonesIcon,  color: '#f97316', steps: CRM_STEPS },
  { key: 'wms',       label: '倉儲物流', icon: Warehouse,       color: '#059669', steps: WMS_STEPS },
  { key: 'finance',   label: '財務會計', icon: CreditCard,      color: '#d97706', steps: FINANCE_STEPS },
  { key: 'sales',     label: '銷售管理', icon: ShoppingCart,    color: '#db2777', steps: SALES_STEPS },
  { key: 'pos',       label: 'POS 收銀', icon: Monitor,         color: '#06b6d4', steps: POS_STEPS },
  { key: 'purchase',  label: '採購管理', icon: ShoppingCart,    color: '#d97706', steps: PURCHASE_STEPS },
  { key: 'mfg',       label: '生產品管', icon: Factory,         color: '#f97316', steps: MFG_STEPS },
  { key: 'org',       label: '組織管理', icon: Building2,       color: '#7c3aed', steps: ORG_STEPS },
  { key: 'analytics', label: '數據分析', icon: PieChart,        color: '#2563eb', steps: ANALYTICS_STEPS },
  { key: 'system',    label: '系統管理', icon: Shield,          color: '#ef4444', steps: SYSTEM_STEPS },
]
