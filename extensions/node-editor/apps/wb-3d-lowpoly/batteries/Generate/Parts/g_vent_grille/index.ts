import {
  bool, emit, freshId, isValidId, makeGeometry, num, numList, parseGeometryPort, str,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

export function gVentGrille(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const pw = Number(input.panel_w ?? 0.12);
  const ph = Number(input.panel_h ?? 0.08);

  if (![pw, ph].every(Number.isFinite)) {
    return { geometry: incoming, id: '', error: 'vent_grille: panel size must be finite' };
  }

  const args: Record<string, Arg> = {
    panel_size: numList([pw, ph]),
  };

  const optNumKeys = [
    'frame', 'face_thickness', 'duct_depth', 'duct_wall',
    'slat_pitch', 'slat_width', 'slat_angle_deg', 'slat_thickness',
    'corner_radius',
  ] as const;
  for (const k of optNumKeys) {
    const raw = input[k];
    if (raw === undefined || raw === '' || raw === null) continue;
    const v = Number(raw);
    if (!Number.isFinite(v) || v === 0) continue;
    args[k] = num(v);
  }
  const slatDir = String(input.slat_direction ?? '').trim().toLowerCase();
  if (slatDir === 'up' || slatDir === 'down') args.slat_direction = str(slatDir);
  if (input.center === false || input.center === 'false') args.center = bool(false);

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'vent');
  if (!isValidId(id)) {
    return { geometry: incoming, id: '', error: `invalid id "${id}"` };
  }

  const next = emit(incoming, id, 'vent_grille', args);
  return { geometry: next, id };
}

export default gVentGrille;
