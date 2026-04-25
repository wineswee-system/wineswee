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
import MySchedule from '../pages/hr/MySchedule'
import AttritionPrediction from '../pages/hr/AttritionPrediction'
import CompensationBenchmark from '../pages/hr/CompensationBenchmark'
import EngagementSurveys from '../pages/hr/EngagementSurveys'
import TaxForms from '../pages/hr/TaxForms'
import SelfService from '../pages/hr/SelfService'
import LeaveCalendar from '../pages/hr/LeaveCalendar'
import ProbationTracker from '../pages/hr/ProbationTracker'
import HRAssistant from '../pages/hr/HRAssistant'
import BenefitSettings from '../pages/hr/BenefitSettings'
import LeaveBalances from '../pages/hr/LeaveBalances'
import SalaryStructures from '../pages/hr/SalaryStructures'
import Payroll from '../pages/hr/Payroll'
import LegalDeductions from '../pages/hr/LegalDeductions'
import WorkUnitSettings from '../pages/hr/WorkUnitSettings'

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
      <Route path="my-schedule" element={<MySchedule />} />
      <Route path="attrition" element={<AttritionPrediction />} />
      <Route path="compensation" element={<CompensationBenchmark />} />
      <Route path="surveys" element={<EngagementSurveys />} />
      <Route path="tax-forms" element={<TaxForms />} />
      <Route path="self-service" element={<SelfService />} />
      <Route path="leave-calendar" element={<LeaveCalendar />} />
      <Route path="probation" element={<ProbationTracker />} />
      <Route path="assistant" element={<HRAssistant />} />
      <Route path="benefit-settings" element={<BenefitSettings />} />
      <Route path="leave-balances" element={<LeaveBalances />} />
      <Route path="salary-structures" element={<SalaryStructures />} />
      <Route path="payroll" element={<Payroll />} />
      <Route path="legal-deductions" element={<LegalDeductions />} />
      <Route path="work-unit-settings" element={<WorkUnitSettings />} />
    </Routes>
  )
}
