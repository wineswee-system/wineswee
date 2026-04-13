import { Routes, Route } from 'react-router-dom'
import Overview from '../pages/crm/Overview'
import Customers from '../pages/crm/Customers'
import Pipeline from '../pages/crm/Pipeline'
import Marketing from '../pages/crm/Marketing'
import DripCampaigns from '../pages/crm/DripCampaigns'
import Service from '../pages/crm/Service'
import Members from '../pages/crm/Members'
import FormBuilder from '../pages/crm/FormBuilder'
import WorkflowBuilder from '../pages/crm/WorkflowBuilder'
import MessageLog from '../pages/crm/MessageLog'
import Segments from '../pages/crm/Segments'
import Customer360 from '../pages/crm/Customer360'
import Activities from '../pages/crm/Activities'
import Leads from '../pages/crm/Leads'
import Reports from '../pages/crm/Reports'
import Contacts from '../pages/crm/Contacts'

export default function CRMModule() {
  return (
    <Routes>
      <Route path="overview" element={<Overview />} />
      <Route path="customers" element={<Customers />} />
      <Route path="contacts" element={<Contacts />} />
      <Route path="pipeline" element={<Pipeline />} />
      <Route path="activities" element={<Activities />} />
      <Route path="leads" element={<Leads />} />
      <Route path="marketing" element={<Marketing />} />
      <Route path="drip-campaigns" element={<DripCampaigns />} />
      <Route path="service" element={<Service />} />
      <Route path="members" element={<Members />} />
      <Route path="forms" element={<FormBuilder />} />
      <Route path="workflows" element={<WorkflowBuilder />} />
      <Route path="messages" element={<MessageLog />} />
      <Route path="segments" element={<Segments />} />
      <Route path="customer-360" element={<Customer360 />} />
      <Route path="reports" element={<Reports />} />
    </Routes>
  )
}
