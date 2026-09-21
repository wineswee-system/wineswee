import { Routes, Route, Navigate } from 'react-router-dom'
import Analytics from '../pages/Analytics'
import HRAnalytics from '../pages/analytics/HRAnalytics'
import DashboardBuilder from '../pages/analytics/DashboardBuilder'
import ProcessAnalytics from '../pages/analytics/ProcessAnalytics'
import CrossSystemAnalytics from '../pages/analytics/CrossSystemAnalytics'
import Alerts from '../pages/analytics/Alerts'
import Guard from '../pages/analytics/AnalyticsRouteGuard'

// tier=1：主管以上（super_admin / admin / manager）
const g1 = (el) => <Guard tier={1}>{el}</Guard>

export default function AnalyticsModule() {
  return (
    <Routes>
      <Route index                element={g1(<Analytics />)} />
      <Route path="alerts"        element={g1(<Alerts />)} />
      <Route path="hr"            element={g1(<HRAnalytics />)} />
      <Route path="process"       element={g1(<ProcessAnalytics />)} />
      <Route path="cross-system"  element={g1(<CrossSystemAnalytics />)} />
      <Route path="builder"       element={g1(<DashboardBuilder />)} />

      {/* 砍掉的舊頁 → redirect 到對應新頁，避免舊書籤壞掉 */}
      <Route path="forecast"      element={<Navigate to="/analytics/alerts" replace />} />
      <Route path="anomaly"       element={<Navigate to="/analytics/alerts" replace />} />
      <Route path="reports"       element={<Navigate to="/analytics" replace />} />
      <Route path="embed"         element={<Navigate to="/analytics" replace />} />
      <Route path="finance"       element={<Navigate to="/analytics" replace />} />
      <Route path="manufacturing" element={<Navigate to="/analytics" replace />} />
      <Route path="sales"         element={<Navigate to="/analytics" replace />} />
      <Route path="crm"           element={<Navigate to="/analytics" replace />} />
      <Route path="inventory"     element={<Navigate to="/analytics" replace />} />
      <Route path="pos"           element={<Navigate to="/analytics" replace />} />
    </Routes>
  )
}
