import {
  emit, freshId, isValidId, makeGeometry, num, parseGeometryPort,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

const PROFILE_OPS: Record<string, string> = {
  spur:        'ring_gear',
  herringbone: 'herringbone_ring_gear',
};

export function gRingGear(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const profile = String(input.tooth_profile ?? 'spur').trim().toLowerCase();
  const op = PROFILE_OPS[profile];
  if (!op) {
    return { geometry: incoming, id: '', error: `ring_gear: tooth_profile must be one of spur/herringbone, got "${profile}"` };
  }

  const mod   = Number(input.module ?? 0.002);
  const teeth = Number(input.teeth_number ?? 40);
  const width = Number(input.width ?? 0.015);
  const rim   = Number(input.rim_width ?? 0.005);

  if (!Number.isFinite(mod) || mod <= 0 || !Number.isFinite(width) || width <= 0 || !Number.isFinite(rim) || rim <= 0 || !Number.isInteger(teeth) || teeth < 3) {
    return { geometry: incoming, id: '', error: 'ring_gear: module/width/rim_width must be positive and teeth_number must be an integer >= 3' };
  }

  const args: Record<string, Arg> = {
    module:       num(mod),
    teeth_number: num(teeth),
    width:        num(width),
    rim_width:    num(rim),
  };

  const optNum = ['pressure_angle', 'helix_angle', 'clearance', 'backlash'] as const;
  for (const k of optNum) {
    const raw = input[k];
    if (raw === undefined || raw === '' || raw === null) continue;
    const v = Number(raw);
    if (!Number.isFinite(v) || v === 0) continue;
    args[k] = num(v);
  }

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'ring');
  if (!isValidId(id)) {
    return { geometry: incoming, id: '', error: `invalid id "${id}"` };
  }

  const next = emit(incoming, id, op, args);
  return { geometry: next, id };
}

export default gRingGear;
