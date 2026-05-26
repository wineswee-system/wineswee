/**
 * workflowDag.js — DAG layout utilities for workflow step visualization
 *
 * Data shapes:
 *   steps  : [{ id, step_order, title, status, ... }]
 *   deps   : [{ id, task_id, depends_on_task_id, dep_type: 'prerequisite'|'trigger' }]
 *
 * Canonical edge direction: A → B means "A must complete before B starts"
 *   - dep stored as: task_id=B, depends_on_task_id=A
 *   - 'prerequisite': B waits for ALL prerequisites (fan-in)
 *   - 'trigger':      A immediately fires B on completion (fan-out)
 */

/**
 * Compute column level (0-based) for each step via Kahn's BFS on the longest path.
 * Falls back to step_order - 1 when no deps exist.
 *
 * @param {Array} steps
 * @param {Array} deps
 * @returns {Map<number, number>}  stepId → level
 */
export function computeLevels(steps, deps) {
  if (!steps?.length) return new Map()

  const stepIds = new Set(steps.map(s => s.id))
  const inDegree  = new Map(steps.map(s => [s.id, 0]))
  const successors = new Map(steps.map(s => [s.id, []]))

  for (const dep of deps || []) {
    const from = dep.depends_on_task_id  // upstream (A)
    const to   = dep.task_id             // downstream (B)
    if (!stepIds.has(from) || !stepIds.has(to)) continue
    const list = successors.get(from)
    if (!list.includes(to)) {
      list.push(to)
      inDegree.set(to, inDegree.get(to) + 1)
    }
  }

  // No real edges (either deps array was empty, or all listed IDs are outside this step set
  // e.g. cross-instance orphans) → fall back to step_order columns so the view still renders.
  if ([...inDegree.values()].every(d => d === 0)) {
    const levels = new Map()
    steps.forEach(s => levels.set(s.id, (s.step_order ?? 1) - 1))
    return levels
  }

  // Kahn's BFS with longest-path level tracking
  const levels = new Map()
  const queue = []
  for (const [id, deg] of inDegree) {
    if (deg === 0) { queue.push(id); levels.set(id, 0) }
  }

  while (queue.length > 0) {
    const cur = queue.shift()
    const curLevel = levels.get(cur) ?? 0
    for (const next of successors.get(cur) || []) {
      const newDeg = inDegree.get(next) - 1
      inDegree.set(next, newDeg)
      levels.set(next, Math.max(levels.get(next) ?? 0, curLevel + 1))
      if (newDeg === 0) queue.push(next)
    }
  }

  // Unreachable steps (cycle guard) — append after last valid level
  const maxLevel = Math.max(0, ...[...levels.values()])
  for (const s of steps) {
    if (!levels.has(s.id)) levels.set(s.id, maxLevel + 1)
  }

  return levels
}

/**
 * Group steps into columns sorted by level; within each column sort by step_order.
 *
 * @returns {Array<{ level: number, steps: Array }>}  ascending by level
 */
export function groupByLevel(steps, deps) {
  const levels = computeLevels(steps, deps)
  const cols = new Map()
  for (const step of steps) {
    const lv = levels.get(step.id) ?? 0
    if (!cols.has(lv)) cols.set(lv, [])
    cols.get(lv).push(step)
  }
  for (const col of cols.values()) col.sort((a, b) => (a.step_order ?? 0) - (b.step_order ?? 0))
  return [...cols.entries()]
    .sort(([a], [b]) => a - b)
    .map(([level, colSteps]) => ({ level, steps: colSteps }))
}

/**
 * Build edge list for SVG arrow rendering.
 * Returns { from: id, to: id, dep_type, depId }[]
 * 'from' always completes first (upstream).
 */
export function getEdges(deps) {
  return (deps || []).map(dep => ({
    from:     dep.depends_on_task_id,
    to:       dep.task_id,
    dep_type: dep.dep_type,
    depId:    dep.id,
  }))
}

/**
 * Would adding edge from→to create a cycle?
 * DFS from `to`; if `from` is reachable, the new edge would close a loop.
 *
 * @param {number} fromId
 * @param {number} toId
 * @param {Array}  existingDeps
 * @param {Array}  steps
 * @returns {boolean}
 */
export function wouldCycle(fromId, toId, existingDeps, steps) {
  if (fromId === toId) return true
  const adj = new Map((steps || []).map(s => [s.id, []]))
  for (const dep of existingDeps || []) {
    const from = dep.depends_on_task_id
    const to   = dep.task_id
    if (adj.has(from) && !adj.get(from).includes(to)) adj.get(from).push(to)
  }
  const visited = new Set()
  const stack = [toId]
  while (stack.length > 0) {
    const cur = stack.pop()
    if (cur === fromId) return true
    if (visited.has(cur)) continue
    visited.add(cur)
    for (const next of adj.get(cur) || []) stack.push(next)
  }
  return false
}
