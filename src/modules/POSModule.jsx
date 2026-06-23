import { Routes, Route } from 'react-router-dom'
import Overview from '../pages/pos/Overview'
import POSTerminal from '../pages/pos/POSTerminal'
import POSShifts from '../pages/pos/POSShifts'
import MenuManagement from '../pages/pos/MenuManagement'
import ProductCatalog from '../pages/pos/ProductCatalog'
import QRSettings from '../pages/pos/QRSettings'
import StaffPerformance from '../pages/pos/StaffPerformance'

export default function POSModule() {
  return (
    <Routes>
      <Route index element={<Overview />} />
      <Route path="terminal" element={<POSTerminal />} />
      <Route path="shifts" element={<POSShifts />} />
      <Route path="menu" element={<MenuManagement />} />
      <Route path="products" element={<ProductCatalog />} />
      <Route path="qr-settings" element={<QRSettings />} />
      <Route path="staff-performance" element={<StaffPerformance />} />
    </Routes>
  )
}
