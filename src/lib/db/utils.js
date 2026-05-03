const _inflight = new Map()
export function dedup(key, fn) {
  if (_inflight.has(key)) return _inflight.get(key)
  const p = Promise.resolve(fn())
  _inflight.set(key, p)
  p.finally(() => _inflight.delete(key))
  return p
}
