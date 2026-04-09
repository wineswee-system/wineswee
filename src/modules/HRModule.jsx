import { Routes, Route } from 'react-router-dom'
import HRReport from '../pages/hr/HRReport'
import Attendance from '../pages/hr/Attendance'
import PunchCorrection from '../pages/hr/PunchCorrection'
import Leave from '../pages/hr/Leave'
import Overtime from '../pages/hr/Overtime'
import Salary from '../pages/hr/Salary'
import Schedule from '../pages/hr/Schedule'
import Holidays from '../pages/hr/Holidays'
import ScheduleRules from '../pages/hr/ScheduleRules'
import Performance from '../pages/hr/Performance'
import Recruitment from '../pages/hr/Recruitment'
import Documents from '../pages/hr/Documents'
import Transfer from '../pages/hr/Transfer'
import BusinessTravel from '../pages/hr/BusinessTravel'
import Expenses from '../pages/hr/Expenses'
import Bonus from '../pages/hr/Bonus'
import LaborInspection from '../pages/hr/LaborInspection'
import Training from '../pages/hr/Training'

export default function HRModule() {
  return (
    <Routes>
      <Route path="report" element={<HRReport />} />
      <Route path="attendance" element={<Attendance />} />
      <Route path="punch-correction" element={<PunchCorrection />} />
      <Route path="leave" element={<Leave />} />
      <Route path="overtime" element={<Overtime />} />
      <Route path="salary" element={<Salary />} />
      <Route path="schedule" element={<Schedule />} />
      <Route path="holidays" element={<Holidays />} />
      <Route path="schedule-rules" element={<ScheduleRules />} />
      <Route path="performance" element={<Performance />} />
      <Route path="recruitment" element={<Recruitment />} />
      <Route path="documents" element={<Documents />} />
      <Route path="transfer" element={<Transfer />} />
      <Route path="travel" element={<BusinessTravel />} />
      <Route path="expenses" element={<Expenses />} />
      <Route path="bonus" element={<Bonus />} />
      <Route path="labor-inspection" element={<LaborInspection />} />
      <Route path="training" element={<Training />} />
    </Routes>
  )
}
