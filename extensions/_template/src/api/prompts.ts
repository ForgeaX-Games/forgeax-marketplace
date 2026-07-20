/* Plugin-owned (non-agentic) AI calls — see Module 16 §10.
 * Use these for deterministic, one-shot model calls: prompt rewriting,
 * workflow steps, image generation. Anything multi-turn / tool-using
 * stays in Studio's ChatPanel.
 *
 * `bus.callModel` is implemented by Bridge.ts in embedded mode (postMessage)
 * and a direct fetch in standalone mode. The transport difference is
 * invisible to this file.
 */
import type { Bridge } from '../platform/Bridge';

export async function rewritePrompt(bridge: Bridge, raw: string): Promise<string> {
  const result = (await bridge.callTool('model:text', {
    channel: 'llm/text/cheap',
    messages: [
      { role: 'system', content: 'You are a prompt-rewriting assistant. Return improved prompt only.' },
      { role: 'user', content: raw },
    ],
  })) as { content?: string };
  return result?.content ?? raw;
}
