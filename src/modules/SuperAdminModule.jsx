import { Routes, Route } from 'react-router-dom'
import OrgManagement from '../pages/super-admin/OrgManagement'
import UserConfig from '../pages/super-admin/UserConfig'
import ModuleConfig from '../pages/super-admin/ModuleConfig'
import SystemLogs from '../pages/super-admin/SystemLogs'
import ErrorLogs from '../pages/super-admin/ErrorLogs'
import UserActivity from '../pages/super-admin/UserActivity'
import AIUsage from '../pages/super-admin/AIUsage'
import Changelog from '../pages/super-admin/Changelog'

export default function SuperAdminModule() {
  return (
    <Routes>
      <Route path="orgs" element={<OrgManagement />} />
      <Route path="users" element={<UserConfig />} />
      <Route path="modules" element={<ModuleConfig />} />
      <Route path="system-logs" element={<SystemLogs />} />
      <Route path="error-logs" element={<ErrorLogs />} />
      <Route path="user-activity" element={<UserActivity />} />
      <Route path="ai-usage" element={<AIUsage />} />
      <Route path="changelog" element={<Changelog />} />
    </Routes>
  )
}
