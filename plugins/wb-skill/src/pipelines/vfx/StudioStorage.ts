// @source wb-character/src/pipelines/spine/editor/StudioStorage.ts
// Pure functions — IndexedDB wrapper for wb-skill studio persistence.
const DB_NAME = 'vag-studio';
const DB_VERSION = 2;
const STORE_NAME = 'data';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function studioSave(key: string, value: any): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function studioLoad<T = any>(key: string): Promise<T | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function studioDelete(key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export interface CustomCharacterData {
  name: string;
  spineJson: any;
  atlasText: string;
  spritesheetDataUrl: string;
  profession: string;
  timestamp: number;
  thumbnailDataUrl?: string;
}

export const CUSTOM_CHAR_KEY = 'custom-character';
export const EDITOR_STATE_KEY = 'editor-state';
export const CHAR_LIST_KEY = 'custom-characters-list';

export async function saveCustomCharacter(charData: CustomCharacterData): Promise<string> {
  const charId = `char_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  await studioSave(`char:${charId}`, charData);

  const list = await loadCharacterList();
  list.push({ id: charId, name: charData.name, profession: charData.profession, timestamp: charData.timestamp });
  await studioSave(CHAR_LIST_KEY, list);

  await studioSave(CUSTOM_CHAR_KEY, charData);

  return charId;
}

export interface CharacterListEntry {
  id: string;
  name: string;
  profession: string;
  timestamp: number;
}

export async function loadCharacterList(): Promise<CharacterListEntry[]> {
  const list = await studioLoad<CharacterListEntry[]>(CHAR_LIST_KEY);
  return list ?? [];
}

export async function loadCustomCharacterById(charId: string): Promise<CustomCharacterData | null> {
  return studioLoad<CustomCharacterData>(`char:${charId}`);
}

export async function deleteCustomCharacter(charId: string): Promise<void> {
  await studioDelete(`char:${charId}`);
  const list = await loadCharacterList();
  const filtered = list.filter(c => c.id !== charId);
  await studioSave(CHAR_LIST_KEY, filtered);
}

export async function migrateOldCustomChar(): Promise<void> {
  const old = await studioLoad<CustomCharacterData>(CUSTOM_CHAR_KEY);
  if (!old) return;
  const list = await loadCharacterList();
  if (list.length > 0) return;
  await saveCustomCharacter(old);
}
