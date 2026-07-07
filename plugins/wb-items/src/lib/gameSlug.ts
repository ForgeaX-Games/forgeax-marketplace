const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
const slugParam = params.get('slug')?.trim();

export const activeSlug: string | null = slugParam && slugParam.length > 0 ? slugParam : null;

export function hasActiveGame(): boolean {
  return activeSlug !== null;
}
