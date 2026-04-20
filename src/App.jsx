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
const EmployeePortal = lazy(() => import('./pages/portal/EmployeePortal'))
const Login = lazy(() => import('./pages/Login'))

// ── Module-level lazy loading ──
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

// ── Route-level access control — 5 roles (MUST be before AdminApp) ──
const ROLE_ROUTES = {
  store_staff:  ['/', '/hr/my-schedule', '/hr/leave', '/hr/overtime', '/hr/punch-correction', '/hr/attendance', '/hr/self-service', '/hr/leave-balances'],
  office_staff: ['/', '/hr/my-schedule', '/hr/leave', '/hr/overtime', '/hr/punch-correction', '/hr/attendance', '/hr/self-service', '/hr/leave-balances', '/hr/schedule', '/hr/leave-calendar', '/hr/salary', '/hr/salary-structures', '/hr/payroll', '/process', '/org'],
  manager:      ['/', '/hr', '/org', '/process'],
  admin:        ['/', '/hr', '/org', '/process', '/system', '/analytics'],
  super_admin:  null, // all
}

// ── Error Boundary ──
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) { console.error('App crash:', error, info) }
  render() {
    if (this.state.error) return (
      <div style={{ padding: 48, textAlign: 'center', color: '#ef4444' }}>
        <h2>系統發生錯誤</h2>
        <pre style={{ textAlign: 'left', maxWidth: 600, margin: '16px auto', fontSize: 13, whiteSpace: 'pre-wrap', background: '#1e293b', color: '#f1f5f9', padding: 16, borderRadius: 8 }}>
          {this.state.error.message}{'\n'}{this.state.error.stack}
        </pre>
        <button onClick={() => window.location.reload()} style={{ padding: '8px 24px', borderRadius: 8, border: 'none', background: '#3b82f6', color: '#fff', cursor: 'pointer' }}>重新載入</button>
      </div>
    )
    return this.props.children
  }
}

// ── AdminApp (uses ROLE_ROUTES) ──
function AdminApp({ role = 'store_staff' }) {
  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem('sme_onboarded'))
  const allowed = role in ROLE_ROUTES ? ROLE_ROUTES[role] : ROLE_ROUTES['store_staff']
  // Module-level access check: '/hr/leave' in allowed → can enter '/hr' module
  // Page-level filtering is handled by Sidebar's ROLE_ALLOWED_PATHS
  const canAccess = (modulePrefix) => {
    if (allowed === null) return true
    return allowed.some(r => r === modulePrefix || r.startsWith(modulePrefix + '/') || modulePrefix.startsWith(r))
  }
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

// ── Protected wrapper ──
function ProtectedApp() {
  const { loading, isAuthenticated, profile, profileReady } = useAuth()

  if (loading) return <LoadingSpinner />
  if (!isAuthenticated) return <Suspense fallback={<LoadingSpinner />}><Login /></Suspense>

  // 等 profile 載完再決定
  if (!profileReady) return <LoadingSpinner />

  // 沒有 profile（RLS 擋住 = 一般員工）→ 導向員工入口
  if (!profile) {
    window.location.href = '/employee-portal/'
    return <LoadingSpinner />
  }

  return <AdminApp role={profile?.role || 'store_staff'} />
}

// ── Root App ──
export default function App() {
  return (
    <ErrorBoundary>
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
          <Route path="/employee-portal" element={<Suspense fallback={<LoadingSpinner />}><EmployeePortal /></Suspense>} />
          <Route path="/*" element={<ProtectedApp />} />
        </Routes>
        </Suspense>
      </TenantProvider>
    </AuthProvider>
    </ErrorBoundary>
  )
}
