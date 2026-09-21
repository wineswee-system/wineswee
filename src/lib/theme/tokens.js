// Resolves CSS theme variables to concrete color strings.
// Use for libraries that can't consume `var(--x)` directly — Chart.js,
// Canvas APIs, SVG attributes. For plain JSX styling, use `var(--...)` directly.

const FALLBACK = {
  '--accent-cyan': '#0ea5c9',
  '--accent-blue': '#3b82f6',
  '--accent-purple': '#8b5cf6',
  '--accent-green': '#10b981',
  '--accent-orange': '#f59e0b',
  '--accent-red': '#ef4444',
  '--accent-pink': '#ec4899',
  '--accent-yellow': '#eab308',
  '--text-primary': '#0f172a',
  '--text-secondary': '#334155',
  '--text-tertiary': '#475569',
  '--text-muted': '#64748b',
  '--bg-card': '#ffffff',
  '--border-medium': 'rgba(148,163,184,0.22)',
}

export function readVar(name) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return FALLBACK[name] || '#000'
  }
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || FALLBACK[name] || '#000'
}

export function chartPalette() {
  return {
    cyan: readVar('--accent-cyan'),
    blue: readVar('--accent-blue'),
    purple: readVar('--accent-purple'),
    green: readVar('--accent-green'),
    orange: readVar('--accent-orange'),
    red: readVar('--accent-red'),
    pink: readVar('--accent-pink'),
    yellow: readVar('--accent-yellow'),
  }
}

export function chartTextTokens() {
  return {
    primary: readVar('--text-primary'),
    secondary: readVar('--text-secondary'),
    tertiary: readVar('--text-tertiary'),
    muted: readVar('--text-muted'),
    card: readVar('--bg-card'),
    border: readVar('--border-medium'),
  }
}

// Semantic mapping used across the app. Keep in sync with Badge component.
export const SEMANTIC = {
  success: '--accent-green',
  warning: '--accent-orange',
  error: '--accent-red',
  info: '--accent-blue',
  primary: '--accent-cyan',
  highlight: '--accent-purple',
}
