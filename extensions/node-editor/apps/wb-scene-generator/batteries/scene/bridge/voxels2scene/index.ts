/**
 * voxels2scene — 由体素坐标列表构造 scene 树（单节点或多层子节点）。
 *
 * 模式：
 *   - nodes[]：按 JSON 分层描述，每个 node 一个子节点（推荐多层建筑）
 *   - groupBy=z|token：自动按 z 层或 token 分组
 *   - 默认：全部体素写入单个节点 name
 */

import {
  emptyTree,
  makeScenePort,
  readNode,
  upsertCells,
  type SceneNodeSnapshot,
  type ScenePortValue,
  type VoxelCell,
} from '../../../../vendor/dist/shared/types/index.js';
import {
  computeBounds,
  normalizeNodePath,
  parseVoxelCell,
  type ParsedVoxelCell,
  type ParsedVoxelNode,
} from '../json2voxels/parse.ts';

type GroupBy = 'none' | 'z' | 'token';

interface Voxels2SceneResult {
  scene?: ScenePortValue;
  voxelCount: number;
  nodeCount: number;
  error?: string;
}

function sanitizeName(raw: unknown, fallback: string): string {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name) return fallback;
  if (name.includes('/')) return fallback;
  return name;
}

function parseVoxelList(raw: unknown, defaultToken: string): ParsedVoxelCell[] {
  if (!Array.isArray(raw)) return [];
  const out: ParsedVoxelCell[] = [];
  for (const item of raw) {
    const cell = parseVoxelCell(item, defaultToken);
    if (cell) out.push(cell);
  }
  return out;
}

function parseTokenList(raw: unknown, count: number, defaultToken: string): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return new Array(count).fill(defaultToken);
  }
  return Array.from({ length: count }, (_, i) => {
    const t = raw[i];
    return typeof t === 'string' && t.trim() ? t.trim() : defaultToken;
  });
}

function attachTokens(cells: ParsedVoxelCell[], tokens: string[], defaultToken: string): VoxelCell[] {
  return cells.map((c, i) => ({
    x: c.x,
    y: c.y,
    z: c.z,
    token: tokens[i] ?? c.token ?? defaultToken,
  }));
}

function upsertNode(
  tree: SceneNodeSnapshot,
  path: string,
  schema: string,
  cells: readonly VoxelCell[],
  version: number,
): SceneNodeSnapshot {
  const bounds = computeBounds(cells);
  return upsertCells(tree, path, { schema, cells, bounds }, version);
}

function parseNodesInput(raw: unknown, defaultToken: string): ParsedVoxelNode[] {
  if (!Array.isArray(raw)) return [];
  const out: ParsedVoxelNode[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    // Allow nested "district/building" names to build a hierarchical tree.
    const name = normalizeNodePath(rec.name);
    if (!name) continue;
    const cells = parseVoxelList(rec.cells ?? rec.voxels, defaultToken);
    if (cells.length === 0) continue;
    out.push({ name, cells });
  }
  return out;
}

function groupCells(
  cells: ParsedVoxelCell[],
  tokens: string[],
  groupBy: GroupBy,
): ParsedVoxelNode[] {
  if (groupBy === 'none') {
    return [{ name: 'Voxels', cells }];
  }

  const buckets = new Map<string, ParsedVoxelCell[]>();
  for (let i = 0; i < cells.length; i += 1) {
    const c = cells[i];
    const key = groupBy === 'z' ? `z${c.z}` : (tokens[i] ?? c.token ?? 'cell');
    const list = buckets.get(key) ?? [];
    list.push(c);
    buckets.set(key, list);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, bucketCells]) => ({ name, cells: bucketCells }));
}

function buildSceneFromNodes(
  nodeSpecs: ParsedVoxelNode[],
  rootName: string,
  schema: string,
  defaultToken: string,
  tokens?: string[],
): Voxels2SceneResult {
  if (nodeSpecs.length === 0) {
    return { voxelCount: 0, nodeCount: 0, error: 'no voxels to write' };
  }

  let tree = emptyTree();
  let version = 1;
  let total = 0;

  if (nodeSpecs.length === 1 && nodeSpecs[0].name === rootName) {
    const only = nodeSpecs[0];
    const voxelCells = attachTokens(only.cells, tokens ?? only.cells.map((c) => c.token), defaultToken);
    total = voxelCells.length;
    tree = upsertNode(tree, `/${rootName}`, schema, voxelCells, version);
    return {
      scene: makeScenePort(tree, `/${rootName}`),
      voxelCount: total,
      nodeCount: 1,
    };
  }

  for (const spec of nodeSpecs) {
    // spec.name may be nested ("district/building"); upsertCells auto-creates
    // any missing intermediate group nodes as empty containers.
    const childPath = `/${rootName}/${spec.name}`;
    if (readNode(tree, childPath) !== null) {
      return { voxelCount: 0, nodeCount: 0, error: `duplicate node name "${spec.name}"` };
    }
    const voxelCells = attachTokens(spec.cells, spec.cells.map((c) => c.token), defaultToken);
    version += 1;
    try {
      tree = upsertNode(tree, childPath, schema, voxelCells, version);
    } catch (err) {
      return {
        voxelCount: 0,
        nodeCount: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
    total += voxelCells.length;
  }

  return {
    scene: makeScenePort(tree, `/${rootName}`),
    voxelCount: total,
    nodeCount: nodeSpecs.length,
  };
}

export function voxels2Scene(input: Record<string, unknown>): Voxels2SceneResult {
  const schema = typeof input.schema === 'string' && input.schema.trim()
    ? input.schema.trim()
    : 'voxel-mass';
  const defaultToken = typeof input.token === 'string' && input.token.trim()
    ? input.token.trim()
    : 'cell';
  const rootName = sanitizeName(input.root ?? input.name, 'Voxels');

  const structuredNodes = parseNodesInput(input.nodes, defaultToken);
  if (structuredNodes.length > 0) {
    return buildSceneFromNodes(structuredNodes, rootName, schema, defaultToken);
  }

  const cells = parseVoxelList(input.voxels, defaultToken);
  if (cells.length === 0) {
    return { voxelCount: 0, nodeCount: 0, error: 'voxels is required and must be a non-empty list' };
  }

  const tokens = parseTokenList(input.tokens, cells.length, defaultToken);
  const groupByRaw = typeof input.groupBy === 'string' ? input.groupBy.trim().toLowerCase() : 'none';
  const groupBy: GroupBy = groupByRaw === 'z' || groupByRaw === 'token' ? groupByRaw : 'none';

  const nodeSpecs = groupBy === 'none'
    ? [{ name: rootName, cells }]
    : groupCells(cells, tokens, groupBy).map((n) => ({
      ...n,
      name: groupBy === 'z' ? n.name : n.name,
    }));

  if (groupBy === 'none') {
    return buildSceneFromNodes(nodeSpecs, rootName, schema, defaultToken, tokens);
  }

  return buildSceneFromNodes(nodeSpecs, rootName, schema, defaultToken);
}

export default voxels2Scene;
