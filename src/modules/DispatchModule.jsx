import { memo, lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import LoadingSpinner from '../components/LoadingSpinner'

const DispatchDashboard = lazy(() => import('../pages/dispatch/DispatchDashboard'))
const DispatchQueue     = lazy(() => import('../pages/dispatch/DispatchQueue'))
const DispatchRoutes    = lazy(() => import('../pages/dispatch/DispatchRoutes'))
const RouteDetail       = lazy(() => import('../pages/dispatch/RouteDetail'))
const DispatchCalendar  = lazy(() => import('../pages/dispatch/DispatchCalendar'))
const FleetManagement   = lazy(() => import('../pages/dispatch/FleetManagement'))
const DriverList        = lazy(() => import('../pages/dispatch/DriverList'))
const TrackingCenter    = lazy(() => import('../pages/dispatch/TrackingCenter'))
const DispatchAnalytics = lazy(() => import('../pages/dispatch/DispatchAnalytics'))

export default memo(function DispatchModule() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <Routes>
        <Route index element={<DispatchDashboard />} />
        <Route path="queue" element={<DispatchQueue />} />
        <Route path="routes" element={<DispatchRoutes />} />
        <Route path="routes/:id" element={<RouteDetail />} />
        <Route path="schedule" element={<DispatchCalendar />} />
        <Route path="fleet" element={<FleetManagement />} />
        <Route path="fleet/drivers" element={<DriverList />} />
        <Route path="tracking" element={<TrackingCenter />} />
        <Route path="analytics" element={<DispatchAnalytics />} />
      </Routes>
    </Suspense>
  )
})
