import {
  bool, emit, freshId, isValidId, makeGeometry, num, parseGeometryPort,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

export function gBlowerWheel(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const outerR = Number(input.outer_radius ?? 0.05);
  const innerR = Number(input.inner_radius ?? 0.035);
  const width  = Number(input.width ?? 0.04);
  const nBlade = Math.round(Number(input.blade_count ?? 24));
  const bladeT = Number(input.blade_thickness ?? 0.0015);

  if (![outerR, innerR, width, bladeT].every(Number.isFinite) || !Number.isFinite(nBlade) || nBlade < 1) {
    return { geometry: incoming, id: '', error: 'blower_wheel: numeric params invalid' };
  }

  const args: Record<string, Arg> = {
    outer_radius:    num(outerR),
    inner_radius:    num(innerR),
    width:           num(width),
    blade_count:     num(nBlade),
    blade_thickness: num(bladeT),
  };

  const sweep = Number(input.blade_sweep_deg ?? 0);
  if (sweep !== 0) args.blade_sweep_deg = num(sweep);
  if (input.backplate === false || input.backplate === 'false') args.backplate = bool(false);
  if (input.shroud === true || input.shroud === 'true') args.shroud = bool(true);
  if (input.center === false || input.center === 'false') args.center = bool(false);

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'blow');
  if (!isValidId(id)) {
    return { geometry: incoming, id: '', error: `invalid id "${id}"` };
  }

  const next = emit(incoming, id, 'blower_wheel', args);
  return { geometry: next, id };
}

export default gBlowerWheel;
