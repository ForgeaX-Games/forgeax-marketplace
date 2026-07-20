# CONTEXT — wb-diffusion-renderer (glossary)

> Ubiquitous language for the state-driven generative visuals plugin. Glossary
> only — provider internals belong in `DESIGN.md` and `REALTIME.md`.

| Term | Meaning |
|------|---------|
| **Visual source** | Studio-owned implementation of the shared `VisualSource` contract. It observes the active edit/play world, exposes a plain snapshot, resolves game-owned prior images, and leases viewport media. |
| **Visual source snapshot** | A provider-neutral observation containing world availability, epoch/run stamp, semantic intent, one atomic presentation program, camera pose, and viewport dimensions. |
| **Visual prior** | A game-owned image selected by opaque `continuityKey`; the active host resolves it through `visual-priors/manifest.json` before an adapter starts. |
| **Presentation program** | The game-owned durable resource for signals, active behavior instances, lifecycle wishes, transition journal, and bounded idempotency receipts. |
| **Recipe evaluator** | Pure plugin-private compiler that resolves manifest recipes into a canonical effect frame. It never reads input keys, Provider state, or wall time. |
| **Presenter** | Cross-provider coordinator that resolves host inputs, invokes the evaluator, serializes reconciliation, and only advances its transition waterline after adapter completion. |
| **Resolved effect frame** | Plugin-private Adapter input containing merged prompt contributions, normalized motion, and an unacknowledged transition tail. |
| **Backend profile** | A descriptor entry declaring required world inputs, optional inputs, outputs, and the direction controls rendered by the Panel. |
| **FluxRT** | Viewport-enhancement backend using the server-relayed JPEG/WebSocket protocol. Its adapter consumes a presenter-owned viewport lease and normalizes output to `MediaStream`. |
| **LingBot World 2** | Seeded navigable-world backend using browser-direct WebRTC. Its adapter consumes a presenter-resolved prior and broker-issued JWT. |
| **FRFP** (ForgeaX Realtime Frame Protocol) | FluxRT's client/server frame framing. It is an adapter transport detail, not a game or Presenter contract. |
| **Presentation stream** | Optional generated-media output shown in the inline Studio Panel. It is a sidecar and never mutates or drives the authoritative game world. |
| **Public plugin id** | `@forgeax-plugin/wb-diffusion-renderer` / workbench id `wb-diffusion-renderer`. |
| **Public plugin entry** | `wb-diffusion-renderer/index.ts`, the stable composition surface for the panel, runtime factory, and provider-neutral types. Studio does not import provider files directly. |
