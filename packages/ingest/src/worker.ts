// Worker entry for PGliteWorker: only the elected leader tab's worker runs init(), so PGlite
// and ingest exist exactly once per origin. Import from a Web Worker module:
//   import { runNodalWorker } from '@nodal/ingest/worker'; runNodalWorker()
import { PGlite } from '@electric-sql/pglite'
import { live } from '@electric-sql/pglite/live'
import { worker } from '@electric-sql/pglite/worker'
import { migrate } from '@nodal/db'
import { IngestHub } from './hub'

export interface NodalWorkerMeta {
  /** idb://nodal (default), opfs-ahp://nodal, or memory:// */
  dataDir: string
}

export function runNodalWorker(): void {
  void worker({
    async init(options) {
      const meta = (options.meta ?? {}) as Partial<NodalWorkerMeta>
      const dataDir = meta.dataDir ?? 'idb://nodal'
      // Durable writes: each write completes only once it is flushed to IndexedDB/OPFS. With relaxed
      // durability, writes in the last moments before a tab closed or reloaded were lost. Ingest batches
      // messages into one transaction (hub.ts), so the cost is one flush per batch.
      const db = await PGlite.create({ dataDir, relaxedDurability: false, extensions: { live } })
      await migrate(db)
      await db.query(
        `insert into nodal_setting (key, value) values ('vfs', $1::jsonb) on conflict (key) do update set value = excluded.value`,
        [JSON.stringify(dataDir)],
      )
      const hub = new IngestHub(db)
      await hub.start()
      return db
    },
  })
}
