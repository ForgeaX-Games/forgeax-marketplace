/**
 * Public composition surface for the Diffusion Renderer workbench plugin.
 *
 * Hosts provide the source; provider adapters and panel wiring stay behind this
 * entry so consumers do not depend on the plugin's internal file layout.
 */
import type { VisualSource } from './adapter';
import { FluxRtAdapter } from './adapters/fluxrt';
import { LingbotWorld2Adapter } from './adapters/lingbot-world-2';
import type { GenerativeVisualsRuntime } from './panel';

export {
  GenerativeVisualsPanel,
  WB_DIFFUSION_RENDERER_PLUGIN_ID,
} from './panel';
export { GenerativeVisualsPresenter } from './presenter';
export type { GenerativeVisualsRuntime } from './panel';
export type {
  GenerativeVisualsPresenterApi,
  VisualPresenterSelection,
  VisualPresenterSnapshot,
} from './presenter';
export type {
  ResolvedVisualRequest,
  VisualBackendAdapter,
  VisualBackendSession,
  VisualDirection,
  VisualSource,
  VisualSourceSnapshot,
  VisualViewportLease,
} from './adapter';

export function createGenerativeVisualsRuntime(
  createSource: () => VisualSource,
): GenerativeVisualsRuntime {
  return {
    createSource,
    adapters: [
      new LingbotWorld2Adapter(),
      new FluxRtAdapter(),
    ],
  };
}
