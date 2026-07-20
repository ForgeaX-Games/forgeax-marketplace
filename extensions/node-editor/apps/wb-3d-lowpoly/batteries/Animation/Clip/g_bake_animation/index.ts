/**
 * g_bake_animation —— 校验作者关节轨迹 q(t) 并追加 `animation` 语句。
 *
 * q(t) 表示：以 URDF 关节名（== DSL joint 语句的 id）为键的每关节标量轨迹
 * （弧度 revolute/continuous | 米 prismatic）。轴 / 类型 / 限位由 URDF 提供，
 * 所以 clip 不携带任何几何。
 *
 * 职责：解析 q(t)（motion 端口 > q_json > q_path）→ 对照 geometry 关节校验 →
 *   - 校验通过：`emit('animation', {...})` 追加语句，几何前进；
 *   - 校验失败：几何原样透传，`error` 返回错误（沿用 g_joint_revolute 约定）。
 * 真正的 `.glb` 由前端导出链路烘焙；本电池只负责创作 + 校验 + emit q(t)。
 */

import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import {
  emit,
  freshId,
  isValidId,
  makeGeometry,
  num,
  str,
  bool,
  parseGeometryPort,
  parseJointAnimationClip,
  validateClipAgainstJoints,
  type Arg,
  type JointAnimationClip,
} from '../../../../vendor/dist/shared/types/index.js';

interface QtSource {
  value: unknown | null;
  error: string | null;
}

export function gBakeAnimation(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const fail = (error: string, animation: unknown = null, report: unknown = null): Record<string, unknown> =>
    ({ geometry: incoming, animation, report, error });

  // 1) 解析 q(t)（优先级：motion 端口 > q_json 内联 > q_path 文件）
  const source = resolveQtSource(input);
  if (source.value === null) {
    return fail(source.error ?? 'no q(t) provided (wire `motion`, or set q_json / q_path)');
  }
  const parsed = parseJointAnimationClip(source.value);
  if (!parsed.clip) {
    return fail(parsed.error ?? 'failed to parse q(t)');
  }

  // 2) 参数覆盖：name / fps / loop（显式给了就盖掉 q(t) 里的值）
  const clip: JointAnimationClip = { ...parsed.clip, channels: parsed.clip.channels };
  const nameParam = String(input.name ?? '').trim();
  if (nameParam) clip.name = nameParam;
  const fpsParam = readFiniteNumber(input.fps);
  if (fpsParam !== undefined && fpsParam > 0) clip.fps = fpsParam;
  if (typeof input.loop === 'boolean') clip.loop = input.loop;
  else if (typeof input.loop === 'string') {
    const l = input.loop.trim().toLowerCase();
    if (l === 'true') clip.loop = true;
    else if (l === 'false') clip.loop = false;
  }

  // 3) 对照 geometry 关节校验 + 夹取到限位
  const { clip: validated, errors, report } = validateClipAgainstJoints(clip, incoming.statements);

  if (errors.length > 0) {
    // 非致命：几何原样透传，仍把已解析 clip + report 交给下游便于诊断。
    return fail(errors.join('\n'), validated, report);
  }

  // 4) emit `animation` 语句；q(t) 存为 JSON 字符串 arg `data`
  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'anim');
  if (!isValidId(id)) return fail(`invalid id "${id}"`, validated, report);

  const args: Record<string, Arg> = {
    name: str(validated.name),
    fps: num(validated.fps),
    frames: num(validated.frameCount),
    data: str(JSON.stringify(validated.channels)),
  };
  if (validated.loop) args.loop = bool(true);

  const next = emit(incoming, id, 'animation', args);
  return { geometry: next, animation: validated, report, error: '' };
}

/**
 * 按优先级解析 q(t) 原始值：motion 端口 > q_json 内联 JSON > q_path 文件。
 * 返回 { value: 原始值(对象/字符串) | null, error }。
 */
function resolveQtSource(input: Record<string, unknown>): QtSource {
  // motion 端口：对象或 JSON 字符串都交给 parseJointAnimationClip 处理
  const motion = input.motion;
  if (motion !== undefined && motion !== null) {
    if (typeof motion === 'string') {
      if (motion.trim() !== '') return { value: motion, error: null };
    } else {
      return { value: motion, error: null };
    }
  }

  const qJson = String(input.q_json ?? '').trim();
  if (qJson !== '') return { value: qJson, error: null };

  const qPath = String(input.q_path ?? '').trim();
  if (qPath !== '') {
    const read = readProjectFile(qPath);
    if (read.text === null) return { value: null, error: read.error };
    return { value: read.text, error: null };
  }

  return { value: null, error: null };
}

/**
 * 读取 q_path 指向的 JSON 文件。绝对路径直接读；相对路径依次尝试
 * FORGEAX_PROJECT_ROOT / process.cwd() 作为基准（best-effort）。
 */
function readProjectFile(pathValue: string): { text: string | null; error: string | null } {
  const candidates: string[] = [];
  if (isAbsolute(pathValue)) {
    candidates.push(pathValue);
  } else {
    const root = process.env.FORGEAX_PROJECT_ROOT;
    if (root) candidates.push(resolve(root, pathValue));
    candidates.push(resolve(process.cwd(), pathValue));
  }
  let lastErr = '';
  for (const abs of candidates) {
    try {
      return { text: readFileSync(abs, 'utf8'), error: null };
    } catch (e) {
      lastErr = (e as Error).message;
    }
  }
  return { text: null, error: `failed to read q_path "${pathValue}": ${lastErr}` };
}

function readFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export default gBakeAnimation;
