import {
  bool, emit, freshId, isValidId, makeGeometry, num, numList, parseGeometryPort,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

export function gSlotPanel(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const pw = Number(input.panel_w ?? 0.12);
  const ph = Number(input.panel_h ?? 0.08);
  const t  = Number(input.thickness ?? 0.003);
  const sw = Number(input.slot_w ?? 0.012);
  const sh = Number(input.slot_h ?? 0.003);
  const px = Number(input.pitch_x ?? 0.018);
  const py = Number(input.pitch_y ?? 0.008);

  if (![pw, ph, t, sw, sh, px, py].every(Number.isFinite)) {
    return { geometry: incoming, id: '', error: 'slot_panel: numeric params must be finite' };
  }

  const args: Record<string, Arg> = {
    panel_size: numList([pw, ph]),
    thickness:  num(t),
    slot_size:  numList([sw, sh]),
    pitch:      numList([px, py]),
  };

  const frame = Number(input.frame ?? 0.008);
  if (frame !== 0.008) args.frame = num(frame);
  const cr = Number(input.corner_radius ?? 0);
  if (cr !== 0) args.corner_radius = num(cr);
  const ang = Number(input.slot_angle_deg ?? 0);
  if (ang !== 0) args.slot_angle_deg = num(ang);
  if (input.stagger === true || input.stagger === 'true') args.stagger = bool(true);
  if (input.center === false || input.center === 'false') args.center = bool(false);

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'slot');
  if (!isValidId(id)) {
    return { geometry: incoming, id: '', error: `invalid id "${id}"` };
  }

  const next = emit(incoming, id, 'slot_panel', args);
  return { geometry: next, id };
}

export default gSlotPanel;
