/**
 * lineSender — CRM 會員 LINE 發送（真實通道）
 *
 * ⚠️ 會員（members）專用。員工 LINE 通知走 lineNotify.js / hr-notify，
 *    使用不同的 LINE 官方帳號與 token，兩邊不可混用。
 *
 * 後端：supabase/functions/crm-line-send（LINE_CHANNEL_ACCESS_TOKEN_CRM）
 * 綁定：只從 members.line_user_id 解析（member-app LIFF 綁定）
 * 紀錄：每位收件人一筆 message_logs（MessageLog.jsx 可見）
 */
import { supabase } from '../supabase'
import { logger } from '../logger'
import {
  getMemberGroupMembers,
  getSurveyById,
  getDueLineSurveyInvitations,
  markSurveyInvitationsSent,
} from '../db/crm'

const LIFF_ID = import.meta.env.VITE_LIFF_ID

/** member-app (LIFF) 內頁連結 */
export function memberLiffUrl(path = '/') {
  if (!LIFF_ID) return `${typeof window !== 'undefined' ? window.location.origin : ''}/liff${path}`
  return `https://liff.line.me/${LIFF_ID}?to=${encodeURIComponent(path)}`
}

/**
 * 發送 LINE 訊息給多位會員。
 * @param {Object} args
 * @param {number[]} args.memberIds - members.id 清單
 * @param {Object}   args.template  - { type: 'text'|'flex', text?, altText?, contents? }
 * @param {Object}  [args.context]  - { campaignId?, surveyInvitationId?, kind? }
 * @param {Object}  [args.vars]     - { [memberId]: { link: '...' } } per-member {{var}} 值
 * @returns {Promise<{ sent:number, failed:number, skipped:number }>}
 * @throws 通道未設定或呼叫失敗時丟出 zh-TW Error（不假裝成功）
 */
export async function sendLineToMembers({ memberIds, template, context = {}, vars }) {
  if (!memberIds?.length) return { sent: 0, failed: 0, skipped: 0 }

  const { data, error } = await supabase.functions.invoke('crm-line-send', {
    body: { memberIds, template, context, ...(vars ? { vars } : {}) },
  })

  if (error) {
    // supabase-js 對 non-2xx 只給 FunctionsHttpError，實際錯誤訊息在 response body
    let detail = error.message
    try {
      const body = await error.context?.json?.()
      if (body?.error) detail = body.error
    } catch { /* keep original message */ }
    logger.error('[lineSender] crm-line-send 失敗', { detail, memberCount: memberIds.length, context })
    throw new Error(detail || 'CRM LINE 發送失敗')
  }
  if (data?.error) {
    logger.error('[lineSender] crm-line-send 回傳錯誤', { error: data.error, context })
    throw new Error(data.error)
  }

  logger.info('[lineSender] LINE 發送完成', {
    sent: data?.sent, failed: data?.failed, skipped: data?.skipped, kind: context.kind,
  })
  return {
    sent: data?.sent ?? 0,
    failed: data?.failed ?? 0,
    skipped: data?.skipped ?? 0,
    results: data?.results ?? [],
  }
}

/**
 * 發送 LINE 訊息給會員群組（member_groups）。
 * @param {number} groupId  - member_groups.id
 * @param {Object} template - 同 sendLineToMembers
 * @param {Object} [context]
 */
export async function sendLineToGroup(groupId, template, context = {}) {
  const { data: rows, error } = await getMemberGroupMembers(groupId)
  if (error) {
    logger.error('[lineSender] 群組成員查詢失敗', { groupId, error: error.message })
    throw new Error(`群組成員查詢失敗：${error.message}`)
  }
  const memberIds = (rows || []).map(r => r.member_id).filter(Boolean)
  if (!memberIds.length) return { sent: 0, failed: 0, skipped: 0 }
  return sendLineToMembers({ memberIds, template, context: { kind: 'group', ...context } })
}

/**
 * 發送「已到期」的問卷 LINE 邀請（status=pending 且 send_after <= now）。
 * 每位會員收到含個人 token 連結的訊息（member-app 路由 /survey/:token），
 * 全數送達才整批標記 status='sent'；有未送達者維持 pending 供補綁後重試。
 *
 * @param {number} surveyId
 * @returns {Promise<{ sent:number, failed:number, skipped:number, due:number }>}
 */
export async function dispatchDueLineSurveyInvitations(surveyId) {
  const { data: survey, error: sErr } = await getSurveyById(surveyId)
  if (sErr || !survey) throw new Error(`問卷查詢失敗：${sErr?.message || '找不到問卷'}`)
  if (survey.send_channel !== 'line') {
    throw new Error(`此問卷發送通道為 ${survey.send_channel}，非 LINE`)
  }

  const { data: invitations, error: iErr } = await getDueLineSurveyInvitations(surveyId)
  if (iErr) throw new Error(`邀請查詢失敗：${iErr.message}`)
  if (!invitations?.length) return { sent: 0, failed: 0, skipped: 0, due: 0 }

  // 每位會員一個專屬 token 連結 → 走 per-member vars（edge function 逐一 push）
  const vars = {}
  const memberIds = []
  for (const inv of invitations) {
    memberIds.push(inv.member_id)
    vars[inv.member_id] = { link: memberLiffUrl(`/survey/${inv.token}`) }
  }

  const template = {
    type: 'text',
    text: `{{name}} 您好，邀請您填寫「${survey.name}」問卷：\n{{link}}\n感謝您的寶貴意見！`,
  }

  const result = await sendLineToMembers({
    memberIds,
    template,
    context: { kind: 'survey_invitation', surveyId },
    vars,
  })

  // 只標記「實際送出」者為 sent；未綁定/失敗者維持 pending 供補綁後重試
  const sentMemberIds = new Set(
    (result.results || []).filter(r => r.status === 'sent').map(r => r.memberId),
  )
  const sentInvitationIds = invitations
    .filter(i => sentMemberIds.has(i.member_id))
    .map(i => i.id)
  if (sentInvitationIds.length > 0) {
    const { error: mErr } = await markSurveyInvitationsSent(sentInvitationIds)
    if (mErr) logger.warn('[lineSender] 邀請標記 sent 失敗', { surveyId, error: mErr.message })
  }
  if (result.failed > 0 || result.skipped > 0) {
    logger.warn('[lineSender] 部分邀請未送達，維持 pending 待重試', { surveyId, ...result })
  }

  return { ...result, due: invitations.length }
}
