# REALTIME.md — Phase 2 streaming design (FRFP + relay)

The Phase-2 real-time path. Phase 1 is single-frame HTTP (see DESIGN.md); this doc is
the streaming design that replaces the HTTP step.

## Layering

```
inline DockShell panel + host stream implementation
   │  direct same-window module calls
   └─speaks──▶  FRFP  ──▶  ForgeaX server relay
      (capture, worker encode,              │ resolves FluxRT upstream
       jitter buffer, plugin panel,         ▼
       backpressure controller)      game/wb-diffusion-renderer.ts
                                             │  native protocol + key injection
                                             ▼   (server=localhost → backend=remote WAN)
                                        the actual service
```

The host stream implementation knows only FRFP. `game/wb-diffusion-renderer.ts`
contains the current FluxRT-specific upstream URL, health, capability, and predict
logic. If a second backend appears, this file is the place to introduce selection.

## FRFP wire format (host stream ⇄ server)

- **Uplink** (binary): `[4B meta_len LE][meta JSON][JPEG]`
  - meta: `{ seq:int, ts:float, params?:{ prompt?, seed?, steps?, interp?, reset_cache? } }`
  - `prompt` / `seed` / `steps` / `interp` are sent with each captured frame. FluxRT
    reports `stateful:false`, so each frame must be self-contained for stable output.
  - `reset_cache:true` is a **one-shot** the host attaches to a single frame when the
    **global style prompt** is (re)applied, so the backend rebuilds its KV cache for a
    large style change. **Game prompt-fragment updates never set it** — they are
    prompt-only and keep the cache for temporal coherence.
- **Downlink** (binary): `[4B header_len LE][header JSON][JPEG × n]`
  - header: `{ type:'out', seq, ts, serverMs, n, sizes:[int...] }` — split trailing bytes by `sizes` in order.
- **Control** (JSON text): `ready | drop{seq} | busy | unauthorized | error{message} | style-switching{etaMs}`.

## Buffering

- **Uplink: never queue.** One in-flight budget `MAX_INFLIGHT ∈ {1,2}`; if exceeded, drop
  the just-captured frame (drop-to-newest). Queuing uplink only accumulates latency.
- **Downlink jitter buffer:** shallow ring, target depth **2–3 frames (~60–100 ms)** — this
  is interactive, so favor freshness over smoothness. `interp=2` yields 4-frame batches;
  play the ring at a steady **~30 fps** display clock. Hard cap; drop oldest on overflow.

## Frame dropping & synchronization

- Monotonic `seq` per session, echoed in the downlink header.
- **Display gate:** never show `seq ≤ lastShownSeq` (drops out-of-order/stale frames).
- `ts` = capture `performance.now()` echoed → true e2e latency = `now - ts`. `serverMs` =
  backend infer time (for the metrics line).
- Backend `drop{seq}` → decrement in-flight + metrics only; render nothing for that seq.
- **`prompt` change is cheap** (FluxRT dropped `lora`, so prompt is the only style knob):
  the new effective prompt rides the next captured frame; there is no multi-second
  style-switch stall to mask. Keep showing the last good frame across any transition,
  never blank the plugin panel.
- Single client clock (capture + display in the same window) → no cross-machine sync.
- **Fixed seed for temporal coherence.** FluxRT is `stateful:false`, so a random per-frame
  seed (`-1`) stylizes each frame independently → "boiling"/dirty churn (worsened by RIFE
  interp). The stream sends a **constant seed** every frame (mirrors the reference client's
  fixed seed) so the stylization is stable frame-to-frame and tracks the game. Verified:
  static-scene consecutive styled frames are pixel-identical (temporal diff = 0).

## Latency budget & backpressure (honest)

Dominant terms are **WAN RTT to the backend + inference (~140–300 ms)**; the ForgeaX
server is localhost, so browser⇄server is ~free and the relay's header rewrite is
negligible. Client levers (worker encode, 576×320 downscale, shallow buffer, `steps=1`)
trim only tens of ms. Realistic e2e ≈ **250–500 ms**; `interp` makes playback *look*
16–20 fps without lowering true latency.

**Adaptive controller** (stability, not magic): watch `inflight` + rolling e2e.
- e2e rising / `drop` spikes → step capture fps 10→6→4, pin `inflight=1`, optionally `steps`→1.
- recovered → step back up. Use hysteresis (e.g. 1.5 s dwell) to avoid flapping.

## Backend capabilities (drives the UI)

`capabilities()` → `{ streaming:boolean, supportsPrompt, supportsInterp,
outputResolution:{w,h} }`. The inline panel renders knobs from this: hide `interp`
when unsupported and letterbox the plugin panel to `outputResolution`. `streaming:false`
backends (async-batch, e.g. Seedance) are excluded from this plugin's live path
(different feature).
