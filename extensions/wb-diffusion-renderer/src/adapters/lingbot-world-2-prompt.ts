import type { ResolvedEffectFrame } from '../effect-frame';
import type { VisualDirection } from '../adapter';

export const LINGBOT_PROMPT_MAX_CHARACTERS = 2_000;

export class LingbotPromptTooLargeError extends Error {
  readonly code = 'unsupported-input' as const;

  constructor(
    readonly characters: number,
    readonly limit = LINGBOT_PROMPT_MAX_CHARACTERS,
  ) {
    super(`LingBot World 2 prompt is ${characters} characters; the limit is ${limit}`);
  }
}

/**
 * LingBot owns only serialization. Recipe selection and prompt merge have
 * already happened in the provider-neutral evaluator.
 */
export function composeLingbotWorld2Prompt(
  direction: VisualDirection,
  frame: ResolvedEffectFrame | undefined,
): { readonly prompt: string; readonly characters: number } {
  const prompt = [
    direction.prompt.trim(),
    ...(frame?.prompt.map((contribution) => contribution.text) ?? []),
  ].filter(Boolean).join(' ') || 'A coherent game world.';
  if (prompt.length > LINGBOT_PROMPT_MAX_CHARACTERS) {
    throw new LingbotPromptTooLargeError(prompt.length);
  }
  return { prompt, characters: prompt.length };
}
