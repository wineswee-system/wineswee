import { Routes, Route } from 'react-router-dom'
import Analytics from '../pages/Analytics'
import SalesForecast from '../pages/analytics/SalesForecast'
import FinanceAnalytics from '../pages/analytics/FinanceAnalytics'
import HRAnalytics from '../pages/analytics/HRAnalytics'
import InventoryAnalytics from '../pages/analytics/InventoryAnalytics'
import POSAnalytics from '../pages/analytics/POSAnalytics'
import ManufacturingAnalytics from '../pages/analytics/ManufacturingAnalytics'
import SalesPerformance from '../pages/analytics/SalesPerformance'
import ScheduledReports from '../pages/analytics/ScheduledReports'
import DashboardBuilder from '../pages/analytics/DashboardBuilder'
import AnomalyDetection from '../pages/analytics/AnomalyDetection'
import EmbeddableCharts from '../pages/analytics/EmbeddableCharts'
import ProcessAnalytics from '../pages/analytics/ProcessAnalytics'
import CrossSystemAnalytics from '../pages/analytics/CrossSystemAnalytics'
import Alerts from '../pages/analytics/Alerts'
import CRMAnalytics from '../pages/analytics/CRMAnalytics'

export default function AnalyticsModule() {
  return (
    <Routes>
      <Route index element={<Analytics />} />
      <Route path="forecast" element={<SalesForecast />} />
      <Route path="finance" element={<FinanceAnalytics />} />
      <Route path="hr" element={<HRAnalytics />} />
      <Route path="inventory" element={<InventoryAnalytics />} />
      <Route path="pos" element={<POSAnalytics />} />
      <Route path="manufacturing" element={<ManufacturingAnalytics />} />
      <Route path="sales" element={<SalesPerformance />} />
      <Route path="reports" element={<ScheduledReports />} />
      <Route path="builder" element={<DashboardBuilder />} />
      <Route path="anomaly" element={<AnomalyDetection />} />
      <Route path="embed" element={<EmbeddableCharts />} />
      <Route path="process" element={<ProcessAnalytics />} />
      <Route path="cross-system" element={<CrossSystemAnalytics />} />
      <Route path="alerts" element={<Alerts />} />
      <Route path="crm" element={<CRMAnalytics />} />
    </Routes>
  )
}
