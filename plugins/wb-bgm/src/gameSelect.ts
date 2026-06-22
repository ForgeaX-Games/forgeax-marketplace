// Game picker for the "配入游戏" (attach) flow. Attach now REQUIRES an explicit
// target game: clicking the attach button opens a small menu that asks which
// GAME to attach into, then attaches on pick.
//
// Embedded in Workbench, `/api/workbench/games` hits the host server directly.
// In standalone vite dev that route isn't proxied, so loadGames() degrades to
// an empty list (attach is a host-only feature anyway).

interface GameRow {
  slug: string;
  name?: string;
}
interface GamesResponse {
  games?: GameRow[];
  activeSlug?: string | null;
}

let cache: GamesResponse | null = null;

// Last slug the user explicitly picked this session — preferred default so a
// choice sticks across the viewer/modal selects until they change it.
let lastChosen: string | null = null;

/** Fetch the game list once (cached). Never throws — returns an empty list on
 *  any failure so the UI keeps working. */
async function loadGames(force = false): Promise<GamesResponse> {
  if (cache && !force) return cache;
  try {
    const r = await fetch('/api/workbench/games');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = (await r.json()) as GamesResponse;
    cache = { games: Array.isArray(j.games) ? j.games : [], activeSlug: j.activeSlug ?? null };
  } catch {
    cache = { games: [], activeSlug: null };
  }
  return cache;
}

/** Remember the user's pick so the picker can pre-highlight it next time. */
function rememberChoice(slug: string): void {
  if (slug) lastChosen = slug;
}

let openMenu: HTMLElement | null = null;
let cleanupListeners: (() => void) | null = null;

function closePicker(): void {
  if (cleanupListeners) { cleanupListeners(); cleanupListeners = null; }
  if (openMenu) { openMenu.remove(); openMenu = null; }
}

function labelFor(g: GameRow): string {
  return g.name && g.name !== g.slug ? `${g.name}（${g.slug}）` : g.slug;
}

/**
 * Open a small "which game?" menu anchored under `anchor`. On selecting a game
 * it calls `onPick(slug)`. Clicking outside, pressing Esc, or clicking the
 * anchor again closes it. Re-fetches the game list each open so newly-created
 * games show up; shows a hint when there are no games yet.
 */
export async function openGamePicker(anchor: HTMLElement, onPick: (slug: string) => void): Promise<void> {
  // Toggle: a second click on the same trigger closes the menu.
  if (openMenu) { closePicker(); return; }

  const { games = [], activeSlug } = await loadGames(true);

  const menu = document.createElement('div');
  menu.className = 'game-picker';

  const title = document.createElement('div');
  title.className = 'game-picker-title';
  title.textContent = '配入到哪个游戏？';
  menu.appendChild(title);

  if (games.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'game-picker-empty';
    empty.textContent = '（无游戏，请先创建）';
    menu.appendChild(empty);
  } else {
    const preferred = [lastChosen, activeSlug ?? ''].find((s) => s && games.some((g) => g.slug === s));
    for (const g of games) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'game-picker-item';
      if (g.slug === preferred) item.classList.add('active');
      const name = document.createElement('span');
      name.textContent = labelFor(g);
      item.appendChild(name);
      if (g.slug === activeSlug) {
        const badge = document.createElement('span');
        badge.className = 'game-picker-badge';
        badge.textContent = '最近编辑';
        item.appendChild(badge);
      }
      item.addEventListener('click', () => {
        rememberChoice(g.slug);
        closePicker();
        onPick(g.slug);
      });
      menu.appendChild(item);
    }
  }

  document.body.appendChild(menu);
  openMenu = menu;

  // Position: under the anchor, right-aligned, clamped to the viewport.
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  let top = r.bottom + 6;
  if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
  let left = r.right - mw;
  if (left < 8) left = 8;
  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;

  // Defer outside-click binding so the opening click doesn't immediately close it.
  const onDocClick = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node) && e.target !== anchor) closePicker();
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closePicker(); };
  setTimeout(() => {
    document.addEventListener('mousedown', onDocClick, true);
    document.addEventListener('keydown', onKey, true);
  }, 0);
  cleanupListeners = () => {
    document.removeEventListener('mousedown', onDocClick, true);
    document.removeEventListener('keydown', onKey, true);
  };
}
