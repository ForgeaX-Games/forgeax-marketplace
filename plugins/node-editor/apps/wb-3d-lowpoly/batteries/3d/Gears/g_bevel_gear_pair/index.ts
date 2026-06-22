import {
  emit, freshId, isValidId, makeGeometry, num, parseGeometryPort,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

export function gBevelGearPair(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const mod    = Number(input.module ?? 0.002);
  const gT     = Math.round(Number(input.gear_teeth ?? 30));
  const pT     = Math.round(Number(input.pinion_teeth ?? 15));
  const face   = Number(input.face_width ?? 0.008);

  if (!Number.isFinite(mod) || !Number.isFinite(face) || [gT, pT].some(v => !Number.isFinite(v) || v < 3)) {
    return { geometry: incoming, id: '', error: 'bevel_gear_pair: numeric params invalid' };
  }

  const args: Record<string, Arg> = {
    module:       num(mod),
    gear_teeth:   num(gT),
    pinion_teeth: num(pT),
    face_width:   num(face),
  };

  const optNum = ['axis_angle', 'pressure_angle', 'clearance', 'backlash'] as const;
  for (const k of optNum) {
    const raw = input[k];
    if (raw === undefined || raw === '' || raw === null) continue;
    const v = Number(raw);
    if (!Number.isFinite(v) || v === 0) continue;
    args[k] = num(v);
  }

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'bevp');
  if (!isValidId(id)) {
    return { geometry: incoming, id: '', error: `invalid id "${id}"` };
  }

  const next = emit(incoming, id, 'bevel_gear_pair', args);
  return { geometry: next, id };
}

export default gBevelGearPair;
