// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "gridSceneNode",
  "contractVersion": "1.0.0",
  "opId": "grid2node",
  "description": "Construct a single scene node from a 2D grid. Non-zero cells in grid[y][x] become voxels at (x,y,z) for each z in zRange (one voxel per layer per cell). Compose outputs under a parent via add_child.",
  "inputs": [
    {
      "name": "name",
      "type": "string",
      "access": "item",
      "required": true,
      "description": "Name of the node (no '/').",
      "label": "节点名",
      "mode": "parameter"
    },
    {
      "name": "grid",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "Input 2D grid (grid[y][x]); non-zero cells become voxels at (x,y,zBase).",
      "label": "grid"
    },
    {
      "name": "schema",
      "type": "string",
      "access": "item",
      "defaultValue": "voxel-mass",
      "description": "Schema tag for the node geometry.",
      "label": "schema",
      "mode": "parameter"
    },
    {
      "name": "token",
      "type": "string",
      "access": "item",
      "defaultValue": "cell",
      "description": "Semantic token for each voxel.",
      "label": "token",
      "mode": "parameter"
    },
    {
      "name": "z",
      "type": "number",
      "access": "item",
      "description": "Optional elevation-tier index (0,1,2…). When zRange is not wired, emits a solid column of voxels at z=0..z — required for mutually exclusive contour partitions.",
      "label": "高度层索引",
      "mode": "parameter"
    },
    {
      "name": "zRange",
      "type": "number",
      "access": "list",
      "defaultValue": [
        0
      ],
      "description": "List of z values; each non-zero cell emits one voxel per z in this list. Default [0] = single flat layer. Ignored when unset and `z` is provided (fill 0..z).",
      "label": "z 层",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "scene",
      "type": "scene",
      "access": "item",
      "description": "One-node scene with focus on the new node; feed into add_child / set_transform / node_explode.",
      "label": "scene"
    },
    {
      "name": "voxelCount",
      "type": "number",
      "access": "item",
      "description": "Number of voxels written.",
      "label": "体素数"
    }
  ],
  "deterministic": true
})
