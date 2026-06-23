import { Routes, Route, Navigate } from 'react-router-dom'
import Overview       from '../pages/reservations/Overview'
import ReservationList from '../pages/reservations/ReservationList'
import SeatingMap     from '../pages/reservations/SeatingMap'
import Tables         from '../pages/reservations/Tables'
import Rules          from '../pages/reservations/Rules'

export default function ReservationModule() {
  return (
    <Routes>
      <Route index element={<Navigate to="overview" replace />} />
      <Route path="overview" element={<Overview />} />
      <Route path="list"     element={<ReservationList />} />
      <Route path="seating"  element={<SeatingMap />} />
      <Route path="tables"   element={<Tables />} />
      <Route path="rules"    element={<Rules />} />
    </Routes>
  )
}
