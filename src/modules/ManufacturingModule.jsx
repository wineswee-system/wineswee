import { Routes, Route } from 'react-router-dom'
import BOM from '../pages/manufacturing/BOM'
import MRP from '../pages/manufacturing/MRP'
import QualityInspection from '../pages/manufacturing/QualityInspection'
import ManufacturingOrders from '../pages/manufacturing/ManufacturingOrders'
import ShopFloor from '../pages/manufacturing/ShopFloor'
import WorkCenters from '../pages/manufacturing/WorkCenters'
import Scheduling from '../pages/manufacturing/Scheduling'
import Subcontracting from '../pages/manufacturing/Subcontracting'

export default function ManufacturingModule() {
  return (
    <Routes>
      <Route path="bom" element={<BOM />} />
      <Route path="mrp" element={<MRP />} />
      <Route path="qm" element={<QualityInspection />} />
      <Route path="orders" element={<ManufacturingOrders />} />
      <Route path="shop-floor" element={<ShopFloor />} />
      <Route path="work-centers" element={<WorkCenters />} />
      <Route path="scheduling" element={<Scheduling />} />
      <Route path="subcontracting" element={<Subcontracting />} />
    </Routes>
  )
}
