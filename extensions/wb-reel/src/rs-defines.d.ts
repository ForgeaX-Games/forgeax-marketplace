// Ambient declarations for the compile-time constants injected by Vite's
// `define` (see vite.config.ts). They are string-replaced at build time, so to
// `tsc` they look like undeclared globals — declare them here so the type-check
// gate (`tsc -b`) and the bundler agree. All values are `JSON.stringify(...)`d
// strings on the Vite side, hence `string` here.
declare const __RS_GEMINI_KEY__: string;
declare const __RS_GEMINI_BASE__: string;
declare const __RS_GEMINI_MODEL__: string;
declare const __RS_CLAUDE_KEY__: string;
declare const __RS_CLAUDE_BASE__: string;
declare const __RS_CLAUDE_MODEL__: string;
declare const __RS_IMG_KEY__: string;
declare const __RS_IMG_BASE__: string;
declare const __RS_IMG_VERSION__: string;
declare const __RS_IMG_EDIT_VERSION__: string;
declare const __RS_IMG_DEPLOYMENT__: string;
declare const __RS_VIDEO_KEY__: string;
declare const __RS_VIDEO_BASE__: string;
declare const __RS_VIDEO_MODEL__: string;
declare const __RS_TTS_KEY__: string;
declare const __RS_TTS_APP_ID__: string;
declare const __RS_TTS_BASE__: string;
declare const __RS_TTS_CLUSTER__: string;
declare const __RS_MUSIC_KEY__: string;
declare const __RS_MUSIC_BASE__: string;
declare const __RS_MUSIC_MODEL__: string;
