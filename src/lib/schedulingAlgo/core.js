/**
 * Scheduling Algorithm Core — barrel re-export
 *
 * Implementation has been split into focused sub-modules:
 *   weeklySchedule.js  — runProgrammaticSchedule and all its private helpers
 *   monthlySchedule.js — runMonthlyProgrammaticSchedule (iterates weekly chunks)
 *
 * src/lib/schedulingAlgo.js re-exports everything from here, so all existing
 * callers (Schedule.jsx, schedulingAlgo.test.js, aiCaller.js) need no changes.
 */

export { runProgrammaticSchedule } from './weeklySchedule'
export { runMonthlyProgrammaticSchedule } from './monthlySchedule'
