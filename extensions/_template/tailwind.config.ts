import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';
// Vendored from @forgeax/design (kept in-tree so the plugin builds standalone,
// even when this submodule is cloned on its own). Re-sync from
// packages/design/preset.ts if the shared scale changes.
import { createForgeaxPreset } from './src/design/preset';

export default {
  presets: [createForgeaxPreset() as unknown as Partial<Config>],
  darkMode: ['selector', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx,html}'],
  corePlugins: {
    // Keep the existing plugin layout CSS (data-pane gating, grid) intact —
    // do not reset it with Tailwind's preflight.
    preflight: false,
  },
  plugins: [animate],
} satisfies Config;
