import { Routes, Route, Navigate } from 'react-router-dom'
import CourseList from '../pages/lms/CourseList'
import CourseDetail from '../pages/lms/CourseDetail'
import CourseBuilder from '../pages/lms/CourseBuilder'
import LessonPlayer from '../pages/lms/LessonPlayer'
import QuizEngine from '../pages/lms/QuizEngine'
import ProgressDashboard from '../pages/lms/ProgressDashboard'
import CertificateList from '../pages/lms/CertificateList'
import LMSAdmin from '../pages/lms/LMSAdmin'

export default function LMSModule() {
  return (
    <Routes>
      <Route index element={<Navigate to="courses" replace />} />
      <Route path="courses" element={<CourseList />} />
      <Route path="builder" element={<CourseBuilder />} />
      <Route path="builder/:id" element={<CourseBuilder />} />
      <Route path="course/:courseId" element={<CourseDetail />} />
      <Route path="course/:courseId/lesson/:lessonId" element={<LessonPlayer />} />
      <Route path="course/:courseId/quiz/:lessonId" element={<QuizEngine />} />
      <Route path="progress" element={<ProgressDashboard />} />
      <Route path="certificates" element={<CertificateList />} />
      <Route path="admin" element={<LMSAdmin />} />
    </Routes>
  )
}
