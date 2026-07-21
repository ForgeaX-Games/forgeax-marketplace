import { describe, it, expect } from 'vitest';
import {
  projectSceneToVoxelLayers,
  readNode,
} from '../../vendor/dist/shared/types/index.js';
import { json2Voxels } from '../../batteries/scene/bridge/json2voxels/index.js';
import { voxels2Scene } from '../../batteries/scene/bridge/voxels2scene/index.js';
import {
  EXAMPLE_VOXEL_BUILDING_JSON,
  buildExampleVoxelBuildingDocument,
} from '../../examples/voxel-city-block.build.js';

describe('json2voxels + voxels2scene', () => {
  it('parses flat voxel array', () => {
    const json = JSON.stringify([
      { x: 1, y: 2, z: 0, token: 'wall' },
      { x: 3, y: 4, z: 1 },
    ]);
    const out = json2Voxels({ json });
    expect(out.error).toBeUndefined();
    expect(out.voxelCount).toBe(2);
    expect(out.voxels).toEqual([
      { x: 1, y: 2, z: 0 },
      { x: 3, y: 4, z: 1 },
    ]);
    expect(out.tokens).toEqual(['wall', 'cell']);
  });

  it('parses hierarchical nodes document with 4m storeys', () => {
    const doc = buildExampleVoxelBuildingDocument();
    expect(doc.meta.floorHeight).toBe(4);
    expect(doc.meta.totalHeight).toBe(15);
    expect(doc.nodes.length).toBe(16);

    const out = json2Voxels({ json: EXAMPLE_VOXEL_BUILDING_JSON });
    expect(out.error).toBeUndefined();
    expect(out.voxelCount).toBeGreaterThan(1500);
    expect((out.nodes as unknown[]).length).toBe(16);
    expect(out.root).toBe('CityBlock');
  });

  it('builds multi-floor scene from nodes[]', () => {
    const parsed = json2Voxels({ json: EXAMPLE_VOXEL_BUILDING_JSON });
    const built = voxels2Scene({
      nodes: parsed.nodes,
      root: parsed.root,
      schema: parsed.schema,
    });
    expect(built.error).toBeUndefined();
    expect(built.nodeCount).toBe(16);
    expect(built.voxelCount).toBe(parsed.voxelCount);

    const root = readNode(built.scene!.tree, '/CityBlock');
    expect(root).not.toBeNull();
    expect(root!.children.map((c) => c.name)).toContain('L1_structure');
    expect(root!.children.map((c) => c.name)).toContain('L3_mech_plant');

    const stair = readNode(built.scene!.tree, '/CityBlock/L1_stair_core');
    expect(stair?.cells?.length ?? 0).toBeGreaterThan(0);
  });

  it('groupBy=z splits flat voxels into z layers', () => {
    const json = JSON.stringify([
      { x: 0, y: 0, z: 0, token: 'a' },
      { x: 1, y: 0, z: 1, token: 'b' },
    ]);
    const parsed = json2Voxels({ json });
    const built = voxels2Scene({
      voxels: parsed.voxels,
      tokens: parsed.tokens,
      name: 'Tower',
      groupBy: 'z',
    });
    expect(built.error).toBeUndefined();
    expect(built.nodeCount).toBe(2);
    const root = readNode(built.scene!.tree, '/Tower');
    expect(root!.children.map((c) => c.name).sort()).toEqual(['z0', 'z1']);
  });

  it('projects to full 4m-per-storey z range', () => {
    const parsed = json2Voxels({ json: EXAMPLE_VOXEL_BUILDING_JSON });
    const built = voxels2Scene({
      nodes: parsed.nodes,
      root: parsed.root,
      schema: parsed.schema,
    });
    const { layers } = projectSceneToVoxelLayers(built.scene!.tree, '/CityBlock');
    const zLevels = new Set(layers.flatMap((l) => l.cells.map((c) => c.z)));
    for (const z of [0, 1, 2, 3, 4, 7, 8, 11, 12, 14]) {
      expect(zLevels.has(z)).toBe(true);
    }
  });
});
