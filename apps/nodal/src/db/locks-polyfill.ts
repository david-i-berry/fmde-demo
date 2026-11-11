// navigator.locks is secure-context only: missing when FMDEhub is opened over plain http from another
// device (e.g. an iPad on http://<pc>:8080). PGlite's tab leader election needs it, so stand in with
// exclusive locks local to this context. Tabs can then no longer coordinate: use one tab per device
// there (or https / localhost, where the real Web Locks API is used).
type Callback = (lock: { name: string; mode: 'exclusive' } | null) => unknown

if (typeof navigator !== 'undefined' && !(navigator as { locks?: unknown }).locks) {
  const queues = new Map<string, Promise<unknown>>()
  const held = new Set<string>()
  const locks = {
    request(name: string, a: Callback | { ifAvailable?: boolean; signal?: AbortSignal }, b?: Callback): Promise<unknown> {
      const options = typeof a === 'function' ? {} : a
      const callback = (typeof a === 'function' ? a : b)!
      if (options.ifAvailable && held.has(name)) return Promise.resolve().then(() => callback(null))
      const prev = queues.get(name) ?? Promise.resolve()
      const run = prev.then(async () => {
        options.signal?.throwIfAborted()
        held.add(name)
        try {
          return await callback({ name, mode: 'exclusive' })
        } finally {
          held.delete(name)
        }
      })
      queues.set(name, run.catch(() => undefined))
      return run
    },
    query: async () => ({ held: [...held].map((name) => ({ name, mode: 'exclusive' })), pending: [] }),
  }
  Object.defineProperty(navigator, 'locks', { value: locks, configurable: true })
}

export {}
