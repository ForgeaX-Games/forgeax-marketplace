import fixture00Image from '../examples/00/image.jpg?url';
import fixture00Prompt from '../examples/00/prompt.txt?raw';
import fixture01Image from '../examples/01/image.jpg?url';
import fixture01Prompt from '../examples/01/prompt.txt?raw';
import fixture02Image from '../examples/02/image.jpg?url';
import fixture02Prompt from '../examples/02/prompt.txt?raw';
import fixture05Image from '../examples/05/image.jpg?url';
import fixture05Prompt from '../examples/05/prompt.txt?raw';
import {
  ProductionLingbotSmokeHarness,
  type FixtureInput,
  type FixtureSmokeState,
  type LingbotControls,
} from './production-smoke-harness';

type FixtureDefinition = {
  readonly id: string;
  readonly label: string;
  readonly imageUrl: string;
  readonly prompt: string;
};

declare global {
  interface Window {
    __reactorFixtureSmoke?: {
      readonly getState: () => FixtureSmokeState;
      disconnect(): Promise<void>;
    };
    /** Browser E2E injects this to mock only the Reactor SDK client seam. */
    __forgeaxMockLingbotFactory?: (options: { readonly apiUrl: string }) => unknown;
  }
}

const FIXTURES: readonly FixtureDefinition[] = [
  {
    id: '00',
    label: '00 · Jungle castle flight',
    imageUrl: fixture00Image,
    prompt: fixture00Prompt.trim(),
  },
  {
    id: '01',
    label: '01 · Stonehenge panorama',
    imageUrl: fixture01Image,
    prompt: fixture01Prompt.trim(),
  },
  {
    id: '02',
    label: '02 · Urban wander',
    imageUrl: fixture02Image,
    prompt: fixture02Prompt.trim(),
  },
  {
    id: '05',
    label: '05 · Jungle castle flight (duplicate fixture)',
    imageUrl: fixture05Image,
    prompt: fixture05Prompt.trim(),
  },
];

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing smoke page element #${id}`);
  return value as T;
}

const video = element<HTMLVideoElement>('main-video');
const emptyOutput = element<HTMLDivElement>('empty-output');
const fixtureSelect = element<HTMLSelectElement>('fixture');
const prompt = element<HTMLTextAreaElement>('prompt');
const connect = element<HTMLButtonElement>('connect');
const reset = element<HTMLButtonElement>('reset');
const disconnect = element<HTMLButtonElement>('disconnect');
const applyPrompt = element<HTMLButtonElement>('apply-prompt');
const phase = element<HTMLElement>('phase');
const message = element<HTMLElement>('message');
const lastCommand = element<HTMLElement>('last-command');
const lease = element<HTMLElement>('lease');

for (const fixture of FIXTURES) {
  const option = document.createElement('option');
  option.value = fixture.id;
  option.textContent = fixture.label;
  fixtureSelect.append(option);
}

function selectedFixture(): FixtureDefinition {
  return FIXTURES.find((fixture) => fixture.id === fixtureSelect.value) ?? FIXTURES[0]!;
}

function render(state: FixtureSmokeState): void {
  phase.textContent = state.phase;
  message.textContent = state.message;
  lastCommand.textContent = state.lastCommand ?? '—';
  lease.textContent = state.phase === 'live' || state.phase === 'waiting' || state.phase === 'connecting'
    ? 'held by production adapter'
    : '—';
  const active = state.phase === 'connecting' || state.phase === 'waiting' || state.phase === 'seeding';
  connect.disabled = active;
  reset.disabled = state.phase !== 'live';
  applyPrompt.disabled = state.phase !== 'live';
  disconnect.disabled = state.phase === 'idle' || state.phase === 'stopped';
}

const session = new ProductionLingbotSmokeHarness({
  createClient: window.__forgeaxMockLingbotFactory
    ? (options) => window.__forgeaxMockLingbotFactory!(options) as never
    : undefined,
  onStateChanged: render,
  onVideo: (stream) => {
    video.srcObject = stream ?? null;
    emptyOutput.hidden = Boolean(stream);
    if (stream) void video.play().catch(() => undefined);
  },
});
render(session.getState());

async function fixtureInput(definition: FixtureDefinition): Promise<FixtureInput> {
  const response = await fetch(definition.imageUrl);
  if (!response.ok) throw new Error(`Fixture image ${definition.id} could not load (${response.status})`);
  return {
    id: definition.id,
    image: await response.blob(),
    prompt: definition.prompt,
  };
}

async function connectFixture(): Promise<void> {
  try {
    const definition = selectedFixture();
    prompt.value = definition.prompt;
    await session.connect(await fixtureInput(definition));
  } catch (error) {
    render({
      phase: 'failed',
      message: error instanceof Error ? error.message : String(error),
      fixtureId: selectedFixture().id,
    });
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && target.isContentEditable);
}

const pressed = new Set<string>();
const inputCodes = new Set(['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

function controlsForPressedKeys(): LingbotControls {
  return {
    longitudinal: pressed.has('KeyW') ? 'forward' : pressed.has('KeyS') ? 'backward' : 'idle',
    lateral: pressed.has('KeyA') ? 'left' : pressed.has('KeyD') ? 'right' : 'idle',
    lookHorizontal: pressed.has('ArrowLeft') ? 'left' : pressed.has('ArrowRight') ? 'right' : 'idle',
    lookVertical: pressed.has('ArrowUp') ? 'up' : pressed.has('ArrowDown') ? 'down' : 'idle',
  };
}

function clearControls(): void {
  if (pressed.size === 0) return;
  pressed.clear();
  void session.setControls(controlsForPressedKeys());
}

fixtureSelect.addEventListener('change', () => {
  prompt.value = selectedFixture().prompt;
});
connect.addEventListener('click', () => { void connectFixture(); });
reset.addEventListener('click', () => { void session.reset(); });
disconnect.addEventListener('click', () => {
  clearControls();
  void session.disconnect();
});
applyPrompt.addEventListener('click', () => { void session.updatePrompt(prompt.value); });

window.addEventListener('keydown', (event) => {
  if (isEditableTarget(event.target) || !inputCodes.has(event.code) || pressed.has(event.code)) return;
  event.preventDefault();
  pressed.add(event.code);
  void session.setControls(controlsForPressedKeys());
});
window.addEventListener('keyup', (event) => {
  if (isEditableTarget(event.target) || !inputCodes.has(event.code)) return;
  event.preventDefault();
  pressed.delete(event.code);
  void session.setControls(controlsForPressedKeys());
});
window.addEventListener('blur', clearControls);
window.addEventListener('pagehide', () => {
  clearControls();
  void session.disconnect(false);
});

window.__reactorFixtureSmoke = {
  getState: () => session.getState(),
  disconnect: () => session.disconnect(),
};
