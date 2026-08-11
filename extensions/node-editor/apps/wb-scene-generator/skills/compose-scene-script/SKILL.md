---
name: compose-scene-script
description: >-
  Design, build, inspect, and locally revise Scene Generator projects through
  canonical Scene Script, bounded edit transactions, and Renderer evidence.
---

# Sino Scene Script workflow

Your job is scene design. Scene Script is the sole authoring truth. The node
graph is its synchronized visual projection, and the Runtime Graph is a
compiler-owned execution artifact.

## Non-negotiable boundary

- Use the versioned Scene Contract as the complete callable language surface.
- Do not inspect battery implementations or sealed Group/Template internals.
- Do not manipulate runtime nodes, ports, edges, IDs, storage, or graph JSON.
- Do not generate or publish assets and do not invoke another Agent.
- Do not investigate compiler, backend, renderer, or platform source code.

## Project start and resume

1. Find or create the requested project with `scene:projects.list` and
   `scene:projects.create`.
2. Open it with `scene:projects.open`.
3. Call `scene:agent.resumeSceneWork` once. Continue its active checkpoint when
   one exists; do not reconstruct history from files or logs.
4. Read `scene:script.contracts` once per contract version.
5. Read the canonical source with `scene:script.get`.

Close the project when the work is complete or explicitly paused.

## Brief Contract

Before editing, record a concise working brief in your reasoning:

- scene scale, orientation, and deterministic seed;
- named spatial hierarchy and approximate proportions;
- entry, primary circulation, branches, and critical reachability;
- functional anchors and their adjacency or separation constraints;
- primary visual focus and intended narrative order;
- density ranges, negative space, and invariants that must not change.

Ask the user only when a missing choice would materially change this contract.

## Initial scene workflow

When the canonical source is empty or the user requests a new scene:

1. Select public functions from `scene:script.contracts`.
2. Author one coherent restricted TypeScript-style module using
   `scene:script.put`. Use named arguments and typed references.
3. Run `scene:script.validate`; fix structured diagnostics at the reported
   high-level call.
4. Build in four semantic stages:
   - **Blockout**: root, major regions, proportion, hierarchy, negative space;
   - **Circulation**: entrances, routes, destinations, crossings, obstacles;
   - **Anchors**: landmarks, gameplay functions, adjacency, sight lines;
   - **Density**: structures, nature, decoration, clustering, edge treatment.
5. After each meaningful stage, execute with `scene:pipeline.execute`.
6. When the Renderer is connected, capture with `scene:screenshot.capture`,
   open the returned image path, and compare it with the Brief.
7. Make at most two evidence-driven refinements per stage.

The restricted language supports function calls, object and array literals,
typed references, imports, exports, and recursive `.scene.ts` modules. It does
not allow loops, classes, mutation, dynamic property access, arbitrary
TypeScript execution, network calls, or filesystem calls.

## Local revision workflow

For a change to an existing scene, never rewrite the whole project by default:

1. Call `scene:agent.locateSceneTarget` using the request and current node,
   source, or Renderer selection.
2. If no candidate is credible, ask for a selection. If several candidates
   remain credible, ask the user to choose.
3. Open the target using `scene:agent.openEditLens`.
4. Derive structured commands only from the Lens contract, capabilities, source
   range, one-hop context, and revision.
5. Call `scene:agent.proposeSceneEdit` with:
   - the Lens revision as a precondition;
   - a concise intent and work order;
   - expected semantic changes;
   - the smallest command set that satisfies the request.
6. Inspect `scene:agent.previewSemanticDiff`. Do not apply when the directly
   changed or invalidated scope exceeds the work order.
7. Apply with `scene:agent.applySceneEdit`. If a Human Gate is required, present
   the bounded diff and wait for approval.
8. Verify with `scene:agent.verifySceneEdit`, choosing local verification unless
   the reported impact crosses modules or global invariants.
9. Inspect Renderer evidence when visual output is affected.
10. Call `scene:agent.acceptOrRevertSceneEdit` with `accept` only when both
    semantic and visual evidence pass; otherwise use `revert`.

On revision conflict, obtain a fresh Lens and re-plan once. Never blindly retry
the stale transaction.

## Structured diagnostics

Read only the structured diagnostic:

- `phase`: parse, type, resolve, compile, execute, verify, or platform;
- `source`, `statementId`, and graph location: the high-level edit target;
- `expected`, `actual`, `signature`, and `fixes`: the correction;
- `transaction`: whether the edit was applied or rolled back;
- `retryable` and `escalation`: whether one safe retry or user action is valid.

Correct a parse/type/resolve/compile issue once at the Scene Script call.
Execution failures follow Source Map lineage back to that call. Verification
failures revise scene semantics. Platform errors get one safe retry, then a
clear blocker report.

## Visual self-review

Execution success is necessary but insufficient. Review the Renderer image for:

- proportion and negative space;
- clear entry, primary route, branches, and destination reachability;
- visual hierarchy and a readable focal point;
- useful density variation instead of uniform scatter;
- repetition, tangencies, accidental gaps, clipping, and occlusion;
- preservation of every invariant in the Brief.

If no live Renderer answers the capture request, report visual acceptance as
unavailable and stop retrying. Never claim visual approval from execution
metadata alone.

## Completion

Before reporting completion, confirm:

- canonical source validates and compiles;
- execution has no unresolved error;
- Semantic Diff matches the intended change;
- required local and global checks pass;
- Renderer evidence passes, or visual acceptance is explicitly unavailable;
- the response states the project, changed scene behavior, verification result,
  and any unresolved asset or visual requirement.
