import { Routes, Route } from 'react-router-dom'
import Overview from '../pages/wms/Overview'
import SKUs from '../pages/wms/SKUs'
import Inbound from '../pages/wms/Inbound'
import Inventory from '../pages/wms/Inventory'
import Outbound from '../pages/wms/Outbound'
import Reports from '../pages/wms/Reports'
import Lots from '../pages/wms/Lots'
import StockCount from '../pages/wms/StockCount'
import Valuation from '../pages/wms/Valuation'
import Bins from '../pages/wms/Bins'
import PickPackShip from '../pages/wms/PickPackShip'
import Transfers from '../pages/wms/Transfers'

export default function WMSModule() {
  return (
    <Routes>
      <Route path="overview" element={<Overview />} />
      <Route path="skus" element={<SKUs />} />
      <Route path="inbound" element={<Inbound />} />
      <Route path="inventory" element={<Inventory />} />
      <Route path="outbound" element={<Outbound />} />
      <Route path="reports" element={<Reports />} />
      <Route path="lots" element={<Lots />} />
      <Route path="stock-count" element={<StockCount />} />
      <Route path="valuation" element={<Valuation />} />
      <Route path="bins" element={<Bins />} />
      <Route path="pick-pack-ship" element={<PickPackShip />} />
      <Route path="transfers" element={<Transfers />} />
    </Routes>
  )
}
