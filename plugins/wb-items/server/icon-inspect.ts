import sharp from 'sharp';

import {
  inspectUiAssetCanvas,
  isIconInspectionRejected,
  isIconInspectionRejectedRelaxed,
  type UiAssetCanvasInspection,
} from '@forgeax/ui-asset-cleanup';

function qaFromInspection(report: UiAssetCanvasInspection, pixelDelivery: boolean) {
  return {
    opaqueEdgePixels: report.opaqueEdgePixels,
    transparentCornerDirtyPixels: report.transparentCornerDirtyPixels,
    fragmentationRatio: report.fragmentationRatio,
    largestComponentRatio: report.largestComponentRatio,
    opaqueBoundsFillRatio: report.opaqueBoundsFillRatio,
    passed: pixelDelivery
      ? !isIconInspectionRejectedRelaxed(report)
      : !isIconInspectionRejected(report),
  };
}

export async function inspectCanvasFromDataUrl(dataUrl: string, pixelDelivery: boolean) {
  const report = await inspectUiAssetCanvas(dataUrl);
  return qaFromInspection(report, pixelDelivery);
}

/** 与 UI 工坊 `inspectUiAssetCanvas` 同一套 QA 规则 */
export async function inspectCanvas(
  data: Buffer,
  width: number,
  height: number,
  pixelDelivery: boolean,
) {
  const png = await sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
  return inspectCanvasFromDataUrl(dataUrl, pixelDelivery);
}
