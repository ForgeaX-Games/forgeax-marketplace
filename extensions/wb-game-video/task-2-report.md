# Task 2 — Nodia extension-owned seed

## Delivered

- Added a deterministic `build:nodia-seed` builder. It reads the Nodia demo graph and
  `src/editor/assets/zhandou/*.mp4`, then writes sorted blueprint and v2 assets-manifest fixtures.
- Added `createNodiaSeed()` with independent deep-cloned project, blueprint, and manifest data.
- Added strict `validateNodiaSeed()` checks for portable strings, project/asset shape, duplicate ids,
  graph edges and entries, subflow references/cycles, root/main graph synchronization, and media refs.
- Repointed the demo from external Kino/COS ids to the extension-owned basename ids, preserving the
  published graph schema unchanged. No MP4 bytes are copied into a game seed.

## Verification evidence

- RED: `bun test server/host/nodia-seed.test.ts` failed because `./nodia-seed` did not exist.
- GREEN: focused seed and demo tests passed (11 tests), then the added cyclic-subflow regression test
  passed (3 seed tests).
- Determinism: `bun run build:nodia-seed` was run twice with `git diff --exit-code server/host/fixtures`
  between runs; both checks exited successfully after staging the canonical fixtures.
- Lint: `bun run lint` passed: both TypeScript programs and the module-boundary check are clean.

## Concern

The requested `.superpowers/sdd/2026-07-29-wb-game-video-host-module` plan directory was not present
in this Task-2 checkout. The supplied `task-2-brief.md` was therefore used as the implementation plan.

## Review round 1

- `media.ref` is now fail-loud whenever a media object owns the field: numbers, null, empty, and
  whitespace-only values are invalid in both the runtime validator and fixture builder.
- The validator now rejects unreachable graph nodes and malformed/empty/missing `subFlowPack` pointers,
  while retaining missing-target and cycle checks. The canonical graph has no intentional disconnected
  UI-only nodes: its formerly disconnected combat subflows are now connected by two `score < 0` edges.
  Score is initialized to zero and has no mutation in Nodia, so these structural reachability edges are
  never selected by normal runtime routing.
- Full Nodia project identity (`id`, `title`, `platform`, `platformVersion`, and entry fields) is now
  validated. New adversarial tests cover every review finding, including a builder invocation with an
  invalid blueprint input.
