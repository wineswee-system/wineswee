import { supabase } from '../supabase'

export const getPerformanceReviews = (orgId) => {
  let q = supabase.from('performance_reviews').select('*').order('id').limit(1000)
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

// ─── Candidates ───
export const getCandidates = (orgId, jobId) => {
  let q = supabase.from('candidates').select('*, recruitment_jobs(title)').order('created_at', { ascending: false })
  if (orgId) q = q.eq('organization_id', orgId)
  if (jobId) q = q.eq('job_id', jobId)
  return q
}
export const createCandidate = (data) =>
  supabase.from('candidates').insert(data).select().single()
export const updateCandidate = (id, data) =>
  supabase.from('candidates').update(data).eq('id', id).select().single()
export const deleteCandidate = (id) =>
  supabase.from('candidates').delete().eq('id', id)

// ─── Interviews ───
export const getInterviews = (orgId, candidateId) => {
  let q = supabase.from('interviews')
    .select('*, employees(name)')
    .order('scheduled_at', { ascending: true })
  if (orgId) q = q.eq('organization_id', orgId)
  if (candidateId) q = q.eq('candidate_id', candidateId)
  return q
}
export const createInterview = (data) =>
  supabase.from('interviews').insert(data).select().single()
export const updateInterview = (id, data) =>
  supabase.from('interviews').update(data).eq('id', id).select().single()
export const deleteInterview = (id) =>
  supabase.from('interviews').delete().eq('id', id)

// ─── Offer Letter Templates ───
export const getOfferLetterTemplates = (orgId) => {
  let q = supabase.from('offer_letter_templates').select('*').order('is_default', { ascending: false }).order('id')
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}
export const createOfferLetterTemplate = (data) =>
  supabase.from('offer_letter_templates').insert(data).select().single()
export const updateOfferLetterTemplate = (id, data) =>
  supabase.from('offer_letter_templates').update(data).eq('id', id).select().single()
export const deleteOfferLetterTemplate = (id) =>
  supabase.from('offer_letter_templates').delete().eq('id', id)

// ─── Offer Letters ───
export const getOfferLetters = (orgId, candidateId) => {
  let q = supabase.from('offer_letters')
    .select('*, candidates(name), offer_letter_templates(name), approver:employees!approver_id(name)')
    .order('created_at', { ascending: false })
  if (orgId) q = q.eq('organization_id', orgId)
  if (candidateId) q = q.eq('candidate_id', candidateId)
  return q
}
export const createOfferLetter = (data) =>
  supabase.from('offer_letters').insert(data).select().single()
export const updateOfferLetter = (id, data) =>
  supabase.from('offer_letters').update(data).eq('id', id).select().single()

export const getDocuments = (orgId) => {
  let q = supabase.from('documents').select('*').order('upload_date', { ascending: false })
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const createDocument = (data) =>
  supabase.from('documents').insert(data).select().single()

export const deleteDocument = (id, orgId) => {
  let q = supabase.from('documents').delete().eq('id', id)
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const getBusinessTrips = (orgId) => {
  let q = supabase.from('business_trips').select('*').is('deleted_at', null).order('id')
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const createBusinessTrip = (data) =>
  supabase.from('business_trips').insert(data).select().single()

export const updateBusinessTripStatus = (id, status, rejectReason, orgId) => {
  let q = supabase.from('business_trips').update({ status, reject_reason: rejectReason || null }).eq('id', id)
  if (orgId) q = q.eq('organization_id', orgId)
  return q.select().single()
}

export const getExpenses = (orgId) => {
  let q = supabase.from('expenses').select('*').order('id')
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const createExpense = (data) =>
  supabase.from('expenses').insert(data).select().single()

export const updateExpenseStatus = (id, status, rejectReason, orgId) => {
  let q = supabase.from('expenses').update({ status, reject_reason: rejectReason || null }).eq('id', id)
  if (orgId) q = q.eq('organization_id', orgId)
  return q.select().single()
}

export const getTrainingCourses = (orgId) => {
  let q = supabase.from('training_courses').select('*').order('id', { ascending: false })
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const createTrainingCourse = (data) =>
  supabase.from('training_courses').insert(data).select().single()

export const updateTrainingCourse = (id, data) =>
  supabase.from('training_courses').update(data).eq('id', id).select().single()

export const deleteTrainingCourse = (id, orgId) => {
  let q = supabase.from('training_courses').delete().eq('id', id)
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const getTrainingEnrollments = (courseId) => {
  const q = supabase.from('training_enrollments').select('*').order('id')
  return courseId ? q.eq('course_id', courseId) : q
}

export const createTrainingEnrollment = (data) =>
  supabase.from('training_enrollments').insert(data).select().single()

export const updateTrainingEnrollment = (id, data) =>
  supabase.from('training_enrollments').update(data).eq('id', id).select().single()

export const getProbationRecords = (orgId) => {
  let q = supabase.from('probation_records').select('*').order('end_date')
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const createProbationRecord = (data) =>
  supabase.from('probation_records').insert(data).select().single()

export const updateProbationRecord = (id, data) =>
  supabase.from('probation_records').update(data).eq('id', id).select().single()

export const getAttritionSnapshots = (date, orgId) => {
  let q = supabase.from('attrition_risk_snapshots').select('*').order('risk_score', { ascending: false })
  if (date) q = q.eq('snapshot_date', date)
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const upsertAttritionSnapshot = (data) =>
  supabase.from('attrition_risk_snapshots').upsert(data, { onConflict: 'employee,snapshot_date' }).select().single()

export const getCompensationBands = (orgId) => {
  let q = supabase.from('compensation_bands').select('*').order('dept')
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

export const createCompensationBand = (data) =>
  supabase.from('compensation_bands').insert(data).select().single()

export const updateCompensationBand = (id, data) =>
  supabase.from('compensation_bands').update(data).eq('id', id).select().single()

export const deleteCompensationBand = (id) =>
  supabase.from('compensation_bands').delete().eq('id', id)

export const getEngagementSurveys = (orgId) => {
  let q = supabase.from('engagement_surveys').select('*').order('created_at', { ascending: false })
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}

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

// ─── Headcount Requests ───
export const getHeadcountRequests = (orgId) => {
  let q = supabase.from('headcount_requests')
    .select('*, creator:employees!created_by(name), reviewer:employees!reviewed_by(name)')
    .order('created_at', { ascending: false })
  if (orgId) q = q.eq('organization_id', orgId)
  return q
}
export const createHeadcountRequest = (data) =>
  supabase.from('headcount_requests').insert(data).select().single()
export const updateHeadcountRequest = (id, data) =>
  supabase.from('headcount_requests').update(data).eq('id', id).select().single()

export const getBenefitPolicies = (filters = {}) => {
  let q = supabase.from('benefit_policies').select('*, stores(name), employees(name)').order('id', { ascending: false })
  if (filters.orgId) q = q.eq('organization_id', filters.orgId)
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
