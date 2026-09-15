import {
  Users, Building2, PieChart, Shield,
} from 'lucide-react'

export * from './demos/hrDemos'
export * from './demos/orgDemos'
export * from './demos/analyticsDemos'
export * from './demos/systemDemos'

import { HR_STEPS } from './demos/hrDemos'
import { ORG_STEPS } from './demos/orgDemos'
import { ANALYTICS_STEPS } from './demos/analyticsDemos'
import { SYSTEM_STEPS } from './demos/systemDemos'

/** All demos bundled */
export const ALL_DEMOS = [
  { key: 'hr',        label: '人事管理', icon: Users,           color: '#2563eb', steps: HR_STEPS },
  { key: 'org',       label: '組織管理', icon: Building2,       color: '#7c3aed', steps: ORG_STEPS },
  { key: 'analytics', label: '數據分析', icon: PieChart,        color: '#2563eb', steps: ANALYTICS_STEPS },
  { key: 'system',    label: '系統管理', icon: Shield,          color: '#ef4444', steps: SYSTEM_STEPS },
]
