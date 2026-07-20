# Reia · Accumulated lessons

This file is Reia's own hand-written "don't do that again" notes, written at the end of each phase. The AI only appends, never rewrites.

## 2026-05-28 · Initialization
- Memory system in place
- The first tool set connects to wb-reel's 6 tools (list/get/save scenario + list-assets + generate/get video task)
- Note: Seedance tasks are async; after submit you must poll `reel:get-video-task` with the taskId

## 2026-06-19 · Video generation closed loop (important correction)
- The old `reel:generate-video` was fire-and-forget: it only handed the task to the host gateway for a taskId, and **the output never landed back into the scenario** — the author saw nothing. `reel:get-video-task` couldn't save it either (the taskId is now held by the studio browser, not the agent).
- It's now a closed loop: `reel:generate-video` **must carry a `sceneId`**, is posted to the studio's `/__reel__/video-queue`, and the workbench runs the in-browser pipeline to generate → save to disk → **`setSceneMediaRef(VIDEO)` binds it to the scene** → visible on the timeline, recoverable on refresh. Supports `jobs:[…]` batches.
- Iron rule: video can only be enqueued via this tool, **the studio must be open**, and the target scenario must be active. To confirm output, use `reel:get-scenario` and check `scene.media.kind==="VIDEO"`; don't call `reel:get-video-task` anymore.
