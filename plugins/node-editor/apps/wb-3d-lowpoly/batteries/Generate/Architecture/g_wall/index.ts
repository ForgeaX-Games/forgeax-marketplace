/**
 * g_wall —— 追加 `id = wall(length=..., height=..., thickness=..., openings=[[x,w,sill,head],...])`。
 *
 * 直墙段：拉伸盒减去 openings 列出的门/窗洞。openings 以 JSON 字符串传入
 * （每项 [x, width, sill, head]，单位米；x = 洞心相对墙中点的 X 偏移）。
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

/** 解析 openings 输入（JSON 字符串或已是数组）为 number[4][]。 */
export function parseOpenings(value: unknown): number[][] | { error: string } {
  if (value === undefined || value === null || value === '') return [];
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return { error: 'openings must be valid JSON, e.g. [[1,0.9,0,2.1]]' };
    }
  }
  if (!Array.isArray(parsed)) return { error: 'openings must be an array of [x, width, sill, head]' };
  const out: number[][] = [];
  for (const row of parsed) {
    if (!Array.isArray(row) || row.length !== 4 || !row.every(n => Number.isFinite(Number(n)))) {
      return { error: 'each opening must be [x, width, sill, head] of 4 finite numbers' };
    }
    out.push(row.map(Number));
  }
  return out;
}

export function gWall(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const length = Number(input.length ?? 4);
  const height = Number(input.height ?? 2.8);
  const thickness = Number(input.thickness ?? 0.2);
  if (![length, height, thickness].every(Number.isFinite) || length <= 0 || height <= 0 || thickness <= 0) {
    return { geometry: incoming, id: '', error: 'wall: length, height, thickness must be positive finite numbers' };
  }

  const openings = parseOpenings(input.openings);
  if (!Array.isArray(openings)) return { geometry: incoming, id: '', error: openings.error };

  const args: Record<string, Arg> = {
    length: num(length),
    height: num(height),
    thickness: num(thickness),
  };
  if (openings.length > 0) {
    args.openings = list(openings.map(o => numList(o)));
  }

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'wall');
  if (!isValidId(id)) return { geometry: incoming, id: '', error: `invalid id "${id}"` };

  return { geometry: emit(incoming, id, 'wall', args), id };
}

export default gWall;
