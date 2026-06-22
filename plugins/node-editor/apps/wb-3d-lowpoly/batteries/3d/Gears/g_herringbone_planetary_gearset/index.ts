import {
  emit, freshId, isValidId, makeGeometry, num, parseGeometryPort,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

export function gHerringbonePlanetaryGearset(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const mod    = Number(input.module ?? 0.002);
  const sunT   = Math.round(Number(input.sun_teeth_number ?? 12));
  const plaT   = Math.round(Number(input.planet_teeth_number ?? 18));
  const width  = Number(input.width ?? 0.018);
  const rim    = Number(input.rim_width ?? 0.005);
  const nPla   = Math.round(Number(input.n_planets ?? 3));

  if (![mod, width, rim].every(Number.isFinite)
    || [sunT, plaT].some(v => !Number.isFinite(v) || v < 3)
    || !Number.isFinite(nPla) || nPla < 1) {
    return { geometry: incoming, id: '', error: 'herringbone_planetary_gearset: module/width/rim_width must be finite, sun/planet teeth must be >= 3, n_planets >= 1' };
  }

  const args: Record<string, Arg> = {
    module:              num(mod),
    sun_teeth_number:    num(sunT),
    planet_teeth_number: num(plaT),
    width:               num(width),
    rim_width:           num(rim),
    n_planets:           num(nPla),
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
  const id = rawId !== '' ? rawId : freshId(incoming, 'hplan');
  if (!isValidId(id)) {
    return { geometry: incoming, id: '', error: `invalid id "${id}"` };
  }

  const next = emit(incoming, id, 'herringbone_planetary_gearset', args);
  return { geometry: next, id };
}

export default gHerringbonePlanetaryGearset;
