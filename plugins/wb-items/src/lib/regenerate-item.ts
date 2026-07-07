import type {
  GenerateIconsResult,
  GenerateStylePlanResult,
  ItemRecord,
  NormalizeBatchResult,
  RegenerateItemResult,
  StylePresetHint,
} from '@shared/types';
import { callTool, type ToolResult } from '@/lib/toolClient';

/** 单条重生图：用已注册的旧工具拼出与 items:regenerate-item 等价的流程 */
export async function regenerateItemViaPipeline(
  item: ItemRecord,
  style: string,
  targetSize: number,
  customPrompt?: string,
  stylePreset?: StylePresetHint,
): Promise<ToolResult<RegenerateItemResult>> {
  const depicts = item.depicts?.trim() || item.name.zh || item.name.en || item.slug;
  const presetArg = stylePreset ? { stylePreset } : {};

  const planR = customPrompt?.trim()
    ? await callTool<GenerateStylePlanResult>('items:generate-style-plan', {
      style,
      proposedItems: [{
        slug: item.slug,
        name: item.name,
        depicts,
        prompt: customPrompt.trim(),
      }],
      ...presetArg,
    })
    : await callTool<GenerateStylePlanResult>('items:generate-style-plan', {
      style,
      slugs: [item.slug],
      ...presetArg,
    });

  if (!planR.ok) return planR;

  const batchId = planR.result.batchId;
  const planItems = planR.result.plan.map((p) => ({
    slug: p.slug,
    name: item.name,
    depicts: p.depicts,
    prompt: customPrompt?.trim() || p.prompt,
  }));

  const iconsR = await callTool<GenerateIconsResult>('items:generate-icons', {
    batchId,
    items: planItems,
    style,
    ...presetArg,
  });
  if (!iconsR.ok) return iconsR;

  const gen = iconsR.result.generated.find((g) => g.slug === item.slug);
  if (!gen && iconsR.result.failed.some((f) => f.slug === item.slug)) {
    const fail = iconsR.result.failed.find((f) => f.slug === item.slug);
    return {
      ok: true,
      result: {
        ok: true,
        batchId,
        itemSlug: item.slug,
        failed: fail?.error ?? '生图失败',
      },
    };
  }

  const normR = await callTool<NormalizeBatchResult>('items:normalize-sources', {
    batchId,
    targetSize,
    style,
    ...presetArg,
  });
  if (!normR.ok) return normR;

  return {
    ok: true,
    result: {
      ok: true,
      batchId,
      itemSlug: item.slug,
      generated: gen ? { slug: item.slug, path: gen.path } : undefined,
      normalize: normR.result,
    },
  };
}
