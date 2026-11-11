// Tab-side database access. Every tab starts a PGliteWorker; the tabs elect a leader and only the
// leader's worker runs PGlite and ingest. Followers proxy queries to it.
import './locks-polyfill'
import { live } from '@electric-sql/pglite/live'
import { PGliteWorker } from '@electric-sql/pglite/worker'
import { CHANGE_CHANNEL } from '@nodal/db'
import { CONTROL_CHANNEL, EVENT_CHANNEL, type ControlMessage, type HubEvent } from '@nodal/ingest'
import NodalWorker from './nodal.worker.ts?worker'

export type Vfs = 'idb' | 'opfs-ahp' | 'memory'

const VFS_KEY = 'nodal.vfs'

export const VFS_DATA_DIR: Record<Vfs, string> = {
  idb: 'idb://nodal',
  'opfs-ahp': 'opfs-ahp://nodal',
  memory: 'memory://',
}

/** OPFS access handle pool: Chromium and Firefox in a worker; not Safari. */
export function opfsAhpSupported(): boolean {
  const ua = navigator.userAgent
  const safari = /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua)
  return !safari && typeof navigator.storage?.getDirectory === 'function'
}

/** The VFS chosen at start-up: ?memory in the URL, else the saved choice, else IndexedDB. */
export function currentVfs(): Vfs {
  if (new URLSearchParams(location.search).has('memory')) return 'memory'
  try {
    const saved = localStorage.getItem(VFS_KEY) as Vfs | null
    if (saved === 'opfs-ahp' && !opfsAhpSupported()) return 'idb'
    if (saved && saved in VFS_DATA_DIR) return saved
  } catch {
    // storage unavailable: fall through to the default
  }
  return 'idb'
}

/** Takes effect on reload. Each VFS is a separate database: use backup/restore to move data. */
export function setVfs(vfs: Vfs): void {
  try {
    localStorage.setItem(VFS_KEY, vfs)
  } catch {
    // ignore
  }
}

export type NodalDb = Awaited<ReturnType<typeof createDb>>

async function createDb() {
  const vfs = currentVfs()
  const dataDir = VFS_DATA_DIR[vfs]
  return PGliteWorker.create(new NodalWorker(), {
    id: `nodal-${vfs}`,
    dataDir,
    meta: { dataDir },
    extensions: { live },
  })
}

let dbPromise: Promise<NodalDb> | null = null

export function getDb(): Promise<NodalDb> {
  dbPromise ??= createDb()
  return dbPromise
}

// --- change notifications: ingest NOTIFYs after each batch -------------------------------------

const changeListeners = new Set<() => void>()
let listening = false

export async function onDataChange(cb: () => void): Promise<() => void> {
  changeListeners.add(cb)
  if (!listening) {
    listening = true
    const db = await getDb()
    await db.listen(CHANGE_CHANNEL, () => changeListeners.forEach((l) => l()))
  }
  return () => changeListeners.delete(cb)
}

// --- control of the leader's ingest hub ----------------------------------------------------------

const control = new BroadcastChannel(CONTROL_CHANNEL)
const events = new BroadcastChannel(EVENT_CHANNEL)

// The hub starts in the leader's worker after PGlite opens and migrates. Until it has announced
// itself (any status event), keep asking, and hold control messages so none are lost.
let resolveHubReady: () => void
const hubReady = new Promise<void>((r) => (resolveHubReady = r))
events.addEventListener('message', () => resolveHubReady(), { once: true })
const poll = setInterval(() => control.postMessage({ type: 'status' } satisfies ControlMessage), 500)
void hubReady.then(() => clearInterval(poll))

export function sendControl(msg: ControlMessage): void {
  void hubReady.then(() => control.postMessage(msg))
}

export function onHubEvent(cb: (e: HubEvent) => void): () => void {
  const handler = (e: MessageEvent<HubEvent>) => cb(e.data)
  events.addEventListener('message', handler)
  return () => events.removeEventListener('message', handler)
}
