/**
 * Architecture 程序化布局助手（纯计算，无几何依赖）。
 *
 * 把一个矩形 footprint 递归二分（BSP）切成若干房间矩形，供 `g_building_shell`
 * 的"程序化"模式消费；"显式" spec 模式直接跳过本模块（调用方自带房间矩形）。
 *
 * 坐标系：footprint 关于原点居中，单位 = 米。返回的每个房间用中心坐标
 * `{ x, y, w, d }` 描述（x/y = 房间中心，w/d = 房间在 X/Y 的边长）。
 *
 * 确定性：用一个内置 LCG（seed 可控）做切分比例与方向抖动，使同一组参数
 * 永远得到同一布局（电池预览、单测可复现）。
 */

/** 房间矩形（中心坐标）。 */
export interface RoomRect {
  /** 房间中心 X（相对 footprint 中点） */
  x: number;
  /** 房间中心 Y */
  y: number;
  /** 房间 X 向边长 */
  w: number;
  /** 房间 Y 向边长 */
  d: number;
}

export interface LayoutOptions {
  /** 目标房间数（>=1）；达到即停止切分。默认 4。 */
  roomCount?: number;
  /** 房间最小边长（米）；切出的子块若小于它则不再切。默认 2。 */
  minRoom?: number;
  /** RNG 种子，控制切分比例 / 方向抖动。默认 1。 */
  seed?: number;
  /** 切分比例抖动幅度（0..0.4），0 = 总是对半切。默认 0.15。 */
  jitter?: number;
}

/** 极简确定性 LCG（与 Numerical Recipes 同参）。 */
function makeRng(seed: number): () => number {
  let s = (Math.floor(seed) >>> 0) || 1;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/**
 * 把 footprint 递归二分成 ~roomCount 个房间矩形。
 *
 * 策略：维护一个矩形列表，每轮挑面积最大的矩形，沿其较长边切一刀
 * （比例 = 0.5 ± jitter），直到达到目标房间数或无法再切（子块 < minRoom）。
 */
export function subdivideFootprint(
  footprint: { w: number; d: number },
  opts: LayoutOptions = {},
): RoomRect[] {
  const { w, d } = footprint;
  if (!(w > 0) || !(d > 0)) {
    throw new Error('subdivideFootprint: footprint w and d must be positive');
  }
  const roomCount = Math.max(1, Math.floor(opts.roomCount ?? 4));
  const minRoom = Math.max(0.1, opts.minRoom ?? 2);
  const jitter = Math.min(0.4, Math.max(0, opts.jitter ?? 0.15));
  const rng = makeRng(opts.seed ?? 1);

  const rooms: RoomRect[] = [{ x: 0, y: 0, w, d }];

  while (rooms.length < roomCount) {
    // 挑面积最大且可切的矩形
    let bestIdx = -1;
    let bestArea = -Infinity;
    for (let i = 0; i < rooms.length; i++) {
      const r = rooms[i];
      const splittable = r.w >= 2 * minRoom || r.d >= 2 * minRoom;
      if (splittable && r.w * r.d > bestArea) {
        bestArea = r.w * r.d;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break; // 没有可切的矩形

    const r = rooms[bestIdx];
    const splitX = r.w >= r.d ? r.w >= 2 * minRoom : r.d < 2 * minRoom;
    const ratio = 0.5 + (rng() - 0.5) * 2 * jitter; // 0.5 ± jitter

    if (splitX && r.w >= 2 * minRoom) {
      // 沿 X 切：两个左右块
      let aw = r.w * ratio;
      aw = Math.min(r.w - minRoom, Math.max(minRoom, aw));
      const bw = r.w - aw;
      rooms.splice(bestIdx, 1,
        { x: r.x - r.w / 2 + aw / 2, y: r.y, w: aw, d: r.d },
        { x: r.x + r.w / 2 - bw / 2, y: r.y, w: bw, d: r.d },
      );
    } else if (r.d >= 2 * minRoom) {
      // 沿 Y 切：两个上下块
      let ad = r.d * ratio;
      ad = Math.min(r.d - minRoom, Math.max(minRoom, ad));
      const bd = r.d - ad;
      rooms.splice(bestIdx, 1,
        { x: r.x, y: r.y - r.d / 2 + ad / 2, w: r.w, d: ad },
        { x: r.x, y: r.y + r.d / 2 - bd / 2, w: r.w, d: bd },
      );
    } else {
      break;
    }
  }

  return rooms;
}

/** 一段墙（中心坐标 + 朝向）：供生成器把房间矩形展开成 4 面墙。 */
export interface WallSeg {
  /** 墙中心 X */
  cx: number;
  /** 墙中心 Y */
  cy: number;
  /** 墙长（沿其走向） */
  length: number;
  /** 走向：'x' = 沿 X，'y' = 沿 Y（需绕 Z 旋转 90°） */
  axis: 'x' | 'y';
}

/**
 * 把一个房间矩形展开成 4 段墙（中心线）。生成器据此发出 wall shape + part +
 * fixed joint。沿 Y 的墙在装配时绕 Z 旋转 90°。
 *
 * `thickness > 0` 时，沿 Y 的两面墙（西/东）各端内缩 thickness，使其在墙角处
 * 与沿 X 的两面墙（南/北）对接而非互相穿插 —— 否则四个墙角会各自重叠一个
 * thickness×thickness 的体积（g_geometry_qc 会判为 aabb_overlap，且实体建模里
 * 是冗余料）。南/北墙保持满宽，墙角由它们覆盖，房间仍然闭合。
 */
export function roomToWalls(room: RoomRect, thickness = 0): WallSeg[] {
  const { x, y, w, d } = room;
  const t = Math.max(0, thickness);
  // 内缩后仍需为正；房间过小则退化为不内缩（宁可重叠也不产生零长墙）。
  const yLen = d - 2 * t > 1e-6 ? d - 2 * t : d;
  return [
    { cx: x, cy: y - d / 2, length: w, axis: 'x' },     // 南（满宽）
    { cx: x, cy: y + d / 2, length: w, axis: 'x' },     // 北（满宽）
    { cx: x - w / 2, cy: y, length: yLen, axis: 'y' },  // 西（内缩）
    { cx: x + w / 2, cy: y, length: yLen, axis: 'y' },  // 东（内缩）
  ];
}
