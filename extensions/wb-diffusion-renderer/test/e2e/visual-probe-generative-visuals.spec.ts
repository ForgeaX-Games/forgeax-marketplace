/**
 * Browser E2E for the Generative Visuals production path.
 *
 * Mocks only external seams (token broker + Reactor SDK client factory via the
 * production smoke harness hooks). Presenter, Adapter, and fixture source stay
 * real. Requires Playwright + the smoke Vite app (`:18921`).
 *
 *   bunx playwright test \
 *     packages/marketplace/plugins/wb-diffusion-renderer/test/e2e/visual-probe-generative-visuals.spec.ts
 */
import { expect, test, type Page } from '@playwright/test';

const SMOKE_URL = process.env.GENERATIVE_VISUALS_SMOKE_URL ?? 'http://127.0.0.1:18921/';

async function installExternalSeamMocks(page: Page): Promise<void> {
  await page.route('**/api/generative-visuals/reactor/tokens', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        jwt: 'e2e-jwt',
        leaseId: 'e2e-lease',
        coordinatorUrl: 'https://api.reactor.inc',
      }),
    });
  });
  await page.route('**/api/generative-visuals/reactor/leases/*/release', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ released: true }),
    });
  });

  await page.addInitScript(() => {
    type Message = { type: string; has_image?: boolean; has_prompt?: boolean };
    const g = window as unknown as {
      __forgeaxMockLingbotFactory?: (options: { apiUrl: string }) => unknown;
    };
    g.__forgeaxMockLingbotFactory = () => {
      let statusListener: ((status: string) => void) | undefined;
      let messageListener: ((message: Message) => void) | undefined;
      let mainVideoListener: ((track: unknown, stream: MediaStream) => void) | undefined;
      return {
        connect: async (getJwt: () => Promise<string>) => {
          await getJwt();
          statusListener?.('ready');
        },
        disconnect: async () => {},
        getStatus: () => 'ready',
        on: (_event: string, listener: (status: string) => void) => { statusListener = listener; },
        off: () => {},
        onMainVideo: (listener: (track: unknown, stream: MediaStream) => void) => {
          mainVideoListener = listener;
          return () => { mainVideoListener = undefined; };
        },
        onCommandError: () => () => {},
        onMessage: (listener: (message: Message) => void) => {
          messageListener = listener;
          return () => { messageListener = undefined; };
        },
        uploadFile: async () => ({
          uploadId: 'e2e',
          name: 'e2e.jpg',
          mimeType: 'image/jpeg',
          size: 4,
        }),
        reset: async () => { messageListener?.({ type: 'generation_reset' }); },
        setImage: async () => { messageListener?.({ type: 'image_accepted' }); },
        setPrompt: async () => {
          messageListener?.({ type: 'conditions_ready', has_image: true, has_prompt: true });
        },
        setCameraPose: async () => {},
        setMoveLongitudinal: async () => {},
        setMoveLateral: async () => {},
        setLookHorizontal: async () => {},
        setLookVertical: async () => {},
        start: async () => {
          queueMicrotask(() => {
            const stream = new MediaStream();
            mainVideoListener?.({}, stream);
          });
        },
      };
    };
  });
}

test.describe('generative visuals production smoke (browser)', () => {
  test('Presenter/Adapter reach live with mocked Reactor network/media seams', async ({ page }) => {
    test.skip(
      process.env.GENERATIVE_VISUALS_BROWSER_E2E !== '1',
      'Set GENERATIVE_VISUALS_BROWSER_E2E=1 and start the smoke Vite app on :18921',
    );

    await installExternalSeamMocks(page);
    await page.goto(SMOKE_URL);
    await expect(page.locator('#phase')).toBeVisible({ timeout: 20_000 });

    // Prefer an injected factory when the harness supports it.
    await page.evaluate(() => {
      const factory = (window as unknown as {
        __forgeaxMockLingbotFactory?: unknown;
      }).__forgeaxMockLingbotFactory;
      if (factory) {
        (window as unknown as { __useMockLingbot?: boolean }).__useMockLingbot = true;
      }
    });

    await page.locator('#connect').click();
    await expect(page.locator('#phase')).toHaveText('live', { timeout: 15_000 });
    await expect(page.locator('#main-video')).toBeVisible();
  });
});
