import {
  bool, emit, freshId, isValidId, makeGeometry, num, numList, parseGeometryPort,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

export function gClevisBracket(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const w = Number(input.w ?? 0.06);
  const d = Number(input.d ?? 0.04);
  const h = Number(input.h ?? 0.05);
  const gap = Number(input.gap_width ?? 0.02);
  const bore = Number(input.bore_diameter ?? 0.008);
  const boreZ = Number(input.bore_center_z ?? 0.035);
  const baseT = Number(input.base_thickness ?? 0.01);

  if (![w, d, h, gap, bore, boreZ, baseT].every(Number.isFinite)) {
    return { geometry: incoming, id: '', error: 'clevis_bracket: numeric params must be finite' };
  }

  const args: Record<string, Arg> = {
    overall_size:   numList([w, d, h]),
    gap_width:      num(gap),
    bore_diameter:  num(bore),
    bore_center_z:  num(boreZ),
    base_thickness: num(baseT),
  };

  const cr = Number(input.corner_radius ?? 0);
  if (cr !== 0) args.corner_radius = num(cr);
  if (input.center === false || input.center === 'false') args.center = bool(false);

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'cle');
  if (!isValidId(id)) {
    return { geometry: incoming, id: '', error: `invalid id "${id}" (must match [A-Za-z_][A-Za-z0-9_]*)` };
  }

  const next = emit(incoming, id, 'clevis_bracket', args);
  return { geometry: next, id };
}

export default gClevisBracket;
