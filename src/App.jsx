import React, { lazy, Suspense, useState, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/queryClient'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { TenantProvider, useTenant } from './contexts/TenantContext'
import { parseOrgPath } from './lib/orgPath'
import { LanguageProvider } from './contexts/LanguageContext'
import Sidebar from './components/Sidebar'
import OnboardingWizard from './components/OnboardingWizard'
import LoadingSpinner from './components/LoadingSpinner'
import ConfirmDialog from './components/ConfirmDialog'
import StickyHorizontalScrollbar from './components/StickyHorizontalScrollbar'
import OutageBanner from './components/OutageBanner'
import { Toaster } from 'sonner'
import { TOAST_POSITION } from './lib/toast'
import { logError } from './lib/systemLogger.js'

// ── Standalone pages (not part of any module) ──
const DemoLanding = lazy(() => import('./pages/DemoLanding'))
const Dashboard   = lazy(() => import('./pages/Dashboard'))
const GuestMenu   = lazy(() => import('./pages/pos/GuestMenu'))
// 舊的 Liff* 頁面（2026-04-23 移除）已搬到獨立 repo aska911023/sme-ops-liff
const PortalLayout = lazy(() => import('./pages/portal/PortalLayout'))
const PortalHome = lazy(() => import('./pages/portal/PortalHome'))
const EmployeePortal = lazy(() => import('./pages/portal/EmployeePortal'))
const Login = lazy(() => import('./pages/Login'))
const OvertimeExceptionImport = lazy(() => import('./pages/hr/OvertimeExceptionImport'))
const BookingPublicPage   = lazy(() => import('./pages/comms/BookingPublicPage'))
const BookingConfirmation = lazy(() => import('./pages/comms/BookingConfirmation'))
const PublicTracking      = lazy(() => import('./pages/dispatch/PublicTracking'))

// ── Module registry (lazy components + manifests) ──
import { ALL_MODULES } from './modules/index'
import { renderModule } from './modules/renderModule'

// Route-level access is now fully driven by each module's `perm` field in
// src/modules/index.js (consistent with Sidebar's nav.* permission checks).
// ROLE_ROUTES was removed — it was non-functional (modulePrefix.startsWith('/')
// always matched '/') and diverged from per-employee permission overrides.

// ── Error Boundary ──
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) {
    // Persist to error_logs table for monitoring dashboard
    logError({
      module: 'Runtime',
      errorCode: 'REACT_ERROR_BOUNDARY',
      message: error.message,
      stackTrace: error.stack,
      component: info.componentStack,
    })
    console.error('App crash:', error, info)
  }
  render() {
    if (this.state.error) return (
      <div style={{ padding: 48, textAlign: 'center', color: 'var(--accent-red)' }}>
        <h2>系統發生錯誤</h2>
        {import.meta.env.PROD ? (
          <p style={{ color: 'var(--text-secondary)' }}>系統發生錯誤，請聯繫系統管理員</p>
        ) : (
          <pre style={{ color: 'var(--text-secondary)', textAlign: 'left', fontSize: 12, overflowX: 'auto' }}>{this.state.error.stack}</pre>
        )}
        <button onClick={() => window.location.reload()} style={{ padding: '8px 24px', borderRadius: 8, border: 'none', background: 'var(--accent-cyan)', color: '#fff', cursor: 'pointer' }}>重新載入</button>
      </div>
    )
    return this.props.children
  }
}

// ── Org URL ↔ Tenant sync ──
// 主要模組網址為 /{module}/:orgId/{page}。此元件負責:
//  1) 舊網址/缺 orgId 段 → 自動補上目前使用者的 org 並 replace 導向
//  2) 一般使用者若網址 orgId 非本人 org → 導回本人 org(URL 非授權邊界,RLS 才是)
//  3) 將網址 orgId 同步進 TenantContext(super_admin 切換 org 的資料範圍 —— Phase 2 接續)
function OrgRouteSync() {
  const location = useLocation()
  const navigate = useNavigate()
  const { profile, isSuperAdmin } = useAuth()
  const { tenant, switchTenant } = useTenant()
  const ownOrg = profile?.organization_id ?? null

  useEffect(() => {
    const { orgScoped, prefix, orgId, rest } = parseOrgPath(location.pathname)
    if (!orgScoped) return
    // 缺 orgId 段 → 補上本人 org
    if (orgId == null) {
      if (ownOrg == null) return
      navigate('/' + [prefix, ownOrg, ...rest].join('/') + location.search, { replace: true })
      return
    }
    // 一般使用者不得瀏覽其他 org(super_admin 可)
    if (!isSuperAdmin && ownOrg != null && orgId !== ownOrg) {
      navigate('/' + [prefix, ownOrg, ...rest].join('/') + location.search, { replace: true })
      return
    }
    // 同步租戶範圍(僅本人 org 或 super_admin 才會被 TenantContext 接受);相同則不重設避免多餘 re-render
    if (tenant?.organization_id !== orgId) switchTenant({ organization_id: orgId })
  }, [location.pathname, location.search, ownOrg, isSuperAdmin, navigate, switchTenant, tenant])

  return null
}

// ── AdminApp ──
function AdminApp() {
  const { hasPermission, isSuperAdmin } = useAuth()
  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem('sme_onboarded'))
  // Module access is gated by each module's `perm` field in src/modules/index.js,
  // using the same nav.* permissions as the Sidebar (consistent + override-aware).
  // RLS remains the true enforcement layer; this is the UX gate.
  const canAccess = () => true
  const canAccessWithPerm = (_modulePrefix, permCode) => hasPermission(permCode)
  const blocked = <Navigate to="/" replace />

  // embedded=1：被任務面板 iframe 內嵌（綁定表單「自己填」inline），隱藏側欄/頂欄/精靈，只留頁面內容
  const isEmbedded = (() => {
    try { return new URLSearchParams(window.location.search).get('embedded') === '1' } catch { return false }
  })()

  return (
    <div className="app-layout">
      <OrgRouteSync />
      {!isEmbedded && showOnboarding && <OnboardingWizard onComplete={() => setShowOnboarding(false)} />}
      {!isEmbedded && <Sidebar />}
      <main className="main-content">
        <div className="page-container">
          <Suspense fallback={<LoadingSpinner />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/otx" element={<OvertimeExceptionImport />} />
            {ALL_MODULES.flatMap(m => renderModule(m, { canAccess, canAccessWithPerm, isSuperAdmin }))}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
        </div>
        {/* 浮動橫向滾軸：自動同步當前 viewport 內可見的 .data-table-wrapper / div.data-table。
            sticky bottom: 0 黏在 .main-content 底，永遠在 viewport 可見 */}
        {!isEmbedded && <StickyHorizontalScrollbar />}
      </main>
    </div>
  )
}

// ── 登入擋下畫面：帳號未綁定 / 已離職 ──
function BlockedAccountScreen({ title, message, hint, user, signOut }) {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 32, background: 'var(--bg-primary)',
    }}>
      <div style={{
        maxWidth: 480, padding: 36, borderRadius: 14,
        background: 'var(--bg-secondary)', border: '1px solid var(--border-medium)',
        boxShadow: 'var(--shadow-xl)', textAlign: 'center',
      }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🔒</div>
        <h2 style={{ margin: '0 0 12px', color: 'var(--text-primary)' }}>{title}</h2>
        <p style={{ margin: '0 0 8px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          {message}（{user?.email || '—'}）
        </p>
        <p style={{ margin: '0 0 24px', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.6 }}>
          {hint}
        </p>
        <button onClick={signOut} className="btn btn-primary" style={{ padding: '10px 28px' }}>
          登出
        </button>
      </div>
    </div>
  )
}

// ── Protected wrapper ──
function ProtectedApp() {
  const { loading, profileReady, isAuthenticated, profile, user, signOut } = useAuth()

  if (loading || !profileReady) return <LoadingSpinner />
  if (!isAuthenticated) return <Suspense fallback={<LoadingSpinner />}><Login /></Suspense>
  // 有 Supabase auth 但找不到對應 employees row → 沒被綁定，直接擋下不准進主系統
  if (!profile) return (
    <BlockedAccountScreen
      title="帳號未綁定"
      message="您的帳號尚未綁定到員工資料"
      hint="請聯絡系統管理員協助綁定 LINE 或 email 帳號後才能使用系統。"
      user={user} signOut={signOut}
    />
  )
  // 員工已離職 / 停用 → 擋下不准進
  if (profile.status && profile.status !== '在職') return (
    <BlockedAccountScreen
      title="帳號已停用"
      message={`您的員工狀態為「${profile.status}」，已無法登入系統`}
      hint="如有問題請聯絡系統管理員。"
      user={user} signOut={signOut}
    />
  )

  return <AdminApp />
}

// ── Portal auth guard — portal pages fetch sensitive employee data ──
function PortalGuard({ children }) {
  const { loading, profileReady, isAuthenticated, profile, user, signOut } = useAuth()
  if (loading || !profileReady) return <LoadingSpinner />
  if (!isAuthenticated || !profile) return <Navigate to="/login" replace />
  // 離職/停用員工也擋下 portal（跟主系統 ProtectedApp 對齊）
  if (profile.status && profile.status !== '在職') return (
    <BlockedAccountScreen
      title="帳號已停用"
      message={`您的員工狀態為「${profile.status}」，已無法使用員工 portal`}
      hint="如有問題請聯絡系統管理員。"
      user={user} signOut={signOut}
    />
  )
  return children
}

// ── Root App ──
// Toaster 主題跟著 documentElement 的 data-theme 走
// Sidebar.toggleTheme 在 setAttribute('data-theme', ...) 時不發 event，
// 所以用 MutationObserver 監聽 attribute 變化
function useThemeFromDom() {
  const [theme, setTheme] = useState(() =>
    typeof document === 'undefined' ? 'dark' : (document.documentElement.getAttribute('data-theme') || 'dark')
  )
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setTheme(document.documentElement.getAttribute('data-theme') || 'dark')
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])
  return theme
}

function ThemedToaster() {
  const theme = useThemeFromDom()
  return (
    <Toaster
      position={TOAST_POSITION}
      theme={theme === 'light' ? 'light' : 'dark'}
      richColors
      closeButton
      toastOptions={{
        style: {
          fontSize: 13,
          fontFamily: 'inherit',
        },
      }}
    />
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
    <ErrorBoundary>
    <LanguageProvider>
    <AuthProvider>
      <TenantProvider>
        <ThemedToaster />
        <OutageBanner />
        <ConfirmDialog />
        <Suspense fallback={<LoadingSpinner />}>
        <Routes>
          <Route path="/demo" element={<PortalGuard><DemoLanding /></PortalGuard>} />
          {/* Public marketing landing — no auth required (shareable demo URL) */}
          <Route path="/showcase" element={<Suspense fallback={<LoadingSpinner />}><DemoLanding /></Suspense>} />
          <Route path="/login" element={<Suspense fallback={<LoadingSpinner />}><Login /></Suspense>} />
          {/* Guest QR self-order menu — public, no auth required */}
          <Route path="/menu/:storeId/:tableId" element={<Suspense fallback={<LoadingSpinner />}><GuestMenu /></Suspense>} />
          {/* Calendly-style booking pages — public, no auth required (external bookers) */}
          <Route path="/book/:slug" element={<Suspense fallback={<LoadingSpinner />}><BookingPublicPage /></Suspense>} />
          <Route path="/book/confirm/:appointmentId" element={<Suspense fallback={<LoadingSpinner />}><BookingConfirmation /></Suspense>} />
          {/* Public shipment tracking — no auth required */}
          <Route path="/track/:number" element={<Suspense fallback={<LoadingSpinner />}><PublicTracking /></Suspense>} />
          {/* /liff/* routes 已移除 — 由獨立 LIFF app (sme-ops-liff.vercel.app) 處理 */}
          <Route path="/portal" element={<PortalGuard><PortalLayout /></PortalGuard>}>
            <Route index element={<PortalHome />} />
          </Route>
          <Route path="/employee-portal" element={<PortalGuard><Suspense fallback={<LoadingSpinner />}><EmployeePortal /></Suspense></PortalGuard>} />
          <Route path="/*" element={<ProtectedApp />} />
        </Routes>
        </Suspense>
      </TenantProvider>
    </AuthProvider>
    </LanguageProvider>
    </ErrorBoundary>
    </QueryClientProvider>
  )
}
