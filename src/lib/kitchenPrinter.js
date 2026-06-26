import { toast } from './toast'

/**
 * Kitchen Ticket Printer — Web Serial API, ESC/POS, 48-char width
 * Matches the receiptPrinter.js Web Serial pattern.
 */

// ── ESC/POS byte constants ────────────────────────────────────────────────────
const ESC_INIT        = [0x1B, 0x40]             // Initialize printer
const ESC_BOLD_ON     = [0x1B, 0x45, 0x01]       // Bold on
const ESC_BOLD_OFF    = [0x1B, 0x45, 0x00]       // Bold off
const ESC_DBL_SIZE    = [0x1D, 0x21, 0x11]       // Double height + double width
const ESC_NORMAL_SIZE = [0x1D, 0x21, 0x00]       // Normal size
const ESC_ALIGN_CTR   = [0x1B, 0x61, 0x01]       // Center align
const ESC_ALIGN_LEFT  = [0x1B, 0x61, 0x00]       // Left align
const ESC_LF          = [0x0A]                    // Line feed
const ESC_FULL_CUT    = [0x1D, 0x56, 0x41, 0x00] // Full paper cut

const BAUD_RATE  = 9600
const LINE_WIDTH = 48  // Characters per line for 80mm kitchen printer
const LS_KEY     = 'kitchen_printer_connected'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Encode a string to UTF-8 bytes. */
function encode(str) {
  return new TextEncoder().encode(str)
}

/**
 * Concatenate any number of byte sources (Uint8Array | number[]) into a
 * single Uint8Array.
 */
function bytes(...byteArrays) {
  const arrays = byteArrays.map(b => (b instanceof Uint8Array ? b : new Uint8Array(b)))
  const total  = arrays.reduce((n, a) => n + a.length, 0)
  const out    = new Uint8Array(total)
  let offset   = 0
  for (const a of arrays) {
    out.set(a, offset)
    offset += a.length
  }
  return out
}

/** Full-width divider line. char defaults to '='. */
function divider(char = '=') {
  return char.repeat(LINE_WIDTH) + '\n'
}

/** Thin divider (dashes). */
function thinDivider() {
  return divider('-')
}

/**
 * Left-align a string, right-pad so the total line is LINE_WIDTH chars.
 * If combined left+right exceeds width, separate with a single space.
 */
function padLine(left, right = '') {
  const gap = LINE_WIDTH - left.length - right.length
  if (gap < 1) return `${left} ${right}\n`
  return `${left}${' '.repeat(gap)}${right}\n`
}

/**
 * Course label mapping: 1 → 第一輪, 2 → 第二輪, etc.
 * Falls back to "第 N 輪" for values beyond the lookup table.
 */
function courseLabel(n) {
  const labels = ['', '第一輪', '第二輪', '第三輪', '第四輪', '第五輪']
  return labels[n] ?? `第 ${n} 輪`
}

// ── Class ─────────────────────────────────────────────────────────────────────

export class KitchenPrinter {
  constructor() {
    /** @type {SerialPort|null} */
    this.port = null
    /** @type {WritableStreamDefaultWriter|null} */
    this.writer = null
  }

  /**
   * Open a Web Serial connection to the kitchen printer.
   * Stores a flag in localStorage ('kitchen_printer_connected') so the UI
   * can reflect persistent connection state across renders.
   * @returns {Promise<boolean>} true on success
   */
  async connect() {
    if (!('serial' in navigator)) {
      toast.error('瀏覽器不支援 Web Serial API（請使用 Chrome / Edge）')
      return false
    }

    // Already connected — close first so the user can re-pick the port
    if (this.port) {
      await this.disconnect()
    }

    try {
      const port = await navigator.serial.requestPort()
      await port.open({ baudRate: BAUD_RATE })
      this.port   = port
      this.writer = port.writable.getWriter()
      localStorage.setItem(LS_KEY, 'true')
      toast.success('廚房印表機已連線')
      return true
    } catch (err) {
      // NotFoundError = user cancelled the picker; not a reportable error
      if (err.name === 'NotFoundError') return false
      console.error('[KitchenPrinter] connect error:', err)
      toast.error('廚房印表機連線失敗：' + (err.message || '未知錯誤'))
      return false
    }
  }

  /**
   * Release the writer lock and close the serial port.
   * Clears the localStorage flag regardless of whether close() succeeds.
   */
  async disconnect() {
    try {
      if (this.writer) {
        this.writer.releaseLock()
        this.writer = null
      }
      if (this.port) {
        await this.port.close()
        this.port = null
      }
    } catch (err) {
      console.error('[KitchenPrinter] disconnect error:', err)
    } finally {
      localStorage.removeItem(LS_KEY)
    }
  }

  /** Returns true when the port is open and the writer lock is held. */
  isConnected() {
    return this.port !== null && this.writer !== null
  }

  /**
   * Low-level: write raw bytes to the port.
   * @param {Uint8Array} data
   */
  async _write(data) {
    if (!this.writer) throw new Error('廚房印表機未連線')
    await this.writer.write(data)
  }

  /**
   * Print a kitchen order ticket.
   *
   * Layout (48-char wide):
   *
   *   ================================================
   *            T{tableNumber}  #{orderNumber}          ← double-size, center
   *   ------------------------------------------------
   *   第一輪:                                           ← bold heading (if courses)
   *     2x 招牌牛肉麵
   *        → 少辣 (item note, if any)
   *   第二輪:
   *     1x 紅豆湯
   *   ------------------------------------------------
   *   備註: 過敏花生 (order-level note, if any)
   *   ================================================
   *   [CUT]
   *
   * @param {{
   *   orderNumber: string|number,
   *   tableNumber: string|number,
   *   items: Array<{ name: string, qty: number, note?: string, course?: number }>,
   *   note?: string,
   * }} ticketData
   * @returns {Promise<boolean>}
   */
  async printKitchenTicket({ orderNumber, tableNumber, items = [], note }) {
    if (!this.isConnected()) {
      toast.error('廚房印表機未連線，無法出單')
      return false
    }

    try {
      // ── Group items by course ────────────────────────────────────────────────
      // Items without a course (or course ≤ 0) fall into group 1
      const hasCourses = items.some(i => i.course != null && i.course > 0)
      const courseMap  = new Map()

      for (const item of items) {
        const c = (item.course != null && item.course > 0) ? item.course : 1
        if (!courseMap.has(c)) courseMap.set(c, [])
        courseMap.get(c).push(item)
      }

      const sortedCourses = [...courseMap.keys()].sort((a, b) => a - b)

      // ── Build payload ────────────────────────────────────────────────────────
      const chunks = []

      // Initialize printer
      chunks.push(bytes(ESC_INIT))

      // Top border (=)
      chunks.push(bytes(ESC_ALIGN_CTR))
      chunks.push(encode(divider('=')))

      // Table + order number — double size for quick glance across the kitchen
      chunks.push(bytes(ESC_DBL_SIZE, ESC_BOLD_ON))
      chunks.push(encode(`T${tableNumber}  #${orderNumber}\n`))
      chunks.push(bytes(ESC_NORMAL_SIZE, ESC_BOLD_OFF))

      // Thin separator
      chunks.push(bytes(ESC_ALIGN_LEFT))
      chunks.push(encode(thinDivider()))

      // Item list, grouped by course
      for (const courseNum of sortedCourses) {
        const courseItems = courseMap.get(courseNum)

        // Course heading only when there are multiple distinct courses
        if (hasCourses && sortedCourses.length > 1) {
          chunks.push(bytes(ESC_BOLD_ON))
          chunks.push(encode(`${courseLabel(courseNum)}:\n`))
          chunks.push(bytes(ESC_BOLD_OFF))
        }

        for (const item of courseItems) {
          // "  2x 招牌牛肉麵"
          chunks.push(encode(`  ${item.qty}x ${item.name}\n`))

          // "     → 少辣" (item-level note, indented)
          if (item.note && item.note.trim()) {
            chunks.push(encode(`     → ${item.note.trim()}\n`))
          }
        }
      }

      // Order-level note
      if (note && note.trim()) {
        chunks.push(encode(thinDivider()))
        chunks.push(bytes(ESC_BOLD_ON))
        chunks.push(encode(`備註: ${note.trim()}\n`))
        chunks.push(bytes(ESC_BOLD_OFF))
      }

      // Bottom border (=)
      chunks.push(encode(divider('=')))

      // Two blank lines before the blade
      chunks.push(bytes(ESC_LF, ESC_LF))

      // Full cut
      chunks.push(bytes(ESC_FULL_CUT))

      // Send to printer
      await this._write(bytes(...chunks))
      return true
    } catch (err) {
      console.error('[KitchenPrinter] printKitchenTicket error:', err)
      toast.error('廚房出單失敗：' + (err.message || '未知錯誤'))
      return false
    }
  }

  /**
   * Reprint a previously issued kitchen ticket.
   * Accepts the same shape as printKitchenTicket().
   * @param {object} ticketData
   * @returns {Promise<boolean>}
   */
  async reprint(ticketData) {
    return this.printKitchenTicket(ticketData)
  }
}

// Singleton — import this everywhere rather than constructing your own instance
export const kitchenPrinter = new KitchenPrinter()
