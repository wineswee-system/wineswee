import { describe, it, expect } from 'vitest'
import { formatShiftLabel, parseWorkRange, getShiftHours, getNetWorkHours } from '../scheduleUtils.js'

// ═══════════════════════════════════════════════════════════════
//  formatShiftLabel
// ═══════════════════════════════════════════════════════════════

describe('formatShiftLabel', () => {
  describe('already-canonical HH:MM~HH:MM', () => {
    it('leaves canonical form unchanged', () => {
      expect(formatShiftLabel('10:30~19:30')).toBe('10:30~19:30')
      expect(formatShiftLabel('00:00~08:00')).toBe('00:00~08:00')
    })
    it('pads single-digit hours', () => {
      expect(formatShiftLabel('9:00~18:00')).toBe('09:00~18:00')
    })
  })

  describe('compact 4+4 digit: HHMM[-~]HHMM', () => {
    it('handles dash separator', () => {
      expect(formatShiftLabel('1030-1930')).toBe('10:30~19:30')
      expect(formatShiftLabel('1300-2200')).toBe('13:00~22:00')
      expect(formatShiftLabel('1500-0000')).toBe('15:00~00:00')
    })
    it('handles tilde separator', () => {
      expect(formatShiftLabel('1100~2000')).toBe('11:00~20:00')
    })
  })

  describe('integer-hours: H[H][-~]H[H]', () => {
    it('pads both sides', () => {
      expect(formatShiftLabel('11-20')).toBe('11:00~20:00')
      expect(formatShiftLabel('8-17')).toBe('08:00~17:00')
      expect(formatShiftLabel('19~1')).toBe('19:00~01:00')
    })
    it('zero end hour', () => {
      expect(formatShiftLabel('16-0')).toBe('16:00~00:00')
    })
  })

  describe('full colon: HH:MM[-~]HH:MM', () => {
    it('normalises dash to tilde', () => {
      expect(formatShiftLabel('10:30-19:30')).toBe('10:30~19:30')
    })
    it('pads single-digit hour', () => {
      expect(formatShiftLabel('9:00-18:00')).toBe('09:00~18:00')
    })
  })

  describe('次日 cross-midnight marker', () => {
    it('strips 次日 prefix from end time', () => {
      expect(formatShiftLabel('17:00~次日01:00')).toBe('17:00~01:00')
      expect(formatShiftLabel('22:00～次日06:00')).toBe('22:00~06:00')
    })
  })

  describe('mixed HHMM-H[H] (4-digit start, 1-2 digit end hour)', () => {
    it('2130-01 → 21:30~01:00', () => {
      expect(formatShiftLabel('2130-01')).toBe('21:30~01:00')
    })
    it('1800-0 → 18:00~00:00', () => {
      expect(formatShiftLabel('1800-0')).toBe('18:00~00:00')
    })
    it('0800-18 → 08:00~18:00', () => {
      expect(formatShiftLabel('0800-18')).toBe('08:00~18:00')
    })
  })

  describe('mixed H[H]-HHMM (1-2 digit start hour, 4-digit end)', () => {
    it('11-1530 → 11:00~15:30', () => {
      expect(formatShiftLabel('11-1530')).toBe('11:00~15:30')
    })
    it('21-0130 → 21:00~01:30', () => {
      expect(formatShiftLabel('21-0130')).toBe('21:00~01:30')
    })
    it('9-1800 → 09:00~18:00', () => {
      expect(formatShiftLabel('9-1800')).toBe('09:00~18:00')
    })
    it('20-2430 normalises 24+ notation → 20:00~00:30', () => {
      expect(formatShiftLabel('20-2430')).toBe('20:00~00:30')
    })
    it('17-2400 normalises midnight → 17:00~00:00', () => {
      expect(formatShiftLabel('17-2400')).toBe('17:00~00:00')
    })
  })

  describe('non-time strings pass through unchanged', () => {
    it('Chinese named shifts', () => {
      expect(formatShiftLabel('早班')).toBe('早班')
      expect(formatShiftLabel('文心晚班 2')).toBe('文心晚班 2')
    })
    it('absence codes', () => {
      expect(formatShiftLabel('例假')).toBe('例假')
      expect(formatShiftLabel('休息')).toBe('休息')
    })
    it('null / undefined / empty', () => {
      expect(formatShiftLabel(null)).toBe(null)
      expect(formatShiftLabel('')).toBe('')
    })
  })
})

// ═══════════════════════════════════════════════════════════════
//  parseWorkRange
// ═══════════════════════════════════════════════════════════════

describe('parseWorkRange', () => {
  it('parses standard range', () => {
    const r = parseWorkRange('12:30~16:30')
    expect(r.start).toBe('12:30')
    expect(r.end).toBe('16:30')
    expect(r.crossMidnight).toBe(false)
    expect(r.grossHours).toBe(4)
  })

  it('detects cross-midnight via end < start', () => {
    const r = parseWorkRange('20:30~01:30')
    expect(r.crossMidnight).toBe(true)
    expect(r.grossHours).toBe(5)
  })

  it('handles 次日 prefix on end time', () => {
    const r = parseWorkRange('20:00~次日01:00')
    expect(r.crossMidnight).toBe(true)
    expect(r.start).toBe('20:00')
    expect(r.end).toBe('01:00')
    expect(r.grossHours).toBe(5)
  })

  it('handles day-of-month prefix (N|HH:MM cross-midnight export format)', () => {
    const r = parseWorkRange('20:00~03|01:00')
    expect(r.crossMidnight).toBe(true)
    expect(r.end).toBe('01:00')
  })

  it('net hours deducts break correctly', () => {
    // 9h gross → 60 min break → 8h net
    const r = parseWorkRange('09:00~18:00')
    expect(r.grossHours).toBe(9)
    expect(r.netHours).toBe(8)
    // 6h gross → 30 min break → 5.5h net
    const r2 = parseWorkRange('10:00~16:00')
    expect(r2.grossHours).toBe(6)
    expect(r2.netHours).toBe(5.5)
    // 4h gross → 0 min break → 4h net
    const r3 = parseWorkRange('14:00~18:00')
    expect(r3.grossHours).toBe(4)
    expect(r3.netHours).toBe(4)
  })

  it('returns null for unparseable input', () => {
    expect(parseWorkRange('')).toBeNull()
    expect(parseWorkRange('早班')).toBeNull()
    expect(parseWorkRange(null)).toBeNull()
    expect(parseWorkRange('not-a-range')).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════
//  getShiftHours / getNetWorkHours
// ═══════════════════════════════════════════════════════════════

describe('getShiftHours', () => {
  it('standard day shift', () => {
    expect(getShiftHours({ start_time: '09:00', end_time: '18:00' })).toBe(9)
  })
  it('cross-midnight shift', () => {
    expect(getShiftHours({ start_time: '22:00', end_time: '06:00' })).toBe(8)
  })
  it('exactly midnight boundary', () => {
    expect(getShiftHours({ start_time: '15:00', end_time: '00:00' })).toBe(9)
  })
})

describe('getNetWorkHours', () => {
  it('< 5h gross → no break', () => {
    expect(getNetWorkHours({ start_time: '10:00', end_time: '14:00' })).toBe(4)
  })
  it('5h boundary → 30 min break', () => {
    expect(getNetWorkHours({ start_time: '10:00', end_time: '15:00' })).toBe(4.5)
  })
  it('6h gross → 30 min break → 5.5h net', () => {
    expect(getNetWorkHours({ start_time: '10:00', end_time: '16:00' })).toBe(5.5)
  })
  it('9h boundary → 60 min break', () => {
    expect(getNetWorkHours({ start_time: '09:00', end_time: '18:00' })).toBe(8)
  })
  it('10h gross → 60 min break → 9h net', () => {
    expect(getNetWorkHours({ start_time: '09:00', end_time: '19:00' })).toBe(9)
  })
})
