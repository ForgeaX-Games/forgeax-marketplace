# CONTEXT — wb-diffusion-renderer (glossary)

> Ubiquitous language for the real-time viewport diffusion renderer plugin. Glossary only —
> no implementation details. Plugin id: `wb-diffusion-renderer`.

| Term | Meaning |
|------|---------|
| **Viewport** (a.k.a. "EA") | The live WebGPU engine preview in the Studio center panel — the `<canvas id="app">` created in `ViewportComponent`. It is the frame **source** (what we capture). Enhanced frames are shown in the Diffusion Renderer plugin panel, not over this canvas. Not to be confused with the Play `/preview/` iframe. |
| **Diffusion Renderer** | One round trip: capture a viewport frame → send to FluxRT → receive an AI enhanced frame. The plugin's whole job. |
| **FluxRT** | The remote real-time video render enhancement service (HTTP `/predict`, WS `/ws`, `/health`). External; we do not run it. |
| **Service key** | The secret FluxRT validates. By product choice it defaults to the user's `ANTHROPIC_API_KEY` so setup only requires one key; `FLUXRT_API_KEY` can override it when a separate render secret is needed. The chosen key never leaves the ForgeaX server. |
| **Host stream implementation** | In-process code running in the **parent Studio window** that owns `captureStream()` from the viewport, the encode Worker, the relay WS, and the output-panel display sink. It lives in the marketplace plugin package and is imported by Studio's inline DockShell panel. |
| **Control plane** | The inline Diffusion Renderer DockShell panel UI: prompt / steps / interp / start / stop + metrics and preview. It configures the stream through direct same-window module calls; no production control path uses the compatibility iframe. |
| **Game control channel** | Optional same-window API published as `window.forgeaxDiffusion` while the inline panel is mounted. Running game code can push a prompt fragment from game state; the stream composes it with the panel's base prompt and exposes a reclaim path for manual control. |
| **Relay** | The ForgeaX server WS reverse-proxy (`/ws/diffusion-renderer`, under `/ws/*` so the dev vite proxy forwards the upgrade) that pipes browser⇄FluxRT bytes transparently and injects the service key at upgrade time. Mirrors the existing wb-scene `/ws/*` proxy. |
| **Uplink frame** | Client→FluxRT binary message: `[4B meta_len LE][meta JSON][JPEG bytes]`. Meta carries `seq`, `ts`, and the current effective render params (`prompt`/`steps`/`interp`/`seed`, plus one-shot `reset_cache` when needed). |
| **Downlink frame** | FluxRT→client binary message: `[4B header_len LE][header JSON][JPEG...]`. `header.sizes[]` splits the trailing bytes into `n` output JPEGs (n>1 when interpolation is on). |
| **Display buffer** | Client-side playback queue that plays downlink JPEGs at a steady FPS (e.g. 30), decoupled from the model's ~4–5 fps output so interpolated batches look smooth. |
| **Latest-frame priority** | If frames are produced faster than they can be processed, older ones are dropped (FluxRT emits `{type:"drop",seq}`); only the newest is edited. The host stream implementation caps in-flight frames and drops to the newest. |
| **Session** | A backend allows exactly **one** live WS session at a time (FluxRT: a second `/ws` gets `{type:"busy"}`, `/predict` returns 409 while a WS session is active). |
| **FRFP** (ForgeaX Realtime Frame Protocol) | The client↔server wire contract (uplink/downlink framing + control messages). The host stream implementation speaks this shape, while server-side FluxRT specifics stay in `game/wb-diffusion-renderer.ts`. See REALTIME.md. |
| **Diffusion renderer server module** | `game/wb-diffusion-renderer.ts`: owns HTTP health/capability routes, optional single-frame `/predict`, and FluxRT WS upstream URL resolution. A multi-backend registry can be added later if needed. |
| **Streaming vs async-batch backend** | `capabilities().streaming` splits backends into realtime-streaming (FluxRT, local turbo models — fit the live plugin panel) vs async-batch (Seedance `task_id` polling — a different offline feature, excluded from this plugin). |
| **In-flight budget** | Uplink backpressure: at most `MAX_INFLIGHT` (1–2) frames outstanding; extra captured frames are dropped-to-newest rather than queued. |
| **Jitter buffer** | The shallow downlink display buffer (2–3 frames) played at a steady ~30 fps, decoupling bursty model output from smooth playback while favoring freshness. |
