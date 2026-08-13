# Sino · Verified Scene Script lessons

> This file contains only durable lessons compatible with the current Scene Script workflow. The versioned Contract remains authoritative for battery signatures; do not copy signatures into memory.

## Context discipline

- Read the `scene:script.contracts` summary once per Contract version; it must contain only approved utilities and Templates.
- After selecting functions, request and cache at most six exact signatures with `detail`. Never read the complete battery catalog.
- Do not use `scene:script.validate` to guess function names or probe the API.
- For initial creation, read the canonical module. For local revision, read only the Target Resolver and Edit Lens scope.
- Do not read the complete Runtime Graph, unrelated modules, full DataTrees, historical logs, or underlying implementations.
- When an output is large, use its summary and only the required Artifact instead of copying the full structure into the conversation.

## Scene Script discipline

- Scene Script is the sole authoring truth; the node graph and Runtime Graph are rebuildable projections.
- Each meaningful scene operation maps to one public function call.
- Use named arguments and direct literals for ordinary configuration. Use typed references only for data flow between calls or intentionally shared values.
- Group and Template Definitions are sealed; use public arguments and public outputs only.
- Do not convert literals into references with adapter nodes or rebuild Templates from low-level grid batteries; report those failures as Contract or Compiler capability gaps.
- Establish a coherent Blockout before adding circulation, functional anchors, and density in separate stages.
- The canonical entry is deliverable only when it has exactly one reachable `sceneOutput({ scene: final.scene })`; zero, multiple, unreachable, or potentially empty final outputs fail the contract.

## Local revision discipline

- Prefer the current node, code, or Renderer selection as Target Resolver evidence.
- If several targets remain plausible, ask the user instead of guessing.
- The Edit Lens revision is a transaction precondition. On conflict, refresh the Lens and re-plan once.
- Semantic Diff must match the intended change; revert when the impact scope is unexpected.
- Deletion, cross-module extraction, or broad impact requires a Human Gate.

## Verification discipline

- Verify in increasing cost order: parse and type → module interface → local execution → semantic diff → Renderer.
- Run global verification only for cross-module impact or final delivery.
- `execute completed` proves termination, not scene quality.
- Every candidate-final revision returned by `scene:script.put` must be followed by `scene:pipeline.execute` for that exact revision. A later final put invalidates earlier execution evidence.
- Do not advance, capture a screenshot, accept, close, or complete unless the final execution has `execFailures === 0`, `verification.ok === true`, and a present, non-empty final output capture/result.
- Request a screenshot only after that gate passes. When the Renderer is available, require a non-empty capture and inspect proportion, circulation, focus, density, empty areas, and occlusion.
- Renderer unavailability waives only visual-aesthetic review; it never waives a present, non-empty final scene output, zero execution failures, or successful verification.
- Allow at most two evidence-driven refinements per design stage to prevent aimless loops.

## Diagnostic discipline

- Use the diagnostic `phase`, `source`, `expected`, `actual`, and `fixes` to correct the high-level call.
- On compile failure, preserve the previous valid Runtime projection instead of bypassing canonical source.
- On execute failure, follow the source map back to the Scene Script call instead of reading a low-level stack.
- A verify failure is usually a design issue: preserve the evidence and correct scene semantics.
- Never leave a restored revision already known to fail execution, verification, or final-output checks as the final state; repair and re-execute it, restore a known-good revision, or report a blocker.
- Retry a platform error safely once; if it persists, stop and report it.
