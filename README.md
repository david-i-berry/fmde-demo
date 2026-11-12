# fmde-demo

[FMDEhub](https://github.com/david-i-berry/fmde-hub), the network manager for the WMO First Mile
Data Exchange (FMDE), as a standalone PWA on GitHub Pages:
**https://david-i-berry.github.io/fmde-demo/**

It runs entirely in the browser. Enter a broker under **Settings** (a `wss://` URL and read-only
credentials) and it subscribes to the FMDE topics (`firstmile/a/#, firstmile/poc1/#`), decodes
every message, and shows the nodes: status board, map, node pages with parameters, time series,
messages and metadata, and the message inspector. Data is kept in the browser's own database.

## How it is built

```
apps/nodal/           the Vue 3 + Vuetify PWA
packages/model/       FMDE protobuf decoding, normalisation, node state (no Vue)
packages/db/          the browser database schema (PGlite)
packages/ingest/      the MQTT source and ingest into the database
packages/components/  charts, tables, map and other Vue components
```

[`.github/workflows/pages.yml`](.github/workflows/pages.yml) builds `apps/nodal` on every push to
`main` with the Pages settings: `NODAL_BASE` (the base path), `VITE_SITES=off` and a `config.json`
of `{ "hideConformance": true, "historyRecorder": false }`. It also copies `index.html` to
`404.html`, so links to node pages work.

To run it locally:

```
npm ci
npm run dev                  # http://localhost:5173
npm run typecheck
```

## Licence

Apache-2.0 (see [LICENSE](LICENSE) and [NOTICE](NOTICE)).
