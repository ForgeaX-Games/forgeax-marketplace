/**
 * g_validate —— 跑一遍 Geometry 的 SSA / 类型 / ref 校验，再加几条 URDF 语义检查：
 *   - 至少有一个 part（否则 URDF 是空 robot）
 *   - 每个 joint 的 parent / child 必须是 part 类型，不能是 shape / material 等
 *   - joint 的 type 是 URDF 允许的值
 *   - joint 不能形成自环（child 不能指向自己的祖先）
 *
 * 输出：
 *   - valid: boolean
 *   - errors: 多行错误描述（"line N: ..."）
 *   - count: 错误条数
 *   - geometry: 透传输入，便于继续接其他下游
 */

import {
  isGeometry,
  validateStatements,
  type Geometry,
  type Statement,
} from '../../../../vendor/dist/shared/types/index.js';

const URDF_JOINT_TYPES = new Set(['fixed', 'revolute', 'continuous', 'prismatic', 'floating', 'planar']);

export function gValidate(input: Record<string, unknown>): Record<string, unknown> {
  const geom = isGeometry(input.geometry) ? (input.geometry as Geometry) : null;
  if (!geom) {
    return { geometry: null, valid: false, errors: 'no Geometry input', count: 1 };
  }

  const messages: string[] = [];

  const base = validateStatements(geom.statements);
  for (const e of base.errors) {
    messages.push(`line ${e.line}: ${e.message}`);
  }

  const byId = new Map<string, Statement>();
  for (const s of geom.statements) byId.set(s.id, s);

  let partCount = 0;
  for (const s of geom.statements) {
    if (s.op === 'part') partCount++;
  }
  if (partCount === 0) {
    messages.push('semantic: geometry has no part; URDF will only contain auto-wrapped orphan shapes (which is fine for preview, but no real assembly)');
  }

  const parentChild: Array<{ joint: Statement; parentId: string; childId: string }> = [];
  for (const s of geom.statements) {
    if (s.op !== 'joint') continue;

    const typeArg = s.args.type;
    if (typeArg && typeArg.kind === 'string' && !URDF_JOINT_TYPES.has(typeArg.value)) {
      messages.push(`line ${s.line}: joint "${s.id}" has unknown type "${typeArg.value}" (URDF allows: ${[...URDF_JOINT_TYPES].join('/')})`);
    }

    const pRef = s.args.parent;
    const cRef = s.args.child;
    if (pRef && pRef.kind === 'ref') {
      const target = byId.get(pRef.name);
      if (target && target.op !== 'part') {
        messages.push(`line ${s.line}: joint "${s.id}" parent "${pRef.name}" is op "${target.op}", expected "part"`);
      }
      if (cRef && cRef.kind === 'ref') {
        const ctarget = byId.get(cRef.name);
        if (ctarget && ctarget.op !== 'part') {
          messages.push(`line ${s.line}: joint "${s.id}" child "${cRef.name}" is op "${ctarget.op}", expected "part"`);
        }
        parentChild.push({ joint: s, parentId: pRef.name, childId: cRef.name });
      }
    }
  }

  // 简单成环检测：把 (parent, child) 当有向边，BFS 看每个 child 的祖先链是否含自己
  const childToParents = new Map<string, string[]>();
  for (const { parentId, childId } of parentChild) {
    if (!childToParents.has(childId)) childToParents.set(childId, []);
    childToParents.get(childId)!.push(parentId);
  }
  for (const { joint, parentId, childId } of parentChild) {
    const seen = new Set<string>([childId]);
    const stack = [parentId];
    let cycle = false;
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (seen.has(cur)) { cycle = true; break; }
      seen.add(cur);
      const ps = childToParents.get(cur);
      if (ps) for (const p of ps) stack.push(p);
    }
    if (cycle) {
      messages.push(`line ${joint.line}: joint "${joint.id}" introduces a cycle (${childId} ↔ ${parentId})`);
    }
  }

  return {
    geometry: geom,
    valid: messages.length === 0,
    errors: messages.join('\n'),
    count: messages.length,
  };
}

export default gValidate;
