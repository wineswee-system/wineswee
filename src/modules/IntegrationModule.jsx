import { Routes, Route } from 'react-router-dom'
import Ecommerce from '../pages/integration/Ecommerce'
import WenzhongImport from '../pages/integration/WenzhongImport'
import APIDocumentation from '../pages/integration/APIDocumentation'
import CarrierIntegration from '../pages/integration/CarrierIntegration'

export default function IntegrationModule() {
  return (
    <Routes>
      <Route path="ecommerce" element={<Ecommerce />} />
      <Route path="wenzhong" element={<WenzhongImport />} />
      <Route path="api" element={<APIDocumentation />} />
      <Route path="carriers" element={<CarrierIntegration />} />
    </Routes>
  )
}
