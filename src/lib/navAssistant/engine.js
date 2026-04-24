/**
 * Nav Assistant Engine
 *
 * Conversational backend for the HR + Workflow navigation assistant.
 * Calls the gemini-proxy Edge Function (navChat action, JSON mode).
 * Falls back to a local keyword matcher when the API call fails.
 *
 * All responses share the same shape so the UI can render them
 * uniformly:
 *
 *   {
 *     reply: string,                 // conversational answer
 *     steps: string[],               // ordered how-to steps
 *     links: [                       // deep-links to pages
 *       { label, path, tip? }
 *     ],
 *     suggestions: string[],         // follow-up prompts the UI can surface
 *     source: 'ai' | 'keyword' | 'fallback'
 *   }
 */

import { supabase } from '../supabase'
import { KNOWLEDGE_BASE, buildKbContext, keywordSearch } from './knowledgeBase'

// Client-side conversation history passed to the stateless edge function on each call.
let navHistory = []

/** Key is now server-side — always enabled */
export function isAiEnabled() {
  return true
}

/** Clear conversation history to start a fresh session */
export function resetChat() {
  navHistory = []
}

function parseJson(raw) {
  if (!raw) return null
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  try { return JSON.parse(cleaned) } catch { return null }
}

function normalizeLinks(links) {
  if (!Array.isArray(links)) return []
  const validPaths = new Set(KNOWLEDGE_BASE.map(k => k.path))
  return links
    .filter(l => l && typeof l.path === 'string' && validPaths.has(l.path))
    .map(l => ({
      label: String(l.label || '').trim() || l.path,
      path: l.path,
      tip: l.tip ? String(l.tip) : undefined,
    }))
}

function keywordAnswer(query) {
  const hits = keywordSearch(query, 3)
  if (hits.length === 0) {
    return {
      reply: '抱歉，我在 HR 與工作流程的知識庫中找不到相關內容。您可以試試下方快速指令，或換個關鍵字。',
      steps: [],
      links: [],
      suggestions: ['我要請特休', '怎麼建立新流程', '如何設定簽核鏈'],
      source: 'fallback',
    }
  }
  const top = hits[0]
  return {
    reply: `您可能想做的是：${top.title}。以下是操作步驟：`,
    steps: top.steps,
    links: hits.map(h => ({
      label: `${h.title}（${h.module}）`,
      path: h.path,
      tip: h.tip,
    })),
    suggestions: hits.slice(0, 3).map(h => `${h.title}怎麼用？`),
    source: 'keyword',
  }
}

export async function ask(query) {
  const text = (query || '').trim()
  if (!text) {
    return {
      reply: '想問什麼呢？',
      steps: [],
      links: [],
      suggestions: [],
      source: 'fallback',
    }
  }

  try {
    const { data, error } = await supabase.functions.invoke('gemini-proxy', {
      body: { action: 'navChat', payload: { message: text, history: navHistory } },
    })

    if (error) throw new Error(error.message)
    if (data?.error) throw new Error(data.error)

    const result = data?.data
    // Persist updated history for the next turn
    if (result?.history) navHistory = result.history

    const parsed = parseJson(result?.text)
    if (!parsed) return keywordAnswer(text)

    return {
      reply: String(parsed.reply || '').trim() || '已為您找到相關功能。',
      steps: Array.isArray(parsed.steps) ? parsed.steps.map(String) : [],
      links: normalizeLinks(parsed.links),
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.map(String).slice(0, 4) : [],
      source: 'ai',
    }
  } catch (err) {
    console.warn('[navAssistant] AI call failed, using keyword fallback:', err?.message)
    return keywordAnswer(text)
  }
}
