import { Routes, Route } from 'react-router-dom'
import Suppliers from '../pages/purchase/Suppliers'
import VendorCategories from '../pages/purchase/VendorCategories'
import VendorPerformance from '../pages/purchase/VendorPerformance'
import VendorOnboarding from '../pages/purchase/VendorOnboarding'
import PurchaseRequests from '../pages/purchase/PurchaseRequests'
import PurchaseOrders from '../pages/purchase/PurchaseOrders'
import GoodsReceipts from '../pages/purchase/GoodsReceipts'
import Contracts from '../pages/purchase/Contracts'
import ProcurementPipeline from '../pages/purchase/ProcurementPipeline'
import ProcurementWorkflow from '../pages/purchase/ProcurementWorkflow'
import ThreeWayMatch from '../pages/purchase/ThreeWayMatch'
import BlanketOrders from '../pages/purchase/BlanketOrders'

export default function PurchaseModule() {
  return (
    <Routes>
      <Route path="suppliers" element={<Suppliers />} />
      <Route path="categories" element={<VendorCategories />} />
      <Route path="performance" element={<VendorPerformance />} />
      <Route path="onboarding" element={<VendorOnboarding />} />
      <Route path="requests" element={<PurchaseRequests />} />
      <Route path="orders" element={<PurchaseOrders />} />
      <Route path="receipts" element={<GoodsReceipts />} />
      <Route path="contracts" element={<Contracts />} />
      <Route path="pipeline" element={<ProcurementPipeline />} />
      <Route path="workflow" element={<ProcurementWorkflow />} />
      <Route path="matching" element={<ThreeWayMatch />} />
      <Route path="blanket" element={<BlanketOrders />} />
    </Routes>
  )
}
