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

function AdminApp({ role = 'store_staff' }) {
  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem('sme_onboarded'))
  const allowed = role in ROLE_ROUTES ? ROLE_ROUTES[role] : ROLE_ROUTES['store_staff']
  const canAccess = (prefix) => allowed === null || allowed.some(r => prefix.startsWith(r) || r.startsWith(prefix))
  const blocked = <Navigate to="/" replace />

  return (
    <div className="app-layout">
      {showOnboarding && <OnboardingWizard onComplete={() => setShowOnboarding(false)} />}
      <Sidebar />
      <main className="main-content">
        <div className="page-container">
          <Suspense fallback={<LoadingSpinner />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/hr/*" element={canAccess('/hr') ? <HRModule /> : blocked} />
            <Route path="/crm/*" element={canAccess('/crm') ? <CRMModule /> : blocked} />
            <Route path="/finance/*" element={canAccess('/finance') ? <FinanceModule /> : blocked} />
            <Route path="/analytics" element={canAccess('/analytics') ? <AnalyticsModule /> : blocked} />
            <Route path="/analytics/*" element={canAccess('/analytics') ? <AnalyticsModule /> : blocked} />
            <Route path="/purchase/*" element={canAccess('/purchase') ? <PurchaseModule /> : blocked} />
            <Route path="/wms/*" element={canAccess('/wms') ? <WMSModule /> : blocked} />
            <Route path="/manufacturing/*" element={canAccess('/manufacturing') ? <ManufacturingModule /> : blocked} />
            <Route path="/sales" element={canAccess('/sales') ? <SalesModule /> : blocked} />
            <Route path="/sales/*" element={canAccess('/sales') ? <SalesModule /> : blocked} />
            <Route path="/pos" element={canAccess('/pos') ? <POSModule /> : blocked} />
            <Route path="/pos/*" element={canAccess('/pos') ? <POSModule /> : blocked} />
            <Route path="/org/*" element={canAccess('/org') ? <OrgModule /> : blocked} />
            <Route path="/process/*" element={canAccess('/process') ? <ProcessModule /> : blocked} />
            <Route path="/system/*" element={canAccess('/system') ? <SystemModule /> : blocked} />
            <Route path="/ai/*" element={canAccess('/ai') ? <AIModule /> : blocked} />
            <Route path="/integration/*" element={canAccess('/integration') ? <IntegrationModule /> : blocked} />
            <Route path="/super-admin/*" element={canAccess('/super-admin') ? <SuperAdminModule /> : blocked} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
        </div>
      </main>
    </div>
  )
}

function ProtectedApp() {
  const { loading, isAuthenticated, profile } = useAuth()

  if (loading) return <LoadingSpinner />
  if (!isAuthenticated) return <Suspense fallback={<LoadingSpinner />}><Login /></Suspense>

  return <AdminApp role={profile?.role || 'store_staff'} />
}

// Route-level access control — 5 roles
const ROLE_ROUTES = {
  store_staff:  ['/', '/hr/my-schedule', '/hr/leave', '/hr/overtime', '/hr/punch-correction', '/hr/attendance', '/hr/self-service'],
  office_staff: ['/', '/hr/my-schedule', '/hr/leave', '/hr/overtime', '/hr/punch-correction', '/hr/attendance', '/hr/self-service', '/hr/schedule', '/hr/leave-calendar', '/process', '/org'],
  manager:      ['/', '/hr', '/org', '/process'],
  admin:        ['/', '/hr', '/org', '/process', '/system', '/analytics'],
  super_admin:  null, // all
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
