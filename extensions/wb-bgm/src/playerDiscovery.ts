import type { HumanFamilyResult } from './humanSearchTypes.ts';

export type PlayerResultSort = 'relevant' | 'unused' | 'explore';

export interface PlayerDiscoveryStats {
  previewed: Record<string, number>;
  attached: Record<string, number>;
}

export const EMPTY_PLAYER_DISCOVERY_STATS: PlayerDiscoveryStats = {
  previewed: {},
  attached: {},
};

export function sanitizePlayerDiscoveryStats(value: unknown): PlayerDiscoveryStats {
  if (!value || typeof value !== 'object') return { ...EMPTY_PLAYER_DISCOVERY_STATS };
  const source = value as Partial<PlayerDiscoveryStats>;
  const cleanRecord = (record: unknown): Record<string, number> => {
    if (!record || typeof record !== 'object') return {};
    return Object.fromEntries(
      Object.entries(record as Record<string, unknown>)
        .filter(([key, count]) =>
          Boolean(key) && typeof count === 'number' && Number.isFinite(count) && count > 0)
        .map(([key, count]) => [key, Math.floor(count as number)]),
    );
  };
  return {
    previewed: cleanRecord(source.previewed),
    attached: cleanRecord(source.attached),
  };
}

function increment(
  stats: PlayerDiscoveryStats,
  bucket: keyof PlayerDiscoveryStats,
  familyId: string,
): PlayerDiscoveryStats {
  return {
    previewed: { ...stats.previewed },
    attached: { ...stats.attached },
    [bucket]: {
      ...stats[bucket],
      [familyId]: (stats[bucket][familyId] ?? 0) + 1,
    },
  };
}

export function markFamilyPreviewed(
  stats: PlayerDiscoveryStats,
  familyId: string,
): PlayerDiscoveryStats {
  return increment(stats, 'previewed', familyId);
}

export function markFamilyAttached(
  stats: PlayerDiscoveryStats,
  familyId: string,
): PlayerDiscoveryStats {
  return increment(stats, 'attached', familyId);
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function sortPlayerCandidates(
  candidates: readonly HumanFamilyResult[],
  mode: PlayerResultSort,
  stats: PlayerDiscoveryStats,
  explorationSeed: string,
): HumanFamilyResult[] {
  const indexed = candidates.map((candidate, index) => ({ candidate, index }));
  if (mode === 'relevant') return indexed.map(({ candidate }) => candidate);

  if (mode === 'unused') {
    return indexed
      .sort((left, right) => {
        const leftAttached = stats.attached[left.candidate.familyId] ?? 0;
        const rightAttached = stats.attached[right.candidate.familyId] ?? 0;
        const leftPreviewed = stats.previewed[left.candidate.familyId] ?? 0;
        const rightPreviewed = stats.previewed[right.candidate.familyId] ?? 0;
        return Number(leftAttached > 0) - Number(rightAttached > 0)
          || leftPreviewed - rightPreviewed
          || left.index - right.index;
      })
      .map(({ candidate }) => candidate);
  }

  const levelOrder = { exact: 0, relaxed: 1, partial: 2 };
  return indexed
    .sort((left, right) => {
      const leftPreviewed = stats.previewed[left.candidate.familyId] ?? 0;
      const rightPreviewed = stats.previewed[right.candidate.familyId] ?? 0;
      return levelOrder[left.candidate.matchLevel] - levelOrder[right.candidate.matchLevel]
        || Number(leftPreviewed > 0) - Number(rightPreviewed > 0)
        || stableHash(`${explorationSeed}:${left.candidate.familyId}`)
          - stableHash(`${explorationSeed}:${right.candidate.familyId}`);
    })
    .map(({ candidate }) => candidate);
}

export function playerCandidateState(
  familyId: string,
  stats: PlayerDiscoveryStats,
): 'attached' | 'previewed' | 'new' {
  if ((stats.attached[familyId] ?? 0) > 0) return 'attached';
  if ((stats.previewed[familyId] ?? 0) > 0) return 'previewed';
  return 'new';
}
