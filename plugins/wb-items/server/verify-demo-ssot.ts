/**
 * 自动验证 demo 游戏图标 SSOT 抠图管线（无需手动打开 Studio）。
 *
 * Usage:
 *   FORGEAX_PROJECT_ROOT=<studio-root> bun server/verify-demo-ssot.ts
 */
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import { ICON_NORMALIZE_REV } from '../shared/catalog';
import { readIconQualityInputInPlace, readRawQualityInput } from './icon-audit';
import { measureIconContent, normalizeIconFile } from './icon-normalize';
import { findLatestRawIcon } from './icon-normalize';
import { gameRoot, iconsDir, itemsJsonPath, projectRoot } from './item-store';
import { tools } from './tool-handlers';

const SLUG = 'demo';

interface IconReport {
  slug: string;
  iconPath: string;
  rawPath: string | null;
  beforeBytes: number;
  afterBytes: number;
  beforeFill: number;
  afterFill: number;
  qaPassed: boolean;
  uniqueColors: number;
  renormalized: boolean;
}

async function main(): Promise<void> {
  console.log(`[verify-demo-ssot] projectRoot=${projectRoot()}`);
  console.log(`[verify-demo-ssot] ICON_NORMALIZE_REV=${ICON_NORMALIZE_REV}`);

  const beforeDoc = JSON.parse(await readFile(itemsJsonPath(SLUG), 'utf-8')) as {
    meta?: { iconNormalizeRev?: number };
    items: Array<{ slug: string; iconStyle?: string }>;
  };
  const revBefore = beforeDoc.meta?.iconNormalizeRev ?? 0;
  console.log(`[verify-demo-ssot] items.json rev before listItems: ${revBefore}`);

  const listResult = await tools['items:list']({ slug: SLUG });
  const revAfter = listResult.document.meta?.iconNormalizeRev ?? 0;
  console.log(`[verify-demo-ssot] items.json rev after listItems: ${revAfter}`);

  const reports: IconReport[] = [];
  for (const item of listResult.document.items) {
    const iconRel = item.icon.replace(/^\.?\//, '');
    const iconPath = resolve(gameRoot(SLUG), iconRel);
    const rawPath = await findLatestRawIcon(item.slug);
    const before = await measureIconContent(iconPath).catch(() => null);
    const beforeBytes = (await stat(iconPath).catch(() => null))?.size ?? 0;

    let renormalized = false;
    if (rawPath) {
      const tmp = `${iconPath}.ssot-verify.tmp.png`;
      await normalizeIconFile(rawPath, tmp, {
        targetSize: listResult.document.meta?.iconSize ?? 48,
        delivery: item.iconStyle === 'pixel-48' || !item.iconStyle
          ? 'png-pixel'
          : 'png-transparent',
      });
      const qa = await readIconQualityInputInPlace(tmp);
      renormalized = true;
      reports.push({
        slug: item.slug,
        iconPath,
        rawPath,
        beforeBytes,
        afterBytes: (await stat(tmp)).size,
        beforeFill: before?.fillRatio ?? 0,
        afterFill: qa.fillRatio,
        qaPassed: qa.qaPassed,
        uniqueColors: qa.uniqueColors,
        renormalized,
      });
      continue;
    }

    const qa = await readIconQualityInputInPlace(iconPath);
    reports.push({
      slug: item.slug,
      iconPath,
      rawPath: null,
      beforeBytes,
      afterBytes: beforeBytes,
      beforeFill: before?.fillRatio ?? qa.fillRatio,
      afterFill: qa.fillRatio,
      qaPassed: qa.qaPassed,
      uniqueColors: qa.uniqueColors,
      renormalized,
    });
  }

  console.log('\n=== DEMO ICON AUDIT (SSOT cutout) ===');
  let qaPass = 0;
  let qaFail = 0;
  for (const r of reports) {
    const mark = r.qaPassed ? 'PASS' : 'FAIL';
    if (r.qaPassed) qaPass++; else qaFail++;
    console.log(
      `${mark}  ${r.slug.padEnd(16)} fill ${(r.afterFill * 100).toFixed(1).padStart(5)}%  colors=${String(r.uniqueColors).padStart(4)}  raw=${r.rawPath ? 'yes' : 'no '}  qa=${r.qaPassed ? 'ok' : 'bad'}`,
    );
  }

  const rawChecks = [
    'magic-box-raw.png',
    'box-raw.png',
    'item-50f1830c-raw.png',
  ];
  console.log('\n=== RAW CUTOUT SPOT CHECK ===');
  for (const name of rawChecks) {
    const slug = name.replace(/-raw\.png$/i, '');
    const rawPath = await findLatestRawIcon(slug);
    if (!rawPath) {
      console.log(`SKIP  ${name} (no raw found)`);
      continue;
    }
    const cut = await readRawQualityInput(rawPath);
    console.log(
      `RAW   ${slug.padEnd(16)} cutoutFill=${(cut.cutoutFillRatio * 100).toFixed(1)}%  sampleColors=${cut.sampleColors}`,
    );
  }

  console.log('\n=== SUMMARY ===');
  console.log(`  icons: ${reports.length}`);
  console.log(`  QA pass: ${qaPass}/${reports.length}`);
  console.log(`  QA fail: ${qaFail}/${reports.length}`);
  console.log(`  rev bump: ${revBefore} → ${revAfter}`);
  console.log(`  listItems ok: ${listResult.ok}`);

  if (qaFail > 0 || revAfter < ICON_NORMALIZE_REV) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
