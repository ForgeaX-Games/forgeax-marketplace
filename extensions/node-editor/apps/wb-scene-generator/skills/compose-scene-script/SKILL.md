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
- Treat each approved Template as a complete semantic operation. Never recreate
  its hidden topology from grid, explode, slice, or other implementation
  primitives, even if you remember those functions from an older session.

## Task boundary

Classify the explicit request before using this workflow:

- **Project management**: create, list, open, or close a Scene Project.
- **Scene bootstrap**: write a specifically requested base scene or scaffold.
- **Scene design**: author a complete scene from a Brief.
- **Scene edit**: make a bounded change to an existing scene.
- **Inspection**: report requested source, execution, or Renderer evidence.

Do not promote one task into another. A create-only request is complete as soon
as `scene:projects.create` returns a project id. Do not then open, resume, read
contracts/source, validate, put, execute, capture, or close. An empty canonical
source is valid for a create-only task and must not be replaced with a base grid.
Scene output and Renderer gates apply only when the request creates or changes
Scene Script content.

## Project start and resume

These steps are prerequisites for scene bootstrap, design, edit, or inspection;
they are not mandatory follow-ups to a project-management request.

1. Find the requested project with `scene:projects.list`. Create it only when
   the same request explicitly asks for both project creation and scene work.
2. Open it with `scene:projects.open`.
3. Call `scene:agent.resumeSceneWork` once. Continue its active checkpoint when
   one exists; do not reconstruct history from files or logs.
4. Call `scene:script.contracts` in `summary` mode once per contract version.
   This compact catalog contains only the small, explicit scene-design surface:
   composition utilities and published Templates. Template summaries include
   their semantic stage and selection guidance.
   Never request or retain the complete platform battery catalog.
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

1. Select candidate functions from the compact Contract summary.
2. Request `scene:script.contracts` in `detail` mode with only the exact
   `functionNames` needed for the current semantic stage, at most six at a time.
   Cache those signatures for the remainder of the project.
3. Author one coherent restricted TypeScript-style module using
   `scene:script.put`. Use named arguments and direct object, array, string,
   number, and boolean literals. Use a typed reference only when one call
   consumes another call's output or a value is intentionally shared.
   The canonical entry must have exactly one reachable final capture:
   `sceneOutput({ scene: final.scene })`. Zero, duplicate, unreachable, or empty
   final captures are invalid.
   Never insert `numberValue`, `stringConcat`, or another helper merely to make
   a Template accept a literal. If a documented literal is rejected, report
   the compiler diagnostic as a platform capability defect instead of building
   an adapter chain.
4. Run `scene:script.validate`; fix structured diagnostics at the reported
   high-level call.
5. Build in four semantic stages:
   - **Blockout**: root, major regions, proportion, hierarchy, negative space;
   - **Circulation**: entrances, routes, destinations, crossings, obstacles;
   - **Anchors**: landmarks, gameplay functions, adjacency, sight lines;
   - **Density**: structures, nature, decoration, clustering, edge treatment.
6. After each meaningful stage, execute with `scene:pipeline.execute`. In
   particular, every revision returned by a `scene:script.put` that is intended
   to be final must be followed by execution of that exact revision; any later
   final put invalidates prior execution evidence.
7. Before advancing from execution, require `execFailures === 0`,
   `verification.ok === true`, and a present, non-empty final output
   capture/result. If any check fails or is absent, repair and re-execute the
   candidate revision or stop with a blocker.
8. Only after that gate passes, when the Renderer is connected, capture with
   `scene:screenshot.capture`, require a non-empty returned image, open it, and
   compare it with the Brief.
9. Make at most two evidence-driven refinements per stage.

`scene:script.validate` is a validator, not a discovery mechanism. Never submit
candidate function names to discover which one compiles. If the summary does
not contain a needed capability, report the capability gap instead of reading
the full catalog or guessing names.

Do not decompose a missing high-level capability into low-level grid or scene
plumbing. The Agent chooses scene semantics; Template Definitions and the
Compiler own mechanical topology.

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
9. Require the final candidate state to pass the same final-delivery gate:
   exactly one reachable final `sceneOutput`; execution after its last final put,
   `execFailures === 0`, `verification.ok === true`, and a present, non-empty
   final output capture/result.
10. Only then inspect Renderer evidence when visual output is affected.
11. Call `scene:agent.acceptOrRevertSceneEdit` with `accept` only when the
    semantic, execution, output, and applicable visual evidence pass; otherwise
    use `revert`. A revision already known to fail any gate may be restored only
    as an intermediate recovery point, never as the accepted final state.

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

Request a screenshot only after execution and final-output gates pass. If no
live Renderer answers the capture request, report only visual-aesthetic
acceptance as unavailable and stop retrying. Renderer unavailability does not
waive the requirement for exactly one reachable final output, a present and
non-empty final output capture/result, zero execution failures, or successful
verification. If a connected Renderer returns an empty capture, do not advance
or complete. Never claim visual approval from execution metadata alone.

## Completion

Apply only the completion contract for the classified task:

- project create/list/open/close: the requested operation returned success;
- inspection: the requested bounded evidence was returned without mutation;
- scene bootstrap/design/edit: confirm all of the following:

- canonical source validates and compiles, and its canonical entry has exactly
  one reachable `sceneOutput({ scene: final.scene })`;
- the exact revision returned by the last final `scene:script.put` was executed
  after that put;
- final execution reports `execFailures === 0`, `verification.ok === true`,
  and a present, non-empty final output capture/result;
- Semantic Diff matches the intended change;
- required local and global checks pass;
- post-gate Renderer evidence is non-empty and passes, or Renderer
  unavailability is explicitly limited to visual-aesthetic acceptance;
- the final state is not a restored revision already known to fail execution,
  verification, or final-output checks;
- the response states the project, changed scene behavior, verification result,
  and any unresolved asset or visual requirement.
