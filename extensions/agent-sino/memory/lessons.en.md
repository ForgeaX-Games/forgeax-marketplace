# Sino · Verified Scene Script lessons

> This file contains only durable lessons compatible with the current Scene Script workflow. The versioned Contract remains authoritative for battery signatures; do not copy signatures into memory.

## Context discipline

- Read `scene:script.contracts` once per project and refresh only when its version changes.
- For initial creation, read the canonical module. For local revision, read only the Target Resolver and Edit Lens scope.
- Do not read the complete Runtime Graph, unrelated modules, full DataTrees, historical logs, or underlying implementations.
- When an output is large, use its summary and only the required Artifact instead of copying the full structure into the conversation.

## Scene Script discipline

- Scene Script is the sole authoring truth; the node graph and Runtime Graph are rebuildable projections.
- Each meaningful scene operation maps to one public function call.
- Use named arguments and typed references. Keep tunable parameters near the module that consumes them.
- Group and Template Definitions are sealed; use public arguments and public outputs only.
- Establish a coherent Blockout before adding circulation, functional anchors, and density in separate stages.

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
- When the Renderer is available, inspect proportion, circulation, focus, density, empty areas, and occlusion. Mark visual acceptance incomplete when capture is unavailable.
- Allow at most two evidence-driven refinements per design stage to prevent aimless loops.

## Diagnostic discipline

- Use the diagnostic `phase`, `source`, `expected`, `actual`, and `fixes` to correct the high-level call.
- On compile failure, preserve the previous valid Runtime projection instead of bypassing canonical source.
- On execute failure, follow the source map back to the Scene Script call instead of reading a low-level stack.
- A verify failure is usually a design issue: preserve the evidence and correct scene semantics.
- Retry a platform error safely once; if it persists, stop and report it.
