import {
  bool, emit, freshId, isValidId, makeGeometry, num, numList, parseGeometryPort,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

export function gPerforatedPanel(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const pw = Number(input.panel_w ?? 0.12);
  const ph = Number(input.panel_h ?? 0.08);
  const t  = Number(input.thickness ?? 0.003);
  const hd = Number(input.hole_diameter ?? 0.004);
  const px = Number(input.pitch_x ?? 0.008);
  const py = Number(input.pitch_y ?? px);

  if (![pw, ph, t, hd, px, py].every(Number.isFinite)) {
    return { geometry: incoming, id: '', error: 'perforated_panel: numeric params must be finite' };
  }

  const args: Record<string, Arg> = {
    panel_size:    numList([pw, ph]),
    thickness:     num(t),
    hole_diameter: num(hd),
    pitch:         numList([px, py]),
  };

  const frame = Number(input.frame ?? 0.008);
  if (frame !== 0.008) args.frame = num(frame);
  const cr = Number(input.corner_radius ?? 0);
  if (cr !== 0) args.corner_radius = num(cr);
  if (input.stagger === true || input.stagger === 'true') args.stagger = bool(true);
  if (input.center === false || input.center === 'false') args.center = bool(false);

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'perf');
  if (!isValidId(id)) {
    return { geometry: incoming, id: '', error: `invalid id "${id}"` };
  }

  const next = emit(incoming, id, 'perforated_panel', args);
  return { geometry: next, id };
}

export default gPerforatedPanel;
