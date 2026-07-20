import {
  bool, emit, freshId, isValidId, makeGeometry, num, parseGeometryPort,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

export function gBarrelHinge(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const length = Number(input.length ?? 0.06);
  const lwA    = Number(input.leaf_width_a ?? 0.025);
  const lwB    = Number(input.leaf_width_b ?? lwA);
  const lt     = Number(input.leaf_thickness ?? 0.0025);
  const pin    = Number(input.pin_diameter ?? 0.005);

  if (![length, lwA, lwB, lt, pin].every(Number.isFinite)) {
    return { geometry: incoming, id: '', error: 'barrel_hinge: numeric params must be finite' };
  }

  const args: Record<string, Arg> = {
    length:         num(length),
    leaf_width_a:   num(lwA),
    leaf_thickness: num(lt),
    pin_diameter:   num(pin),
  };
  if (lwB !== lwA) args.leaf_width_b = num(lwB);

  const optNum = ['knuckle_outer_diameter', 'knuckle_count', 'clearance', 'open_angle_deg'] as const;
  for (const k of optNum) {
    const raw = input[k];
    if (raw === undefined || raw === '' || raw === null) continue;
    const v = Number(raw);
    if (!Number.isFinite(v) || v === 0) continue;
    args[k] = num(v);
  }
  if (input.center === false || input.center === 'false') args.center = bool(false);

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'hng');
  if (!isValidId(id)) {
    return { geometry: incoming, id: '', error: `invalid id "${id}"` };
  }

  const next = emit(incoming, id, 'barrel_hinge', args);
  return { geometry: next, id };
}

export default gBarrelHinge;
