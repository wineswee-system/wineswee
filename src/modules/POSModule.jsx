import { Routes, Route } from 'react-router-dom'
import Overview         from '../pages/pos/Overview'
import POSTerminal      from '../pages/pos/POSTerminal'
import POSShifts        from '../pages/pos/POSShifts'
import MenuManagement   from '../pages/pos/MenuManagement'
import ProductCatalog   from '../pages/pos/ProductCatalog'
import QRSettings       from '../pages/pos/QRSettings'
import QRTableManager  from '../pages/pos/QRTableManager'
import StaffPerformance from '../pages/pos/StaffPerformance'
import OrderHistory     from '../pages/pos/OrderHistory'
import InvoiceList      from '../pages/pos/InvoiceList'
import ZReport          from '../pages/pos/ZReport'
import KitchenDisplay   from '../pages/pos/KitchenDisplay'
import WaiterMode       from '../pages/pos/WaiterMode'

export default function POSModule() {
  return (
    <Routes>
      <Route index                      element={<Overview />} />
      <Route path="terminal"            element={<POSTerminal />} />
      <Route path="waiter"              element={<WaiterMode />} />
      <Route path="kitchen"             element={<KitchenDisplay />} />
      <Route path="shifts"              element={<POSShifts />} />
      <Route path="z-report"            element={<ZReport />} />
      <Route path="menu"                element={<MenuManagement />} />
      <Route path="products"            element={<ProductCatalog />} />
      <Route path="qr-settings"         element={<QRSettings />} />
      <Route path="qr-tables"           element={<QRTableManager />} />
      <Route path="staff-performance"   element={<StaffPerformance />} />
      <Route path="orders"              element={<OrderHistory />} />
      <Route path="invoices"            element={<InvoiceList />} />
    </Routes>
  )
}
