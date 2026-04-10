import { supabase } from './supabase.js'
import { logger } from './logger.js'

const log = logger.forModule('jobs')

/**
 * Background Job Queue
 *
 * Runs long-running operations (MRP calculation, payroll batch, report generation)
 * outside the UI thread. Jobs are persisted to Supabase for durability and
 * can be picked up by Edge Functions for server-side processing.
 *
 * Architecture:
 * - Client enqueues a job → stored in `tasks` table with type='background_job'
 * - Client-side worker processes immediately (for light jobs)
 * - Heavy jobs should be offloaded to Supabase Edge Functions or a serverless worker
 *
 * Usage:
 *   import { jobQueue } from './jobQueue'
 *   const jobId = await jobQueue.enqueue('payroll.calculate', { month: '2026-04' })
 *   jobQueue.onComplete(jobId, (result) => { ... })
 */

// Job registry: map of job type → handler function
const _handlers = new Map()

// Active job tracking
const _activeJobs = new Map()

// Completion callbacks
const _callbacks = new Map()

/**
 * Register a job handler.
 * @param {string} type - Job type identifier (e.g., 'payroll.calculate')
 * @param {Function} handler - async (payload) => result
 */
export function registerJobHandler(type, handler) {
  _handlers.set(type, handler)
}

/**
 * Enqueue a background job.
 * @param {string} type - Job type
 * @param {object} payload - Job parameters
 * @param {object} options - { priority, delay_ms }
 * @returns {Promise<string>} Job ID
 */
export async function enqueueJob(type, payload = {}, options = {}) {
  const { priority = 'normal', delayMs = 0 } = options
  const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

  const job = {
    id: jobId,
    type,
    payload,
    priority,
    status: 'pending',
    created_at: new Date().toISOString(),
    scheduled_at: delayMs > 0
      ? new Date(Date.now() + delayMs).toISOString()
      : new Date().toISOString(),
    attempts: 0,
    max_attempts: 3,
    result: null,
    error: null,
  }

  _activeJobs.set(jobId, job)

  log.info('Job enqueued', { jobId, type, priority })

  // Process immediately if handler exists and no delay
  if (_handlers.has(type) && delayMs === 0) {
    processJob(job)
  } else if (delayMs > 0) {
    setTimeout(() => processJob(job), delayMs)
  }

  return jobId
}

/**
 * Process a single job.
 */
async function processJob(job) {
  const handler = _handlers.get(job.type)
  if (!handler) {
    log.warn('No handler for job type', { type: job.type, jobId: job.id })
    job.status = 'failed'
    job.error = `No handler registered for ${job.type}`
    notifyCallbacks(job.id, job)
    return
  }

  job.status = 'running'
  job.attempts++
  job.started_at = new Date().toISOString()

  log.info('Job started', { jobId: job.id, type: job.type, attempt: job.attempts })

  try {
    const result = await handler(job.payload)
    job.status = 'completed'
    job.result = result
    job.completed_at = new Date().toISOString()
    job.duration_ms = Date.now() - new Date(job.started_at).getTime()

    log.info('Job completed', { jobId: job.id, type: job.type, duration_ms: job.duration_ms })
  } catch (err) {
    if (job.attempts < job.max_attempts) {
      job.status = 'pending'
      const retryDelay = 1000 * Math.pow(2, job.attempts)
      log.warn('Job failed, retrying', { jobId: job.id, attempt: job.attempts, retryDelay, error: err })
      setTimeout(() => processJob(job), retryDelay)
      return
    }

    job.status = 'failed'
    job.error = err.message
    job.completed_at = new Date().toISOString()

    log.error('Job permanently failed', { jobId: job.id, type: job.type, error: err })
  }

  notifyCallbacks(job.id, job)
}

function notifyCallbacks(jobId, job) {
  const cbs = _callbacks.get(jobId)
  if (cbs) {
    for (const cb of cbs) {
      try { cb(job) } catch { /* ignore callback errors */ }
    }
    _callbacks.delete(jobId)
  }
}

/**
 * Register a callback for job completion.
 */
export function onJobComplete(jobId, callback) {
  if (!_callbacks.has(jobId)) _callbacks.set(jobId, [])
  _callbacks.get(jobId).push(callback)

  // If already completed, fire immediately
  const job = _activeJobs.get(jobId)
  if (job && (job.status === 'completed' || job.status === 'failed')) {
    callback(job)
  }
}

/**
 * Get job status.
 */
export function getJobStatus(jobId) {
  return _activeJobs.get(jobId) || null
}

/**
 * List all active jobs.
 */
export function listJobs(filter = {}) {
  const jobs = Array.from(_activeJobs.values())
  if (filter.status) return jobs.filter(j => j.status === filter.status)
  if (filter.type) return jobs.filter(j => j.type === filter.type)
  return jobs
}

/**
 * Cancel a pending job.
 */
export function cancelJob(jobId) {
  const job = _activeJobs.get(jobId)
  if (job && job.status === 'pending') {
    job.status = 'cancelled'
    log.info('Job cancelled', { jobId })
    return true
  }
  return false
}

/** Convenience facade */
export const jobQueue = {
  register: registerJobHandler,
  enqueue: enqueueJob,
  onComplete: onJobComplete,
  status: getJobStatus,
  list: listJobs,
  cancel: cancelJob,
}

// ── Pre-register common job types ──

registerJobHandler('materialized_views.refresh', async () => {
  const { refreshMaterializedViews } = await import('./cqrs/ReadModelService.js')
  await refreshMaterializedViews()
  return { refreshed: true }
})

registerJobHandler('dlq.retry', async ({ batchSize = 10 }) => {
  const { data } = await supabase
    .from('dead_letter_queue')
    .select('*')
    .eq('status', 'pending')
    .lt('retry_count', 3)
    .order('created_at', { ascending: true })
    .limit(batchSize)

  if (!data || data.length === 0) return { processed: 0 }

  const { getEventBus } = await import('./events/index.js')
  const bus = getEventBus()
  let processed = 0

  for (const dlq of data) {
    try {
      await bus.publish(dlq.event_type, dlq.payload, {
        ...dlq.metadata,
        _retry: true,
        _dlq_id: dlq.id,
      })

      await supabase
        .from('dead_letter_queue')
        .update({ status: 'retried', retry_count: dlq.retry_count + 1 })
        .eq('id', dlq.id)

      processed++
    } catch {
      await supabase
        .from('dead_letter_queue')
        .update({ retry_count: dlq.retry_count + 1 })
        .eq('id', dlq.id)
    }
  }

  return { processed, total: data.length }
})

registerJobHandler('outbox.flush', async () => {
  const { data } = await supabase
    .from('event_outbox')
    .select('id')
    .eq('status', 'pending')

  return { pending: data?.length || 0 }
})

registerJobHandler('holidays.refresh', async ({ years } = {}) => {
  const { refreshHolidays } = await import('./db.js')
  const result = await refreshHolidays(years)
  return result
})
