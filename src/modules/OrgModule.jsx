import { Routes, Route } from 'react-router-dom'
import Overview from '../pages/org/Overview'
import Organizations from '../pages/org/Organizations'
import OrgChart from '../pages/org/OrgChart'
import Companies from '../pages/org/Companies'
import Locations from '../pages/org/Locations'
import Departments from '../pages/org/Departments'
import Employees from '../pages/org/Employees'
import EmployeeProfile from '../pages/org/EmployeeProfile'
import LineIntegration from '../pages/org/LineIntegration'
import Templates from '../pages/org/Templates'

export default function OrgModule() {
  return (
    <Routes>
      <Route path="overview" element={<Overview />} />
      <Route path="organizations" element={<Organizations />} />
      <Route path="chart" element={<OrgChart />} />
      <Route path="companies" element={<Companies />} />
      <Route path="locations" element={<Locations />} />
      <Route path="departments" element={<Departments />} />
      <Route path="employees" element={<Employees />} />
      <Route path="employees/:id" element={<EmployeeProfile />} />
      <Route path="line" element={<LineIntegration />} />
      <Route path="templates" element={<Templates />} />
    </Routes>
  )
}
