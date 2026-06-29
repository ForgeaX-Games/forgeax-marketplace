/**
 * g_door —— 追加门框 + 独立门扇两条 shape。
 *
 *   `<id>      = door_frame(size=[w,h], depth, frame)`
 *   `<id>_leaf = door_leaf(size=[leaf_w,leaf_h], thickness, hinge)`
 *
 * 门扇作为**独立 shape** 发出（不在 baker 里融进门框），这样生成器可以选择把它
 * 用 `g_joint_revolute`（可开）或 `g_joint_fixed`（静态）连到门框 / 墙上。
 */

import {
  emit,
  freshId,
  isValidId,
  makeGeometry,
  num,
  numList,
  parseGeometryPort,
  str,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

export function gDoor(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const w = Number(input.width ?? 0.9);
  const h = Number(input.height ?? 2.1);
  const depth = Number(input.depth ?? 0.2);
  if (![w, h, depth].every(Number.isFinite) || w <= 0 || h <= 0 || depth <= 0) {
    return { geometry: incoming, id: '', error: 'door: width, height, depth must be positive finite numbers' };
  }
  const frame = (() => {
    const f = Number(input.frame ?? Math.min(w * 0.1, 0.08));
    return Number.isFinite(f) && f > 0 ? f : Math.min(w * 0.1, 0.08);
  })();
  const leafT = (() => {
    const t = Number(input.leaf_thickness ?? 0.045);
    return Number.isFinite(t) && t > 0 ? t : 0.045;
  })();
  const hinge = String(input.hinge ?? 'left').trim().toLowerCase() === 'right' ? 'right' : 'left';
  const leaves = Math.round(Number(input.leaves ?? 1)) === 2 ? 2 : 1;
  const VALID_STYLE = new Set(['flush', 'panel', 'glazed']);
  const style = String(input.style ?? 'flush').trim().toLowerCase();
  if (!VALID_STYLE.has(style)) {
    return { geometry: incoming, id: '', error: `door: style must be flush/panel/glazed, got "${style}"` };
  }

  if (frame * 2 >= w) {
    return { geometry: incoming, id: '', error: 'door: frame must be < half of width' };
  }

  const rawId = String(input.id ?? '').trim();
  const frameId = rawId !== '' ? rawId : freshId(incoming, 'door');
  if (!isValidId(frameId)) return { geometry: incoming, id: '', error: `invalid id "${frameId}"` };

  const gap = 0.01;
  const clearW = w - 2 * frame;
  const leafH = Math.max(0.1, h - frame - gap);

  let geom = emit(incoming, frameId, 'door_frame', {
    size: numList([w, h]),
    depth: num(depth),
    frame: num(frame),
  } satisfies Record<string, Arg>);

  // 门扇：单扇 = 一块；双扇 = 两块对开（铰接边各在两侧，合起来填满洞口）。
  const leafIds: string[] = [];
  const emitLeaf = (suffix: string, leafW: number, lhinge: string): string | null => {
    const id = `${frameId}_${suffix}`;
    if (!isValidId(id)) return null;
    geom = emit(geom, id, 'door_leaf', {
      size: numList([Math.max(0.1, leafW), leafH]),
      thickness: num(leafT),
      hinge: str(lhinge),
      style: str(style),
    } satisfies Record<string, Arg>);
    leafIds.push(id);
    return id;
  };

  if (leaves === 2) {
    const leafW = Math.max(0.1, (clearW - gap) / 2);
    if (emitLeaf('leaf_l', leafW, 'right') === null || emitLeaf('leaf_r', leafW, 'left') === null) {
      return { geometry: incoming, id: '', error: 'door: invalid leaf id' };
    }
  } else {
    if (emitLeaf('leaf', clearW - gap, hinge) === null) {
      return { geometry: incoming, id: '', error: 'door: invalid leaf id' };
    }
  }

  return {
    geometry: geom,
    id: frameId,
    frame_id: frameId,
    leaf_id: leafIds[0],
    leaf_ids: leafIds,
    leaves,
    style,
    openable: input.openable === undefined ? true : Boolean(input.openable),
  };
}

export default gDoor;
