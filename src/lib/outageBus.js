// Module-level singleton that tracks Supabase infrastructure outages (521/522).
// The custom fetch in supabase.js calls recordResponse() on every request,
// and any component can subscribe to react to outage state changes.
let listeners = new Set()
let outage = false
let clearTimer = null
let autoResetTimer = null

function broadcast() {
  listeners.forEach(fn => fn(outage))
}

// Called by the custom fetch wrapper in supabase.js after every response.
export function recordResponse(status) {
  const isDown = status === 521 || status === 522
  if (isDown) {
    clearTimeout(clearTimer)
    if (!outage) {
      outage = true
      broadcast()
      // Safety: prevent a permanently stuck banner if recovery signal is never received
      clearTimeout(autoResetTimer)
      autoResetTimer = setTimeout(() => { outage = false; broadcast() }, 15 * 60 * 1000)
    }
  } else if (outage) {
    // Debounce recovery: require 2s of clean responses before hiding the banner
    clearTimeout(clearTimer)
    clearTimer = setTimeout(() => {
      clearTimeout(autoResetTimer)
      outage = false
      broadcast()
    }, 2000)
  }
}

export const outageBus = {
  // Subscribe to outage state changes. Immediately fires fn with current state.
  // Returns an unsubscribe function.
  subscribe(fn) {
    listeners.add(fn)
    fn(outage)
    return () => listeners.delete(fn)
  },
  isDown: () => outage,
}
