import { Routes, Route, Navigate } from 'react-router-dom'
import Analytics from '../pages/Analytics'
import FinanceAnalytics from '../pages/analytics/FinanceAnalytics'
import HRAnalytics from '../pages/analytics/HRAnalytics'
import InventoryAnalytics from '../pages/analytics/InventoryAnalytics'
import POSAnalytics from '../pages/analytics/POSAnalytics'
import ManufacturingAnalytics from '../pages/analytics/ManufacturingAnalytics'
import SalesPerformance from '../pages/analytics/SalesPerformance'
import DashboardBuilder from '../pages/analytics/DashboardBuilder'
import ProcessAnalytics from '../pages/analytics/ProcessAnalytics'
import CrossSystemAnalytics from '../pages/analytics/CrossSystemAnalytics'
import Alerts from '../pages/analytics/Alerts'
import CRMAnalytics from '../pages/analytics/CRMAnalytics'
import Guard from '../pages/analytics/AnalyticsRouteGuard'

// tier=1：主管以上（super_admin / admin / manager）
// tier=2：上述 + store_staff（門市相關）
const g1 = (el) => <Guard tier={1}>{el}</Guard>
const g2 = (el) => <Guard tier={2}>{el}</Guard>

export default function AnalyticsModule() {
  return (
    <Routes>
      <Route index                element={g1(<Analytics />)} />
      <Route path="alerts"        element={g1(<Alerts />)} />
      <Route path="finance"       element={g1(<FinanceAnalytics />)} />
      <Route path="hr"            element={g1(<HRAnalytics />)} />
      <Route path="sales"         element={g1(<SalesPerformance />)} />
      <Route path="crm"           element={g1(<CRMAnalytics />)} />
      <Route path="manufacturing" element={g1(<ManufacturingAnalytics />)} />
      <Route path="process"       element={g1(<ProcessAnalytics />)} />
      <Route path="cross-system"  element={g1(<CrossSystemAnalytics />)} />
      <Route path="builder"       element={g1(<DashboardBuilder />)} />
      {/* tier 2：店長 + 門市人員可看 */}
      <Route path="inventory"     element={g2(<InventoryAnalytics />)} />
      <Route path="pos"           element={g2(<POSAnalytics />)} />

      {/* 砍掉的舊頁 → redirect 到對應新頁，避免舊書籤壞掉 */}
      <Route path="forecast" element={<Navigate to="/analytics/alerts" replace />} />
      <Route path="anomaly"  element={<Navigate to="/analytics/alerts" replace />} />
      <Route path="reports"  element={<Navigate to="/analytics" replace />} />
      <Route path="embed"    element={<Navigate to="/analytics" replace />} />
    </Routes>
  )
}
