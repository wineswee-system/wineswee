/**
 * CRM — Points & Loyalty Engine (tiers, earn, redeem, refund, referral)
 */

// ============================================================
// Points & Loyalty Engine
// ============================================================

export const TIER_RULES = [
  { level: '一般', min_spent: 0, min_points: 0, earn_rate: 1, discount: 0 },
  { level: '銀卡', min_spent: 10000, min_points: 1000, earn_rate: 1.2, discount: 3 },
  { level: '金卡', min_spent: 30000, min_points: 3000, earn_rate: 1.5, discount: 5 },
  { level: '白金', min_spent: 80000, min_points: 8000, earn_rate: 2, discount: 8 },
  { level: '鑽石', min_spent: 200000, min_points: 20000, earn_rate: 3, discount: 12 },
]

/**
 * Calculate points earned from a purchase
 */
export function calculatePointsEarned(amount, memberLevel = '一般') {
  const tier = TIER_RULES.find(t => t.level === memberLevel) || TIER_RULES[0]
  const basePoints = Math.floor(amount / 10) // 1 point per $10
  return Math.floor(basePoints * tier.earn_rate)
}

/**
 * Determine the correct tier based on total spent/points
 */
export function calculateTier(totalSpent, totalPoints) {
  let newTier = TIER_RULES[0]
  for (const tier of TIER_RULES) {
    if (totalSpent >= tier.min_spent && totalPoints >= tier.min_points) {
      newTier = tier
    }
  }
  return newTier
}

/**
 * Process a point redemption
 */
export function redeemPoints(member, pointsToRedeem, redemptionType = 'discount') {
  if (pointsToRedeem <= 0 || pointsToRedeem > (member.available_points || 0)) {
    return { success: false, error: '點數不足或無效數量' }
  }

  const pointValue = 0.5 // 1 point = $0.5
  const discountAmount = Math.floor(pointsToRedeem * pointValue)

  return {
    success: true,
    transaction: {
      id: `PT-${Date.now()}`,
      member_id: member.id,
      type: 'redeem',
      points: -pointsToRedeem,
      description: `${redemptionType === 'discount' ? '折抵消費' : '兌換商品'} (${pointsToRedeem}點 = $${discountAmount})`,
      discount_amount: discountAmount,
      created_at: new Date().toISOString(),
    },
    newAvailablePoints: (member.available_points || 0) - pointsToRedeem,
    discountAmount,
  }
}

/**
 * Process a point earning event
 */
export function earnPoints(member, amount, description = '消費累點') {
  const points = calculatePointsEarned(amount, member.level)
  const newTotal = (member.total_points || 0) + points
  const newAvailable = (member.available_points || 0) + points
  const newSpent = (member.total_spent || 0) + amount
  const newTier = calculateTier(newSpent, newTotal)

  return {
    transaction: {
      id: `PT-${Date.now()}`,
      member_id: member.id,
      type: 'earn',
      points: points,
      description: `${description} ($${amount.toLocaleString()} × ${TIER_RULES.find(t => t.level === member.level)?.earn_rate || 1}x)`,
      created_at: new Date().toISOString(),
    },
    pointsEarned: points,
    newTotalPoints: newTotal,
    newAvailablePoints: newAvailable,
    newTotalSpent: newSpent,
    tierChanged: newTier.level !== member.level,
    newTier: newTier.level,
  }
}

/**
 * Process a refund — reverse points earned from the original purchase.
 * Deducts points from total and available (floored at 0), recalculates tier.
 */
export function refundPoints(member, refundAmount, originalTotal, reason = '退款扣回') {
  // Reverse the points that would have been earned on the refunded amount
  const pointsToReverse = calculatePointsEarned(refundAmount, member.level)
  const newTotalPoints = Math.max(0, (member.total_points || 0) - pointsToReverse)
  const newAvailablePoints = Math.max(0, (member.available_points || 0) - pointsToReverse)
  const newTotalSpent = Math.max(0, (member.total_spent || 0) - refundAmount)
  const newTier = calculateTier(newTotalSpent, newTotalPoints)

  return {
    transaction: {
      id: `PT-${Date.now()}`,
      member_id: member.id,
      type: 'refund',
      points: -pointsToReverse,
      description: `${reason} (退款 $${refundAmount.toLocaleString()}，扣回 ${pointsToReverse} 點)`,
      created_at: new Date().toISOString(),
    },
    pointsReversed: pointsToReverse,
    newTotalPoints,
    newAvailablePoints,
    newTotalSpent,
    tierChanged: newTier.level !== member.level,
    newTier: newTier.level,
  }
}

/**
 * Generate referral code
 */
export function generateReferralCode(memberId) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = 'REF-'
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return { code, member_id: memberId, uses: 0, max_uses: 10, bonus_points: 200, created_at: new Date().toISOString() }
}
