import { gameImportStatus, importLowpolyAsset } from './game-import.ts';

interface ToolContext {
  caller: {
    kind: 'user' | 'ai' | 'skill' | 'workbench' | 'cli';
    sessionId?: string;
    threadId?: string;
    agentId?: string;
  };
  toolId: string;
  projectRoot: string;
  game?: string;
}

type ToolHandler = (args: unknown, context: ToolContext) => Promise<unknown>;

function assetPathArg(args: unknown): string {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw Object.assign(new Error('assetPath is required.'), { code: 'invalid_asset_path' });
  }
  const assetPath = (args as { assetPath?: unknown }).assetPath;
  if (typeof assetPath !== 'string' || !assetPath.trim()) {
    throw Object.assign(new Error('assetPath is required.'), { code: 'invalid_asset_path' });
  }
  return assetPath;
}

function sessionGame(context: ToolContext): string {
  if (!context.caller.sessionId && !context.caller.threadId) {
    throw Object.assign(new Error('A session-bound game is required for delivery.'), {
      code: 'missing_session_game',
    });
  }
  if (!context.game) {
    throw Object.assign(new Error('This session is not bound to a game.'), { code: 'missing_session_game' });
  }
  return context.game;
}

function failure(error: unknown): { ok: false; code: string; message: string; retryable: boolean } {
  const coded = error as { code?: unknown; retryable?: unknown; message?: unknown };
  return {
    ok: false,
    code: typeof coded.code === 'string' ? coded.code : 'lowpoly_delivery_failed',
    message: typeof coded.message === 'string' ? coded.message : String(error),
    retryable: coded.retryable === true,
  };
}

async function run(
  args: unknown,
  context: ToolContext,
  operation: (projectRoot: string, game: string, assetPath: string) => Promise<unknown>,
): Promise<unknown> {
  try {
    return await operation(context.projectRoot, sessionGame(context), assetPathArg(args));
  } catch (error) {
    return failure(error);
  }
}

export const tools: Record<string, ToolHandler> = {
  'lowpoly:game-import-status': (args, context) => run(args, context, gameImportStatus),
  'lowpoly:import-to-game': (args, context) => run(args, context, importLowpolyAsset),
};

export default tools;
