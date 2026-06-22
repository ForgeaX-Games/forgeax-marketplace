import {
  emit, freshId, isValidId, makeGeometry, num, parseGeometryPort,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

export function gCrossedGearPair(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const mod    = Number(input.module ?? 0.002);
  const g1T    = Math.round(Number(input.gear1_teeth_number ?? 20));
  const g2T    = Math.round(Number(input.gear2_teeth_number ?? 24));
  const g1W    = Number(input.gear1_width ?? 0.01);
  const g2W    = Number(input.gear2_width ?? 0.01);

  if (!Number.isFinite(mod) || ![g1W, g2W].every(Number.isFinite) || [g1T, g2T].some(v => !Number.isFinite(v) || v < 3)) {
    return { geometry: incoming, id: '', error: 'crossed_gear_pair: numeric params invalid' };
  }

  const args: Record<string, Arg> = {
    module:             num(mod),
    gear1_teeth_number: num(g1T),
    gear2_teeth_number: num(g2T),
    gear1_width:        num(g1W),
    gear2_width:        num(g2W),
  };

  const optNum = ['shaft_angle', 'gear1_helix_angle', 'pressure_angle', 'clearance', 'backlash'] as const;
  for (const k of optNum) {
    const raw = input[k];
    if (raw === undefined || raw === '' || raw === null) continue;
    const v = Number(raw);
    if (!Number.isFinite(v) || v === 0) continue;
    args[k] = num(v);
  }

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'xpr');
  if (!isValidId(id)) {
    return { geometry: incoming, id: '', error: `invalid id "${id}"` };
  }

  const next = emit(incoming, id, 'crossed_gear_pair', args);
  return { geometry: next, id };
}

export default gCrossedGearPair;
