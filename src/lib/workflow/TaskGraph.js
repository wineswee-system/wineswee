import { logger } from '../logger.js'
import { getEventBus } from '../events/EventBus.js'
import { startWorkflow } from './WorkflowEngine.js'

const log = logger.forModule('taskgraph')
function _bus() { return getEventBus() }

// ── Registries ──
const _projects = new Map()       // projectName → { name, workflows[], entry[] }
const _taskWorkflows = new Map()  // workflowName → { tasks[], entryTasks[] }
const _taskHandlers = new Map()   // handlerName → async fn(ctx, payload)

// ── Project ──
/**
 * Define a project that groups one or more task-graph workflows.
 *
 * @param {string} name
 * @param {object} options
 * @param {string[]} options.workflows  - Workflow names included in this project.
 * @param {Array<{workflow:string, task:string}>} options.entry
 *   Explicit list of workflow+task pairs that start when the project starts.
 *   Must be non-empty — there is no implicit auto-start.
 */
export function defineProject(name, { workflows = [], entry = [] }) {
  if (entry.length === 0) {
    throw new Error(`defineProject("${name}"): entry must list at least one {workflow, task}`)
  }
  for (const { workflow: wf } of entry) {
    if (!workflows.includes(wf)) {
      throw new Error(`defineProject("${name}"): entry workflow "${wf}" is not listed in workflows`)
    }
  }
  _projects.set(name, { name, workflows, entry })
}

// ── Task-graph workflow ──
/**
 * Define a task-graph workflow.
 *
 * @param {string}   name
 * @param {Array}    tasks       - Task descriptors built with task().
 * @param {object}   [options]
 * @param {string[]} [options.entryTasks]
 *   Default tasks that start when this workflow is launched standalone via
 *   startTaskWorkflow(). Required if the workflow will ever be started standalone.
 */
export function defineTaskWorkflow(name, tasks, { entryTasks = [] } = {}) {
  _taskWorkflows.set(name, { tasks, entryTasks })
}

// ── Handler registry ──
export function registerTaskHandler(name, fn) {
  _taskHandlers.set(name, fn)
}

// ── Descriptor builders ──

/**
 * Declare a task within a task-graph workflow.
 *
 * @param {string} name
 * @param {object} [options]
 * @param {Array}  [options.triggers]            - Trigger descriptors. No auto-start inference.
 * @param {string} [options.triggerMode]         - 'any' (default) | 'all'
 * @param {object|Function} [options.payload]    - Static payload or (ctx) => payload
 * @param {Function} [options.condition]         - async (ctx) => bool; false = skip
 * @param {string}  [options.startWorkflow]      - Start a legacy sequential workflow instead of a handler.
 * @param {string}  [options.startTaskWorkflow]  - Start a task-graph workflow instead of a handler.
 * @param {string[]} [options.startWithTasks]    - Entry tasks to use when startTaskWorkflow is set.
 * @param {Date|string|number|Function} [options.startTime]
 *   If set, the task will not execute until this time arrives, regardless of when its
 *   triggers fire. Accepts a Date, ISO string, epoch ms, or (ctx) => Date|string|number.
 */
export const task = (name, options = {}) => ({
  kind:               'task',
  name,
  triggers:           options.triggers           ?? [],
  triggerMode:        options.triggerMode        ?? 'any',
  payload:            options.payload,
  condition:          options.condition,
  startTime:          options.startTime          ?? null,
  startWorkflow:      options.startWorkflow      ?? null,
  startTaskWorkflow:  options.startTaskWorkflow  ?? null,
  startWithTasks:     options.startWithTasks     ?? [],
})

/**
 * Trigger a task when a specific other task fires.
 *
 * @param {string} taskName
 * @param {object} [options]
 * @param {string} [options.workflow]  - Source workflow. null = same workflow as the target.
 * @param {string} [options.event]     - 'completed' (default) | 'failed' | 'skipped'
 */
export const taskTrigger = (taskName, options = {}) => ({
  kind:     'task',
  task:     taskName,
  workflow: options.workflow ?? null,
  event:    options.event    ?? 'completed',
})

/**
 * Trigger a task when an entire workflow finishes.
 *
 * @param {string} workflowName
 * @param {object} [options]
 * @param {string} [options.event]  - 'completed' (default) | 'failed'
 */
export const workflowTrigger = (workflowName, options = {}) => ({
  kind:     'workflow',
  workflow: workflowName,
  event:    options.event ?? 'completed',
})

// ── Project runs ──
const _projectRuns = new Map()
const _terminalProjectRunIds = new Set()
// Tracks run IDs that completed and were subsequently evicted from _projectRuns,
// so isRunComplete() returns true for evicted runs rather than false.
const _completedRunIds = new Set()
const _PROJECT_RUN_STORE_MAX = 500

function _pruneProjectRuns() {
  if (_projectRuns.size <= _PROJECT_RUN_STORE_MAX) return
  if (_terminalProjectRunIds.size === 0) {
    log.warn('_pruneProjectRuns: store at capacity with no terminal runs to evict', { size: _projectRuns.size })
    return
  }
  for (const id of _terminalProjectRunIds) {
    _terminalProjectRunIds.delete(id)
    _projectRuns.delete(id)
    if (_projectRuns.size <= _PROJECT_RUN_STORE_MAX) break
  }
}

/**
 * Start a project using its declared entry points.
 *
 * @param {string} projectName
 * @param {object} initialContext
 * @returns {Promise<string>} projectRunId
 */
export async function startProject(projectName, initialContext = {}) {
  const project = _projects.get(projectName)
  if (!project) throw new Error(`Project "${projectName}" not defined`)

  const rand  = Math.random().toString(36).padEnd(6, '0').slice(2, 6)
  const runId = `prj_${Date.now()}_${rand}`
  const run = _createRun(runId, projectName, initialContext, project.workflows)

  _projectRuns.set(runId, run)
  _pruneProjectRuns()
  log.info('Project started', { runId, project: projectName })
  try {
    _bus().publish('project.started', { run_id: runId, project: projectName, workflow: null })
  } catch (busErr) {
    log.warn('project.started publish failed', { runId, error: busErr })
  }

  // Start only the explicitly declared entry tasks
  const entrySettled = await Promise.allSettled(
    project.entry.map(({ workflow: wfName, task: taskName }) =>
      _startTaskByName(run, wfName, taskName)
    )
  )
  entrySettled.forEach((r, i) => {
    if (r.status === 'rejected') {
      const { workflow: wfName, task: taskName } = project.entry[i]
      log.error('Entry task failed to start', { runId, project: projectName, workflow: wfName, task: taskName, error: r.reason })
    }
  })
  if (entrySettled.every(r => r.status === 'rejected')) {
    throw new Error(`startProject("${projectName}"): all ${project.entry.length} entry task(s) failed to start`)
  }

  return runId
}

/**
 * Start a single task-graph workflow standalone (outside a project).
 * Uses the workflow's declared entryTasks, or the caller-supplied startTasks override.
 *
 * @param {string}   workflowName
 * @param {object}   initialContext
 * @param {object}   [options]
 * @param {string[]} [options.startTasks]  - Override which tasks to start. If omitted,
 *                                           uses the workflow's declared entryTasks.
 * @returns {Promise<string>} runId
 */
export async function startTaskWorkflow(workflowName, initialContext = {}, { startTasks } = {}) {
  const wfDef = _taskWorkflows.get(workflowName)
  if (!wfDef) throw new Error(`Task-graph workflow "${workflowName}" not defined`)

  const entryTaskNames = startTasks ?? wfDef.entryTasks
  if (entryTaskNames.length === 0) {
    throw new Error(
      `startTaskWorkflow("${workflowName}"): no entry tasks — ` +
      `provide startTasks option or set entryTasks in defineTaskWorkflow`
    )
  }

  const rand  = Math.random().toString(36).padEnd(6, '0').slice(2, 6)
  const runId = `prj_${Date.now()}_${rand}`
  const run   = _createRun(runId, null, initialContext, [workflowName])

  _projectRuns.set(runId, run)
  _pruneProjectRuns()
  log.info('Task-workflow started', { runId, workflow: workflowName, entryTaskNames })
  try {
    _bus().publish('project.started', { run_id: runId, project: null, workflow: workflowName })
  } catch (busErr) {
    log.warn('project.started publish failed', { runId, error: busErr })
  }

  const settled = await Promise.allSettled(
    entryTaskNames.map(taskName => _startTaskByName(run, workflowName, taskName))
  )
  settled.forEach((r, i) => {
    if (r.status === 'rejected')
      log.error('Entry task failed to start', { runId, workflow: workflowName, task: entryTaskNames[i], error: r.reason })
  })
  if (settled.every(r => r.status === 'rejected')) {
    throw new Error(`startTaskWorkflow("${workflowName}"): all ${entryTaskNames.length} entry task(s) failed to start`)
  }

  return runId
}

// ── Internal helpers ──

function _createRun(runId, projectName, initialContext, workflowNames) {
  const run = {
    id:            runId,
    project:       projectName,
    // Snapshot copy — new workflows may be injected dynamically (startTaskWorkflow task option)
    workflows:     [...workflowNames],
    context:       { ...initialContext, results: { ...(initialContext.results ?? {}) } },
    fired:         new Set(),         // "wf:taskName:event" | ":wfName:event"
    started:       new Set(),         // "wf:taskName" — executing or completed
    scheduled:     new Set(),         // "wf:taskName" — waiting for startTime
    startedCount:  new Map(),         // wfName → tasks that entered actual execution
    terminalCount: new Map(),         // wfName → tasks in terminal state
    spawnedBy:     new Map(),         // childWfName → Set<parentWfName> (supports multiple spawning parents)
  }
  for (const wfName of workflowNames) {
    run.startedCount.set(wfName, 0)
    run.terminalCount.set(wfName, 0)
  }
  return run
}

function _resolveWorkflowList(run) {
  // run.workflows is always authoritative — project runs snapshot project.workflows at start,
  // and new workflows injected via startTaskWorkflow task option are pushed here directly.
  return run.workflows
}

async function _startTaskByName(run, wfName, taskName) {
  const wfDef = _taskWorkflows.get(wfName)
  if (!wfDef) throw new Error(`Workflow "${wfName}" not defined`)
  const taskDesc = wfDef.tasks.find(t => t.name === taskName)
  if (!taskDesc) throw new Error(`Task "${taskName}" not found in workflow "${wfName}"`)
  return _execTask(run, wfName, taskDesc)
}

async function _execTask(run, wfName, taskDesc) {
  const key = `${wfName}:${taskDesc.name}`
  if (run.started.has(key) || run.scheduled.has(key)) return

  // If startTime is set and in the future, defer execution until then
  if (taskDesc.startTime != null) {
    const raw   = typeof taskDesc.startTime === 'function'
      ? taskDesc.startTime(run.context)
      : taskDesc.startTime
    const delay = new Date(raw).getTime() - Date.now()
    if (delay > 0) {
      run.scheduled.add(key)
      log.warn('Task deferred — timer is in-memory only and will be lost on process restart', {
        runId: run.id, workflow: wfName, task: taskDesc.name, startTime: new Date(raw).toISOString(),
      })
      try {
        _bus().publish('project.task.scheduled', {
          run_id: run.id, workflow: wfName, task: taskDesc.name, start_time: new Date(raw).toISOString(),
        })
      } catch (busErr) {
        log.warn('project.task.scheduled publish failed', { runId: run.id, workflow: wfName, task: taskDesc.name, error: busErr })
      }
      setTimeout(() => {
        run.scheduled.delete(key)
        _execTask(run, wfName, taskDesc)
      }, delay)
      return
    }
  }

  run.started.add(key)
  run.startedCount.set(wfName, (run.startedCount.get(wfName) ?? 0) + 1)
  log.info('Task started', { runId: run.id, workflow: wfName, task: taskDesc.name })
  try {
    _bus().publish('project.task.started', { run_id: run.id, workflow: wfName, task: taskDesc.name })
  } catch (busErr) {
    log.warn('project.task.started publish failed', { runId: run.id, workflow: wfName, task: taskDesc.name, error: busErr })
  }

  // Condition gate
  if (typeof taskDesc.condition === 'function') {
    const ok = await taskDesc.condition(run.context)
    if (!ok) {
      await _onTaskDone(run, wfName, taskDesc.name, 'skipped')
      return null
    }
  }

  const payload = typeof taskDesc.payload === 'function'
    ? taskDesc.payload(run.context)
    : (taskDesc.payload ?? {})

  // Task that injects a task-graph sub-workflow into the current run.
  // Runs within the SAME run object so sub-workflow events propagate to all triggers.
  if (taskDesc.startTaskWorkflow) {
    const targetWfName = taskDesc.startTaskWorkflow
    const targetWfDef  = _taskWorkflows.get(targetWfName)
    if (!targetWfDef) {
      log.error('Sub-workflow not defined', { runId: run.id, task: key, target: targetWfName })
      await _onTaskDone(run, wfName, taskDesc.name, 'failed')
      return
    }
    const entryNames = taskDesc.startWithTasks.length
      ? taskDesc.startWithTasks
      : targetWfDef.entryTasks
    if (entryNames.length === 0) {
      log.error('Sub-workflow has no entry tasks', { runId: run.id, task: key, target: targetWfName })
      await _onTaskDone(run, wfName, taskDesc.name, 'failed')
      return
    }
    // Register sub-workflow in the current run so _evaluateTriggers scans its tasks
    if (!run.workflows.includes(targetWfName)) {
      run.workflows.push(targetWfName)
      run.startedCount.set(targetWfName, 0)
      run.terminalCount.set(targetWfName, 0)
    }
    // Track spawn relationship so _checkWorkflowCompletion blocks parent until child finishes.
    // Skip if the child already ran — a previously-completed workflow can't re-run (tasks are
    // deduplicated by run.started), so recording the relationship would permanently block the parent.
    // Multiple parents may spawn the same child; all are stored in a Set so each gets re-checked.
    const alreadyDone = run.fired.has(`:${targetWfName}:completed`) || run.fired.has(`:${targetWfName}:failed`)
    if (!alreadyDone) {
      if (!run.spawnedBy.has(targetWfName)) run.spawnedBy.set(targetWfName, new Set())
      run.spawnedBy.get(targetWfName).add(wfName)
    }
    // Mark launcher task complete immediately; sub-workflow runs via its own trigger chain
    await _onTaskDone(run, wfName, taskDesc.name, 'completed')
    Promise.allSettled(
      entryNames.map(taskName => _startTaskByName(run, targetWfName, taskName))
    ).then(async results => {
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          log.error('Sub-workflow entry task failed to start', {
            runId: run.id, subWorkflow: targetWfName, task: entryNames[i], error: r.reason,
          })
        }
      })
      // If no entry task managed to start (all threw before _execTask incremented startedCount),
      // fire the sub-workflow as failed so blocked parents are not permanently deadlocked.
      if ((run.startedCount.get(targetWfName) ?? 0) === 0) {
        const firedKey = `:${targetWfName}:failed`
        if (!run.fired.has(firedKey)) {
          run.fired.add(firedKey)
          log.error('Sub-workflow never started — all entry tasks failed; marking failed to unblock parents', {
            runId: run.id, subWorkflow: targetWfName,
          })
          try {
            _bus().publish('project.workflow.failed', { run_id: run.id, workflow: targetWfName })
          } catch (busErr) {
            log.warn('project.workflow.failed publish error', { runId: run.id, error: busErr })
          }
          await _evaluateTriggers(run, { kind: 'workflow', workflow: targetWfName, event: 'failed' })
          const parents = run.spawnedBy.get(targetWfName)
          if (parents) for (const p of parents) await _checkWorkflowCompletion(run, p)
        }
      }
    }).catch(err => {
      log.error('Sub-workflow post-launch error — firing failed event to unblock parents', {
        runId: run.id, subWorkflow: targetWfName, error: err,
      })
      const firedKey = `:${targetWfName}:failed`
      if (!run.fired.has(firedKey)) {
        run.fired.add(firedKey)
        try { _bus().publish('project.workflow.failed', { run_id: run.id, workflow: targetWfName }) } catch {}
        _evaluateTriggers(run, { kind: 'workflow', workflow: targetWfName, event: 'failed' })
          .catch(e => log.error('_evaluateTriggers failed in catch recovery', { runId: run.id, error: e }))
        const parents = run.spawnedBy.get(targetWfName)
        if (parents) for (const p of parents) {
          _checkWorkflowCompletion(run, p)
            .catch(e => log.error('_checkWorkflowCompletion failed in catch recovery', { runId: run.id, error: e }))
        }
      }
    })
    return
  }

  // Task that starts a legacy sequential workflow
  if (taskDesc.startWorkflow) {
    try {
      await startWorkflow(taskDesc.startWorkflow, { ...run.context, ...payload })
      await _onTaskDone(run, wfName, taskDesc.name, 'completed')
    } catch (err) {
      if (err.isCancelled) {
        log.info('Legacy sub-workflow cancelled', { runId: run.id, task: key, target: taskDesc.startWorkflow, reason: err.cancellationReason ?? err.message })
        await _onTaskDone(run, wfName, taskDesc.name, 'cancelled')
      } else {
        log.error('Legacy sub-workflow failed', { runId: run.id, task: key, target: taskDesc.startWorkflow, err })
        await _onTaskDone(run, wfName, taskDesc.name, 'failed')
      }
    }
    return
  }

  // Normal handler
  const handler = _taskHandlers.get(taskDesc.name)
  if (!handler) {
    await _onTaskDone(run, wfName, taskDesc.name, 'failed')
    throw new Error(`No handler registered for task "${taskDesc.name}"`)
  }

  try {
    const result = await handler(run.context, payload)
    if (result != null) run.context.results[taskDesc.name] = result
    await _onTaskDone(run, wfName, taskDesc.name, 'completed')
    return result
  } catch (err) {
    log.error('Task failed', { runId: run.id, workflow: wfName, task: taskDesc.name, err })
    await _onTaskDone(run, wfName, taskDesc.name, 'failed')
    throw err
  }
}

async function _onTaskDone(run, wfName, taskName, event) {
  run.fired.add(`${wfName}:${taskName}:${event}`)
  try {
    _bus().publish(`project.task.${event}`, { run_id: run.id, workflow: wfName, task: taskName })
  } catch (busErr) {
    log.warn('project.task event publish failed (task state still updated)', { runId: run.id, workflow: wfName, task: taskName, event, error: busErr })
  }

  run.terminalCount.set(wfName, (run.terminalCount.get(wfName) ?? 0) + 1)
  await _checkWorkflowCompletion(run, wfName)
  await _evaluateTriggers(run, { kind: 'task', workflow: wfName, task: taskName, event })
}

async function _checkWorkflowCompletion(run, wfName) {
  // Cannot be complete while any task is still waiting for its startTime
  const wfTasks = _taskWorkflows.get(wfName)?.tasks ?? []
  const hasScheduled = wfTasks.some(t => run.scheduled.has(`${wfName}:${t.name}`))
  if (hasScheduled) return

  // Compare against startedCount (not allTasks.length) — unreachable tasks never started
  // and should not block completion of the tasks that did run.
  const started  = run.startedCount.get(wfName) ?? 0
  const terminal = run.terminalCount.get(wfName) ?? 0
  if (started === 0 || terminal < started) return

  // Block completion while any directly-spawned sub-workflow is still running.
  // This prevents premature completion when the launcher task finishes before the
  // sub-workflow's entry tasks have even started (startedCount=0 on the child).
  const hasActiveSubworkflow = _resolveWorkflowList(run).some(swName =>
    run.spawnedBy.get(swName)?.has(wfName) &&
    !run.fired.has(`:${swName}:completed`) &&
    !run.fired.has(`:${swName}:failed`)
  )
  if (hasActiveSubworkflow) return

  const hadFailure = wfTasks.some(t =>
    run.fired.has(`${wfName}:${t.name}:failed`) || run.fired.has(`${wfName}:${t.name}:cancelled`)
  )
  const wfEvent    = hadFailure ? 'failed' : 'completed'
  const wfFiredKey = `:${wfName}:${wfEvent}`
  if (run.fired.has(wfFiredKey)) return

  run.fired.add(wfFiredKey)
  log.info('Workflow finished', { runId: run.id, workflow: wfName, outcome: wfEvent })
  try {
    _bus().publish(`project.workflow.${wfEvent}`, { run_id: run.id, workflow: wfName })
  } catch (busErr) {
    log.warn('project.workflow event publish failed (trigger evaluation still proceeds)', { runId: run.id, workflow: wfName, error: busErr })
  }

  await _evaluateTriggers(run, { kind: 'workflow', workflow: wfName, event: wfEvent })

  // Re-check all parent workflows that were waiting on this child.
  // Handles the case where a parent has no tasks triggered by this workflow and would
  // otherwise never be re-evaluated after the child finishes.
  const parents = run.spawnedBy.get(wfName)
  if (parents) for (const parentWfName of parents) await _checkWorkflowCompletion(run, parentWfName)

  // Mark the project run terminal once every workflow has fired its final event.
  // Guard with !_terminalProjectRunIds.has(run.id) so the terminal event fires exactly once
  // even when _checkWorkflowCompletion is re-entered for parent re-checks.
  if (_isRunTerminal(run) && !_terminalProjectRunIds.has(run.id)) {
    const hadFailure = run.workflows.some(wfName => run.fired.has(`:${wfName}:failed`))
    const projectEvent = hadFailure ? 'failed' : 'completed'
    log.info('Project run terminal', { runId: run.id, project: run.project, outcome: projectEvent })
    try {
      _bus().publish(`project.${projectEvent}`, { run_id: run.id, project: run.project })
    } catch (busErr) {
      log.warn(`project.${projectEvent} publish failed`, { runId: run.id, error: busErr })
    }
    _terminalProjectRunIds.add(run.id)
    _completedRunIds.add(run.id)
    // Cap the tombstone index so it doesn't grow without bound
    if (_completedRunIds.size > _PROJECT_RUN_STORE_MAX) {
      _completedRunIds.delete(_completedRunIds.values().next().value)
    }
    // Evict older terminal runs only at capacity so recently-completed runs
    // remain queryable via getProjectRun / isRunComplete between completions.
    if (_projectRuns.size > _PROJECT_RUN_STORE_MAX) {
      for (const id of _terminalProjectRunIds) {
        if (id === run.id) continue
        _terminalProjectRunIds.delete(id)
        _projectRuns.delete(id)
        if (_projectRuns.size <= _PROJECT_RUN_STORE_MAX) break
      }
    }
  }
}

async function _evaluateTriggers(run, source) {
  const workflowNames = _resolveWorkflowList(run)
  const toStart = []

  for (const wfName of workflowNames) {
    const tasks = _taskWorkflows.get(wfName)?.tasks ?? []
    for (const taskDesc of tasks) {
      if (taskDesc.triggers.length === 0) continue
      const key = `${wfName}:${taskDesc.name}`
      if (run.started.has(key) || run.scheduled.has(key)) continue

      const currentFires = taskDesc.triggers.some(t =>
        _triggerMatchesSource(t, wfName, source)
      )
      if (!currentFires) continue

      const mode = taskDesc.triggerMode ?? 'any'
      const shouldStart =
        mode === 'any'
          ? true
          : taskDesc.triggers.every(t => _triggerHasFired(run, wfName, t))

      if (shouldStart) toStart.push({ wfName, taskDesc })
    }
  }

  const settled = await Promise.allSettled(
    toStart.map(({ wfName, taskDesc }) => _execTask(run, wfName, taskDesc))
  )
  settled.forEach((r, i) => {
    if (r.status === 'rejected') {
      const { wfName, taskDesc } = toStart[i]
      log.error('Triggered task failed to start', { runId: run.id, workflow: wfName, task: taskDesc.name, error: r.reason })
    }
  })
}

function _triggerMatchesSource(trigger, targetWf, source) {
  if (trigger.kind === 'task' && source.kind === 'task') {
    const tWf    = trigger.workflow ?? targetWf
    const tEvent = trigger.event    ?? 'completed'
    return tWf === source.workflow && trigger.task === source.task && tEvent === source.event
  }
  if (trigger.kind === 'workflow' && source.kind === 'workflow') {
    const tEvent = trigger.event ?? 'completed'
    return trigger.workflow === source.workflow && tEvent === source.event
  }
  return false
}

function _triggerHasFired(run, targetWf, trigger) {
  if (trigger.kind === 'task') {
    const tWf    = trigger.workflow ?? targetWf
    const tEvent = trigger.event    ?? 'completed'
    return run.fired.has(`${tWf}:${trigger.task}:${tEvent}`)
  }
  if (trigger.kind === 'workflow') {
    const tEvent = trigger.event ?? 'completed'
    return run.fired.has(`:${trigger.workflow}:${tEvent}`)
  }
  return false
}

// ── Query ──
export function getProjectRun(runId) {
  return _projectRuns.get(runId) ?? null
}

/**
 * Returns true if the run has tasks still deferred by `startTime`.
 * This only covers tasks waiting on a scheduled timer — it does NOT reflect
 * whether sub-workflows launched via `startTaskWorkflow` task option have finished.
 * Use `isRunComplete()` for a true quiescence check.
 */
export function hasPendingScheduled(runId) {
  const run = _projectRuns.get(runId)
  return run ? run.scheduled.size > 0 : false
}

/**
 * Returns true once every workflow in the run has fired its final
 * `completed` or `failed` event — including sub-workflows injected at runtime.
 * Safe to use as a quiescence / "all work done" check.
 */
export function isRunComplete(runId) {
  const run = _projectRuns.get(runId)
  if (run) return _isRunTerminal(run)
  return _completedRunIds.has(runId)
}

function _isRunTerminal(run) {
  return run.workflows.every(wfName => {
    // Already fired — done regardless of counts.
    if (run.fired.has(`:${wfName}:completed`) || run.fired.has(`:${wfName}:failed`)) return true
    // A startTime-deferred task is still in the scheduled queue — incomplete.
    const wfTasks = _taskWorkflows.get(wfName)?.tasks ?? []
    if (wfTasks.some(t => run.scheduled.has(`${wfName}:${t.name}`))) return false
    // Registered as a sub-workflow child (via spawnedBy) but startedCount=0 means entry tasks
    // are still in the fire-and-forget async gap — treat as incomplete so callers don't
    // get a false "all done" before the sub-workflow has had a chance to run.
    if (run.spawnedBy.has(wfName)) return false
    // Workflow was declared in the project but never triggered — no tasks ran, nothing to wait for.
    if ((run.startedCount.get(wfName) ?? 0) === 0) return true
    // Tasks started but haven't all finished yet.
    return false
  })
}

// ── Convenience facade ──
export const taskGraph = {
  defineProject,
  defineTaskWorkflow,
  registerTaskHandler,
  startProject,
  startTaskWorkflow,
  getProjectRun,
  hasPendingScheduled,
  isRunComplete,
}
