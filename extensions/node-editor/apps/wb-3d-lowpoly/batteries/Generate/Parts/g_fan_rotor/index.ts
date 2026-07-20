import {
  bool, emit, freshId, isValidId, makeGeometry, num, parseGeometryPort,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

export function gFanRotor(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const outerR = Number(input.outer_radius ?? 0.04);
  const hubR   = Number(input.hub_radius ?? 0.01);
  const nBlade = Math.round(Number(input.blade_count ?? 5));
  const t      = Number(input.thickness ?? 0.012);

  if (![outerR, hubR, t].every(Number.isFinite) || !Number.isFinite(nBlade) || nBlade < 1) {
    return { geometry: incoming, id: '', error: 'fan_rotor: numeric params invalid' };
  }

  const args: Record<string, Arg> = {
    outer_radius: num(outerR),
    hub_radius:   num(hubR),
    blade_count:  num(nBlade),
    thickness:    num(t),
  };

  const optNum = ['blade_pitch_deg', 'blade_sweep_deg', 'blade_root_chord', 'blade_tip_chord'] as const;
  for (const k of optNum) {
    const raw = input[k];
    if (raw === undefined || raw === '' || raw === null) continue;
    const v = Number(raw);
    if (!Number.isFinite(v) || v === 0) continue;
    args[k] = num(v);
  }
  if (input.center === false || input.center === 'false') args.center = bool(false);

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'fan');
  if (!isValidId(id)) {
    return { geometry: incoming, id: '', error: `invalid id "${id}"` };
  }

  const next = emit(incoming, id, 'fan_rotor', args);
  return { geometry: next, id };
}

export default gFanRotor;
