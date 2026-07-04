import { logger } from './logger'
import { sendLineToMembers, memberLiffUrl } from './comms/lineSender'

// Hex colors for LINE Flex Message payloads — cannot use CSS vars in external API JSON
const LC = {
  brand:   '#06b6d4',
  success: '#10b981',
  warning: '#f59e0b',
  purple:  '#8b5cf6',
  muted:   '#666666',
  dark:    '#111827',
}

/**
 * 會員 LINE 推播 — 走 crm-line-send edge function（CRM 會員頻道）。
 * 綁定解析（members.line_user_id）與 message_logs 紀錄都在後端完成；
 * 未綁定會回 skipped，不會誤用員工頻道。
 */
async function pushToMember(memberId, messages, kind = 'membership') {
  const msg = messages?.[0]
  if (!msg) return { ok: false, error: 'empty message' }
  const template = msg.type === 'flex'
    ? { type: 'flex', altText: msg.altText, contents: msg.contents }
    : { type: 'text', text: msg.text }
  try {
    const { sent, skipped } = await sendLineToMembers({
      memberIds: [memberId],
      template,
      context: { kind },
    })
    if (skipped > 0) {
      logger.warn('[LINE-member] 會員未綁定 LINE，略過', { memberId, kind })
      return { ok: false, reason: 'no_line_user_id' }
    }
    return { ok: sent > 0 }
  } catch (err) {
    logger.error('[LINE-member] Push error', { memberId, err: err?.message })
    return { ok: false, error: err?.message }
  }
}

/**
 * Notify a member they have been upgraded to a new level.
 */
export async function notifyMemberLevelUp(memberId, { oldLevel, newLevel }) {
  const liffUrl = memberLiffUrl('/member-card')
  const messages = [{
    type: 'flex',
    altText: `恭喜升等為 ${newLevel}！`,
    contents: {
      type: 'bubble', size: 'kilo',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: LC.purple, paddingAll: '14px',
        contents: [{ type: 'text', text: '🎉 會員升等通知', color: '#ffffff', weight: 'bold', size: 'md' }],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px',
        contents: [
          { type: 'text', text: `您已升等為「${newLevel}」會員！`, weight: 'bold', size: 'sm', wrap: true, color: LC.dark },
          { type: 'text', text: `${oldLevel} → ${newLevel}`, size: 'sm', color: LC.purple, margin: 'sm', weight: 'bold' },
          { type: 'text', text: '感謝您的支持，繼續享受更多專屬優惠！', size: 'sm', color: LC.muted, wrap: true, margin: 'sm' },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: '12px',
        contents: [{
          type: 'button', style: 'primary', height: 'sm', color: LC.purple,
          action: { type: 'uri', label: '查看會員卡', uri: liffUrl },
        }],
      },
    },
  }]
  return pushToMember(memberId, messages, 'level_up')
}

/**
 * Notify a member that points have been added to their account.
 */
export async function notifyMemberPointsEarned(memberId, { points, newTotal, reason }) {
  const liffUrl = memberLiffUrl('/points')
  const messages = [{
    type: 'flex',
    altText: `獲得 ${points} 點！`,
    contents: {
      type: 'bubble', size: 'kilo',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: LC.brand, paddingAll: '14px',
        contents: [{ type: 'text', text: '⭐ 點數入帳通知', color: '#ffffff', weight: 'bold', size: 'md' }],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px',
        contents: [
          {
            type: 'box', layout: 'horizontal', alignItems: 'baseline',
            contents: [
              { type: 'text', text: `+${points}`, weight: 'bold', size: 'xl', color: LC.brand, flex: 0 },
              { type: 'text', text: '  點', size: 'sm', color: LC.muted },
            ],
          },
          ...(reason ? [{ type: 'text', text: reason, size: 'sm', color: LC.muted, margin: 'sm', wrap: true }] : []),
          { type: 'separator', margin: 'sm' },
          { type: 'text', text: `目前累積：${(newTotal ?? 0).toLocaleString()} 點`, size: 'sm', color: LC.muted, margin: 'sm' },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: '12px',
        contents: [{
          type: 'button', style: 'primary', height: 'sm', color: LC.brand,
          action: { type: 'uri', label: '查看我的點數', uri: liffUrl },
        }],
      },
    },
  }]
  return pushToMember(memberId, messages, 'points')
}

/**
 * Notify a member that a coupon has been assigned to their account.
 */
export async function notifyMemberCouponReceived(memberId, { couponName, couponCode, expiresAt }) {
  const liffUrl = memberLiffUrl('/coupons')
  const fmtDate = (iso) => iso
    ? new Date(iso).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' })
    : '永久有效'
  const messages = [{
    type: 'flex',
    altText: `您收到優惠券：${couponName}`,
    contents: {
      type: 'bubble', size: 'kilo',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: LC.success, paddingAll: '14px',
        contents: [{ type: 'text', text: '🎫 優惠券通知', color: '#ffffff', weight: 'bold', size: 'md' }],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px',
        contents: [
          { type: 'text', text: couponName, weight: 'bold', size: 'sm', wrap: true, color: LC.dark },
          {
            type: 'box', layout: 'horizontal', margin: 'sm', paddingAll: '8px', cornerRadius: '6px',
            backgroundColor: '#F0FFF4',
            contents: [
              { type: 'text', text: '代碼', size: 'xs', color: LC.muted, flex: 2 },
              { type: 'text', text: couponCode, weight: 'bold', size: 'sm', color: LC.success, flex: 3 },
            ],
          },
          { type: 'text', text: `有效期限：${fmtDate(expiresAt)}`, size: 'xs', color: LC.muted, margin: 'sm' },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: '12px',
        contents: [{
          type: 'button', style: 'primary', height: 'sm', color: LC.success,
          action: { type: 'uri', label: '查看我的優惠券', uri: liffUrl },
        }],
      },
    },
  }]
  return pushToMember(memberId, messages, 'coupon')
}

/**
 * Notify a member of their birthday reward (points and/or coupon).
 */
export async function notifyMemberBirthdayReward(memberId, { points = 0, couponName = '' }) {
  const liffUrl = memberLiffUrl('/member-card')
  const parts = []
  if (points > 0) parts.push(`${points} 點`)
  if (couponName) parts.push(`優惠券「${couponName}」`)
  const rewardText = parts.join(' 及 ') || '生日禮物'
  const messages = [{
    type: 'flex',
    altText: `生日快樂！送您 ${rewardText}`,
    contents: {
      type: 'bubble', size: 'kilo',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: LC.warning, paddingAll: '14px',
        contents: [{ type: 'text', text: '🎂 生日快樂！', color: '#ffffff', weight: 'bold', size: 'md' }],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px',
        contents: [
          { type: 'text', text: '感謝您的支持，獻上我們的生日祝福！', weight: 'bold', size: 'sm', wrap: true, color: LC.dark },
          { type: 'separator', margin: 'md' },
          {
            type: 'box', layout: 'vertical', margin: 'md', paddingAll: '10px',
            cornerRadius: '8px', backgroundColor: '#FFFBEB',
            contents: [
              { type: 'text', text: '本月生日禮物', size: 'xs', color: LC.muted, weight: 'bold' },
              { type: 'text', text: rewardText, size: 'sm', color: LC.warning, margin: 'sm', wrap: true, weight: 'bold' },
            ],
          },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: '12px',
        contents: [{
          type: 'button', style: 'primary', height: 'sm', color: LC.warning,
          action: { type: 'uri', label: '查看我的禮物', uri: liffUrl },
        }],
      },
    },
  }]
  return pushToMember(memberId, messages, 'birthday')
}
