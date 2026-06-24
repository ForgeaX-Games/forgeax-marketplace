/**
 * g_geometry_qc —— 静态几何质量检查（articraft geometry_qc 的轻量 TS 等价）。
 *
 * 这里只跑 4 项"在没有 mesh 烘焙、没有 fcl/trimesh"也能做的检查：
 *
 *   ① **连通分量 (islands)**
 *      把每个 `joint(parent, child)` 当无向边，跑一遍 union-find；
 *      孤岛（多个连通分量）= URDF 里多根树，运行时只渲染一棵 → 用户经常发现"零件没了"。
 *
 *   ② **shape AABB 解析失败 (missing_aabb)**
 *      每个 `part(shape=ref(...))` 沿引用链解析 → `localAabbFromShapeInGeometry`；
 *      返回 null = mesh 形状或未注册的 op，会让 placement / inertia / collision 三条
 *      下游能力同时失效，需要尽早暴露。
 *
 *   ③ **joint origin 距 part AABB 异常远**
 *      articraft 在 fcl 里用点-AABB 距离判断；这里走"point-AABB 距离"代数式：
 *      把 joint.origin 投到 parent / child AABB 上，超过 tol 就报告。
 *      其它分支（sphere / cylinder / mesh）走更精确的算法是 articraft 用 fcl 的
 *      原因；TS 端我们走 AABB 即可，对绝大多数 bug case 已经够诊断。
 *
 *   ④ **兄弟 part AABB rest-pose 重叠**
 *      把每个 part 的 AABB 用 part.origin / part.rpy 旋转到"父坐标系"，
 *      然后两两 AABB-vs-AABB depth 检测。articraft 里用 OBB SAT；
 *      这里采用"先把 AABB 用 origin 平移 + rpy=0 时直接比较"，rpy 非零时把
 *      AABB 八角点旋转后取重新包络（保守 AABB），保持算法简单且永远不漏报，
 *      只可能因为 rotated AABB 膨胀产生少量误报（注释里有说明）。
 *
 * 设计取舍：
 *   - 完全静态、纯几何，不需要 baker / fcl，可以在画布每次 tick 都跑
 *   - rest pose 检测；没有 articraft 的 pose-sampling，这是当前 TS 端能做的最大范围
 *   - 输出 multiline 字符串便于直接接到 g_validate 的展示链
 */

import {
  isGeometry,
  localAabbFromPart,
  type Arg,
  type Geometry,
  type LocalAABB,
  type Statement,
} from '../../../../vendor/dist/shared/types/index.js';

type Vec3 = [number, number, number];

/**
 * 「裸 primitive」shape op（Primitive 家族，mesh 除外 —— mesh 引用外部网格，
 * 视为已经是丰富几何，不应触发 primitive-only 提示）。
 */
const BARE_PRIMITIVE_OPS: ReadonlySet<string> = new Set([
  'box',
  'cylinder',
  'sphere',
  'cone',
  'capsule',
  'torus',
  'dome',
]);

/** 非 shape 的辅助语句 op（不参与"几何是否丰富"判断）。 */
const NON_SHAPE_AUX_OPS: ReadonlySet<string> = new Set([
  'material',
  'inertial',
  'collision',
  'part',
  'joint',
]);

/** 2D profile op（被 extrude / loft / lathe / part 等消费；自身不应孤立残留）。 */
const PROFILE_OPS: ReadonlySet<string> = new Set([
  'profile_rect',
  'profile_circle',
  'profile_polygon',
]);

/**
 * 2D sketch / profile op 全集（含圆角矩形 / 正多边形）。
 * profile 是 2D 截面、不是实体 shape，**不计入「几何丰富度」**——
 * 一段 profile 必须被 extrude/loft/revolve 消费后才产出真实建模。
 */
const SKETCH_OPS: ReadonlySet<string> = new Set([
  'profile_rect',
  'profile_circle',
  'profile_polygon',
  'profile_rounded_rect',
  'profile_regular_polygon',
]);

/** XY 语义（居中于原点）的 profile op —— 喂给 lathe/revolve 会被误读为 r,z。 */
const XY_PROFILE_OPS: ReadonlySet<string> = new Set([
  'profile_rect',
  'profile_circle',
  'profile_polygon',
]);

/** mesh-backed 曲线/曲面 op —— 不能作为布尔操作的操作数（baker 会抛错）。 */
const MESH_BACKED_OPS: ReadonlySet<string> = new Set([
  'pipe',
  'sweep',
  'section_loft',
]);

/** 单输入变换 op：解析布尔操作数 / profile 消费链时需要穿透。 */
const TRANSFORM_OPS: ReadonlySet<string> = new Set([
  'translate',
  'rotate',
  'scale',
  'mirror',
  'array_linear',
  'array_radial',
]);

const BOOLEAN_OPS: ReadonlySet<string> = new Set([
  'union',
  'difference',
  'intersection',
]);

type SignalSeverity = 'error' | 'warning' | 'note';

interface QcSignal {
  code: string;
  severity: SignalSeverity;
  message: string;
  ids?: string[];
}

interface PartAabbWorld {
  /** 父坐标系（geom 全局）下的 AABB */
  readonly aabb: LocalAABB;
  /** part.origin（缺省 [0,0,0]） */
  readonly origin: Vec3;
}

export function gGeometryQc(input: Record<string, unknown>): Record<string, unknown> {
  const geom = isGeometry(input.geometry) ? (input.geometry as Geometry) : null;
  if (!geom) {
    return {
      geometry: null,
      valid: false,
      report: 'no Geometry input',
      count: 1,
      islands: 0,
      missing_aabb: 0,
      overlaps: 0,
      primitive_only: false,
    };
  }

  const jointOriginTol = readPositiveNumber(input.joint_origin_tol, 0.05);
  const overlapTol = readPositiveNumber(input.overlap_tol, 0.001);
  const checkOverlaps = input.check_overlaps !== false; // 默认 true
  const allowPairs = readStringSet(input.allow_pairs);
  const allowJoints = readStringSet(input.allow_joints);

  const byId = new Map<string, Statement>();
  for (const s of geom.statements) byId.set(s.id, s);

  const parts: Statement[] = [];
  const joints: Statement[] = [];
  for (const s of geom.statements) {
    if (s.op === 'part') parts.push(s);
    else if (s.op === 'joint') joints.push(s);
  }

  const issues: string[] = [];
  // joint origin/距离启发式信号：对**可动**关节（revolute/prismatic/...）是致命错误
  // （origin 必须落在转轴/滑轴上，靠近父子件）；对**fixed** 关节降级为 note ——
  // 静态装配（如 g_building_shell 把屋顶/上层楼板用 fixed joint 以世界式偏移挂到
  // 单一根 slab）下，"子件远离父级 AABB" 是合法摆位而非 bug。
  const jointHeuristicSignals: QcSignal[] = [];
  // 静态全 fixed 装配（建筑外壳：墙在墙角/T 形接头按一个墙厚交叠、楼梯占楼梯井
  // 与楼板 AABB 交叠）在休止位的 AABB 互穿属于低模常态，非致命；仅当模型含可动
  // 关节（revolute/prismatic/...）时互穿才是真问题（运动碰撞）→ 那时才判致命。
  const overlapAdvisories: QcSignal[] = [];

  // ════════════════════════════════════════════════════════════════════
  // ① 连通分量（孤岛检测）
  // ════════════════════════════════════════════════════════════════════
  const partIds = parts.map(p => p.id);
  const islands = countIslands(partIds, joints);
  if (parts.length > 1 && islands > 1) {
    const components = listComponents(partIds, joints);
    issues.push(
      `islands: ${islands} disconnected component(s) — URDF requires a single root tree. ` +
        `components: ${components.map(c => `[${c.join(', ')}]`).join(' | ')}. ` +
        `add fixed/revolute joints to stitch them.`,
    );
  }

  // 正向运动学：沿 joint 树累计每个 part 的世界变换。生成器（g_building_shell）
  // 把元素摆位编码在 joint.origin 而非 part.origin —— 不做 FK
  // 会把所有 part 误判为堆在世界原点（假 aabb_overlap），并把"墙立在楼板上"
  // 误判为 joint 远离父级（假 joint_attaches_distant_child）。所有 joint 都在
  // 原点（摆位写在 part.origin）时 FK = 恒等，与旧行为逐字节一致（向后兼容）。
  const worldXform = computeWorldTransforms(parts, joints);

  // ════════════════════════════════════════════════════════════════════
  // ② AABB 解析（part → shape），并按 part.origin/rpy + joint-FK 摆到世界帧
  // ════════════════════════════════════════════════════════════════════
  const partAabbs = new Map<string, PartAabbWorld>();
  let missingAabb = 0;
  for (const part of parts) {
    const local = localAabbFromPart(part, byId);
    if (!local) {
      missingAabb++;
      const shapeRef = part.args.shape;
      const shapeName =
        shapeRef && shapeRef.kind === 'ref' ? shapeRef.name : '<no shape ref>';
      const shape = shapeRef && shapeRef.kind === 'ref' ? byId.get(shapeRef.name) : undefined;
      const opLabel = shape ? shape.op : '<unknown>';
      issues.push(
        `aabb_missing: part "${part.id}" → shape "${shapeName}" (op="${opLabel}") cannot be reduced to an AABB. ` +
          `mesh shapes / unregistered ops do not support placement / inertia / collision auto-derivation.`,
      );
      continue;
    }
    const origin = readVec3(part.args.origin) ?? [0, 0, 0];
    const rpy = readVec3(part.args.rpy) ?? [0, 0, 0];
    // 1) part.origin/rpy：visual 在 link 内的偏移；2) joint-FK：link 在世界中的位姿
    const linkLocal = transformAabbByOriginRpy(local, origin, rpy);
    const w = worldXform.get(part.id) ?? IDENTITY_XFORM;
    const world = transformAabbByMatOrigin(linkLocal, w.rot, w.origin);
    partAabbs.set(part.id, { aabb: world, origin });
  }

  // ════════════════════════════════════════════════════════════════════
  // ③ joint origin 距 parent / child AABB 异常远（在世界帧比较）
  // ════════════════════════════════════════════════════════════════════
  for (const j of joints) {
    if (allowJoints.has(j.id)) continue;
    const parentRef = j.args.parent;
    const childRef = j.args.child;
    if (
      !parentRef ||
      parentRef.kind !== 'ref' ||
      !childRef ||
      childRef.kind !== 'ref'
    ) {
      continue; // g_validate 已报；这里只关心几何
    }
    const parentBox = partAabbs.get(parentRef.name);
    const childBox = partAabbs.get(childRef.name);
    if (!parentBox || !childBox) continue;

    // fixed 关节：远离父级是合法摆位（静态装配）→ note；可动关节 → error。
    const jointType = readString(j.args.type) ?? 'fixed';
    const isMovingJoint = jointType !== 'fixed';
    const pushJointSignal = (code: string, message: string): void => {
      if (isMovingJoint) {
        issues.push(`${code}: ${message}`);
      } else {
        jointHeuristicSignals.push({ code, severity: 'note', message: `${message} (fixed joint — treated as intentional static placement)` });
      }
    };

    // joint.origin 在 parent-local 帧；先用 parent 的世界变换抬到世界帧再比较。
    const jointOriginLocal = readVec3(j.args.origin) ?? [0, 0, 0];
    const pW = worldXform.get(parentRef.name) ?? IDENTITY_XFORM;
    const jointOriginWorld = addVec(pW.origin, mat3Vec3(pW.rot, jointOriginLocal));

    const parentDist = pointAabbDistance(jointOriginWorld, parentBox.aabb);
    if (parentDist > jointOriginTol) {
      pushJointSignal(
        'joint_origin_far_from_parent',
        `joint "${j.id}" origin=[${fmt3(jointOriginLocal)}] ` +
          `is ${fmt(parentDist)}m outside parent "${parentRef.name}" AABB (tol=${fmt(jointOriginTol)}m). ` +
          `usually means the joint origin is given in world frame instead of parent local frame.`,
      );
    }

    // child 世界 AABB（FK 已含 joint 摆位）与 parent 世界 AABB 的最近间距。
    // 连接良好的相邻件应贴合（≈0）；墙立在楼板上 → 间距 0，不再误报。
    // 仅当 child 被整体甩离父级（典型：joint.origin 误填世界坐标导致双重平移）才触发。
    const childToParent = aabbAabbDistance(childBox.aabb, parentBox.aabb);
    if (childToParent > jointOriginTol * 4) {
      pushJointSignal(
        'joint_attaches_distant_child',
        `joint "${j.id}" places child "${childRef.name}" ` +
          `${fmt(childToParent)}m away from parent "${parentRef.name}" AABB (tol=${fmt(jointOriginTol * 4)}m). ` +
          `consider g_align_centers / g_place_on_surface to compute origin first.`,
      );
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // ④ 兄弟 part rest-pose AABB 重叠（sibling pair-wise interpenetration）
  // ════════════════════════════════════════════════════════════════════
  let overlapCount = 0;
  if (checkOverlaps) {
    const hasMovingJoint = joints.some(j => (readString(j.args.type) ?? 'fixed') !== 'fixed');
    const ids = Array.from(partAabbs.keys()).sort();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = partAabbs.get(ids[i])!;
        const b = partAabbs.get(ids[j])!;
        const depth = aabbOverlapDepth(a.aabb, b.aabb);
        if (depth[0] > overlapTol && depth[1] > overlapTol && depth[2] > overlapTol) {
          if (pairAllowed(ids[i], ids[j], allowPairs)) continue;
          overlapCount++;
          const minDepth = Math.min(depth[0], depth[1], depth[2]);
          const message =
            `aabb_overlap: parts "${ids[i]}" and "${ids[j]}" interpenetrate in rest pose ` +
            `(min depth=${fmt(minDepth)}m, tol=${fmt(overlapTol)}m). ` +
            `note: AABB-only check, conservative for rotated meshes.`;
          if (hasMovingJoint) {
            issues.push(message);
          } else {
            overlapAdvisories.push({ code: 'aabb_overlap', severity: 'warning', ids: [ids[i], ids[j]], message });
          }
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // ⑤ 几何丰富度信号（非致命警告，articraft 式「QC 作为传感器」闸门）
  //    判据只看「形状」：模型里**所有** shape 都是裸 primitive
  //    （box/cylinder/sphere/...），完全没有任何富几何 —— 即没有 CSG 实体
  //    (extrude/revolve/loft/union/difference/...)、没有 Parts（含齿轮）/Architecture
  //    语义件、也没有引用 Phase-1 烘焙细节的 mesh —— 多半是"堆方块"反模式。
  //    **是否用 g_part / g_joint 组装无关**：把一堆 box 包成 part 再连 joint
  //    依然是堆方块，旧逻辑因此漏报，这里改为只要"全是裸 primitive"就警告。
  //    纯摆放 transform / 2D profile / material 等辅助语句都不算富几何。
  //    不计入 issue / 不改 valid，只追加一行 report + 暴露 primitive_only。
  // ════════════════════════════════════════════════════════════════════
  const primitiveCount = geom.statements.filter(s => BARE_PRIMITIVE_OPS.has(s.op)).length;
  const hasRichShape = geom.statements.some(
    s =>
      !BARE_PRIMITIVE_OPS.has(s.op) &&
      !TRANSFORM_OPS.has(s.op) &&
      !SKETCH_OPS.has(s.op) &&
      !NON_SHAPE_AUX_OPS.has(s.op),
  );
  const primitiveOnly = primitiveCount > 0 && !hasRichShape;

  // 非致命建议（不影响 valid，但进入 report + structured signals）
  const advisories: QcSignal[] = [...jointHeuristicSignals, ...overlapAdvisories];

  if (primitiveOnly) {
    advisories.push({
      code: 'primitive_only',
      severity: 'warning',
      message:
        `model is ${primitiveCount} bare primitive shape(s) with no rich geometry at all ` +
        `(no CSG solid, no Parts (incl. gears)/Architecture, no baked mesh) — ` +
        `even wrapped in g_part + g_joint this is still a "stacked boxes" decomposition. ` +
        `model each part for real first (g_difference/g_revolve/... or a semantic Parts op such as a gear, ` +
        `bake it with g_bake_part), then assemble those meshes with g_mesh + g_part + g_joint_*.`,
    });
  }

  // ⑥ 悬空件：有 joint 时，未被任何 joint 连接到根树的 part（无关节路径到根）
  const floating = findFloatingLinks(parts, joints);
  if (floating.length > 0) {
    advisories.push({
      code: 'floating_link',
      severity: 'warning',
      ids: floating,
      message:
        `${floating.length} part(s) have no joint path to the root: [${floating.join(', ')}]. ` +
        `URDF only renders the root-connected tree, so these will be dropped at runtime — ` +
        `attach them with g_joint_* (fixed/revolute/...).`,
    });
  }

  // ⑦ 孤立 profile：profile_* 未被任何下游消费（extrude/loft/lathe/part/...）
  const referenced = collectAllRefs(geom.statements);
  const orphanProfiles = geom.statements
    .filter(s => PROFILE_OPS.has(s.op) && !referenced.has(s.id))
    .map(s => s.id);
  if (orphanProfiles.length > 0) {
    advisories.push({
      code: 'orphan_profile',
      severity: 'warning',
      ids: orphanProfiles,
      message:
        `${orphanProfiles.length} profile(s) are not consumed by extrude/loft/revolve/part: ` +
        `[${orphanProfiles.join(', ')}]. a lone profile bakes to a ~2mm preview slab — ` +
        `feed it into g_extrude / g_loft / g_revolve or remove it.`,
    });
  }

  // ⑧ lathe/revolve 喂入 XY 语义 profile（被误读为 r,z → 静默错误回转体）
  const latheXy: string[] = [];
  for (const s of geom.statements) {
    if (s.op !== 'lathe' && s.op !== 'revolve') continue;
    const pr = s.args.profile;
    if (!pr || pr.kind !== 'ref') continue;
    const src = byId.get(pr.name);
    if (src && XY_PROFILE_OPS.has(src.op)) latheXy.push(`${s.id}←${src.id}(${src.op})`);
  }
  if (latheXy.length > 0) {
    advisories.push({
      code: 'lathe_xy_profile',
      severity: 'warning',
      message:
        `lathe/revolve consumes XY-centered profile(s): [${latheXy.join(', ')}]. ` +
        `lathe treats profile points as (r,z); an origin-centered rect/circle has negative r and will ` +
        `error or produce a wrong solid of revolution. author a dedicated r,z profile with all r>=0.`,
    });
  }

  // ⑨ mesh-backed 布尔误用：union/difference/intersection 操作数（穿透 transform）
  //    最终落到 pipe/sweep/section_loft → baker 会抛 "boolean on mesh-backed" 错。
  const meshBoolMisuse: string[] = [];
  for (const s of geom.statements) {
    if (!BOOLEAN_OPS.has(s.op)) continue;
    const operandArgs = ['a', 'b', 'base', 'tool'];
    for (const key of operandArgs) {
      const ref = s.args[key];
      if (!ref || ref.kind !== 'ref') continue;
      const meshSrc = resolveMeshBackedSource(ref.name, byId, new Set());
      if (meshSrc) meshBoolMisuse.push(`${s.id}.${key}←${meshSrc}`);
    }
  }
  if (meshBoolMisuse.length > 0) {
    advisories.push({
      code: 'mesh_boolean_misuse',
      severity: 'error',
      message:
        `boolean op operand(s) resolve to mesh-backed pipe/sweep/section_loft: [${meshBoolMisuse.join(', ')}]. ` +
        `union/difference/intersection cannot consume triangle meshes and the baker will throw. ` +
        `build the boolean from solids (box/cylinder/sphere/extrude/loft/revolve) instead.`,
    });
  }

  // ── 汇总 structured signals（fatal issues → error；advisories 各自 severity） ──
  const signals: QcSignal[] = [];
  for (const issue of issues) {
    const code = issue.slice(0, issue.indexOf(':'));
    signals.push({ code: code || 'issue', severity: 'error', message: issue });
  }
  for (const a of advisories) signals.push(a);
  // mesh_boolean_misuse 虽走 advisory 列表，但语义是致命的 → 计入 valid 判定
  const fatalAdvisories = advisories.filter(a => a.severity === 'error');

  const reportLines = [...issues, ...advisories.map(a => `${a.code}: ${a.message}`)];

  const valid = issues.length === 0 && fatalAdvisories.length === 0;
  return {
    geometry: geom,
    valid,
    report: reportLines.join('\n'),
    count: issues.length + fatalAdvisories.length,
    islands,
    missing_aabb: missingAabb,
    overlaps: overlapCount,
    primitive_only: primitiveOnly,
    floating_links: floating.length,
    orphan_profiles: orphanProfiles.length,
    signals,
  };
}

/** 收集所有语句 args 里出现过的 ref name（用于孤立 profile 检测）。 */
function collectAllRefs(statements: readonly Statement[]): Set<string> {
  const out = new Set<string>();
  const walk = (arg: Arg | undefined): void => {
    if (!arg) return;
    if (arg.kind === 'ref') out.add(arg.name);
    else if (arg.kind === 'list') for (const it of arg.items) walk(it);
  };
  for (const s of statements) for (const a of Object.values(s.args)) walk(a);
  return out;
}

/**
 * 悬空件：选出根（不是任何 joint.child 的 part），从根集合沿 joint 边 BFS，
 * 返回不可达的 part id。无 joint 时不报（单件/纯 shape 场景由其它信号覆盖）。
 */
function findFloatingLinks(parts: readonly Statement[], joints: readonly Statement[]): string[] {
  if (parts.length <= 1 || joints.length === 0) return [];
  const partIds = new Set(parts.map(p => p.id));
  const children = new Set<string>();
  const adj = new Map<string, string[]>();
  for (const id of partIds) adj.set(id, []);
  for (const j of joints) {
    const p = j.args.parent;
    const c = j.args.child;
    if (!p || p.kind !== 'ref' || !c || c.kind !== 'ref') continue;
    if (!partIds.has(p.name) || !partIds.has(c.name)) continue;
    adj.get(p.name)!.push(c.name);
    adj.get(c.name)!.push(p.name);
    children.add(c.name);
  }
  const roots = [...partIds].filter(id => !children.has(id));
  const seen = new Set<string>();
  const queue = roots.length > 0 ? [...roots] : [parts[0].id];
  for (const r of queue) seen.add(r);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const nb of adj.get(cur) ?? []) {
      if (!seen.has(nb)) { seen.add(nb); queue.push(nb); }
    }
  }
  return [...partIds].filter(id => !seen.has(id)).sort();
}

/**
 * 从一个 ref name 出发，穿透单输入 transform op，判断其几何源是否 mesh-backed
 * (pipe/sweep/section_loft)。是 → 返回该源的 "id(op)"；否则 undefined。
 */
function resolveMeshBackedSource(
  name: string,
  byId: ReadonlyMap<string, Statement>,
  visiting: Set<string>,
): string | undefined {
  if (visiting.has(name)) return undefined;
  visiting.add(name);
  const s = byId.get(name);
  if (!s) return undefined;
  if (MESH_BACKED_OPS.has(s.op)) return `${s.id}(${s.op})`;
  if (TRANSFORM_OPS.has(s.op)) {
    // 透传第一个 shape ref（translate/rotate/... 的 shape 参数）
    for (const key of ['shape', 'a', 'base', 'input']) {
      const ref = s.args[key];
      if (ref && ref.kind === 'ref') {
        const r = resolveMeshBackedSource(ref.name, byId, visiting);
        if (r) return r;
      }
    }
  }
  if (BOOLEAN_OPS.has(s.op)) {
    for (const key of ['a', 'b', 'base', 'tool']) {
      const ref = s.args[key];
      if (ref && ref.kind === 'ref') {
        const r = resolveMeshBackedSource(ref.name, byId, visiting);
        if (r) return r;
      }
    }
  }
  return undefined;
}

// ════════════════════════════════════════════════════════════════════
// 连通分量（union-find）
// ════════════════════════════════════════════════════════════════════

function countIslands(partIds: readonly string[], joints: readonly Statement[]): number {
  return listComponents(partIds, joints).length;
}

function listComponents(
  partIds: readonly string[],
  joints: readonly Statement[],
): string[][] {
  if (partIds.length === 0) return [];
  const parent = new Map<string, string>();
  for (const id of partIds) parent.set(id, id);

  const find = (x: string): string => {
    let cur = x;
    while (parent.get(cur)! !== cur) cur = parent.get(cur)!;
    // 路径压缩
    let p = x;
    while (parent.get(p)! !== cur) {
      const next = parent.get(p)!;
      parent.set(p, cur);
      p = next;
    }
    return cur;
  };

  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const j of joints) {
    const p = j.args.parent;
    const c = j.args.child;
    if (!p || p.kind !== 'ref' || !c || c.kind !== 'ref') continue;
    if (!parent.has(p.name) || !parent.has(c.name)) continue;
    union(p.name, c.name);
  }

  const groups = new Map<string, string[]>();
  for (const id of partIds) {
    const r = find(id);
    const list = groups.get(r);
    if (list) list.push(id);
    else groups.set(r, [id]);
  }
  return [...groups.values()].map(arr => arr.slice().sort());
}

// ════════════════════════════════════════════════════════════════════
// AABB 几何工具
// ════════════════════════════════════════════════════════════════════

function transformAabbByOriginRpy(
  local: LocalAABB,
  origin: Vec3,
  rpy: Vec3,
): LocalAABB {
  // rpy = [0,0,0] 时简化为平移
  if (rpy[0] === 0 && rpy[1] === 0 && rpy[2] === 0) {
    return translateAabb(local, origin);
  }
  // rpy 非零：八角点旋转后取重新包络（保守 AABB），可能比原始 OBB 略大但不漏报
  const corners = aabbCorners(local);
  const rot = rpyToMat3(rpy);
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const c of corners) {
    const r = mat3Vec3(rot, c);
    const x = r[0] + origin[0];
    const y = r[1] + origin[1];
    const z = r[2] + origin[2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return {
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
    halfExtent: [(maxX - minX) / 2, (maxY - minY) / 2, (maxZ - minZ) / 2],
  };
}

function translateAabb(a: LocalAABB, offset: Vec3): LocalAABB {
  return {
    center: [a.center[0] + offset[0], a.center[1] + offset[1], a.center[2] + offset[2]],
    halfExtent: a.halfExtent,
  };
}

// ════════════════════════════════════════════════════════════════════
// 正向运动学（joint 树 → 每个 part 的世界位姿）
// ════════════════════════════════════════════════════════════════════

type Mat3 = readonly [Vec3, Vec3, Vec3];
interface Xform {
  readonly rot: Mat3;
  readonly origin: Vec3;
}
const IDENTITY_XFORM: Xform = { rot: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], origin: [0, 0, 0] };

/**
 * 沿 joint 树（parent→child）累计每个 part 的世界变换。
 *   childWorld.rot    = parentWorld.rot · jointRot(rpy)
 *   childWorld.origin = parentWorld.origin + parentWorld.rot · jointOrigin
 * 根 part（不是任何 joint.child）取恒等。未连通到根的 part（孤岛/环）兜底恒等。
 * 每个 link 只认第一条父 joint（URDF 树约束）。
 */
function computeWorldTransforms(parts: readonly Statement[], joints: readonly Statement[]): Map<string, Xform> {
  const partIds = new Set(parts.map(p => p.id));
  const edge = new Map<string, { parent: string; origin: Vec3; rpy: Vec3 }>();
  const childrenOf = new Map<string, string[]>();
  for (const id of partIds) childrenOf.set(id, []);
  for (const j of joints) {
    const p = j.args.parent;
    const c = j.args.child;
    if (!p || p.kind !== 'ref' || !c || c.kind !== 'ref') continue;
    if (!partIds.has(p.name) || !partIds.has(c.name)) continue;
    if (edge.has(c.name)) continue;
    const origin = readVec3(j.args.origin) ?? [0, 0, 0];
    const rpy = readVec3(j.args.rpy) ?? [0, 0, 0];
    edge.set(c.name, { parent: p.name, origin, rpy });
    childrenOf.get(p.name)!.push(c.name);
  }
  const world = new Map<string, Xform>();
  const queue: string[] = [];
  for (const id of partIds) {
    if (!edge.has(id)) { world.set(id, IDENTITY_XFORM); queue.push(id); }
  }
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const curW = world.get(cur)!;
    for (const ch of childrenOf.get(cur) ?? []) {
      if (world.has(ch)) continue;
      const e = edge.get(ch)!;
      const rot = mat3Mul(curW.rot, rpyToMat3(e.rpy));
      const origin = addVec(curW.origin, mat3Vec3(curW.rot, e.origin));
      world.set(ch, { rot, origin });
      queue.push(ch);
    }
  }
  for (const id of partIds) if (!world.has(id)) world.set(id, IDENTITY_XFORM);
  return world;
}

function transformAabbByMatOrigin(local: LocalAABB, rot: Mat3, origin: Vec3): LocalAABB {
  const corners = aabbCorners(local);
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const c of corners) {
    const r = mat3Vec3(rot, c);
    const x = r[0] + origin[0];
    const y = r[1] + origin[1];
    const z = r[2] + origin[2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return {
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
    halfExtent: [(maxX - minX) / 2, (maxY - minY) / 2, (maxZ - minZ) / 2],
  };
}

/** 两 AABB 的最近间距（相交 → 0）。 */
function aabbAabbDistance(a: LocalAABB, b: LocalAABB): number {
  const aMin: Vec3 = [a.center[0] - a.halfExtent[0], a.center[1] - a.halfExtent[1], a.center[2] - a.halfExtent[2]];
  const aMax: Vec3 = [a.center[0] + a.halfExtent[0], a.center[1] + a.halfExtent[1], a.center[2] + a.halfExtent[2]];
  const bMin: Vec3 = [b.center[0] - b.halfExtent[0], b.center[1] - b.halfExtent[1], b.center[2] - b.halfExtent[2]];
  const bMax: Vec3 = [b.center[0] + b.halfExtent[0], b.center[1] + b.halfExtent[1], b.center[2] + b.halfExtent[2]];
  const dx = Math.max(0, bMin[0] - aMax[0], aMin[0] - bMax[0]);
  const dy = Math.max(0, bMin[1] - aMax[1], aMin[1] - bMax[1]);
  const dz = Math.max(0, bMin[2] - aMax[2], aMin[2] - bMax[2]);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function mat3Mul(a: Mat3, b: Mat3): Mat3 {
  const out: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      out[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
    }
  }
  return [
    [out[0][0], out[0][1], out[0][2]],
    [out[1][0], out[1][1], out[1][2]],
    [out[2][0], out[2][1], out[2][2]],
  ];
}

function addVec(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function aabbCorners(a: LocalAABB): Vec3[] {
  const c = a.center;
  const h = a.halfExtent;
  const out: Vec3[] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        out.push([c[0] + sx * h[0], c[1] + sy * h[1], c[2] + sz * h[2]]);
      }
    }
  }
  return out;
}

/** 点到 AABB 的最短距离；点在内部 → 0 */
function pointAabbDistance(p: Vec3, a: LocalAABB): number {
  const minX = a.center[0] - a.halfExtent[0];
  const minY = a.center[1] - a.halfExtent[1];
  const minZ = a.center[2] - a.halfExtent[2];
  const maxX = a.center[0] + a.halfExtent[0];
  const maxY = a.center[1] + a.halfExtent[1];
  const maxZ = a.center[2] + a.halfExtent[2];
  const dx = Math.max(0, Math.max(minX - p[0], p[0] - maxX));
  const dy = Math.max(0, Math.max(minY - p[1], p[1] - maxY));
  const dz = Math.max(0, Math.max(minZ - p[2], p[2] - maxZ));
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** 两 AABB 在三轴上的重叠深度；任何轴 ≤ 0 表示该轴未重叠 */
function aabbOverlapDepth(a: LocalAABB, b: LocalAABB): Vec3 {
  const aMin: Vec3 = [
    a.center[0] - a.halfExtent[0],
    a.center[1] - a.halfExtent[1],
    a.center[2] - a.halfExtent[2],
  ];
  const aMax: Vec3 = [
    a.center[0] + a.halfExtent[0],
    a.center[1] + a.halfExtent[1],
    a.center[2] + a.halfExtent[2],
  ];
  const bMin: Vec3 = [
    b.center[0] - b.halfExtent[0],
    b.center[1] - b.halfExtent[1],
    b.center[2] - b.halfExtent[2],
  ];
  const bMax: Vec3 = [
    b.center[0] + b.halfExtent[0],
    b.center[1] + b.halfExtent[1],
    b.center[2] + b.halfExtent[2],
  ];
  return [
    Math.min(aMax[0], bMax[0]) - Math.max(aMin[0], bMin[0]),
    Math.min(aMax[1], bMax[1]) - Math.max(aMin[1], bMin[1]),
    Math.min(aMax[2], bMax[2]) - Math.max(aMin[2], bMin[2]),
  ];
}

function rpyToMat3(rpy: Vec3): readonly [Vec3, Vec3, Vec3] {
  const [r, p, y] = rpy;
  const cr = Math.cos(r);
  const sr = Math.sin(r);
  const cp = Math.cos(p);
  const sp = Math.sin(p);
  const cy = Math.cos(y);
  const sy = Math.sin(y);
  // R = Rz(yaw) * Ry(pitch) * Rx(roll)（与 articraft / URDF 一致）
  return [
    [cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr],
    [sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr],
    [-sp, cp * sr, cp * cr],
  ];
}

function mat3Vec3(m: readonly [Vec3, Vec3, Vec3], v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

// ════════════════════════════════════════════════════════════════════
// Arg 读取 / 格式化
// ════════════════════════════════════════════════════════════════════

function readString(arg: Arg | undefined): string | undefined {
  if (!arg || arg.kind !== 'string') return undefined;
  return arg.value;
}

function readVec3(arg: Arg | undefined): Vec3 | undefined {
  if (!arg || arg.kind !== 'list' || arg.items.length !== 3) return undefined;
  const out: number[] = [];
  for (const item of arg.items) {
    if (item.kind !== 'number') return undefined;
    out.push(item.value);
  }
  return [out[0], out[1], out[2]];
}

function readPositiveNumber(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function readStringSet(raw: unknown): Set<string> {
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.map(v => String(v).trim()).filter(v => v !== ''));
}

function pairAllowed(a: string, b: string, allowed: ReadonlySet<string>): boolean {
  return allowed.has(`${a}:${b}`) || allowed.has(`${b}:${a}`) || allowed.has(`${a},${b}`) || allowed.has(`${b},${a}`);
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Math.abs(n) >= 1e4 || (n !== 0 && Math.abs(n) < 1e-3)) return n.toExponential(3);
  return n.toFixed(4).replace(/\.?0+$/, '');
}

function fmt3(v: Vec3): string {
  return v.map(fmt).join(', ');
}

export default gGeometryQc;
