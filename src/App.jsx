import React, { lazy, Suspense, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { TenantProvider } from './contexts/TenantContext'
import Sidebar from './components/Sidebar'
import OnboardingWizard from './components/OnboardingWizard'
import LoadingSpinner from './components/LoadingSpinner'

// ── Standalone pages (not part of any module) ──
const DemoLanding = lazy(() => import('./pages/DemoLanding'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const LiffClockIn = lazy(() => import('./pages/liff/LiffClockIn'))
const LiffTask = lazy(() => import('./pages/liff/LiffTask'))
const PortalLayout = lazy(() => import('./pages/portal/PortalLayout'))
const PortalHome = lazy(() => import('./pages/portal/PortalHome'))
const Login = lazy(() => import('./pages/Login'))

// ── Module-level lazy loading ──
// Each module bundles ALL its pages into a single chunk.
// When a user enters a module (e.g. HR), the entire module loads once
// and subsequent navigation within that module is instant.
const HRModule = lazy(() => import('./modules/HRModule'))
const CRMModule = lazy(() => import('./modules/CRMModule'))
const FinanceModule = lazy(() => import('./modules/FinanceModule'))
const AnalyticsModule = lazy(() => import('./modules/AnalyticsModule'))
const PurchaseModule = lazy(() => import('./modules/PurchaseModule'))
const WMSModule = lazy(() => import('./modules/WMSModule'))
const ManufacturingModule = lazy(() => import('./modules/ManufacturingModule'))
const SalesModule = lazy(() => import('./modules/SalesModule'))
const POSModule = lazy(() => import('./modules/POSModule'))
const OrgModule = lazy(() => import('./modules/OrgModule'))
const ProcessModule = lazy(() => import('./modules/ProcessModule'))
const SystemModule = lazy(() => import('./modules/SystemModule'))
const AIModule = lazy(() => import('./modules/AIModule'))
const IntegrationModule = lazy(() => import('./modules/IntegrationModule'))
const SuperAdminModule = lazy(() => import('./modules/SuperAdminModule'))

function AdminApp() {
  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem('sme_onboarded'))

  return (
    <div className="app-layout">
      {showOnboarding && <OnboardingWizard onComplete={() => setShowOnboarding(false)} />}
      <Sidebar />
      <main className="main-content">
        <div className="page-container">
          <Suspense fallback={<LoadingSpinner />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            {/* Module routes — each module handles its own sub-routes */}
            <Route path="/hr/*" element={<HRModule />} />
            <Route path="/crm/*" element={<CRMModule />} />
            <Route path="/finance/*" element={<FinanceModule />} />
            <Route path="/analytics" element={<AnalyticsModule />} />
            <Route path="/analytics/*" element={<AnalyticsModule />} />
            <Route path="/purchase/*" element={<PurchaseModule />} />
            <Route path="/wms/*" element={<WMSModule />} />
            <Route path="/manufacturing/*" element={<ManufacturingModule />} />
            <Route path="/sales" element={<SalesModule />} />
            <Route path="/sales/*" element={<SalesModule />} />
            <Route path="/pos" element={<POSModule />} />
            <Route path="/pos/*" element={<POSModule />} />
            <Route path="/org/*" element={<OrgModule />} />
            <Route path="/process/*" element={<ProcessModule />} />
            <Route path="/system/*" element={<SystemModule />} />
            <Route path="/ai/*" element={<AIModule />} />
            <Route path="/integration/*" element={<IntegrationModule />} />
            <Route path="/super-admin/*" element={<SuperAdminModule />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
        </div>
      </main>
    </div>
  )
}

function ProtectedApp() {
  const { loading, isAuthenticated } = useAuth()

  if (loading) return <LoadingSpinner />
  if (!isAuthenticated) return <Suspense fallback={<LoadingSpinner />}><Login /></Suspense>

  return <AdminApp />
}

export default function App() {
  return (
    <AuthProvider>
      <TenantProvider>
        <Suspense fallback={<LoadingSpinner />}>
        <Routes>
          <Route path="/demo" element={<DemoLanding />} />
          <Route path="/login" element={<Suspense fallback={<LoadingSpinner />}><Login /></Suspense>} />
          <Route path="/liff/clock" element={<LiffClockIn />} />
          <Route path="/liff/task" element={<LiffTask />} />
          <Route path="/portal" element={<PortalLayout />}>
            <Route index element={<PortalHome />} />
          </Route>
          <Route path="/*" element={<ProtectedApp />} />
        </Routes>
        </Suspense>
      </TenantProvider>
    </AuthProvider>
  )
}
