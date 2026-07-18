import {
  bool, emit, freshId, isValidId, makeGeometry, num, numList, parseGeometryPort, str,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

export function gBezel(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const ow = Number(input.opening_w ?? 0.08);
  const oh = Number(input.opening_h ?? 0.05);
  const xw = Number(input.outer_w ?? 0.1);
  const xh = Number(input.outer_h ?? 0.07);
  const dep = Number(input.depth ?? 0.005);

  if (![ow, oh, xw, xh, dep].every(Number.isFinite)) {
    return { geometry: incoming, id: '', error: 'bezel: numeric params must be finite' };
  }

  const args: Record<string, Arg> = {
    opening_size: numList([ow, oh]),
    outer_size:   numList([xw, xh]),
    depth:        num(dep),
  };

  const openingShape = String(input.opening_shape ?? '').trim();
  if (openingShape !== '' && openingShape !== 'rect') args.opening_shape = str(openingShape);
  const outerShape = String(input.outer_shape ?? '').trim();
  if (outerShape !== '' && outerShape !== 'rect') args.outer_shape = str(outerShape);

  const ocr = Number(input.opening_corner_radius ?? 0);
  if (ocr !== 0) args.opening_corner_radius = num(ocr);
  const xcr = Number(input.outer_corner_radius ?? 0);
  if (xcr !== 0) args.outer_corner_radius = num(xcr);
  const wall = Number(input.wall ?? 0);
  if (wall !== 0) args.wall = num(wall);
  const flangeWidth = Number(input.flange_width ?? 0);
  if (Number.isFinite(flangeWidth) && flangeWidth > 0) args.flange_width = num(flangeWidth);
  const recessDepth = Number(input.recess_depth ?? 0);
  if (Number.isFinite(recessDepth) && recessDepth > 0) args.recess_depth = num(recessDepth);

  if (input.center === false || input.center === 'false') args.center = bool(false);

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'bez');
  if (!isValidId(id)) {
    return { geometry: incoming, id: '', error: `invalid id "${id}"` };
  }

  const next = emit(incoming, id, 'bezel', args);
  return { geometry: next, id };
}

export default gBezel;
