type AssetMediaKind = "image" | "model3d" | "animation" | "video" | "audio" | "document" | "game-asset";
type AssetJsonValue = string | number | boolean | null | AssetJsonValue[] | {
    [key: string]: AssetJsonValue;
};
interface AssetRef {
    id: string;
    ownerExtension: string;
    mediaKind: AssetMediaKind;
    uri?: string;
    previewUrl?: string;
    revision?: string;
    metadata?: Record<string, AssetJsonValue>;
}
declare function sanitizeAssetRef(input: unknown): AssetRef | null;

type ToolCallResult<TResult> = {
    ok: true;
    result: TResult;
} | {
    ok: false;
    error: string;
    code?: string;
};
interface ForgeaXToolPort {
    call(toolId: string, args: unknown, options?: {
        signal?: AbortSignal;
    }): Promise<ToolCallResult<unknown>>;
    listToolIds?(): Promise<Set<string>>;
}
declare class HttpForgeaXToolClient implements ForgeaXToolPort {
    private readonly endpoint;
    constructor(endpoint?: string);
    call(toolId: string, args: unknown, options?: {
        signal?: AbortSignal;
    }): Promise<ToolCallResult<unknown>>;
    listToolIds(): Promise<Set<string>>;
}

type GenerationJsonValue = string | number | boolean | null | GenerationJsonValue[] | GenerationJsonObject;
interface GenerationJsonObject {
    [key: string]: GenerationJsonValue;
}
interface AdapterContext<TParams extends GenerationJsonObject = GenerationJsonObject> {
    gameSlug: string;
    nodeId: string;
    params: TParams;
    inputs: Record<string, AssetRef[]>;
    signal?: AbortSignal;
}
type ReadinessResult = {
    ready: true;
} | {
    ready: false;
    reason: string;
};
interface AdapterOutput {
    assets: AssetRef[];
    preview?: GenerationJsonObject;
}
interface ForgeaXTaskAdapter<TParams extends GenerationJsonObject = GenerationJsonObject, TResult = unknown> {
    kind: string;
    version: number;
    title: string;
    description: string;
    category: "source" | "2d" | "3d" | "animation" | "video" | "audio" | "publish";
    toolId: string;
    capability?: {
        id: string;
        version: number;
    };
    inputRoles: string[];
    outputRole: string;
    cachePolicy: "never" | "by-input-fingerprint";
    costPolicy: "free" | "confirm";
    execution?: {
        kind: "generation-job";
        statusToolId: string;
        cancelToolId: string;
        pollIntervalMs: number;
    };
    createDefaultParams(): TParams;
    validate(context: AdapterContext<TParams>): ReadinessResult;
    buildArgs(context: AdapterContext<TParams>): unknown;
    normalizeResult(result: TResult): AdapterOutput;
}
declare function createVideoAdapters(): ForgeaXTaskAdapter[];
declare function buildVideoCapabilityInput(context: AdapterContext): GenerationJsonObject;
declare function normalizeVideoCapabilityResult(result: unknown): {
    assets: AssetRef[];
};

export { type AdapterContext, type AssetRef, type ForgeaXTaskAdapter, type ForgeaXToolPort, type GenerationJsonObject, type GenerationJsonValue, HttpForgeaXToolClient, buildVideoCapabilityInput, createVideoAdapters, normalizeVideoCapabilityResult, sanitizeAssetRef };
