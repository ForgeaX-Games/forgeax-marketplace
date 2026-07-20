import {
  emit, freshId, isValidId, makeGeometry, num, parseGeometryPort,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

// tooth_profile → 现有 baker DSL op。baker builder 完全不动，旧 DSL 照常 bake。
const PROFILE_OPS: Record<string, string> = {
  spur:        'spur_gear',
  helical:     'crossed_helical_gear',
  herringbone: 'herringbone_gear',
  hyperbolic:  'hyperbolic_gear',
};

export function gGear(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const profile = String(input.tooth_profile ?? 'spur').trim().toLowerCase();
  const op = PROFILE_OPS[profile];
  if (!op) {
    return { geometry: incoming, id: '', error: `gear: tooth_profile must be one of spur/helical/herringbone/hyperbolic, got "${profile}"` };
  }

  const mod   = Number(input.module ?? 0.002);
  const teeth = Math.round(Number(input.teeth_number ?? 20));
  const width = Number(input.width ?? 0.01);

  if (!Number.isFinite(mod) || mod <= 0 || !Number.isFinite(width) || width <= 0 || !Number.isFinite(teeth) || teeth < 3) {
    return { geometry: incoming, id: '', error: 'gear: module/width must be positive and teeth_number must be an integer >= 3' };
  }

  const args: Record<string, Arg> = {
    module:       num(mod),
    teeth_number: num(teeth),
    width:        num(width),
  };

  if (profile === 'hyperbolic') {
    const twist = Number(input.twist_angle ?? 30);
    if (!Number.isFinite(twist)) {
      return { geometry: incoming, id: '', error: 'gear(hyperbolic): twist_angle must be finite' };
    }
    args.twist_angle = num(twist);
  }

  // helix_angle 只对 spur/helical/herringbone 有意义；hyperbolic 由 twist_angle 决定齿向。
  const optNum = profile === 'hyperbolic'
    ? (['pressure_angle', 'clearance', 'backlash', 'bore_d'] as const)
    : (['pressure_angle', 'helix_angle', 'clearance', 'backlash', 'bore_d'] as const);
  for (const k of optNum) {
    const raw = input[k];
    if (raw === undefined || raw === '' || raw === null) continue;
    const v = Number(raw);
    if (!Number.isFinite(v) || v === 0) continue;
    args[k] = num(v);
  }

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'gear');
  if (!isValidId(id)) {
    return { geometry: incoming, id: '', error: `invalid id "${id}"` };
  }

  const next = emit(incoming, id, op, args);
  return { geometry: next, id };
}

export default gGear;
