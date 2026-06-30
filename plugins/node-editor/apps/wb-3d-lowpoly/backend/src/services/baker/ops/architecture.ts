/**
 * Architecture 家族 —— 静态 low-poly 建筑元素的 baker builders。
 *
 * 设计与 panels.ts 同范式：薄板 / 盒体 + CSG 切孔，单位 = 米，Z 朝上。
 * 每个 op 产出单一 BakeableShape，由上层 part(shape=ref(...)) 消费，
 * 与 box/cylinder 在装配侧完全一致。
 *
 * 约定（让生成器拼装时可预测）：
 *   - 墙 / 楼板 / 楼梯 / 窗 / 门扇：X、Y 居中，底面落在 Z=0（楼面），
 *     这样把元素放到某一层只需 translateZ(layerBase)。
 *   - 屋顶：footprint 关于原点居中，底面 Z=0。
 *   - 开口列表 openings：嵌套 list，每项 [x, width, sill, head]
 *     —— x = 洞中心相对墙中点的 X 偏移，width = 洞宽，sill/head = 洞底/洞顶高度。
 */

import type { OpBuilder, BakeableShape, OpContext } from '../types.js';
import { BakerError } from '../errors.js';
import { csgCut, csgFuse } from '../csg_helpers.js';
import {
  boxFloor,
  centeredBox as boxCentered,
  drawingFromPoints,
  type ClosedDrawing,
} from '../op_helpers.js';
import { optionalNumber, optionalString, requireNumber, requireNumList } from '../arg_readers.js';
import type { Arg } from '../shared-types.js';

// ── 公共助手 ─────────────────────────────────────────────────────────

type SolidSketch = { extrude: (h: number) => BakeableShape };
type LoftSketch = { loftWith: (s: unknown[], cfg?: { ruled?: boolean }) => BakeableShape };

/** 把 shape 在 X/Y 居中、并把 Z 最小值落到 0（屋脊棱柱的拉伸方向因平面法向而异，统一兜底）。 */
function recenterXYToFloor(shape: BakeableShape): BakeableShape {
  // OCCT bbox 是手动管理内存的 WASM 对象 —— 读完即释放，避免泄漏。
  const bbox = shape.boundingBox;
  const [min, max] = bbox.bounds;
  const cx = (min[0] + max[0]) / 2;
  const cy = (min[1] + max[1]) / 2;
  const minZ = min[2];
  (bbox as { delete?: () => void }).delete?.();
  if (Math.abs(cx) < 1e-9 && Math.abs(cy) < 1e-9 && Math.abs(minZ) < 1e-9) return shape;
  return shape.translate(-cx, -cy, -minZ) as BakeableShape;
}

/** 读取 openings：嵌套 list，每项 [x, width, sill, head]（米）。 */
function readOpenings(args: Record<string, Arg>, op: string): Array<[number, number, number, number]> {
  const raw = args.openings;
  if (!raw) return [];
  if (raw.kind !== 'list') throw new BakerError(`${op}: openings must be a list of [x, width, sill, head]`);
  const out: Array<[number, number, number, number]> = [];
  for (const item of raw.items) {
    if (item.kind !== 'list') throw new BakerError(`${op}: each opening must be a list [x, width, sill, head]`);
    const nums: number[] = [];
    for (const n of item.items) {
      if (n.kind !== 'number' || !Number.isFinite(n.value)) {
        throw new BakerError(`${op}: opening values must be finite numbers`);
      }
      nums.push(n.value);
    }
    if (nums.length !== 4) throw new BakerError(`${op}: each opening must have exactly 4 numbers [x, width, sill, head]`);
    out.push([nums[0], nums[1], nums[2], nums[3]]);
  }
  return out;
}

/** 读取矩形洞列表 holes：嵌套 list，每项 [x, y, w, d]（米）。 */
function readRectHoles(args: Record<string, Arg>, op: string): Array<[number, number, number, number]> {
  const raw = args.holes;
  if (!raw) return [];
  if (raw.kind !== 'list') throw new BakerError(`${op}: holes must be a list of [x, y, w, d]`);
  const out: Array<[number, number, number, number]> = [];
  for (const item of raw.items) {
    if (item.kind !== 'list') throw new BakerError(`${op}: each hole must be a list [x, y, w, d]`);
    const nums: number[] = [];
    for (const n of item.items) {
      if (n.kind !== 'number' || !Number.isFinite(n.value)) {
        throw new BakerError(`${op}: hole values must be finite numbers`);
      }
      nums.push(n.value);
    }
    if (nums.length !== 4) throw new BakerError(`${op}: each hole must have exactly 4 numbers [x, y, w, d]`);
    out.push([nums[0], nums[1], nums[2], nums[3]]);
  }
  return out;
}

// ── wall ────────────────────────────────────────────────────────────
// 直墙段：length(X) × height(Z) × thickness(Y)，减去 openings 列出的门/窗洞。

export const wall: OpBuilder = (ctx, args) => {
  const length = requireNumber(args, 'length', 'wall');
  const height = requireNumber(args, 'height', 'wall');
  const thickness = requireNumber(args, 'thickness', 'wall');
  if (length <= 0 || height <= 0 || thickness <= 0) {
    throw new BakerError('wall: length, height and thickness must be positive');
  }

  let shape = boxFloor(ctx, length, thickness, height);

  const openings = readOpenings(args, 'wall');
  const eps = Math.max(thickness * 0.5, 0.01);
  for (const [x, w, sill, head] of openings) {
    const oh = head - sill;
    if (w <= 0 || oh <= 0) throw new BakerError('wall: opening width and (head - sill) must be positive');
    if (Math.abs(x) + w / 2 > length / 2 + 1e-9) {
      throw new BakerError(`wall: opening at x=${x} (width ${w}) exceeds wall length ${length}`);
    }
    if (sill < -1e-9 || head > height + 1e-9) {
      throw new BakerError(`wall: opening [sill=${sill}, head=${head}] exceeds wall height ${height}`);
    }
    // 切洞盒：X 居中、Z∈[0, oh]，平移到 (x, 0, sill)；Y 方向放宽以穿透整堵墙
    const cut = boxFloor(ctx, w, thickness + eps, oh).translate(x, 0, sill) as BakeableShape;
    shape = csgCut(shape, cut);
  }
  return shape;
};

// ── floor_slab ──────────────────────────────────────────────────────
// 矩形楼板：size=[w, d]，thickness(Z)，可选 holes（楼梯井 / 竖井）。

export const floorSlab: OpBuilder = (ctx, args) => {
  const [w, d] = requireNumList(args, 'size', 2, 'floor_slab');
  const thickness = requireNumber(args, 'thickness', 'floor_slab');
  if (w <= 0 || d <= 0 || thickness <= 0) {
    throw new BakerError('floor_slab: size and thickness must be positive');
  }

  let shape = boxFloor(ctx, w, d, thickness);

  const holes = readRectHoles(args, 'floor_slab');
  const eps = Math.max(thickness, 0.02);
  for (const [hx, hy, hw, hd] of holes) {
    if (hw <= 0 || hd <= 0) throw new BakerError('floor_slab: hole w and d must be positive');
    const cut = boxFloor(ctx, hw, hd, thickness + 2 * eps).translate(hx, hy, -eps) as BakeableShape;
    shape = csgCut(shape, cut);
  }
  return shape;
};

// ── stairs ──────────────────────────────────────────────────────────
// type=straight（默认）：直梯段，逐级叠高盒体融合（low-poly 实心楼梯）。
//   total_rise(Z 总高) / run(每级踏步进深 X) / width(Y) / step_count。
// type=spiral：螺旋梯，踏步绕中柱(Z)旋转盘升。
//   radius(外半径) / inner_radius(中柱半径) / sweep_deg(总旋转角)。

export const stairs: OpBuilder = (ctx, args) => {
  const totalRise = requireNumber(args, 'total_rise', 'stairs');
  const run = requireNumber(args, 'run', 'stairs');
  const width = requireNumber(args, 'width', 'stairs');
  const stepCount = Math.round(requireNumber(args, 'step_count', 'stairs'));
  const type = optionalString(args, 'type', 'straight');
  if (totalRise <= 0 || run <= 0 || width <= 0) {
    throw new BakerError('stairs: total_rise, run and width must be positive');
  }
  if (stepCount < 1) throw new BakerError('stairs: step_count must be >= 1');

  const riser = totalRise / stepCount;

  if (type === 'spiral') {
    const radius = optionalNumber(args, 'radius', Math.max(width, 1.0));
    const innerRadius = optionalNumber(args, 'inner_radius', Math.max(0.05, radius * 0.12));
    const sweepDeg = optionalNumber(args, 'sweep_deg', 270);
    if (radius <= 0 || innerRadius <= 0 || innerRadius >= radius) {
      throw new BakerError('stairs(spiral): need 0 < inner_radius < radius');
    }
    if (Math.abs(sweepDeg) < 1e-3) throw new BakerError('stairs(spiral): sweep_deg must be non-zero');
    const angStep = sweepDeg / stepCount;
    const angStepRad = (Math.abs(angStep) * Math.PI) / 180;
    const treadLen = radius - innerRadius;
    const midR = (radius + innerRadius) / 2;
    // 踏步切向宽度 ≈ 中半径处弦长，略放大保证相邻踏步咬合无缝。
    const treadDepth = Math.max(2 * midR * Math.sin(angStepRad / 2) * 1.05, run);
    // 中柱：贯穿全高。
    let shape = ctx.replicad.makeCylinder(innerRadius, totalRise, [0, 0, 0], [0, 0, 1]) as BakeableShape;
    for (let i = 0; i < stepCount; i++) {
      // 踏步盒：X∈[innerRadius, radius]、Y 居中、Z∈[0, riser]；先放到半径处，再绕 Z 旋转、抬升。
      const tread = boxFloor(ctx, treadLen, treadDepth, riser)
        .translate(innerRadius + treadLen / 2, 0, i * riser)
        .rotate(i * angStep, [0, 0, 0], [0, 0, 1]) as BakeableShape;
      shape = csgFuse(shape, tread);
    }
    return shape;
  }

  // 直梯：把锯齿截面（每级一个踢面+踏面）在 XZ 平面画成闭合多段线，沿 Y 拉伸成单一 shape。
  // 旧实现逐级累积叠高盒体（高度 = riser×(i+1)）再 csgFuse，OCCT 布尔会把它退化成实心斜块；
  // 改用拉伸的台阶截面后是干净的低面数台阶，且无布尔运算。
  const totalRun = run * stepCount;
  const profile: Array<readonly [number, number]> = [[0, 0]];
  for (let i = 0; i < stepCount; i++) {
    const z = riser * (i + 1);
    profile.push([i * run, z]);        // 踢面：竖直上升
    profile.push([(i + 1) * run, z]);  // 踏面：水平外伸
  }
  profile.push([totalRun, 0]);          // 沿背面竖直回到底面，闭合
  // X∈[0, totalRun]、Y 居中、Z∈[0, totalRise]（与旧直梯的原点约定一致）。
  const sketch = drawingFromPoints(ctx, profile).sketchOnPlane('XZ', -width / 2) as unknown as SolidSketch;
  return sketch.extrude(width);
};

// ── roof ────────────────────────────────────────────────────────────
// footprint=[w, d] 上的 flat / shed / gable / hip 屋顶。
// pitch/height 用 height 表达（屋脊相对底面的高度）；flat 用 thickness。

export const roof: OpBuilder = (ctx, args) => {
  const [w, d] = requireNumList(args, 'footprint', 2, 'roof');
  const type = optionalString(args, 'type', 'gable');
  // 默认出檐对齐 g_facade/g_roof 电池默认值（0.3），避免 DSL 省略 overhang 时与电池行为不一致。
  const overhang = optionalNumber(args, 'overhang', 0.3);
  if (w <= 0 || d <= 0) throw new BakerError('roof: footprint must be positive');
  if (overhang < 0) throw new BakerError('roof: overhang must be >= 0');

  const bw = w + 2 * overhang;
  const bd = d + 2 * overhang;

  if (type === 'flat') {
    const thickness = optionalNumber(args, 'thickness', 0.15);
    if (thickness <= 0) throw new BakerError('roof: flat thickness must be positive');
    return boxFloor(ctx, bw, bd, thickness);
  }

  const height = optionalNumber(args, 'height', Math.min(bw, bd) * 0.4);
  if (height <= 0) throw new BakerError('roof: height must be positive');

  if (type === 'gable') {
    const pts: Array<readonly [number, number]> = [
      [-bw / 2, 0], [bw / 2, 0], [0, height],
    ];
    const sketch = drawingFromPoints(ctx, pts).sketchOnPlane('XZ', -bd / 2) as unknown as SolidSketch;
    return recenterXYToFloor(sketch.extrude(bd));
  }

  if (type === 'shed') {
    const pts: Array<readonly [number, number]> = [
      [-bw / 2, 0], [bw / 2, 0], [bw / 2, height], [-bw / 2, Math.max(height * 0.001, 0)],
    ];
    const sketch = drawingFromPoints(ctx, pts).sketchOnPlane('XZ', -bd / 2) as unknown as SolidSketch;
    return recenterXYToFloor(sketch.extrude(bd));
  }

  if (type === 'gambrel') {
    // 谷仓式：每侧两段坡（下陡上缓），对称 5 点截面，沿 Y 拉伸。
    const kneeH = height * 0.55;
    const kneeX = bw * 0.32;
    const pts: Array<readonly [number, number]> = [
      [-bw / 2, 0], [bw / 2, 0], [kneeX, kneeH], [0, height], [-kneeX, kneeH],
    ];
    const sketch = drawingFromPoints(ctx, pts).sketchOnPlane('XZ', -bd / 2) as unknown as SolidSketch;
    return recenterXYToFloor(sketch.extrude(bd));
  }

  const rectAt = (rw: number, rd: number, z: number) => {
    const r: Array<readonly [number, number]> = [
      [-rw / 2, -rd / 2], [rw / 2, -rd / 2], [rw / 2, rd / 2], [-rw / 2, rd / 2],
    ];
    return drawingFromPoints(ctx, r).sketchOnPlane('XY', z);
  };

  if (type === 'hip') {
    // 底面矩形 → 屋脊（沿 X 的短矩形）loft 成四坡。
    const ridgeLen = Math.max(bw - bd, bw * 0.25);
    const ridgeEps = Math.min(bd, bw) * 0.02 + 1e-4;
    const base = rectAt(bw, bd, 0) as unknown as LoftSketch;
    const ridge = rectAt(ridgeLen, 2 * ridgeEps, height);
    return recenterXYToFloor(base.loftWith([ridge], { ruled: true }));
  }

  if (type === 'pyramid') {
    // 四角攒尖：底面矩形 loft 到接近一点的极小矩形（顶点）。
    const apexEps = Math.min(bw, bd) * 0.01 + 1e-4;
    const base = rectAt(bw, bd, 0) as unknown as LoftSketch;
    const apex = rectAt(apexEps, apexEps, height);
    return recenterXYToFloor(base.loftWith([apex], { ruled: true }));
  }

  if (type === 'mansard') {
    // 法式四坡双折：底面 → 中部内收矩形（下段陡坡）→ 顶部更小矩形（上段缓坡）。
    const midH = height * 0.6;
    const base = rectAt(bw, bd, 0) as unknown as LoftSketch;
    const mid = rectAt(bw * 0.72, bd * 0.72, midH);
    const top = rectAt(bw * 0.5, bd * 0.5, height);
    return recenterXYToFloor(base.loftWith([mid, top], { ruled: true }));
  }

  throw new BakerError(`roof: unknown type "${type}" (expected flat/shed/gable/hip/gambrel/mansard/pyramid)`);
};

// ── facade_panel ────────────────────────────────────────────────────
// 外墙挂板 / siding：薄板 [w, h] × thickness(Z)，可选水平 reveal 凹槽阵列模拟板缝。

export const facadePanel: OpBuilder = (ctx, args) => {
  const [w, h] = requireNumList(args, 'panel_size', 2, 'facade_panel');
  const thickness = requireNumber(args, 'thickness', 'facade_panel');
  const grooveCount = Math.max(0, Math.round(optionalNumber(args, 'groove_count', 0)));
  const grooveDepth = optionalNumber(args, 'groove_depth', thickness * 0.4);
  const grooveWidth = optionalNumber(args, 'groove_width', Math.min(0.01, h * 0.05));
  if (w <= 0 || h <= 0 || thickness <= 0) {
    throw new BakerError('facade_panel: panel_size and thickness must be positive');
  }

  // 贴地约定（与墙/楼板一致）：底面落在 Z=0，Z∈[0, thickness]。
  let shape = boxFloor(ctx, w, h, thickness);

  if (grooveCount > 0) {
    if (grooveDepth <= 0 || grooveDepth >= thickness) {
      throw new BakerError('facade_panel: groove_depth must be in (0, thickness)');
    }
    if (grooveWidth <= 0) throw new BakerError('facade_panel: groove_width must be positive');
    // 在 h 方向均匀排 grooveCount 条横槽，切在 +Z 面（顶面 Z=thickness）
    const span = h - grooveWidth;
    for (let i = 1; i <= grooveCount; i++) {
      const y = -span / 2 + (span * i) / (grooveCount + 1);
      const groove = boxCentered(ctx, w + 0.002, grooveWidth, grooveDepth * 2)
        .translate(0, y, thickness) as BakeableShape;
      shape = csgCut(shape, groove);
    }
  }
  return shape;
};

// ── window ──────────────────────────────────────────────────────────
// 框 + 十字中梃 + 可选玻璃嵌片，融合为单一 shape。
// X = 宽、Z = 高（底面 Z=0）、Y = 进深（对齐墙厚）。

export const windowUnit: OpBuilder = (ctx, args) => {
  const [w, h] = requireNumList(args, 'size', 2, 'window');
  const depth = requireNumber(args, 'depth', 'window');
  const frame = optionalNumber(args, 'frame', Math.min(w, h) * 0.08);
  const mullion = optionalNumber(args, 'mullion', frame * 0.6);
  const glass = optionalNumber(args, 'glass', 0) > 0 ? optionalNumber(args, 'glass', 0) : 0;
  const type = optionalString(args, 'type', 'cross');
  if (w <= 0 || h <= 0 || depth <= 0) throw new BakerError('window: size and depth must be positive');
  if (frame <= 0 || frame * 2 >= Math.min(w, h)) {
    throw new BakerError('window: frame must be >0 and < half of min(size)');
  }

  // 外框 = 实心盒减去内洞
  let shape = boxFloor(ctx, w, depth, h);
  const eps = depth * 0.5 + 0.01;
  const iw = w - 2 * frame;        // 内洞宽
  const ih = h - 2 * frame;        // 内洞高
  const innerCut = boxFloor(ctx, iw, depth + eps, ih).translate(0, 0, frame) as BakeableShape;
  shape = csgCut(shape, innerCut);

  const bar = Math.max(mullion, 1e-3);
  if (type === 'louver') {
    // 百叶：内洞里均布水平薄板（含上下两端各半档），低面数实心板，不倾斜以保证可烘。
    const slatCount = Math.max(2, Math.round(optionalNumber(args, 'rows', 5)));
    const slatT = Math.min(ih / (slatCount + 1) * 0.8, ih / slatCount);
    for (let i = 0; i < slatCount; i++) {
      const cz = frame + (ih * (i + 0.5)) / slatCount;
      const slat = boxFloor(ctx, iw, depth * 0.7, slatT).translate(0, 0, cz - slatT / 2) as BakeableShape;
      shape = csgFuse(shape, slat);
    }
    return shape;
  }

  if (mullion > 0) {
    // cross = 2×2（1 竖 1 横）；grid = rows×cols 格栅。
    const cols = type === 'grid' ? Math.max(1, Math.round(optionalNumber(args, 'cols', 3))) : 2;
    const rows = type === 'grid' ? Math.max(1, Math.round(optionalNumber(args, 'rows', 3))) : 2;
    for (let c = 1; c < cols; c++) {
      const x = -iw / 2 + (iw * c) / cols;
      const vbar = boxFloor(ctx, bar, depth, ih).translate(x, 0, frame) as BakeableShape;
      shape = csgFuse(shape, vbar);
    }
    for (let r = 1; r < rows; r++) {
      const z = frame + (ih * r) / rows;
      const hbar = boxFloor(ctx, iw, depth, bar).translate(0, 0, z - bar / 2) as BakeableShape;
      shape = csgFuse(shape, hbar);
    }
  }

  // 可选玻璃薄片（同一 shape 内，便于单 part 预览）
  if (glass > 0) {
    if (glass >= depth) throw new BakerError('window: glass thickness must be < depth');
    const pane = boxFloor(ctx, iw, glass, ih).translate(0, 0, frame) as BakeableShape;
    shape = csgFuse(shape, pane);
  }
  return shape;
};

// ── door_frame ──────────────────────────────────────────────────────
// 三面门框（两侧门挺 + 上槛，底部开口），单一 shape。

export const doorFrame: OpBuilder = (ctx, args) => {
  const [w, h] = requireNumList(args, 'size', 2, 'door_frame');
  const depth = requireNumber(args, 'depth', 'door_frame');
  const frame = optionalNumber(args, 'frame', Math.min(w * 0.1, 0.08));
  if (w <= 0 || h <= 0 || depth <= 0) throw new BakerError('door_frame: size and depth must be positive');
  if (frame <= 0 || frame * 2 >= w) throw new BakerError('door_frame: frame must be >0 and < half of width');
  if (frame >= h) throw new BakerError('door_frame: frame must be < height');

  let shape = boxFloor(ctx, w, depth, h);
  const eps = depth * 0.5 + 0.01;
  // 切到底（含底面以下），留下两挺 + 上槛
  const innerCut = boxFloor(ctx, w - 2 * frame, depth + eps, h)
    .translate(0, 0, -eps) as BakeableShape;
  shape = csgCut(shape, innerCut);
  return shape;
};

// ── door_leaf ───────────────────────────────────────────────────────
// 门扇：单块板（独立 shape，便于生成器选 revolute 或 fixed 连接）。
// 局部坐标系把铰接边放在 X=0（hinge 侧），便于以 X 轴为转轴在生成器侧旋转。

export const doorLeaf: OpBuilder = (ctx, args) => {
  const [w, h] = requireNumList(args, 'size', 2, 'door_leaf');
  const thickness = requireNumber(args, 'thickness', 'door_leaf');
  const hinge = optionalString(args, 'hinge', 'center');
  const style = optionalString(args, 'style', 'flush');
  if (w <= 0 || h <= 0 || thickness <= 0) throw new BakerError('door_leaf: size and thickness must be positive');

  // 默认 X、Y 居中、Z∈[0, h]
  let shape = boxFloor(ctx, w, thickness, h);

  if (style === 'panel') {
    // 两段凹板：在前后两面各刻出上下两块浅凹槽（嵌板门）。
    const mx = w * 0.16;
    const mz = h * 0.08;
    const gap = h * 0.05;
    const panelW = Math.max(w - 2 * mx, w * 0.2);
    const panelH = Math.max((h - 2 * mz - gap) / 2, h * 0.1);
    const cutD = thickness * 0.3;
    const centers = [mz + panelH / 2, mz + panelH + gap + panelH / 2];
    for (const cz of centers) {
      for (const sign of [1, -1]) {
        const recess = boxFloor(ctx, panelW, cutD * 2, panelH)
          .translate(0, sign * (thickness / 2), cz - panelH / 2) as BakeableShape;
        shape = csgCut(shape, recess);
      }
    }
  } else if (style === 'glazed') {
    // 上半玻璃窗：在门扇上部挖通透洞口。
    const mx = w * 0.16;
    const holeW = Math.max(w - 2 * mx, w * 0.2);
    const holeBottom = h * 0.5;
    const holeH = h * 0.4;
    const eps = thickness * 0.5 + 0.01;
    const cut = boxFloor(ctx, holeW, thickness + eps, holeH)
      .translate(0, 0, holeBottom) as BakeableShape;
    shape = csgCut(shape, cut);
  }

  if (hinge === 'left') shape = shape.translate(w / 2, 0, 0) as BakeableShape;
  else if (hinge === 'right') shape = shape.translate(-w / 2, 0, 0) as BakeableShape;
  return shape;
};

// ── railing ─────────────────────────────────────────────────────────
// 栏杆 / 护栏：沿 X 的一段，两端方立柱 + 顶扶手 + 均布竖向栏杆条。
// length(X) × height(Z)，Y 居中（厚度由 post_size 决定）。可用于阳台、走廊、楼梯侧。

export const railing: OpBuilder = (ctx, args) => {
  const length = requireNumber(args, 'length', 'railing');
  const height = requireNumber(args, 'height', 'railing');
  if (length <= 0 || height <= 0) throw new BakerError('railing: length and height must be positive');
  const thickness = optionalNumber(args, 'thickness', 0.04);
  const postSize = optionalNumber(args, 'post_size', Math.max(thickness * 2.2, 0.08));
  const railH = optionalNumber(args, 'rail_height', Math.max(thickness * 1.5, 0.06));
  const balusters = Math.max(0, Math.round(
    optionalNumber(args, 'baluster_count', Math.max(2, Math.floor(length / 0.12))),
  ));
  if (thickness <= 0 || postSize <= 0 || railH <= 0) {
    throw new BakerError('railing: thickness / post_size / rail_height must be positive');
  }
  if (postSize >= length) throw new BakerError('railing: post_size must be < length');
  if (railH >= height) throw new BakerError('railing: rail_height must be < height');

  const railDepth = Math.max(thickness, postSize);
  // 顶扶手：贯通整段，置于顶部。
  let shape = boxFloor(ctx, length, railDepth, railH).translateZ(height - railH) as BakeableShape;
  // 两端方立柱（全高）。
  for (const sign of [-1, 1]) {
    const post = boxFloor(ctx, postSize, postSize, height)
      .translate(sign * (length / 2 - postSize / 2), 0, 0) as BakeableShape;
    shape = csgFuse(shape, post);
  }
  // 竖向栏杆条：两立柱之间均布，从底到扶手底。
  const innerL = length - 2 * postSize;
  const balH = Math.max(height - railH, height * 0.1);
  if (balusters > 0 && innerL > 0) {
    for (let i = 0; i < balusters; i++) {
      const x = -innerL / 2 + (innerL * (i + 0.5)) / balusters;
      const bal = boxFloor(ctx, thickness, thickness, balH).translate(x, 0, 0) as BakeableShape;
      shape = csgFuse(shape, bal);
    }
  }
  return shape;
};

// ── column ──────────────────────────────────────────────────────────
// 柱子 / 立柱：圆柱或方柱柱身 + 可选柱础(base)、柱头(capital) 方板。
// height(Z 总高)，X/Y 居中、底面 Z=0。base_height / capital_height = 0 表示无。

export const column: OpBuilder = (ctx, args) => {
  const height = requireNumber(args, 'height', 'column');
  const radius = optionalNumber(args, 'radius', 0.2);
  const shapeType = optionalString(args, 'shape', 'round');
  const baseH = Math.max(0, optionalNumber(args, 'base_height', 0));
  const capH = Math.max(0, optionalNumber(args, 'capital_height', 0));
  if (height <= 0 || radius <= 0) throw new BakerError('column: height and radius must be positive');
  const shaftH = height - baseH - capH;
  if (shaftH <= 0) throw new BakerError('column: base_height + capital_height must be < height');

  // 柱身
  let shape: BakeableShape;
  if (shapeType === 'square') {
    shape = boxFloor(ctx, 2 * radius, 2 * radius, shaftH).translateZ(baseH) as BakeableShape;
  } else {
    shape = ctx.replicad.makeCylinder(radius, shaftH, [0, 0, baseH], [0, 0, 1]) as BakeableShape;
  }
  const slabSize = radius * 2.6;
  if (baseH > 0) {
    const base = boxFloor(ctx, slabSize, slabSize, baseH) as BakeableShape;
    shape = csgFuse(shape, base);
  }
  if (capH > 0) {
    const cap = boxFloor(ctx, slabSize, slabSize, capH).translateZ(height - capH) as BakeableShape;
    shape = csgFuse(shape, cap);
  }
  return shape;
};
