import {
  emit, freshId, isValidId, makeGeometry, num, parseGeometryPort,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

export function gCrossedHelicalGear(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const mod   = Number(input.module ?? 0.002);
  const teeth = Math.round(Number(input.teeth_number ?? 20));
  const width = Number(input.width ?? 0.01);

  if (!Number.isFinite(mod) || !Number.isFinite(width) || !Number.isFinite(teeth) || teeth < 3) {
    return { geometry: incoming, id: '', error: 'crossed_helical_gear: numeric params invalid' };
  }

  const args: Record<string, Arg> = {
    module:       num(mod),
    teeth_number: num(teeth),
    width:        num(width),
  };

  const optNum = ['pressure_angle', 'helix_angle', 'clearance', 'backlash', 'bore_d'] as const;
  for (const k of optNum) {
    const raw = input[k];
    if (raw === undefined || raw === '' || raw === null) continue;
    const v = Number(raw);
    if (!Number.isFinite(v) || v === 0) continue;
    args[k] = num(v);
  }

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'xhel');
  if (!isValidId(id)) {
    return { geometry: incoming, id: '', error: `invalid id "${id}"` };
  }

  const next = emit(incoming, id, 'crossed_helical_gear', args);
  return { geometry: next, id };
}

export default gCrossedHelicalGear;
