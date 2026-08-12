// src/adapters/video.ts
var OWNER = "@forgeax/workbench-host";
var VIDEO_CAPABILITY = {
  id: "media.video.generate",
  version: 1
};
var SUPPORTED_REFERENCE_ROLES = /* @__PURE__ */ new Set([
  "reference_image",
  "first_frame",
  "last_frame"
]);
function createVideoAdapters() {
  return [{
    kind: "forgeax.video.node-video",
    version: 1,
    title: "\u751F\u6210\u8282\u70B9\u89C6\u9891",
    description: "\u901A\u8FC7\u5F53\u524D Studio Host \u7684 media.video.generate@1 \u80FD\u529B\u751F\u6210\u89C6\u9891\u3002",
    category: "video",
    toolId: "",
    capability: VIDEO_CAPABILITY,
    inputRoles: [...SUPPORTED_REFERENCE_ROLES],
    outputRole: "video",
    cachePolicy: "never",
    costPolicy: "confirm",
    createDefaultParams: () => ({
      sceneNodeId: "scene-node",
      nodeName: "Scene",
      storyText: "",
      characterRefIds: ["character-ref"],
      sceneRefIds: ["scene-ref"],
      durationSeconds: 5,
      generateAudio: false
    }),
    validate: (context) => {
      const missing = ["sceneNodeId", "nodeName", "storyText", "characterRefIds", "sceneRefIds"].filter((key) => !hasValue(context.params[key]));
      return missing.length > 0 ? { ready: false, reason: `\u7F3A\u5C11\u53C2\u6570: ${missing.join(", ")}` } : { ready: true };
    },
    buildArgs: (context) => buildVideoCapabilityInput(context),
    normalizeResult: (result) => normalizeVideoCapabilityResult(result)
  }];
}
function buildVideoCapabilityInput(context) {
  const params = context.params;
  const references = Object.entries(context.inputs).flatMap(
    ([role, assets]) => SUPPORTED_REFERENCE_ROLES.has(role) ? assets.flatMap((asset) => asset.id ? [{ role, assetId: asset.id }] : []) : []
  );
  return {
    prompt: readString(params.storyText) ?? "",
    durationSeconds: readNumber(params.durationSeconds) ?? 5,
    generateAudio: params.generateAudio === true,
    references,
    metadata: {
      sceneNodeId: readString(params.sceneNodeId) ?? context.nodeId,
      nodeName: readString(params.nodeName) ?? "Scene",
      characterRefIds: readStringArray(params.characterRefIds),
      sceneRefIds: readStringArray(params.sceneRefIds)
    }
  };
}
function normalizeVideoCapabilityResult(result) {
  const asset = isRecord(result) && isRecord(result.asset) ? result.asset : null;
  if (!asset || typeof asset.id !== "string" || asset.id.trim().length === 0 || asset.kind !== "video" || asset.status !== "ready") {
    throw new Error("\u5BBF\u4E3B\u89C6\u9891\u751F\u6210\u80FD\u529B\u8FD4\u56DE\u4E86\u65E0\u6548\u7684\u5C31\u7EEA\u89C6\u9891\u8D44\u4EA7");
  }
  const uri = readString(asset.url) ?? readString(asset.file);
  return {
    assets: [{
      id: asset.id,
      ownerExtension: OWNER,
      mediaKind: "video",
      ...uri ? { uri } : {}
    }]
  };
}
function hasValue(value) {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return value !== void 0 && value !== null;
}
function readString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
function readNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}
function readStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim().length > 0) : [];
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/forgeax/tool-client.ts
var HttpForgeaXToolClient = class {
  constructor(endpoint = "/api/tools/call") {
    this.endpoint = endpoint;
  }
  endpoint;
  async call(toolId, args, options) {
    let response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toolId,
          args,
          caller: { kind: "user" }
        }),
        signal: options?.signal
      });
    } catch (error) {
      return {
        ok: false,
        code: options?.signal?.aborted ? "cancelled" : "network_error",
        error: error instanceof Error ? error.message : String(error)
      };
    }
    const body = await response.json().catch(() => null);
    if (!body || typeof body.ok !== "boolean") {
      return {
        ok: false,
        code: "bad_response",
        error: `ToolRegistry \u8FD4\u56DE\u4E86\u65E0\u6548\u54CD\u5E94\uFF08HTTP ${response.status}\uFF09`
      };
    }
    return body;
  }
  async listToolIds() {
    const endpoint = this.endpoint.replace(/\/call\/?$/, "");
    const response = await fetch(endpoint);
    if (!response.ok) throw new Error(`\u5DE5\u5177\u76EE\u5F55\u4E0D\u53EF\u7528\uFF08HTTP ${response.status}\uFF09`);
    const body = await response.json();
    if (!isRecord2(body) || !Array.isArray(body.tools)) {
      throw new Error("\u5DE5\u5177\u76EE\u5F55\u8FD4\u56DE\u4E86\u65E0\u6548\u54CD\u5E94");
    }
    return new Set(body.tools.flatMap(
      (tool) => isRecord2(tool) && typeof tool.id === "string" && tool.hasHandler !== false ? [tool.id] : []
    ));
  }
};
function isRecord2(input) {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

// src/forgeax/asset-ref.ts
var MEDIA_KINDS = /* @__PURE__ */ new Set([
  "image",
  "model3d",
  "animation",
  "video",
  "audio",
  "document",
  "game-asset"
]);
function sanitizeAssetRef(input) {
  if (!isRecord3(input)) return null;
  const id = readString2(input.id);
  const ownerExtension = readString2(input.ownerExtension);
  const mediaKind = readString2(input.mediaKind);
  if (!id || !ownerExtension || !mediaKind || !MEDIA_KINDS.has(mediaKind)) {
    return null;
  }
  const metadata = sanitizeRecord(input.metadata);
  return {
    id,
    ownerExtension,
    mediaKind,
    ...safeLocation("uri", input.uri),
    ...safePreviewUrl(input.previewUrl),
    ...optionalString("revision", input.revision),
    ...metadata && Object.keys(metadata).length > 0 ? { metadata } : {}
  };
}
function safePreviewUrl(input) {
  return safeLocation("previewUrl", input);
}
function safeLocation(key, input) {
  const value = readString2(input);
  if (!value || value.startsWith("blob:") || value.startsWith("data:")) return {};
  if (/^https?:/i.test(value)) {
    try {
      const url = new URL(value);
      const transientKeys = [
        "signature",
        "sig",
        "token",
        "expires",
        "x-cos-signature",
        "x-amz-signature",
        "x-goog-signature"
      ];
      if ([...url.searchParams.keys()].some(
        (name) => transientKeys.some((keyName) => name.toLowerCase().includes(keyName))
      )) return {};
    } catch {
      return {};
    }
  }
  return { [key]: value };
}
function optionalString(key, input) {
  const value = readString2(input);
  return value ? { [key]: value } : {};
}
function sanitizeRecord(input) {
  if (!isRecord3(input)) return null;
  const entries = Object.entries(input).flatMap(([key, value]) => {
    const sanitized = sanitizeValue(value);
    return sanitized === void 0 ? [] : [[key, sanitized]];
  });
  return Object.fromEntries(entries);
}
function sanitizeValue(input) {
  if (input === null || typeof input === "string" || typeof input === "boolean") {
    return input;
  }
  if (typeof input === "number") return Number.isFinite(input) ? input : void 0;
  if (Array.isArray(input)) {
    const values = input.map(sanitizeValue);
    return values.some((value) => value === void 0) ? void 0 : values;
  }
  return sanitizeRecord(input) ?? void 0;
}
function readString2(input) {
  if (typeof input !== "string") return null;
  const value = input.trim();
  return value ? value : null;
}
function isRecord3(input) {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

// src/generation-lib.ts
function createVideoAdapters2() {
  return createVideoAdapters();
}
function buildVideoCapabilityInput2(context) {
  return buildVideoCapabilityInput(context);
}
function normalizeVideoCapabilityResult2(result) {
  return normalizeVideoCapabilityResult(result);
}
export {
  HttpForgeaXToolClient,
  buildVideoCapabilityInput2 as buildVideoCapabilityInput,
  createVideoAdapters2 as createVideoAdapters,
  normalizeVideoCapabilityResult2 as normalizeVideoCapabilityResult,
  sanitizeAssetRef
};
