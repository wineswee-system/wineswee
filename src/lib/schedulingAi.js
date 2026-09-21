/**
 * AI Scheduler Orchestrator (Client-Side)
 *
 * Sub-modules live in ./schedulingAi/:
 *   dataGathering  — gatherSchedulingData (Supabase fetches)
 *   promptBuilder  — buildClientPrompt, buildFixPromptClient, buildRetryPrompt
 *   aiCaller       — invokeSchedulingProxy, runAiSchedule, runMonthlyAiSchedule,
 *                    fixViolations, runScheduleWithRetry
 *
 * This file re-exports everything so existing callers need no path changes.
 */

export * from './schedulingAi/dataGathering'
export * from './schedulingAi/promptBuilder'
export * from './schedulingAi/aiCaller'
