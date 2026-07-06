import { Routes, Route } from 'react-router-dom'
import Overview from '../pages/sales/Overview'
import Quotations from '../pages/sales/Quotations'
import SalesOrders from '../pages/sales/SalesOrders'
import Promotions from '../pages/sales/Promotions'
import Returns from '../pages/sales/Returns'
import Shipments from '../pages/sales/Shipments'
import PricingRules from '../pages/sales/PricingRules'
import Commission from '../pages/sales/Commission'
import Allowances from '../pages/sales/Allowances'

export default function SalesModule() {
  return (
    <Routes>
      <Route index element={<Overview />} />
      <Route path="quotations" element={<Quotations />} />
      <Route path="orders" element={<SalesOrders />} />
      <Route path="promotions" element={<Promotions />} />
      <Route path="returns" element={<Returns />} />
      <Route path="allowances" element={<Allowances />} />
      <Route path="shipments" element={<Shipments />} />
      <Route path="pricing" element={<PricingRules />} />
      <Route path="commission" element={<Commission />} />
    </Routes>
  )
}
