import { supabase } from '../supabase'

export const getPerformanceReviews = (orgId) => {
  let q = supabase.from('performance_reviews').select('*').order('id')
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const updatePerformanceReview = (id, data) =>
  supabase.from('performance_reviews').update(data).eq('id', id).select().single()

export const getRecruitmentJobs = (orgId) => {
  let q = supabase.from('recruitment_jobs').select('*').order('id')
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const createRecruitmentJob = (data) =>
  supabase.from('recruitment_jobs').insert(data).select().single()

export const updateRecruitmentJob = (id, data) =>
  supabase.from('recruitment_jobs').update(data).eq('id', id).select().single()

export const deleteRecruitmentJob = (id) =>
  supabase.from('recruitment_jobs').delete().eq('id', id)

export const getDocuments = () =>
  supabase.from('documents').select('*').order('upload_date', { ascending: false })

export const createDocument = (data) =>
  supabase.from('documents').insert(data).select().single()

export const deleteDocument = (id) =>
  supabase.from('documents').delete().eq('id', id)

export const getBusinessTrips = () =>
  supabase.from('business_trips').select('*').order('id')

export const createBusinessTrip = (data) =>
  supabase.from('business_trips').insert(data).select().single()

export const updateBusinessTripStatus = (id, status, rejectReason) =>
  supabase.from('business_trips').update({ status, reject_reason: rejectReason || null }).eq('id', id).select().single()

export const getExpenses = () =>
  supabase.from('expenses').select('*').order('id')

export const createExpense = (data) =>
  supabase.from('expenses').insert(data).select().single()

export const updateExpenseStatus = (id, status, rejectReason) =>
  supabase.from('expenses').update({ status, reject_reason: rejectReason || null }).eq('id', id).select().single()

export const getTrainingCourses = () =>
  supabase.from('training_courses').select('*').order('id', { ascending: false })

export const createTrainingCourse = (data) =>
  supabase.from('training_courses').insert(data).select().single()

export const updateTrainingCourse = (id, data) =>
  supabase.from('training_courses').update(data).eq('id', id).select().single()

export const deleteTrainingCourse = (id) =>
  supabase.from('training_courses').delete().eq('id', id)

export const getTrainingEnrollments = (courseId) => {
  const q = supabase.from('training_enrollments').select('*').order('id')
  return courseId ? q.eq('course_id', courseId) : q
}

export const createTrainingEnrollment = (data) =>
  supabase.from('training_enrollments').insert(data).select().single()

export const updateTrainingEnrollment = (id, data) =>
  supabase.from('training_enrollments').update(data).eq('id', id).select().single()

export const getProbationRecords = () =>
  supabase.from('probation_records').select('*').order('end_date')

export const createProbationRecord = (data) =>
  supabase.from('probation_records').insert(data).select().single()

export const updateProbationRecord = (id, data) =>
  supabase.from('probation_records').update(data).eq('id', id).select().single()

export const getAttritionSnapshots = (date) => {
  const q = supabase.from('attrition_risk_snapshots').select('*').order('risk_score', { ascending: false })
  return date ? q.eq('snapshot_date', date) : q
}

export const upsertAttritionSnapshot = (data) =>
  supabase.from('attrition_risk_snapshots').upsert(data, { onConflict: 'employee,snapshot_date' }).select().single()

export const getCompensationBands = () =>
  supabase.from('compensation_bands').select('*').order('dept')

export const createCompensationBand = (data) =>
  supabase.from('compensation_bands').insert(data).select().single()

export const updateCompensationBand = (id, data) =>
  supabase.from('compensation_bands').update(data).eq('id', id).select().single()

export const deleteCompensationBand = (id) =>
  supabase.from('compensation_bands').delete().eq('id', id)

export const getEngagementSurveys = () =>
  supabase.from('engagement_surveys').select('*').order('created_at', { ascending: false })

export const createEngagementSurvey = (data) =>
  supabase.from('engagement_surveys').insert(data).select().single()

export const updateEngagementSurvey = (id, data) =>
  supabase.from('engagement_surveys').update(data).eq('id', id).select().single()

export const deleteEngagementSurvey = (id) =>
  supabase.from('engagement_surveys').delete().eq('id', id)

export const getEngagementResponses = (surveyId) =>
  supabase.from('engagement_responses').select('*').eq('survey_id', surveyId).order('submitted_at', { ascending: false })

export const submitEngagementResponse = (data) =>
  supabase.from('engagement_responses').insert(data).select().single()

export const getEmployeePersonality = (employeeId) =>
  supabase.from('employee_personality_profiles').select('*').eq('employee_id', employeeId).maybeSingle()

export const upsertEmployeePersonality = (data) =>
  supabase.from('employee_personality_profiles').upsert(data, { onConflict: 'employee_id' }).select().single()

export const getEmployeeDevelopmentPlans = (employeeId) =>
  supabase.from('employee_development_plans').select('*').eq('employee_id', employeeId).order('created_at', { ascending: false })

export const createDevelopmentPlan = (data) =>
  supabase.from('employee_development_plans').insert(data).select().single()

export const updateDevelopmentPlan = (id, data) =>
  supabase.from('employee_development_plans').update(data).eq('id', id).select().single()

export const deleteDevelopmentPlan = (id) =>
  supabase.from('employee_development_plans').delete().eq('id', id)

export const getBenefitPolicies = (filters = {}) => {
  let q = supabase.from('benefit_policies').select('*, stores(name), employees(name)').order('id', { ascending: false })
  if (filters.storeId) q = q.eq('store_id', filters.storeId)
  if (filters.storeId === null) q = q.is('store_id', null)
  if (filters.category) q = q.eq('category', filters.category)
  if (filters.isActive !== undefined) q = q.eq('is_active', filters.isActive)
  return q
}

export const createBenefitPolicy = (data) =>
  supabase.from('benefit_policies').insert(data).select().single()

export const updateBenefitPolicy = (id, data) =>
  supabase.from('benefit_policies').update({ ...data, updated_at: new Date().toISOString() }).eq('id', id).select().single()

export const deleteBenefitPolicy = (id) =>
  supabase.from('benefit_policies').delete().eq('id', id)
