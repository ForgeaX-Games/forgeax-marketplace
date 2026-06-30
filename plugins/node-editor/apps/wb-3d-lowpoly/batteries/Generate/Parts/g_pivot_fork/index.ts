import {
  bool, emit, freshId, isValidId, makeGeometry, num, numList, parseGeometryPort,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

export function gPivotFork(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const w = Number(input.w ?? 0.06);
  const d = Number(input.d ?? 0.04);
  const h = Number(input.h ?? 0.05);
  const gap = Number(input.gap_width ?? 0.02);
  const bore = Number(input.bore_diameter ?? 0.008);
  const boreZ = Number(input.bore_center_z ?? 0.035);
  const bridge = Number(input.bridge_thickness ?? 0.008);

  if (![w, d, h, gap, bore, boreZ, bridge].every(Number.isFinite)) {
    return { geometry: incoming, id: '', error: 'pivot_fork: numeric params must be finite' };
  }

  const args: Record<string, Arg> = {
    overall_size:      numList([w, d, h]),
    gap_width:         num(gap),
    bore_diameter:     num(bore),
    bore_center_z:     num(boreZ),
    bridge_thickness:  num(bridge),
  };

  const cr = Number(input.corner_radius ?? 0);
  if (cr !== 0) args.corner_radius = num(cr);
  if (input.center === false || input.center === 'false') args.center = bool(false);

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'fork');
  if (!isValidId(id)) {
    return { geometry: incoming, id: '', error: `invalid id "${id}"` };
  }

  const next = emit(incoming, id, 'pivot_fork', args);
  return { geometry: next, id };
}

export default gPivotFork;
