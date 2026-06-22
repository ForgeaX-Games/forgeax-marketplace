import {
  emit, freshId, isValidId, makeGeometry, num, parseGeometryPort,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

export function gRackGear(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const mod    = Number(input.module ?? 0.002);
  const length = Number(input.length ?? 0.1);
  const width  = Number(input.width ?? 0.01);
  const height = Number(input.height ?? 0.01);

  if (![mod, length, width, height].every(Number.isFinite)) {
    return { geometry: incoming, id: '', error: 'rack_gear: numeric params must be finite' };
  }

  const args: Record<string, Arg> = {
    module: num(mod),
    length: num(length),
    width:  num(width),
    height: num(height),
  };

  const optNum = ['pressure_angle', 'clearance', 'backlash'] as const;
  for (const k of optNum) {
    const raw = input[k];
    if (raw === undefined || raw === '' || raw === null) continue;
    const v = Number(raw);
    if (!Number.isFinite(v) || v === 0) continue;
    args[k] = num(v);
  }

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'rack');
  if (!isValidId(id)) {
    return { geometry: incoming, id: '', error: `invalid id "${id}"` };
  }

  const next = emit(incoming, id, 'rack_gear', args);
  return { geometry: next, id };
}

export default gRackGear;
