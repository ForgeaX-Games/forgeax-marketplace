import {
  bool, emit, freshId, isValidId, makeGeometry, num, numList, parseGeometryPort,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

export function gTrunnionYoke(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const w = Number(input.w ?? 0.08);
  const d = Number(input.d ?? 0.04);
  const h = Number(input.h ?? 0.06);
  const span = Number(input.span_width ?? 0.04);
  const tDia = Number(input.trunnion_diameter ?? 0.012);
  const tZ   = Number(input.trunnion_center_z ?? 0.045);
  const baseT = Number(input.base_thickness ?? 0.012);

  if (![w, d, h, span, tDia, tZ, baseT].every(Number.isFinite)) {
    return { geometry: incoming, id: '', error: 'trunnion_yoke: numeric params must be finite' };
  }

  const args: Record<string, Arg> = {
    overall_size:      numList([w, d, h]),
    span_width:        num(span),
    trunnion_diameter: num(tDia),
    trunnion_center_z: num(tZ),
    base_thickness:    num(baseT),
  };

  const cr = Number(input.corner_radius ?? 0);
  if (cr !== 0) args.corner_radius = num(cr);
  if (input.center === false || input.center === 'false') args.center = bool(false);

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'yoke');
  if (!isValidId(id)) {
    return { geometry: incoming, id: '', error: `invalid id "${id}"` };
  }

  const next = emit(incoming, id, 'trunnion_yoke', args);
  return { geometry: next, id };
}

export default gTrunnionYoke;
