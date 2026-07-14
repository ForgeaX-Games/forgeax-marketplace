import {
  bool, emit, freshId, isValidId, makeGeometry, num, parseGeometryPort,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

export function gWheel(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const r = Number(input.radius ?? 0.05);
  const w = Number(input.width ?? 0.025);

  if (!Number.isFinite(r) || !Number.isFinite(w)) {
    return { geometry: incoming, id: '', error: 'wheel: radius/width must be finite' };
  }
  // 与 baker（ops/wheels.ts）保持一致：radius/width 必须为正。提前在电池层挡掉，
  // 让 agent 直接从 error 端口看到失败，而不是等 bake 抛 BakerError 或静默接受 radius=0。
  if (r <= 0 || w <= 0) {
    return { geometry: incoming, id: '', error: 'wheel: radius and width must be positive' };
  }

  const args: Record<string, Arg> = {
    radius: num(r),
    width:  num(w),
  };

  const boreD = Number(input.bore_d ?? 0);
  if (Number.isFinite(boreD) && boreD > 0) {
    // bore 是中心轴孔直径，必须小于轮直径（2*radius），否则 bake 会失败。
    if (boreD >= r * 2) {
      return { geometry: incoming, id: '', error: 'wheel: bore_d must be smaller than the wheel diameter (2*radius)' };
    }
    args.bore_d = num(boreD);
  }
  const spokeCount = Number(input.spoke_count ?? 0);
  if (Number.isFinite(spokeCount) && spokeCount > 0) {
    // baker 把 spoke_count 截到 12（控制布尔次数）；电池层同样 clamp，保证 meta
    // 声明的"上限 12"在产出的 DSL 里就成立，而非依赖下游 baker 兜底。
    args.spoke_count = num(Math.min(Math.round(spokeCount), 12));
  }

  if (input.center === false || input.center === 'false') args.center = bool(false);

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'wheel');
  if (!isValidId(id)) {
    return { geometry: incoming, id: '', error: `invalid id "${id}"` };
  }

  const next = emit(incoming, id, 'wheel', args);
  return { geometry: next, id };
}

export default gWheel;
