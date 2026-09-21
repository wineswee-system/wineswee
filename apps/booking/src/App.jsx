import { Routes, Route, Navigate } from 'react-router-dom'
import BookingPage from './pages/BookingPage'
import ConfirmPage from './pages/ConfirmPage'
import LookupPage  from './pages/LookupPage'
import MenuPage    from './pages/MenuPage'

export default function App() {
  return (
    <Routes>
      <Route path="/"                        element={<BookingPage />} />
      <Route path="/confirm"                 element={<ConfirmPage />} />
      <Route path="/lookup"                  element={<LookupPage />} />
      <Route path="/menu/:storeId/:tableId"  element={<MenuPage />} />
      <Route path="*"                        element={<Navigate to="/" replace />} />
    </Routes>
  )
}
