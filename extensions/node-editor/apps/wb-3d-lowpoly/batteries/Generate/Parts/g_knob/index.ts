import {
  bool, emit, freshId, isValidId, makeGeometry, num, parseGeometryPort, str,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

export function gKnob(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const dia = Number(input.diameter ?? 0.025);
  const h   = Number(input.height ?? 0.018);

  if (!Number.isFinite(dia) || !Number.isFinite(h)) {
    return { geometry: incoming, id: '', error: 'knob: diameter/height must be finite' };
  }

  const args: Record<string, Arg> = {
    diameter: num(dia),
    height:   num(h),
  };

  const bodyStyle = String(input.body_style ?? '').trim();
  if (bodyStyle !== '' && bodyStyle !== 'cylindrical') args.body_style = str(bodyStyle);

  const optNum = [
    'top_diameter', 'base_diameter', 'crown_radius', 'edge_radius', 'side_draft_deg',
    'skirt_diameter', 'skirt_height', 'bore_d',
  ] as const;
  for (const k of optNum) {
    const raw = input[k];
    if (raw === undefined || raw === '' || raw === null) continue;
    const v = Number(raw);
    if (!Number.isFinite(v) || v === 0) continue;
    args[k] = num(v);
  }
  if (input.indicator === true || input.indicator === 'true') args.indicator = bool(true);
  if (input.center === false || input.center === 'false') args.center = bool(false);

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'knob');
  if (!isValidId(id)) {
    return { geometry: incoming, id: '', error: `invalid id "${id}"` };
  }

  const next = emit(incoming, id, 'knob', args);
  return { geometry: next, id };
}

export default gKnob;
