import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { StoreProvider } from './contexts/StoreContext'
import LoginPage from './pages/LoginPage'
import AccessDenied from './pages/AccessDenied'
import Layout from './components/Layout'
import Overview from './pages/Overview'
import ReservationList from './pages/ReservationList'
import SeatingMap from './pages/SeatingMap'

function Guard({ children }) {
  const { user, loading, isAllowed } = useAuth()

  if (user === undefined || loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#9ca3af', background: '#0f1117' }}>
        載入中…
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  if (!isAllowed) return <AccessDenied />
  return children
}

function ProtectedApp() {
  return (
    <Guard>
      <StoreProvider>
        <Layout>
          <Routes>
            <Route index element={<Navigate to="overview" replace />} />
            <Route path="overview" element={<Overview />} />
            <Route path="list"     element={<ReservationList />} />
            <Route path="seating"  element={<SeatingMap />} />
          </Routes>
        </Layout>
      </StoreProvider>
    </Guard>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/*"     element={<ProtectedApp />} />
      </Routes>
    </AuthProvider>
  )
}
