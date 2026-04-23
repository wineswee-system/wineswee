/**
 * Nav Assistant Engine
 *
 * Conversational backend for the HR + Workflow navigation assistant.
 * Prefers Gemini (JSON mode). Falls back to a local keyword matcher
 * when VITE_GEMINI_API_KEY is missing or the API call fails.
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

import { GoogleGenerativeAI } from '@google/generative-ai'
import { KNOWLEDGE_BASE, buildKbContext, keywordSearch } from './knowledgeBase'

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY
let client = null
let chat = null

export function isAiEnabled() {
  return !!API_KEY && API_KEY !== 'your_gemini_api_key_here'
}

function getClient() {
  if (!isAiEnabled()) throw new Error('missing-api-key')
  if (!client) client = new GoogleGenerativeAI(API_KEY)
  return client
}

const SYSTEM_PROMPT = `你是 SME Ops 系統的「導覽助理」，專精人資 (HR) 與工作流程 (Workflow) 模組。
你的工作：當使用者用自然語言問「怎麼做某件事」時，你要回答：
  1) 一段友善、簡短的口語說明（繁體中文）；
  2) 一組 step-by-step 指示；
  3) 對應的頁面連結（必須從下方知識庫挑選，不要自創路徑）；
  4) 2-3 個有用的延伸問題建議。

嚴格規則：
- 回傳 **純 JSON**，符合此 schema：
  {
    "reply": string,
    "steps": string[],
    "links": [ { "label": string, "path": string, "tip": string? } ],
    "suggestions": string[]
  }
- path 一定要來自知識庫；若不確定就只放最相關的 1 條而不是亂猜。
- 若使用者問的主題不在 HR / Workflow 範圍（例如財務、庫存），禮貌說明你專精 HR 與流程，並列出相近主題建議。
- 回覆使用繁體中文。
- 保持簡潔：reply 不超過 2 句，steps 建議 3-6 步。

===== 知識庫 =====
${buildKbContext()}
===== 知識庫結束 =====`

function ensureChat() {
  if (chat) return chat
  const genAI = getClient()
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.4,
    },
  })
  chat = model.startChat({
    history: [
      { role: 'user', parts: [{ text: SYSTEM_PROMPT }] },
      {
        role: 'model',
        parts: [{
          text: JSON.stringify({
            reply: '您好，我是 HR 與工作流程的導覽助理，告訴我您想做什麼，我會指引您到正確的頁面。',
            steps: [],
            links: [],
            suggestions: ['我要請特休', '怎麼補登打卡', '怎麼建立新流程'],
          })
        }]
      },
    ],
  })
  return chat
}

export function resetChat() {
  chat = null
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

  if (!isAiEnabled()) return keywordAnswer(text)

  try {
    const session = ensureChat()
    const res = await session.sendMessage([{ text }])
    const raw = res.response.text()
    const parsed = parseJson(raw)
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
