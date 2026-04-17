import { Routes, Route } from 'react-router-dom'
import Triggers from '../pages/system/Triggers'
import Notifications from '../pages/system/Notifications'
import Users from '../pages/system/Users'
import AuditLog from '../pages/system/AuditLog'
import PerformanceMgmt from '../pages/system/PerformanceMgmt'
import Settings from '../pages/system/Settings'
import DataImportExport from '../pages/system/DataImportExport'
import DatabaseAdmin from '../pages/system/DatabaseAdmin'
import TenantAdmin from '../pages/system/TenantAdmin'
import ApprovalRules from '../pages/system/ApprovalRules'
import ApprovalChains from '../pages/system/ApprovalChains'
import TrainingGuide from '../pages/system/TrainingGuide'
export default function SystemModule() {
  return (
    <Routes>
      <Route path="training" element={<TrainingGuide />} />
      <Route path="triggers" element={<Triggers />} />
      <Route path="notifications" element={<Notifications />} />
      <Route path="users" element={<Users />} />
      <Route path="audit" element={<AuditLog />} />
      <Route path="performance" element={<PerformanceMgmt />} />
      <Route path="settings" element={<Settings />} />
      <Route path="import-export" element={<DataImportExport />} />
      <Route path="database" element={<DatabaseAdmin />} />
      <Route path="tenants" element={<TenantAdmin />} />
      <Route path="approval-rules" element={<ApprovalRules />} />
      <Route path="approval-chains" element={<ApprovalChains />} />
    </Routes>
  )
}
