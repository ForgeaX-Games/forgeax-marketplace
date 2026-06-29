# wb-observatory · ForgeaX Workbench Plugin

Live + replay visualizer for ForgeaX agent sessions. Renders a reactflow
graph of session-root → turn-N → tool / sub-agent nodes from the host
session's `EventBus`, and slices the composed system prompt into
inspectable modules with token estimates.

## Run

```bash
bun install
bun run dev      # http://localhost:5176/?session=current
```

The plugin expects to be served behind ForgeaX's
`/plugins/wb-observatory/` mount; vite `base` is set accordingly so
hashed asset URLs work after `bun run build`.

## Backend contract

This plugin is a passive consumer of four host endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/observatory/sessions` | session list (mtime-sorted) |
| `GET /api/observatory/sessions/:sid/agents` | agent tree |
| `GET /api/observatory/inspect?session=&agent=` | composed system prompt + module slice |
| `GET /api/observatory/events?session=` | SSE: ledger replay → live tail |

Frontend `?session=current` resolves server-side to the most-recently
touched sid.

## Layout

```
src/
  App.tsx                    URL params + global layout
  hooks/
    useEventStream.ts        EventSource → store dispatch
    useObservatoryData.ts    sessions / agents fetchers
  components/
    ObservatoryToolbar.tsx
    ObservatoryCanvas.tsx
    ModuleSidebar.tsx
    nodes/, edges/
  store/
    observatoryStore.ts      zustand graph state
```

## License

Same as the parent ForgeaX repository.
