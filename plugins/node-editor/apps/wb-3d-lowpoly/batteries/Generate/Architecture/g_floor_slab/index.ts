/**
 * g_floor_slab —— 追加 `id = floor_slab(size=[w,d], thickness=..., holes=[[x,y,w,d],...])`。
 *
 * 矩形楼板，可选矩形洞（楼梯井 / 竖井）。holes 以 JSON 字符串传入。
 */

import {
  emit,
  freshId,
  isValidId,
  list,
  makeGeometry,
  num,
  numList,
  parseGeometryPort,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

/** 解析 holes 输入为 number[4][]。 */
export function parseHoles(value: unknown): number[][] | { error: string } {
  if (value === undefined || value === null || value === '') return [];
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { return { error: 'holes must be valid JSON, e.g. [[1,1,1.2,2.8]]' }; }
  }
  if (!Array.isArray(parsed)) return { error: 'holes must be an array of [x, y, w, d]' };
  const out: number[][] = [];
  for (const row of parsed) {
    if (!Array.isArray(row) || row.length !== 4 || !row.every(n => Number.isFinite(Number(n)))) {
      return { error: 'each hole must be [x, y, w, d] of 4 finite numbers' };
    }
    out.push(row.map(Number));
  }
  return out;
}

export function gFloorSlab(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const width = Number(input.width ?? 6);
  const depth = Number(input.depth ?? 4);
  const thickness = Number(input.thickness ?? 0.2);
  if (![width, depth, thickness].every(Number.isFinite) || width <= 0 || depth <= 0 || thickness <= 0) {
    return { geometry: incoming, id: '', error: 'floor_slab: width, depth, thickness must be positive finite numbers' };
  }

  const holes = parseHoles(input.holes);
  if (!Array.isArray(holes)) return { geometry: incoming, id: '', error: holes.error };

  const args: Record<string, Arg> = {
    size: numList([width, depth]),
    thickness: num(thickness),
  };
  if (holes.length > 0) args.holes = list(holes.map(h => numList(h)));

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'slab');
  if (!isValidId(id)) return { geometry: incoming, id: '', error: `invalid id "${id}"` };

  return { geometry: emit(incoming, id, 'floor_slab', args), id };
}

export default gFloorSlab;
