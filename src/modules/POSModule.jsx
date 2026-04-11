import { Routes, Route } from 'react-router-dom'
import Overview from '../pages/pos/Overview'
import POSTerminal from '../pages/pos/POSTerminal'
import POSShifts from '../pages/pos/POSShifts'

export default function POSModule() {
  return (
    <Routes>
      <Route index element={<Overview />} />
      <Route path="terminal" element={<POSTerminal />} />
      <Route path="shifts" element={<POSShifts />} />
    </Routes>
  )
}
