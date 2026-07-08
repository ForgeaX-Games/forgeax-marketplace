/**
 * 金标质量线 — 来自 forgeax-studio/default/assets/icons（batch pixel-48-20260706，41/41 QA 通过）
 * 用于独立验证与生成后门禁，避免「指标过线但肉眼发糊」的 demo 级输出。
 */

export const GOLD_BATCH_ID = 'pixel-48-20260706';

/** 金标生图 raw：1024×1024 方图为主 */
export const GOLD_RAW_SIZE = 1024;

/** 金标 raw 抠底后主体占比（p25≈35%，均值≈45%） */
export const GOLD_CUTOUT_FILL_PASS = 0.35;
export const GOLD_CUTOUT_FILL_WARN = 0.25;

/** 128px 采样色数：金标 48px 原生像素 raw≈709；1024 插画伪像素常 >2500 */
export const GOLD_RAW_SAMPLE_SIZE = 128;
export const GOLD_RAW_SAMPLE_COLORS_PASS = 1100;
export const GOLD_RAW_SAMPLE_COLORS_WARN = 1500;

/** 金标 48px 输出主体占比（min≈33%，p25≈47%） */
export const GOLD_OUTPUT_FILL_PASS = 0.45;
export const GOLD_OUTPUT_FILL_WARN = 0.33;
export const GOLD_OUTPUT_FILL_FAIL = 0.32;

/** 金标 48px 调色板（min≈23，max≈1226，中位≈534） */
export const GOLD_OUTPUT_COLORS_PASS = 1050;
export const GOLD_OUTPUT_COLORS_WARN = 1226;
export const GOLD_OUTPUT_COLORS_FAIL = 1300;

export type QualityVerdict = 'pass' | 'warn' | 'fail';

export interface RawQualityInput {
  width: number;
  height: number;
  cutoutFillRatio: number;
  /** 128px 采样不透明色数，用于拒绝插画伪像素 */
  sampleColors?: number;
}

export interface IconQualityInput {
  width: number;
  height: number;
  fillRatio: number;
  uniqueColors: number;
  qaPassed: boolean;
}

export interface QualityEvaluation {
  verdict: QualityVerdict;
  notes: string[];
}

function bump(current: QualityVerdict, next: QualityVerdict): QualityVerdict {
  const rank: Record<QualityVerdict, number> = { pass: 0, warn: 1, fail: 2 };
  return rank[next] > rank[current] ? next : current;
}

export function evaluateRawQuality(input: RawQualityInput, opts: { strict?: boolean } = {}): QualityEvaluation {
  const notes: string[] = [];
  let verdict: QualityVerdict = 'pass';
  const strict = opts.strict ?? false;

  const square = input.width === input.height;
  const exactGold = input.width === GOLD_RAW_SIZE && input.height === GOLD_RAW_SIZE;
  if (strict && !exactGold) {
    notes.push(`生图尺寸 ${input.width}×${input.height}，严格要求 ${GOLD_RAW_SIZE}×${GOLD_RAW_SIZE}`);
    verdict = bump(verdict, 'fail');
  } else if (!square) {
    notes.push(`非正方形生图 ${input.width}×${input.height}（金标要求 ${GOLD_RAW_SIZE}×${GOLD_RAW_SIZE}）`);
    verdict = bump(verdict, 'fail');
  } else if (!exactGold) {
    notes.push(`生图尺寸 ${input.width}×${input.height}，推荐 ${GOLD_RAW_SIZE}×${GOLD_RAW_SIZE}`);
    verdict = bump(verdict, strict ? 'fail' : 'warn');
  }

  if (input.cutoutFillRatio < GOLD_CUTOUT_FILL_WARN) {
    notes.push(`抠底后主体过小 ${(input.cutoutFillRatio * 100).toFixed(1)}%（金标 p25≈35%）`);
    verdict = bump(verdict, 'fail');
  } else if (input.cutoutFillRatio < GOLD_CUTOUT_FILL_PASS) {
    notes.push(`抠底后主体偏小 ${(input.cutoutFillRatio * 100).toFixed(1)}%（金标 p25≈35%）`);
    verdict = bump(verdict, strict ? 'fail' : 'warn');
  }

  if (input.sampleColors != null) {
    if (input.sampleColors > GOLD_RAW_SAMPLE_COLORS_WARN) {
      notes.push(
        `${GOLD_RAW_SAMPLE_SIZE}px 采样色数 ${input.sampleColors} 过高（插画伪像素，金标≈709）`,
      );
      verdict = bump(verdict, 'fail');
    } else if (input.sampleColors > GOLD_RAW_SAMPLE_COLORS_PASS) {
      notes.push(
        `${GOLD_RAW_SAMPLE_SIZE}px 采样色数 ${input.sampleColors} 偏高（易在下采样后发糊，金标≈709）`,
      );
      verdict = bump(verdict, strict ? 'fail' : 'warn');
    }
  }

  return { verdict, notes };
}

export function evaluateIconQuality(input: IconQualityInput): QualityEvaluation {
  const notes: string[] = [];
  let verdict: QualityVerdict = 'pass';

  if (input.width !== 48 || input.height !== 48) {
    notes.push(`输出尺寸 ${input.width}×${input.height}，应为 48×48`);
    verdict = bump(verdict, 'fail');
  }

  if (!input.qaPassed) {
    notes.push('QA 未通过（边缘脏像素 / 碎片 / 主体断裂）');
    verdict = bump(verdict, 'fail');
  }

  if (input.fillRatio < GOLD_OUTPUT_FILL_FAIL) {
    notes.push(`48px 主体过小 ${(input.fillRatio * 100).toFixed(1)}%（金标 min≈33%）`);
    verdict = bump(verdict, 'fail');
  } else if (input.fillRatio < GOLD_OUTPUT_FILL_PASS) {
    notes.push(`48px 主体偏小 ${(input.fillRatio * 100).toFixed(1)}%（金标 p25≈47%）`);
    verdict = bump(verdict, 'warn');
  }

  if (input.uniqueColors > GOLD_OUTPUT_COLORS_FAIL) {
    notes.push(`48px 色数过多 ${input.uniqueColors}（金标 max≈1226，易为插画糊边）`);
    verdict = bump(verdict, 'fail');
  } else if (input.uniqueColors > GOLD_OUTPUT_COLORS_WARN) {
    notes.push(`48px 色数偏高 ${input.uniqueColors}（金标 max≈1226）`);
    verdict = bump(verdict, 'warn');
  } else if (input.uniqueColors > GOLD_OUTPUT_COLORS_PASS) {
    notes.push(`48px 色数略高 ${input.uniqueColors}（金标中位≈534）`);
    verdict = bump(verdict, 'warn');
  }

  return { verdict, notes };
}

export function evaluatePipelineQuality(
  raw: RawQualityInput | null,
  icon: IconQualityInput,
): QualityEvaluation {
  const notes: string[] = [];
  let verdict: QualityVerdict = 'pass';

  if (raw) {
    const rawEval = evaluateRawQuality(raw);
    notes.push(...rawEval.notes);
    verdict = bump(verdict, rawEval.verdict);
  }

  const iconEval = evaluateIconQuality(icon);
  notes.push(...iconEval.notes);
  verdict = bump(verdict, iconEval.verdict);

  return { verdict, notes: [...new Set(notes)] };
}

export function isQualified(verdict: QualityVerdict): boolean {
  return verdict !== 'fail';
}
