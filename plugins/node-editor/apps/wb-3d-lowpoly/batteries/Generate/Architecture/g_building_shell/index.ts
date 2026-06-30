/**
 * g_building_shell —— 大编排器：把 footprint + 层数 + 每层房间布局 展开成一整栋
 * 多层建筑外壳（各层楼板、内/外墙、楼梯 + 楼板开井、屋顶），全部包成 `part` 并用
 * `joint(type="fixed")` 挂在**单一根 part**（地面层楼板）下，从一个电池节点产出
 * 完整 URDF 子树。
 *
 * 布局双模式：
 *   - **显式**：`rooms` 给定 JSON（每项 [x,y,w,d]，房间中心 + 边长，相对 footprint
 *     中点）→ 直接用它，跳过程序化分割。
 *   - **程序化**：用 `subdivideFootprint`（递归二分 / BSP，来自共享 arch-layout）
 *     按 `rooms_per_floor` / `seed` / `min_room` 生成房间矩形。
 */

import {
  emit,
  freshId,
  isValidId,
  makeGeometry,
  num,
  numList,
  parseGeometryPort,
  ref,
  roomToWalls,
  str,
  subdivideFootprint,
  type Arg,
  type RoomRect,
} from '../../../../vendor/dist/shared/types/index.js';

const VALID_ROOF = new Set(['flat', 'shed', 'gable', 'hip', 'gambrel', 'mansard', 'pyramid', 'none']);

function parseRooms(value: unknown): RoomRect[] | { error: string } | null {
  if (value === undefined || value === null || value === '') return null;
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { return { error: 'rooms must be valid JSON, e.g. [[0,0,4,3]]' }; }
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return { error: 'rooms must be a non-empty array of [x,y,w,d]' };
  const out: RoomRect[] = [];
  for (const row of parsed) {
    if (!Array.isArray(row) || row.length !== 4 || !row.every(n => Number.isFinite(Number(n)))) {
      return { error: 'each room must be [x, y, w, d] of 4 finite numbers' };
    }
    out.push({ x: Number(row[0]), y: Number(row[1]), w: Number(row[2]), d: Number(row[3]) });
  }
  return out;
}

export function gBuildingShell(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const fw = Number(input.footprint_w ?? 12);
  const fd = Number(input.footprint_d ?? 8);
  const floors = Math.round(Number(input.floors ?? 2));
  const wallH = Number(input.wall_height ?? 2.8);
  const wallT = Number(input.wall_thickness ?? 0.2);
  const floorT = Number(input.floor_thickness ?? 0.2);
  const seed = Number(input.seed ?? 1);
  const minRoom = Number(input.min_room ?? 2);
  const roomsPerFloor = Math.round(Number(input.rooms_per_floor ?? 3));
  const stairwell = input.stairwell === undefined ? true : Boolean(input.stairwell);
  const roofType = String(input.roof_type ?? 'gable').trim().toLowerCase();
  const roofHeight = Number(input.roof_height ?? 2);
  const roofOverhang = Number(input.roof_overhang ?? 0.4);

  if (![fw, fd, wallH, wallT, floorT].every(Number.isFinite) || fw <= 0 || fd <= 0 || wallH <= 0 || wallT <= 0 || floorT <= 0) {
    return { geometry: incoming, id: '', error: 'building_shell: footprint, wall_height, thickness must be positive finite numbers' };
  }
  if (!Number.isFinite(floors) || floors < 1) {
    return { geometry: incoming, id: '', error: 'building_shell: floors must be >= 1' };
  }
  if (!VALID_ROOF.has(roofType)) {
    return { geometry: incoming, id: '', error: `building_shell: roof_type must be one of flat/shed/gable/hip/gambrel/mansard/pyramid/none, got "${roofType}"` };
  }

  const explicit = parseRooms(input.rooms);
  if (explicit && !Array.isArray(explicit)) return { geometry: incoming, id: '', error: explicit.error };

  const rawId = String(input.id ?? '').trim();
  const base = rawId !== '' ? rawId : freshId(incoming, 'bldg');
  if (!isValidId(base)) return { geometry: incoming, id: '', error: `invalid id "${base}"` };

  const rooms: RoomRect[] = explicit ?? subdivideFootprint({ w: fw, d: fd }, {
    roomCount: Math.max(1, roomsPerFloor), minRoom: Math.max(0.5, minRoom), seed,
  });

  const storeyH = wallH + floorT;
  let g = incoming;

  // ── 根 part = 地面层楼板（无 joint，作为单一树根） ──
  const rootSlabId = `${base}_slab0`;
  const rootPartId = `${base}_root`;
  g = emit(g, rootSlabId, 'floor_slab', { size: numList([fw, fd]), thickness: num(floorT) });
  g = emit(g, rootPartId, 'part', { shape: ref(rootSlabId) });

  // ── 楼梯 + 楼梯井（全楼一致，先算一次；楼板开井与楼梯落位共用同一组坐标） ──
  // stairs mesh 局部坐标从 x=0 沿 +x 方向爬升，水平投影长度 = step_count × run，
  // 远大于一个房间/角落；若随便丢在 footprint 边角会戳出墙外（"飞出去的楼梯"）。
  // 策略：让楼梯顶端贴近 +x 内墙，整跑向 -x 回退，保证全段都在 footprint 内；
  // 上层楼板在楼梯顶端正上方开井，对齐出入口。
  const stairRun = 0.28;
  const stairStepCount = Math.max(2, Math.round(storeyH / 0.18));
  const stairRunLen = stairStepCount * stairRun;
  const stairWidth = Math.min(1.2, Math.max(0.6, Math.min(fw, fd) * 0.18));
  const innerMaxX = fw / 2 - wallT;
  const innerMinX = -fw / 2 + wallT;
  const innerMinY = -fd / 2 + wallT;
  // 顶端锚在 +x 内墙处，底端 = 顶端 - 整跑长度；clamp 到 -x 内墙，极端小楼也尽量不戳出。
  const stairBaseX = Math.max(innerMinX, innerMaxX - stairRunLen);
  const stairTopX = stairBaseX + stairRunLen;
  const stairY = innerMinY + stairWidth / 2 + 0.1;
  // 楼板开井：取楼梯顶端一段（避免上楼撞头），中心相对 footprint 中点。
  const wellOpenLen = Math.min(stairRunLen, Math.max(1.2, stairRunLen * 0.5));
  const wellHoleX = stairTopX - wellOpenLen / 2;
  const wellHoleY = stairY;
  const wellHoleW = wellOpenLen;
  const wellHoleD = stairWidth + 0.3;

  const emitWalls = (floorIdx: number, baseZ: number) => {
    const floorTopZ = baseZ + floorT;
    // 相邻房间（BSP 切出）会在共享边界各自产一面墙 → 两面墙完全重合（冗余料 +
    // g_geometry_qc 判 aabb_overlap）。按几何键去重，每条唯一墙线只发一次。
    const seen = new Set<string>();
    let wIdx = 0;
    const k = (n: number) => Math.round(n * 1000) / 1000;
    rooms.forEach((room) => {
      roomToWalls(room, wallT).forEach((seg) => {
        const key = `${seg.axis}:${k(seg.cx)}:${k(seg.cy)}:${k(seg.length)}`;
        if (seen.has(key)) return;
        seen.add(key);
        const wid = `${base}_f${floorIdx}_w${wIdx++}`;
        const wpid = `${wid}_p`;
        const wjid = `${wid}_j`;
        g = emit(g, wid, 'wall', { length: num(seg.length), height: num(wallH), thickness: num(wallT) });
        g = emit(g, wpid, 'part', { shape: ref(wid) });
        const yaw = seg.axis === 'y' ? Math.PI / 2 : 0;
        g = emit(g, wjid, 'joint', {
          type: str('fixed'), parent: ref(rootPartId), child: ref(wpid),
          origin: numList([seg.cx, seg.cy, floorTopZ]), rpy: numList([0, 0, yaw]),
        } satisfies Record<string, Arg>);
      });
    });
  };

  for (let f = 0; f < floors; f++) {
    const baseZ = f * storeyH;

    // 上层楼板（f>0）：footprint slab + 可选楼梯井开洞
    if (f > 0) {
      const slabId = `${base}_slab${f}`;
      const slabPartId = `${base}_slab${f}_p`;
      const slabArgs: Record<string, Arg> = { size: numList([fw, fd]), thickness: num(floorT) };
      if (stairwell && floors > 1) slabArgs.holes = list4(wellHoleX, wellHoleY, wellHoleW, wellHoleD);
      g = emit(g, slabId, 'floor_slab', slabArgs);
      g = emit(g, slabPartId, 'part', { shape: ref(slabId) });
      g = emit(g, `${base}_slab${f}_j`, 'joint', {
        type: str('fixed'), parent: ref(rootPartId), child: ref(slabPartId),
        origin: numList([0, 0, baseZ]),
      } satisfies Record<string, Arg>);
    }

    emitWalls(f, baseZ);

    // 楼梯：连接本层与上一层（f>=1 时，从下层爬到本层）。沿 +x 爬升，整跑落在 footprint 内。
    if (stairwell && f >= 1) {
      const stId = `${base}_stair${f}`;
      const stPartId = `${stId}_p`;
      g = emit(g, stId, 'stairs', {
        total_rise: num(storeyH), run: num(stairRun), width: num(stairWidth),
        step_count: num(stairStepCount),
      });
      g = emit(g, stPartId, 'part', { shape: ref(stId) });
      g = emit(g, `${stId}_j`, 'joint', {
        type: str('fixed'), parent: ref(rootPartId), child: ref(stPartId),
        origin: numList([stairBaseX, stairY, (f - 1) * storeyH + floorT]),
      } satisfies Record<string, Arg>);
    }
  }

  // ── 屋顶 ──
  if (roofType !== 'none') {
    const roofId = `${base}_roof`;
    const roofPartId = `${roofId}_p`;
    const roofArgs: Record<string, Arg> = {
      footprint: numList([fw, fd]), type: str(roofType),
    };
    if (Number.isFinite(roofOverhang) && roofOverhang > 0) roofArgs.overhang = num(roofOverhang);
    if (roofType === 'flat') roofArgs.thickness = num(floorT);
    else roofArgs.height = num(Number.isFinite(roofHeight) && roofHeight > 0 ? roofHeight : 2);
    g = emit(g, roofId, 'roof', roofArgs);
    g = emit(g, roofPartId, 'part', { shape: ref(roofId) });
    g = emit(g, `${roofId}_j`, 'joint', {
      type: str('fixed'), parent: ref(rootPartId), child: ref(roofPartId),
      origin: numList([0, 0, floors * storeyH]),
    } satisfies Record<string, Arg>);
  }

  return { geometry: g, id: base, root_id: rootPartId };
}

/** [[x,y,w,d]] 单洞列表，便于楼板开井。 */
function list4(x: number, y: number, w: number, d: number): Arg {
  return { kind: 'list', items: [numList([x, y, w, d])] } as Arg;
}

export default gBuildingShell;
