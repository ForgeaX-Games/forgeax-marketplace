import {
  emit, freshId, isValidId, makeGeometry, num, parseGeometryPort,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

export function gWorm(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const mod    = Number(input.module ?? 0.002);
  const lead   = Number(input.lead_angle ?? 5);
  const nThr   = Math.round(Number(input.n_threads ?? 1));
  const length = Number(input.length ?? 0.03);

  if (![mod, lead, length].every(Number.isFinite) || !Number.isFinite(nThr) || nThr < 1) {
    return { geometry: incoming, id: '', error: 'worm: numeric params invalid' };
  }

  const args: Record<string, Arg> = {
    module:     num(mod),
    lead_angle: num(lead),
    n_threads:  num(nThr),
    length:     num(length),
  };

  const optNum = ['pressure_angle', 'clearance', 'backlash', 'bore_d'] as const;
  for (const k of optNum) {
    const raw = input[k];
    if (raw === undefined || raw === '' || raw === null) continue;
    const v = Number(raw);
    if (!Number.isFinite(v) || v === 0) continue;
    args[k] = num(v);
  }

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'worm');
  if (!isValidId(id)) {
    return { geometry: incoming, id: '', error: `invalid id "${id}"` };
  }

  const next = emit(incoming, id, 'worm', args);
  return { geometry: next, id };
}

export default gWorm;
