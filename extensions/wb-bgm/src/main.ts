import './style.css';

import {
  AUDIO_SHAPING_PRESETS,
  DEFAULT_AUDIO_SHAPING,
  isDefaultAudioShaping,
  matchingAudioShapingPreset,
  sanitizeAudioShapingParams,
  type AudioShapingParams,
} from './audioShaping.ts';
import { AudioShapingEngine } from './audioShapingEngine.ts';
import { initAudioBindingsUi } from './audioBindingsUi.ts';
import { initCustomAudioUi } from './customAudio.ts';
import { attachToGame, type AudioSelection } from './attach.ts';
import { fetchAllAssetsOfType } from './api.ts';
import {
  AUDIO_NAME_SOURCES,
  localizedVariantName,
} from './audioNameLocalization.ts';
import {
  formatCreativeDuration,
  validateCreativeRequest,
  type CreativeReference,
  type CreativeRequest,
  type CreativeSourceMode,
  type CreativeVersion,
  type GeneratedAudioKind,
} from './creativeWorkbench.ts';
import {
  downloadCreativeVersion,
  fetchAudioGenerationStatus,
  generateCreativeVersions,
  saveCreativeVersionToGame,
} from './creativeAudioApi.ts';
import { openGamePicker } from './gameSelect.ts';
import {
  buildHumanFamilyIndex,
  runHumanSearch,
  runHumanSimilarSearch,
} from './humanSearch.ts';
import {
  bgmTagLabel,
  buildBgmTagOptions,
} from './bgmTagSearch.ts';
import {
  HUMAN_SEARCH_SCHEMA,
  type HumanAudioMode,
  type HumanFamilyResult,
  type HumanSearchIntent,
  type HumanSearchResult,
  type HumanSfxIntent,
  type HumanVariant,
  type PlayerWorkbenchMode,
} from './humanSearchTypes.ts';
import { PlatformBridge } from './platform/Bridge.ts';
import {
  EMPTY_PLAYER_DISCOVERY_STATS,
  markFamilyAttached,
  markFamilyPreviewed,
  playerCandidateState,
  sanitizePlayerDiscoveryStats,
  sortPlayerCandidates,
  type PlayerDiscoveryStats,
  type PlayerResultSort,
} from './playerDiscovery.ts';
import { proxyUrl } from './proxyUrl.ts';
import {
  cueLabel,
  intensityLabel,
  materialLabel,
  sourceLabel,
} from './tagCatalog.ts';
import {
  buildSfxDirectoryCatalog,
  categoryLabel,
  subcategoryLabel,
  type DirectoryOption,
} from './sfxDirectoryCatalog.ts';
import type { AssetMeta } from './state.ts';
import { AudioWorkbenchChannel } from './workbenchChannel.ts';

type SearchFormState = Omit<
  HumanSfxIntent,
  'schemaVersion' | 'kind' | 'projectId' | 'topK'
> & {
  bgmScene?: string;
  bgmMoodIds: string[];
  bgmEnergy?: string;
  bgmWorld?: string;
};

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing #${id}`);
  return element as T;
};

const htmlPane = document.documentElement.dataset.pane ?? 'standalone';
const hasLeftPane = htmlPane === 'left' || htmlPane === 'standalone';
const hasCenterPane = htmlPane === 'center' || htmlPane === 'standalone';
const bridge = new PlatformBridge();
const bus = new AudioWorkbenchChannel();
const storagePrefix = `forgeax:wb-bgm:human:${bus.projectId}:${bus.instanceId}`;

let mode: PlayerWorkbenchMode = 'sfx';
let formState: SearchFormState = {
  cue: '',
  directoryCategory: '',
  directorySubcategory: '',
  preferredStyleIds: [],
  hardExcludeIds: [],
  avoidStyleIds: [],
  queryText: '',
  bgmMoodIds: [],
};
let latestResult: HumanSearchResult | null = null;
let selectedResult: HumanFamilyResult | null = null;
let selectedVariant: HumanVariant | null = null;
let latestSearchRequestId = '';
let latestCreativeRequestId = '';
let creativeGenerationController: AbortController | null = null;
let waveformToken = 0;
let shapingEngine: AudioShapingEngine | null = null;
let shapingParams: AudioShapingParams = { ...DEFAULT_AUDIO_SHAPING };
let shapingBypassed = false;
const shapingDrafts = new Map<string, { params: AudioShapingParams; saved: boolean }>();
let creativeKind: GeneratedAudioKind = 'bgm';
let creativeSourceMode: CreativeSourceMode = 'new';
let creativeReference: CreativeReference | undefined;
let selectedVoiceEmotion = '平静';
let activeCreativeRequest: CreativeRequest | null = null;
let creativeVersions: CreativeVersion[] = [];
let selectedCreativeVersion: CreativeVersion | null = null;
let creativeRevisionTags: string[] = [];
let playerDiscoveryStats: PlayerDiscoveryStats = { ...EMPTY_PLAYER_DISCOVERY_STATS };
let attachedAssetIds = new Set<string>();
let resultContextLabel = '';
let onlineSfxAssets: AssetMeta[] = [];
let customAudioUi: ReturnType<typeof initCustomAudioUi> | null = null;

type AudioShapingKey = keyof AudioShapingParams;

const SHAPING_CONTROLS: Array<{
  inputId: string;
  outputId: string;
  key: AudioShapingKey;
}> = [
  { inputId: 'shapingGain', outputId: 'shapingGainValue', key: 'gainDb' },
  { inputId: 'shapingPitch', outputId: 'shapingPitchValue', key: 'pitchSemitones' },
  { inputId: 'shapingHighpass', outputId: 'shapingHighpassValue', key: 'highpassHz' },
  { inputId: 'shapingLowpass', outputId: 'shapingLowpassValue', key: 'lowpassHz' },
  { inputId: 'shapingEqLow', outputId: 'shapingEqLowValue', key: 'eqLowDb' },
  { inputId: 'shapingEqMid', outputId: 'shapingEqMidValue', key: 'eqMidDb' },
  { inputId: 'shapingEqHigh', outputId: 'shapingEqHighValue', key: 'eqHighDb' },
];

function requestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `human-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function showToast(message: string, type: 'success' | 'warning' | 'error' | '' = ''): void {
  const toast = $('toast') as HTMLElement & { _timer?: ReturnType<typeof setTimeout> };
  toast.textContent = message;
  toast.className = `toast ${type}`.trim();
  if (toast._timer) clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.add('hidden'), 3500);
}

function discoveryStorageKey(): string {
  return `forgeax:wb-bgm:player-discovery:${bus.projectId}`;
}

function loadPlayerDiscoveryStats(): void {
  try {
    const raw = localStorage.getItem(discoveryStorageKey());
    playerDiscoveryStats = raw
      ? sanitizePlayerDiscoveryStats(JSON.parse(raw))
      : { ...EMPTY_PLAYER_DISCOVERY_STATS };
  } catch {
    playerDiscoveryStats = { ...EMPTY_PLAYER_DISCOVERY_STATS };
  }
}

function savePlayerDiscoveryStats(): void {
  try {
    localStorage.setItem(discoveryStorageKey(), JSON.stringify(playerDiscoveryStats));
  } catch {
    // Discovery remains available without persistence.
  }
}

async function loadAttachedAssetIds(): Promise<void> {
  try {
    const response = await fetch('/api/tools/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toolId: 'list-audio',
        args: { slug: bus.projectId },
        caller: { kind: 'user' },
      }),
    });
    const envelope = await response.json() as {
      ok?: boolean;
      result?: { tracks?: Array<{ assetId?: string }> };
    };
    if (!envelope.ok) return;
    attachedAssetIds = new Set(
      (envelope.result?.tracks ?? [])
        .map((track) => track.assetId ?? '')
        .filter(Boolean),
    );
    renderResults();
  } catch {
    // The standalone workbench has no project manifest endpoint.
  }
}

function effectiveDiscoveryStats(
  candidates: readonly HumanFamilyResult[],
): PlayerDiscoveryStats {
  const attached = { ...playerDiscoveryStats.attached };
  for (const candidate of candidates) {
    if (candidate.variants.some((variant) => attachedAssetIds.has(variant.assetId))) {
      attached[candidate.familyId] = Math.max(1, attached[candidate.familyId] ?? 0);
    }
  }
  return {
    previewed: playerDiscoveryStats.previewed,
    attached,
  };
}

function selectedShapingKey(): string | null {
  if (!selectedVariant) return null;
  return `${selectedVariant.assetId || 'asset'}:${selectedVariant.resUrl}`;
}

function shapingStorageKey(key: string): string {
  return `${storagePrefix}:shaping:${encodeURIComponent(key)}`;
}

function readStoredShaping(key: string): AudioShapingParams | null {
  try {
    const raw = localStorage.getItem(shapingStorageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { params?: unknown } | unknown;
    const value = parsed && typeof parsed === 'object' && 'params' in parsed
      ? parsed.params
      : parsed;
    return sanitizeAudioShapingParams(value);
  } catch {
    return null;
  }
}

function storeCurrentShaping(): boolean {
  const key = selectedShapingKey();
  if (!key) return false;
  try {
    localStorage.setItem(shapingStorageKey(key), JSON.stringify({
      schemaVersion: 1,
      params: shapingParams,
    }));
    shapingDrafts.set(key, { params: { ...shapingParams }, saved: true });
    return true;
  } catch {
    return false;
  }
}

function shapingValueLabel(key: AudioShapingKey, value: number): string {
  if (key === 'pitchSemitones') {
    return `${value > 0 ? '+' : ''}${value} 半音`;
  }
  if (key === 'highpassHz' || key === 'lowpassHz') {
    if (value >= 1_000) {
      const khz = value / 1_000;
      return `${Number.isInteger(khz) ? khz.toFixed(0) : khz.toFixed(1)} kHz`;
    }
    return `${Math.round(value)} Hz`;
  }
  return `${value > 0 ? '+' : ''}${value} dB`;
}

function setShapingEnabled(enabled: boolean): void {
  for (const control of SHAPING_CONTROLS) {
    $<HTMLInputElement>(control.inputId).disabled = !enabled;
  }
  $<HTMLButtonElement>('shapingSaveBtn').disabled = !enabled;
}

function updateAttachForShaping(): void {
  if (!selectedVariant) return;
  const hasRealAsset = Boolean(selectedVariant.assetId && selectedVariant.resUrl);
  const adjusted = !isDefaultAudioShaping(shapingParams);
  $('attachHint').textContent = !hasRealAsset
    ? '该变体缺少真实资产信息'
    : adjusted
      ? '当前调音只用于试听；配入时仍使用原始音频'
      : '试听确认后可配入游戏';
  const button = $<HTMLButtonElement>('attachAudioBtn');
  button.disabled = !hasRealAsset;
  button.textContent = adjusted ? '配入原声' : '配入游戏';
}

function renderShapingPresets(): void {
  const container = $('shapingPresetList');
  container.innerHTML = '';
  const matched = matchingAudioShapingPreset(shapingParams)?.id;
  for (const preset of AUDIO_SHAPING_PRESETS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `audio-preset-btn${matched === preset.id ? ' is-selected' : ''}`;
    button.textContent = preset.label;
    button.title = preset.description;
    button.disabled = !selectedVariant;
    button.addEventListener('click', () => {
      shapingParams = { ...preset.params };
      shapingBypassed = false;
      const key = selectedShapingKey();
      if (key) shapingDrafts.set(key, { params: { ...shapingParams }, saved: false });
      renderShapingControls();
    });
    container.appendChild(button);
  }
}

function renderShapingControls(): void {
  for (const control of SHAPING_CONTROLS) {
    const value = shapingParams[control.key];
    $<HTMLInputElement>(control.inputId).value = String(value);
    $<HTMLOutputElement>(control.outputId).value =
      shapingValueLabel(control.key, value);
  }
  renderShapingPresets();
  setShapingEnabled(Boolean(selectedVariant));

  const key = selectedShapingKey();
  const draft = key ? shapingDrafts.get(key) : undefined;
  const isOriginal = isDefaultAudioShaping(shapingParams);
  const compare = $<HTMLButtonElement>('shapingCompareBtn');
  compare.disabled = !selectedVariant || isOriginal;
  compare.textContent = shapingBypassed ? '返回处理后' : '对比原声';
  compare.classList.toggle('is-selected', shapingBypassed);
  $<HTMLButtonElement>('shapingResetBtn').disabled = !selectedVariant || isOriginal;
  $('shapingStatus').textContent = shapingBypassed
    ? '正在试听原声'
    : isOriginal
      ? '原始声音'
      : draft?.saved
        ? '参数已保存（原文件不变）'
        : '已调整，尚未保存';

  shapingEngine?.apply(shapingParams, shapingBypassed);
  updateAttachForShaping();
}

function loadVariantShaping(variant: HumanVariant): void {
  const key = `${variant.assetId || 'asset'}:${variant.resUrl}`;
  const draft = shapingDrafts.get(key);
  if (draft) {
    shapingParams = { ...draft.params };
  } else {
    const stored = readStoredShaping(key);
    shapingParams = stored ?? { ...DEFAULT_AUDIO_SHAPING };
    shapingDrafts.set(key, {
      params: { ...shapingParams },
      saved: Boolean(stored),
    });
  }
  shapingBypassed = false;
  renderShapingControls();
}

function storedKey(kind: HumanAudioMode): string {
  return `${storagePrefix}:${kind}:form`;
}

function saveLeftState(): void {
  if (!hasLeftPane) return;
  try {
    sessionStorage.setItem(storedKey('sfx'), JSON.stringify(formState));
    sessionStorage.setItem(`${storagePrefix}:mode`, mode);
  } catch {
    // Search remains usable when storage is unavailable.
  }
}

function restoreLeftState(): void {
  if (!hasLeftPane) return;
  try {
    const storedMode = sessionStorage.getItem(`${storagePrefix}:mode`);
    if (
      storedMode === 'bgm'
      || storedMode === 'sfx'
      || storedMode === 'voice'
      || storedMode === 'generate'
      || storedMode === 'bindings'
    ) mode = storedMode;
    const raw = sessionStorage.getItem(storedKey('sfx'));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SearchFormState>;
      formState = {
        cue: typeof parsed.cue === 'string' ? parsed.cue : '',
        directoryCategory:
          typeof parsed.directoryCategory === 'string' ? parsed.directoryCategory : '',
        directorySubcategory:
          typeof parsed.directorySubcategory === 'string' ? parsed.directorySubcategory : '',
        sourceId: typeof parsed.sourceId === 'string' ? parsed.sourceId : undefined,
        materialId: typeof parsed.materialId === 'string' ? parsed.materialId : undefined,
        intensity:
          parsed.intensity === 'light' || parsed.intensity === 'medium' || parsed.intensity === 'heavy'
            ? parsed.intensity
            : undefined,
        requireIntensityVariants: parsed.requireIntensityVariants === true,
        preferredStyleIds: Array.isArray(parsed.preferredStyleIds) ? parsed.preferredStyleIds : [],
        hardExcludeIds: Array.isArray(parsed.hardExcludeIds) ? parsed.hardExcludeIds : [],
        avoidStyleIds: Array.isArray(parsed.avoidStyleIds) ? parsed.avoidStyleIds : [],
        queryText: typeof parsed.queryText === 'string' ? parsed.queryText : '',
        bgmScene: typeof parsed.bgmScene === 'string' ? parsed.bgmScene : undefined,
        bgmMoodIds: Array.isArray(parsed.bgmMoodIds)
          ? parsed.bgmMoodIds.filter((value): value is string => typeof value === 'string').slice(0, 2)
          : [],
        bgmEnergy: typeof parsed.bgmEnergy === 'string' ? parsed.bgmEnergy : undefined,
        bgmWorld: typeof parsed.bgmWorld === 'string' ? parsed.bgmWorld : undefined,
      };
    }
  } catch {
    // Ignore stale or malformed view state.
  }
}

function isSearchMode(value: PlayerWorkbenchMode): value is HumanAudioMode {
  return value === 'sfx' || value === 'bgm';
}

function resetCreativePreview(): void {
  const player = document.getElementById('creativeAudioPlayer') as HTMLAudioElement | null;
  if (player) {
    player.pause();
    player.removeAttribute('src');
    player.load();
  }
  activeCreativeRequest = null;
  creativeVersions = [];
  selectedCreativeVersion = null;
  $('creativeResultList').innerHTML = '';
  $('creativeResultCount').textContent = '尚未生成';
  $('creativeResultsEmpty').classList.remove('hidden');
  $('creativeResultsLoading').classList.add('hidden');
  $('creativePreviewEmpty').classList.remove('hidden');
  $('creativePreviewContent').classList.add('hidden');
  $('creativePreviewTitle').textContent = '生成预览';
  $('creativePreviewSubtitle').textContent = '尚未选择版本';
  $('creativeDraftState').textContent = '草稿';
  $('creativeCurrentTime').textContent = '00:00';
  ($('creativeProgress').querySelector('i') as HTMLElement).style.width = '0%';
}

function setCenterWorkspace(next: PlayerWorkbenchMode): void {
  if (!hasCenterPane) return;
  const creative = next === 'voice' || next === 'generate';
  const bindings = next === 'bindings';
  const custom = next === 'custom';
  $('searchWorkspace').classList.toggle('hidden', creative || bindings || custom);
  $('generationWorkspace').classList.toggle('hidden', !creative);
  $('bindingsWorkspace').classList.toggle('hidden', !bindings);
  $('customAudioWorkspace').classList.toggle('hidden', !custom);
  if (creative) {
    $('creativeResultsTitle').textContent = next === 'voice' ? '语音版本' : '生成版本';
    if (activeCreativeRequest && activeCreativeRequest.mode !== next) {
      resetCreativePreview();
    }
  }
}

function setMode(next: PlayerWorkbenchMode, broadcast = true): void {
  mode = next;
  for (const button of document.querySelectorAll<HTMLButtonElement>('.audio-mode-btn')) {
    const selected = button.dataset.mode === mode;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-selected', String(selected));
  }
  const searching = isSearchMode(mode);
  const creative = mode === 'voice' || mode === 'generate';
  const custom = mode === 'custom';
  $('searchControls').classList.toggle('hidden', !searching);
  $('searchActions').classList.toggle('hidden', !searching);
  $('creativeActions').classList.toggle('hidden', !creative);
  $('sfxSearchForm').classList.toggle('hidden', mode !== 'sfx');
  $('bgmSearchForm').classList.toggle('hidden', mode !== 'bgm');
  $('querySearchBlock').classList.toggle('hidden', mode === 'sfx');
  $('voiceCreationForm').classList.toggle('hidden', mode !== 'voice');
  $('audioGenerationForm').classList.toggle('hidden', mode !== 'generate');
  $('audioBindingsIntro').classList.toggle('hidden', mode !== 'bindings');
  $('customAudioIntro').classList.toggle('hidden', !custom);

  if (searching) {
    const query = $<HTMLInputElement>('queryInput');
    query.placeholder = '例如：黑暗奇幻 Boss 战，最后进入高潮';
    $('queryHint').textContent = '描述使用场景或输入已有资产名称、标签。';
    $('runSearchBtn').textContent = mode === 'sfx' ? '搜索音效' : '搜索 BGM';
    updateSummary();
  } else if (creative) {
    updateCreativeAction();
  } else if (custom) {
    void customAudioUi?.refresh();
  }
  setCenterWorkspace(next);
  saveLeftState();
  if (broadcast) {
    bus.post({
      schemaVersion: HUMAN_SEARCH_SCHEMA,
      type: 'view.mode',
      requestId: requestId(),
      projectId: bus.projectId,
      mode: next,
    });
    if (next === 'bindings') {
      bus.post({
        schemaVersion: HUMAN_SEARCH_SCHEMA,
        type: 'bindings.state.request',
        requestId: requestId(),
        projectId: bus.projectId,
      });
    }
  }
}

function chip(
  option: DirectoryOption,
  selected: boolean,
  onClick: () => void,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `audio-chip${selected ? ' is-selected' : ''}`;
  button.dataset.value = option.id;
  button.title = `${option.label} · ${option.count} 个已标注资产`;
  const label = document.createElement('span');
  label.textContent = option.label;
  const count = document.createElement('small');
  count.textContent = String(option.count);
  button.append(label, count);
  button.addEventListener('click', onClick);
  return button;
}

function renderSingleChoice(
  containerId: string,
  options: DirectoryOption[],
  selected: string | undefined,
  onChange: (id: string | undefined) => void,
): void {
  const container = $(containerId);
  container.innerHTML = '';
  for (const option of options) {
    container.appendChild(chip(option, selected === option.id, () => {
      onChange(selected === option.id ? undefined : option.id);
      renderFilters();
    }));
  }
}

function renderMultiChoice(
  containerId: string,
  options: DirectoryOption[],
  selected: string[],
  maxSelected: number,
  onChange: (values: string[]) => void,
): void {
  const container = $(containerId);
  container.innerHTML = '';
  for (const option of options) {
    const isSelected = selected.includes(option.id);
    container.appendChild(chip(option, isSelected, () => {
      if (isSelected) {
        onChange(selected.filter((id) => id !== option.id));
      } else if (selected.length < maxSelected) {
        onChange([...selected, option.id]);
      } else {
        showToast(`最多选择 ${maxSelected} 项`, 'warning');
        return;
      }
      renderFilters();
    }));
  }
}

function renderBgmFilters(): void {
  const catalog = buildBgmTagOptions();
  renderSingleChoice(
    'bgmSceneChips',
    catalog.scene,
    formState.bgmScene,
    (value) => { formState.bgmScene = value; },
  );
  renderMultiChoice(
    'bgmMoodChips',
    catalog.mood,
    formState.bgmMoodIds,
    2,
    (values) => { formState.bgmMoodIds = values; },
  );
  renderSingleChoice(
    'bgmEnergyChips',
    catalog.energy,
    formState.bgmEnergy,
    (value) => { formState.bgmEnergy = value; },
  );
  renderSingleChoice(
    'bgmWorldChips',
    catalog.world,
    formState.bgmWorld,
    (value) => { formState.bgmWorld = value; },
  );
}

function renderFilters(): void {
  if (!hasLeftPane) return;
  const catalog = buildSfxDirectoryCatalog(
    onlineSfxAssets,
    formState.directoryCategory || undefined,
  );
  renderSingleChoice('categoryChips', catalog.categories, formState.directoryCategory, (value) => {
    if (value !== formState.directoryCategory) formState.directorySubcategory = '';
    formState.directoryCategory = value ?? '';
  });
  renderSingleChoice(
    'subcategoryChips',
    catalog.subcategories,
    formState.directorySubcategory,
    (value) => { formState.directorySubcategory = value ?? ''; },
  );
  $('subcategorySection').classList.toggle('hidden', !formState.directoryCategory);
  renderBgmFilters();
  $<HTMLInputElement>('queryInput').value = formState.queryText ?? '';
  $('interpretedSection').classList.add('hidden');
  updateSummary();
  saveLeftState();
}

function updateSummary(): void {
  if (!hasLeftPane) return;
  const summary = $('conditionSummary');
  if (!isSearchMode(mode)) return;
  if (mode === 'bgm') {
    const selected = [
      formState.bgmScene ? bgmTagLabel('scene', formState.bgmScene) : '',
      ...formState.bgmMoodIds.map((id) => bgmTagLabel('mood', id)),
      formState.bgmEnergy ? `${bgmTagLabel('energy', formState.bgmEnergy)}能量` : '',
      formState.bgmWorld ? bgmTagLabel('world', formState.bgmWorld) : '',
    ].filter(Boolean);
    if (formState.queryText?.trim()) selected.unshift(`“${formState.queryText.trim()}”`);
    summary.textContent = selected.length
      ? `BGM：${selected.join(' · ')}`
      : '输入描述或选择场景、情绪、能量、世界观';
    return;
  }
  if (!formState.directoryCategory) {
    summary.textContent = '请先选择一级分类';
    return;
  }
  const primary = categoryLabel(formState.directoryCategory);
  summary.textContent = formState.directorySubcategory
    ? `${primary} / ${subcategoryLabel(formState.directoryCategory, formState.directorySubcategory)}`
    : `${primary} / 全部二级标签`;
}

function makeSfxIntent(): HumanSfxIntent {
  return {
    schemaVersion: HUMAN_SEARCH_SCHEMA,
    kind: 'sfx',
    cue: '',
    directoryCategory: formState.directoryCategory,
    directorySubcategory: formState.directorySubcategory || undefined,
    preferredStyleIds: [],
    hardExcludeIds: [],
    avoidStyleIds: [],
    projectId: bus.projectId,
    topK: 100,
  };
}

function makeIntent(): HumanSearchIntent | null {
  if (!isSearchMode(mode)) return null;
  if (mode === 'bgm') {
    return {
      schemaVersion: HUMAN_SEARCH_SCHEMA,
      kind: 'bgm',
      queryText: formState.queryText?.trim() || '',
      scene: formState.bgmScene,
      moodIds: [...formState.bgmMoodIds],
      energy: formState.bgmEnergy,
      world: formState.bgmWorld,
      projectId: bus.projectId,
      topK: 20,
    };
  }
  if (!formState.directoryCategory) return null;
  return makeSfxIntent();
}

function applyQueryText(): void {
  updateSummary();
  saveLeftState();
}

function dispatchSearch(): void {
  applyQueryText();
  const intent = makeIntent();
  if (!intent) {
    showToast(mode === 'sfx' ? '请先选择一级分类' : '请输入 BGM 搜索内容', 'warning');
    return;
  }
  if (
    intent.kind === 'bgm'
    && !intent.queryText
    && !intent.scene
    && !intent.moodIds.length
    && !intent.energy
    && !intent.world
  ) {
    showToast('请输入描述或至少选择一个 BGM 标签', 'warning');
    return;
  }
  const id = requestId();
  latestSearchRequestId = id;
  $('searchStatus').textContent = '搜索中…';
  $<HTMLButtonElement>('runSearchBtn').disabled = true;
  bus.post({
    schemaVersion: HUMAN_SEARCH_SCHEMA,
    type: 'search.request',
    requestId: id,
    projectId: bus.projectId,
    payload: intent,
  });
}

function clearSearch(): void {
  formState = {
    cue: '',
    directoryCategory: '',
    directorySubcategory: '',
    preferredStyleIds: [],
    hardExcludeIds: [],
    avoidStyleIds: [],
    queryText: '',
    bgmMoodIds: [],
  };
  renderFilters();
}

const QUICK_CHOICES: Record<'bgm' | 'sfx', string[]> = {
  bgm: ['更紧张', '更宏大', '更轻松', '加强节奏', '减少鼓点', '去掉人声', '高潮更明显', '适合循环'],
  sfx: ['更有力', '更轻一些', '更短促', '尾音更长', '减少混响', '更近', '更远', '更真实'],
};

const REVISION_CHOICES: Record<GeneratedAudioKind, string[]> = {
  voice: ['更愤怒', '更克制', '语速慢一点', '更有压迫感', '重新读这一句', '换一种演法'],
  bgm: ['更紧张', '减少鼓点', '高潮晚一点', '换种乐器', '去掉人声', '做成循环'],
  sfx: ['冲击更强', '更短促', '减少混响', '更近', '更真实', '只保留命中层'],
};

function setExclusiveChoice(
  container: Element,
  selected: HTMLButtonElement,
): void {
  container.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
    button.classList.toggle('is-selected', button === selected);
  });
}

function updateCreativeReference(): void {
  if (!hasLeftPane) return;
  const hasReference = Boolean(creativeReference);
  $('creativeReferenceCard').classList.toggle(
    'hidden',
    creativeSourceMode !== 'customize' || !hasReference,
  );
  $('creativeReferenceEmpty').classList.toggle(
    'hidden',
    creativeSourceMode !== 'customize' || hasReference,
  );
  $('creativeStrengthField').classList.toggle(
    'hidden',
    creativeSourceMode !== 'customize',
  );
  if (creativeReference) {
    $('creativeReferenceName').textContent = creativeReference.name;
  }
}

function renderGenerationQuickChoices(): void {
  if (!hasLeftPane) return;
  const container = $('generationQuickChoices');
  container.innerHTML = '';
  const kind = creativeKind === 'sfx' ? 'sfx' : 'bgm';
  for (const label of QUICK_CHOICES[kind]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'creative-choice';
    button.textContent = label;
    button.addEventListener('click', () => button.classList.toggle('is-selected'));
    container.appendChild(button);
  }
}

function updateCreativeForm(): void {
  if (!hasLeftPane) return;
  document.querySelectorAll<HTMLButtonElement>('[data-generation-kind]').forEach((button) => {
    button.classList.toggle('is-selected', button.dataset.generationKind === creativeKind);
  });
  document.querySelectorAll<HTMLButtonElement>('[data-source-mode]').forEach((button) => {
    button.classList.toggle('is-selected', button.dataset.sourceMode === creativeSourceMode);
  });
  const sfx = creativeKind === 'sfx';
  const duration = $<HTMLSelectElement>('generationDuration');
  if (sfx && Number(duration.value) > 30) duration.value = '30';
  for (const option of duration.options) {
    option.disabled = sfx && Number(option.value) > 30;
  }
  $('generationPromptLabel').innerHTML = sfx
    ? '想生成什么 <b>必填</b>'
    : '想生成什么音乐 <b>必填</b>';
  $<HTMLTextAreaElement>('generationPrompt').placeholder = sfx
    ? '例如：沉重的火焰剑砍中金属盔甲，短促、有冲击力'
    : '例如：黑暗奇幻 Boss 战音乐，持续推进，最后进入高潮';
  $('instrumentalField').classList.toggle('hidden', sfx);
  renderGenerationQuickChoices();
  updateCreativeReference();
  updateCreativeAction();
}

function updateCreativeAction(): void {
  if (!hasLeftPane || isSearchMode(mode)) return;
  const button = $<HTMLButtonElement>('runCreativeBtn');
  if (mode === 'voice') {
    const count = Number($<HTMLSelectElement>('voiceVariationCount').value) || 3;
    button.textContent = `生成 ${count} 个语音版本`;
    $('creativeStatus').textContent = '填写台词后生成';
    return;
  }
  const count = Number($<HTMLSelectElement>('generationVariationCount').value) || 2;
  button.textContent = `生成 ${count} 个版本`;
  button.disabled = creativeSourceMode === 'customize' && !creativeReference;
  $('creativeStatus').textContent = creativeSourceMode === 'customize'
    ? creativeReference ? '将基于参考声音生成' : '请先选择参考声音'
    : '填写需求后生成';
}

function selectedQuickDirections(): string[] {
  return [...document.querySelectorAll<HTMLButtonElement>('#generationQuickChoices .is-selected')]
    .map((button) => button.textContent?.trim() ?? '')
    .filter(Boolean);
}

function makeCreativeRequest(): CreativeRequest {
  if (mode === 'voice') {
    const roleSelect = $<HTMLSelectElement>('voiceRole');
    return {
      mode: 'voice',
      kind: 'voice',
      sourceMode: 'new',
      prompt: $<HTMLTextAreaElement>('voiceScript').value.trim(),
      direction: $<HTMLTextAreaElement>('voiceDirection').value.trim(),
      durationSeconds: 0,
      loop: false,
      instrumental: false,
      variationCount: Number($<HTMLSelectElement>('voiceVariationCount').value) || 3,
      projectId: bus.projectId,
      voice: {
        script: $<HTMLTextAreaElement>('voiceScript').value.trim(),
        roleId: roleSelect.value,
        role: roleSelect.selectedOptions[0]?.textContent?.trim() || roleSelect.value,
        emotion: selectedVoiceEmotion,
        language: $<HTMLSelectElement>('voiceLanguage').value,
        speed: $<HTMLSelectElement>('voiceSpeed').value,
      },
    };
  }
  const strength = Number($<HTMLInputElement>('creativeStrength').value);
  return {
    mode: 'generate',
    kind: creativeKind === 'sfx' ? 'sfx' : 'bgm',
    sourceMode: creativeSourceMode,
    prompt: $<HTMLTextAreaElement>('generationPrompt').value.trim(),
    direction: selectedQuickDirections().join('、'),
    durationSeconds: Number($<HTMLSelectElement>('generationDuration').value) || 30,
    loop: $<HTMLInputElement>('generationLoop').checked,
    instrumental: $<HTMLInputElement>('generationInstrumental').checked,
    variationCount: Number($<HTMLSelectElement>('generationVariationCount').value) || 2,
    projectId: bus.projectId,
    reference: creativeSourceMode === 'customize' ? creativeReference : undefined,
    modificationStrength: (strength === 1 || strength === 3 ? strength : 2),
  };
}

function dispatchCreativeRequest(): void {
  if (isSearchMode(mode)) return;
  const payload = makeCreativeRequest();
  const error = validateCreativeRequest(payload);
  if (error) {
    showToast(error, 'warning');
    return;
  }
  const id = requestId();
  latestCreativeRequestId = id;
  $('creativeStatus').textContent = '准备版本中…';
  $<HTMLButtonElement>('runCreativeBtn').disabled = true;
  bus.post({
    schemaVersion: HUMAN_SEARCH_SCHEMA,
    type: 'creative.request',
    requestId: id,
    projectId: bus.projectId,
    payload,
  });
}

async function refreshAudioGenerationStatus(): Promise<void> {
  const note = hasLeftPane
    ? $('creativeApiNote').querySelector('span:last-child')
    : null;
  try {
    const status = await fetchAudioGenerationStatus();
    const ready = [
      status.tts.configured ? '语音' : '',
      status.music.configured ? '音乐' : '',
      status.sfx.configured ? '音效' : '',
    ].filter(Boolean);
    const missing = [
      !status.tts.configured ? '语音' : '',
      !status.music.configured ? '音乐' : '',
      !status.sfx.configured ? '音效' : '',
    ].filter(Boolean);
    if (note) {
      note.textContent = ready.length
        ? `已连接：${ready.join('、')}${missing.length ? `；待配置：${missing.join('、')}` : ''}`
        : '服务端功能已就绪；配置 API 密钥后即可生成';
    }
    if (hasCenterPane) {
      $('creativeApiBadge').textContent = missing.length ? 'API 待配置' : 'API 已连接';
    }
  } catch {
    if (note) note.textContent = '暂时无法读取生成服务状态，请确认 ForgeaX 服务已启动';
    if (hasCenterPane) $('creativeApiBadge').textContent = '服务未连接';
  }
}

function renderCreativeWave(version: CreativeVersion): void {
  const container = $('creativeMockWave');
  container.innerHTML = '';
  const seed = [...version.id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  for (let index = 0; index < 72; index += 1) {
    const bar = document.createElement('span');
    const envelope = Math.sin((index / 71) * Math.PI);
    const texture = 0.35 + (((seed * (index + 3)) % 61) / 100);
    bar.style.height = `${Math.max(8, Math.round(envelope * texture * 92))}%`;
    container.appendChild(bar);
  }
}

function renderCreativeAdjustChoices(kind: GeneratedAudioKind): void {
  const container = $('creativeAdjustChoices');
  container.innerHTML = '';
  for (const label of REVISION_CHOICES[kind]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `creative-choice${creativeRevisionTags.includes(label) ? ' is-selected' : ''}`;
    button.textContent = label;
    button.addEventListener('click', () => {
      creativeRevisionTags = creativeRevisionTags.includes(label)
        ? creativeRevisionTags.filter((item) => item !== label)
        : [...creativeRevisionTags, label];
      renderCreativeAdjustChoices(kind);
    });
    container.appendChild(button);
  }
}

function selectCreativeVersion(version: CreativeVersion): void {
  selectedCreativeVersion = version;
  creativeRevisionTags = [];
  $('creativePreviewEmpty').classList.add('hidden');
  $('creativePreviewContent').classList.remove('hidden');
  $('creativePreviewTitle').textContent = `版本 ${version.label} · ${version.title}`;
  $('creativePreviewSubtitle').textContent = version.derivedFrom
    ? `基于 ${version.derivedFrom}`
    : [version.provider, version.model].filter(Boolean).join(' · ') || 'API 生成结果';
  $('creativeVersionName').textContent = `版本 ${version.label} · ${version.title}`;
  $('creativeVersionSummary').textContent = version.summary;
  $('creativePromptSummary').textContent = version.promptSource === 'fallback'
    ? '查看专业提示词（本地模板）'
    : '查看专业提示词（Skill）';
  $('creativeCompiledPrompt').textContent = version.compiledPrompt || '未记录提示词';
  $('creativeKindBadge').textContent =
    version.kind === 'voice' ? '语音' : version.kind === 'bgm' ? 'BGM' : '音效';
  $('creativeMockDuration').textContent = formatCreativeDuration(version.durationSeconds);
  $('creativeCurrentTime').textContent = '00:00';
  const progress = $('creativeProgress').querySelector('i') as HTMLElement;
  progress.style.width = '0%';
  const player = $<HTMLAudioElement>('creativeAudioPlayer');
  player.pause();
  player.src = version.dataUrl || '';
  player.load();
  const playButton = $('creativeMockPlay');
  playButton.classList.remove('is-playing');
  playButton.textContent = '▶';
  const tags = $('creativeVersionTags');
  tags.innerHTML = '';
  for (const tag of version.tags) {
    const span = document.createElement('span');
    span.textContent = tag;
    tags.appendChild(span);
  }
  renderCreativeWave(version);
  renderCreativeAdjustChoices(version.kind);
  renderCreativeResults();
}

function renderCreativeResults(): void {
  const container = $('creativeResultList');
  container.innerHTML = '';
  $('creativeResultsEmpty').classList.toggle('hidden', Boolean(creativeVersions.length));
  $('creativeResultCount').textContent = creativeVersions.length
    ? `${creativeVersions.length} 个可选版本`
    : '尚未生成';
  for (const version of creativeVersions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `creative-result-row${selectedCreativeVersion?.id === version.id ? ' is-selected' : ''}`;
    button.innerHTML = `
      <span class="creative-version-letter">${escapeHtml(version.label)}</span>
      <span>
        <strong>${escapeHtml(version.title)}</strong>
        <small>${escapeHtml(version.summary)}</small>
        <i>${version.tags.map(escapeHtml).join(' · ')}</i>
      </span>
      <em>生成完成</em>
    `;
    button.addEventListener('click', () => selectCreativeVersion(version));
    container.appendChild(button);
  }
}

async function handleCreativeRequest(payload: CreativeRequest, id: string): Promise<void> {
  activeCreativeRequest = payload;
  latestCreativeRequestId = id;
  creativeGenerationController?.abort();
  const controller = new AbortController();
  creativeGenerationController = controller;
  setCenterWorkspace(payload.mode);
  $('creativeResultsEmpty').classList.add('hidden');
  $('creativeResultsLoading').classList.remove('hidden');
  $('creativeResultList').innerHTML = '';
  $('creativeResultCount').textContent = '正在生成…';
  $('creativeLoadingText').textContent = '正在用 Skill 优化提示词并调用音频生成 API';
  $('creativePreviewEmpty').classList.remove('hidden');
  $('creativePreviewContent').classList.add('hidden');
  bus.post({
    schemaVersion: HUMAN_SEARCH_SCHEMA,
    type: 'creative.status',
    requestId: id,
    projectId: bus.projectId,
    status: 'loading',
  });

  try {
    creativeVersions = await generateCreativeVersions(payload, id, (completed, total) => {
      if (id !== latestCreativeRequestId) return;
      $('creativeLoadingText').textContent = `正在生成 ${completed}/${total} 个版本`;
      $('creativeResultCount').textContent = `${completed}/${total}`;
    }, controller.signal);
    if (id !== latestCreativeRequestId) return;
    selectedCreativeVersion = null;
    $('creativeResultsLoading').classList.add('hidden');
    renderCreativeResults();
    if (creativeVersions[0]) selectCreativeVersion(creativeVersions[0]);
    bus.post({
      schemaVersion: HUMAN_SEARCH_SCHEMA,
      type: 'creative.status',
      requestId: id,
      projectId: bus.projectId,
      status: 'done',
      count: creativeVersions.length,
    });
  } catch (error) {
    if (id !== latestCreativeRequestId || controller.signal.aborted) return;
    $('creativeResultsLoading').classList.add('hidden');
    $('creativeResultsEmpty').classList.remove('hidden');
    $('creativeResultsEmpty').querySelector('strong')!.textContent = '生成失败';
    $('creativeResultsEmpty').querySelector('p')!.textContent =
      error instanceof Error ? error.message : String(error);
    bus.post({
      schemaVersion: HUMAN_SEARCH_SCHEMA,
      type: 'creative.status',
      requestId: id,
      projectId: bus.projectId,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    if (creativeGenerationController === controller) creativeGenerationController = null;
  }
}

function currentCreativeReference(): CreativeReference | null {
  if (!selectedVariant || !selectedResult || !latestResult) return null;
  return {
    assetId: selectedVariant.assetId,
    name: selectedResult.displayName || selectedVariant.filename,
    kind: latestResult.intent.kind,
    version: selectedVariant.version,
    resUrl: selectedVariant.resUrl,
  };
}

function openCreativeFromSelection(): void {
  const reference = currentCreativeReference();
  if (!reference) {
    showToast('请先选择一个真实音频素材', 'warning');
    return;
  }
  bus.post({
    schemaVersion: HUMAN_SEARCH_SCHEMA,
    type: 'creative.open',
    requestId: requestId(),
    projectId: bus.projectId,
    reference,
  });
}

function downloadSelectedCreativeVersion(): void {
  if (!selectedCreativeVersion) return;
  try {
    downloadCreativeVersion(selectedCreativeVersion);
    $('creativeDraftState').textContent = '已下载';
    showToast('生成音频已下载', 'success');
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), 'error');
  }
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function matchCopy(candidate: HumanFamilyResult): string {
  if (candidate.directoryCategory) return '目录匹配';
  if (candidate.matchLevel === 'exact') return '完全符合';
  if (candidate.matchLevel === 'relaxed') return '条件已放宽';
  return '需要确认';
}

function resultTags(candidate: HumanFamilyResult): string[] {
  if (candidate.bgmTags) {
    return [
      candidate.bgmTags.scene
        ? bgmTagLabel('scene', candidate.bgmTags.scene)
        : '',
      ...candidate.bgmTags.mood
        .slice(0, 2)
        .map((id) => bgmTagLabel('mood', id)),
      candidate.bgmTags.energy
        ? `${bgmTagLabel('energy', candidate.bgmTags.energy)}能量`
        : '',
      candidate.bgmTags.world
        ? bgmTagLabel('world', candidate.bgmTags.world)
        : '',
    ].filter(Boolean);
  }
  if (candidate.directoryCategory) {
    return [
      categoryLabel(candidate.directoryCategory),
      candidate.directorySubcategory
        ? subcategoryLabel(candidate.directoryCategory, candidate.directorySubcategory)
        : '',
    ].filter(Boolean);
  }
  return [
    cueLabel(candidate.cue),
    ...candidate.source.slice(0, 1).map(sourceLabel),
    ...candidate.targetMaterial.slice(0, 1).map(materialLabel),
    ...candidate.intensity.slice(0, 1).map(intensityLabel),
  ].filter(Boolean);
}

function filteredCandidates(): HumanFamilyResult[] {
  if (!latestResult) return [];
  const filter = $<HTMLSelectElement>('resultFilter').value;
  const filtered = filter === 'all'
    ? latestResult.candidates
    : latestResult.candidates.filter((candidate) => candidate.matchLevel === filter);
  const selectedSort = $<HTMLSelectElement>('resultSort').value;
  const sortMode: PlayerResultSort =
    selectedSort === 'unused' || selectedSort === 'explore'
      ? selectedSort
      : 'relevant';
  const seed = [
    new Date().toISOString().slice(0, 10),
    latestResult.intent.kind,
    latestResult.intent.kind === 'sfx'
      ? latestResult.intent.directorySubcategory
        || latestResult.intent.directoryCategory
        || latestResult.intent.queryText
        || latestResult.intent.cue
      : latestResult.intent.queryText,
  ].join(':');
  return sortPlayerCandidates(
    filtered,
    sortMode,
    effectiveDiscoveryStats(filtered),
    seed,
  );
}

function renderResults(): void {
  if (!hasCenterPane) return;
  const list = $('resultList');
  list.innerHTML = '';
  const candidates = filteredCandidates();
  const empty = $('resultsEmpty');
  const emptyTitle = empty.querySelector('strong')!;
  const emptyDescription = empty.querySelector('p')!;
  if (!latestResult) {
    empty.classList.remove('hidden');
    emptyTitle.textContent = '从左侧选择条件开始搜索';
    emptyDescription.textContent = '结果会按音效族展示，同一动作的多个变体不会占满列表。';
  } else if (!latestResult.candidates.length) {
    empty.classList.remove('hidden');
    const isDirectorySearch = latestResult.intent.kind === 'sfx'
      && Boolean(latestResult.intent.directoryCategory);
    emptyTitle.textContent = isDirectorySearch
      ? '当前目录暂无可用资产'
      : '当前搜索暂无可用资产';
    emptyDescription.textContent = isDirectorySearch
      ? '该目录来自交付规范，当前资产库中尚未收录对应音效。'
      : '请调整搜索条件后重试。';
  } else if (!candidates.length) {
    empty.classList.remove('hidden');
    emptyTitle.textContent = '当前筛选暂无结果';
    emptyDescription.textContent = '请选择“全部结果”或更换结果筛选条件。';
  } else {
    empty.classList.add('hidden');
  }
  const resultUnit = latestResult?.intent.kind === 'bgm' ? '首曲目' : '个音效族';
  $('resultCount').textContent = latestResult
    ? `${resultContextLabel ? `${resultContextLabel} · ` : ''}${latestResult.totalFamilies} ${resultUnit} · 展示 ${candidates.length}`
    : '等待搜索';

  const discoveryStats = effectiveDiscoveryStats(candidates);
  for (const candidate of candidates) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `audio-result-row${selectedResult?.familyId === candidate.familyId ? ' is-selected' : ''}`;
    row.dataset.level = candidate.matchLevel;
    const tags = resultTags(candidate)
      .map((tag) => `<span>${escapeHtml(tag)}</span>`)
      .join('');
    const discoveryState = playerCandidateState(candidate.familyId, discoveryStats);
    const discoveryLabel = discoveryState === 'attached'
      ? '已在项目中'
      : discoveryState === 'previewed'
        ? '已试听'
        : '新发现';
    row.innerHTML = `
      <span class="audio-result-play" aria-hidden="true">▶</span>
      <span class="audio-result-main">
        <span class="audio-result-title">
          <strong>${escapeHtml(candidate.displayName)}</strong>
          <em>${escapeHtml(matchCopy(candidate))}</em>
        </span>
        <span class="audio-result-meta">${candidate.bgmTags ? 'BGM曲目' : `${candidate.variants.length} 个变体`} · ${escapeHtml(candidate.reviewStatus)} · ${discoveryLabel}</span>
        <span class="audio-result-tags">${tags}</span>
      </span>
    `;
    row.addEventListener('click', () => selectCandidate(candidate));
    list.appendChild(row);
  }

  if (latestResult && !candidates.length) {
    const empty = document.createElement('div');
    empty.className = 'audio-inline-empty';
    empty.textContent = '当前筛选范围没有结果';
    list.appendChild(empty);
  }
}

function renderWarnings(result: HumanSearchResult): void {
  const container = $('resultWarnings');
  container.innerHTML = '';
  container.classList.toggle('hidden', !result.warnings.length);
  for (const warning of result.warnings) {
    const row = document.createElement('p');
    row.textContent = warning;
    container.appendChild(row);
  }
}

function variantSelection(variant: HumanVariant): AudioSelection {
  return {
    assetId: variant.assetId,
    name: variant.name,
    kind: latestResult?.intent.kind === 'bgm' ? 'bgm' : 'sfx',
    version: variant.version,
    resUrl: variant.resUrl,
    filename: variant.filename,
  };
}

function variantDisplayName(candidate: HumanFamilyResult, variant: HumanVariant): string {
  if (candidate.nameSource === 'original') return variant.filename;
  const index = Math.max(0, candidate.variants.findIndex((item) => item.resUrl === variant.resUrl));
  return localizedVariantName(candidate.displayName, index);
}

function renderVariantButtons(candidate: HumanFamilyResult): void {
  const container = $('variantList');
  container.innerHTML = '';
  candidate.variants.forEach((variant, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `audio-variant-btn${selectedVariant?.resUrl === variant.resUrl ? ' is-selected' : ''}`;
    button.textContent = String(index + 1).padStart(2, '0');
    button.title = variantDisplayName(candidate, variant);
    button.setAttribute('aria-label', variantDisplayName(candidate, variant));
    button.addEventListener('click', () => selectVariant(variant));
    container.appendChild(button);
  });
}

function renderPreviewTags(candidate: HumanFamilyResult): void {
  const container = $('previewTags');
  container.innerHTML = '';
  for (const tag of resultTags(candidate)) {
    const span = document.createElement('span');
    span.textContent = tag;
    container.appendChild(span);
  }
}

async function renderWaveform(url: string, token: number): Promise<void> {
  const container = $('audioWaveform');
  container.className = 'audio-waveform is-loading';
  container.innerHTML = '<span></span>';
  try {
    const response = await fetch(proxyUrl(url), { cache: 'force-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.arrayBuffer();
    const AudioContextCtor = window.AudioContext
      || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) throw new Error('AudioContext unavailable');
    const context = new AudioContextCtor();
    const decoded = await context.decodeAudioData(data.slice(0));
    const samples = decoded.getChannelData(0);
    const bars = 72;
    const block = Math.max(1, Math.floor(samples.length / bars));
    const peaks: number[] = [];
    for (let i = 0; i < bars; i += 1) {
      let peak = 0;
      const start = i * block;
      const end = Math.min(samples.length, start + block);
      for (let j = start; j < end; j += 1) peak = Math.max(peak, Math.abs(samples[j] ?? 0));
      peaks.push(peak);
    }
    await context.close();
    if (token !== waveformToken) return;
    const max = Math.max(...peaks, 0.01);
    container.innerHTML = '';
    container.className = 'audio-waveform';
    for (const peak of peaks) {
      const bar = document.createElement('span');
      bar.style.height = `${Math.max(4, Math.round((peak / max) * 88))}%`;
      container.appendChild(bar);
    }
  } catch {
    if (token !== waveformToken) return;
    container.className = 'audio-waveform is-fallback';
    container.innerHTML = '<span></span>';
  }
}

function selectVariant(variant: HumanVariant): void {
  selectedVariant = variant;
  const player = $<HTMLAudioElement>('audioPlayer');
  player.pause();
  player.src = proxyUrl(variant.resUrl);
  player.load();
  loadVariantShaping(variant);
  $('previewFilename').textContent = selectedResult
    ? variantDisplayName(selectedResult, variant)
    : variant.filename;
  $('previewPath').textContent = `原文件：${variant.filename}`;
  updateAttachForShaping();
  if (selectedResult) renderVariantButtons(selectedResult);
  waveformToken += 1;
  void renderWaveform(variant.resUrl, waveformToken);
}

function selectCandidate(candidate: HumanFamilyResult): void {
  const firstPreview = selectedResult?.familyId !== candidate.familyId;
  selectedResult = candidate;
  selectedVariant = candidate.variants[0] ?? null;
  if (firstPreview) {
    playerDiscoveryStats = markFamilyPreviewed(playerDiscoveryStats, candidate.familyId);
    savePlayerDiscoveryStats();
  }
  $('previewEmpty').classList.add('hidden');
  $('previewContent').classList.remove('hidden');
  $('previewTitle').textContent = candidate.displayName;
  $('previewMatchBadge').textContent = matchCopy(candidate);
  $('previewMatchBadge').dataset.level = candidate.matchLevel;
  $('previewVariantCount').textContent = `${candidate.variants.length} 个变体`;
  $<HTMLButtonElement>('previewInfoBtn').disabled = false;
  $<HTMLButtonElement>('previewSimilarBtn').disabled = latestResult?.intent.kind !== 'sfx';
  $<HTMLButtonElement>('customizeAudioBtn').disabled = !selectedVariant;
  renderPreviewTags(candidate);
  renderResults();
  renderVariantButtons(candidate);
  if (selectedVariant) selectVariant(selectedVariant);
}

async function handleSearchRequest(intent: HumanSearchIntent, id: string): Promise<void> {
  latestSearchRequestId = id;
  resultContextLabel = '';
  $('resultsEmpty').classList.add('hidden');
  $('resultsLoading').classList.remove('hidden');
  $('resultWarnings').classList.add('hidden');
  $('resultList').innerHTML = '';
  $('resultCount').textContent = '搜索中…';
  bus.post({
    schemaVersion: HUMAN_SEARCH_SCHEMA,
    type: 'search.status',
    requestId: id,
    projectId: bus.projectId,
    status: 'loading',
  });

  try {
    const result = await runHumanSearch(id, intent);
    if (id !== latestSearchRequestId) return;
    latestResult = result;
    selectedResult = null;
    selectedVariant = null;
    $<HTMLButtonElement>('previewSimilarBtn').disabled = true;
    $('resultsLoading').classList.add('hidden');
    $('previewEmpty').classList.remove('hidden');
    $('previewContent').classList.add('hidden');
    renderWarnings(result);
    renderResults();
    bus.post({
      schemaVersion: HUMAN_SEARCH_SCHEMA,
      type: 'search.status',
      requestId: id,
      projectId: bus.projectId,
      status: 'done',
      count: result.candidates.length,
    });
  } catch (error) {
    if (id !== latestSearchRequestId) return;
    $('resultsLoading').classList.add('hidden');
    $('resultsEmpty').classList.remove('hidden');
    $('resultsEmpty').querySelector('strong')!.textContent = '搜索失败';
    $('resultsEmpty').querySelector('p')!.textContent =
      error instanceof Error ? error.message : String(error);
    bus.post({
      schemaVersion: HUMAN_SEARCH_SCHEMA,
      type: 'search.status',
      requestId: id,
      projectId: bus.projectId,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleSimilarSearch(reference: HumanFamilyResult): Promise<void> {
  const id = requestId();
  latestSearchRequestId = id;
  resultContextLabel = `与「${reference.displayName}」相近`;
  $('resultsEmpty').classList.add('hidden');
  $('resultsLoading').classList.remove('hidden');
  $('resultWarnings').classList.add('hidden');
  $('resultList').innerHTML = '';
  $('resultCount').textContent = '正在寻找相近素材…';
  $<HTMLButtonElement>('previewSimilarBtn').disabled = true;

  try {
    const exclusions = latestResult?.intent.kind === 'sfx'
      ? latestResult.intent.hardExcludeIds
      : [];
    const result = await runHumanSimilarSearch(
      id,
      reference,
      bus.projectId,
      exclusions,
      16,
    );
    if (id !== latestSearchRequestId) return;
    latestResult = result;
    selectedResult = null;
    selectedVariant = null;
    $('resultsLoading').classList.add('hidden');
    $('previewEmpty').classList.remove('hidden');
    $('previewContent').classList.add('hidden');
    renderWarnings(result);
    renderResults();
  } catch (error) {
    if (id !== latestSearchRequestId) return;
    $('resultsLoading').classList.add('hidden');
    $('resultsEmpty').classList.remove('hidden');
    $('resultsEmpty').querySelector('strong')!.textContent = '找相似失败';
    $('resultsEmpty').querySelector('p')!.textContent =
      error instanceof Error ? error.message : String(error);
  }
}

function initLeftPane(): void {
  if (!hasCenterPane) {
    customAudioUi = initCustomAudioUi({
      onChanged: () => {
        bus.post({
          schemaVersion: HUMAN_SEARCH_SCHEMA,
          type: 'custom.changed',
          requestId: requestId(),
          projectId: bus.projectId,
        });
      },
      onBind: (asset, slug, attached) => {
        bus.post({
          schemaVersion: HUMAN_SEARCH_SCHEMA,
          type: 'custom.bind',
          requestId: requestId(),
          projectId: bus.projectId,
          slug,
          asset: { assetId: asset.assetId, originalName: asset.originalName },
          file: attached.file ?? attached.path ?? '',
        });
      },
    });
  }
  restoreLeftState();
  document.querySelectorAll<HTMLButtonElement>('.audio-mode-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const next = button.dataset.mode;
      if (next === 'bgm' || next === 'voice' || next === 'generate' || next === 'bindings') setMode(next);
      else setMode('sfx');
    });
  });
  const query = $<HTMLInputElement>('queryInput');
  query.addEventListener('input', () => {
    formState.queryText = query.value;
    updateSummary();
    saveLeftState();
  });
  query.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') dispatchSearch();
  });
  $('clearSearchBtn').addEventListener('click', clearSearch);
  $('runSearchBtn').addEventListener('click', dispatchSearch);
  $('runCreativeBtn').addEventListener('click', dispatchCreativeRequest);
  $('bindingLeftChooseGameBtn').addEventListener('click', () => {
    const button = $<HTMLButtonElement>('bindingLeftChooseGameBtn');
    void openGamePicker(button, (slug) => {
      bus.post({
        schemaVersion: HUMAN_SEARCH_SCHEMA,
        type: 'bindings.select',
        requestId: requestId(),
        projectId: bus.projectId,
        slug,
      });
    });
  });
  $('bindingLeftScanBtn').addEventListener('click', () => {
    bus.post({
      schemaVersion: HUMAN_SEARCH_SCHEMA,
      type: 'bindings.scan',
      requestId: requestId(),
      projectId: bus.projectId,
    });
  });

  $('voiceEmotionChoices').querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
    button.addEventListener('click', () => {
      selectedVoiceEmotion = button.dataset.value || '平静';
      setExclusiveChoice($('voiceEmotionChoices'), button);
    });
  });
  $<HTMLSelectElement>('voiceVariationCount').addEventListener('change', updateCreativeAction);
  $<HTMLSelectElement>('generationVariationCount').addEventListener('change', updateCreativeAction);

  document.querySelectorAll<HTMLButtonElement>('[data-generation-kind]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextKind = button.dataset.generationKind === 'sfx' ? 'sfx' : 'bgm';
      if (nextKind !== creativeKind) {
        creativeKind = nextKind;
        bus.post({
          schemaVersion: HUMAN_SEARCH_SCHEMA,
          type: 'creative.reset',
          requestId: requestId(),
          projectId: bus.projectId,
          mode: 'generate',
        });
      }
      updateCreativeForm();
    });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-source-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      creativeSourceMode = button.dataset.sourceMode === 'customize' ? 'customize' : 'new';
      updateCreativeForm();
    });
  });
  $('clearCreativeReference').addEventListener('click', () => {
    creativeReference = undefined;
    updateCreativeReference();
    updateCreativeAction();
  });
  $<HTMLInputElement>('creativeStrength').addEventListener('input', (event) => {
    const value = Number((event.target as HTMLInputElement).value);
    $<HTMLOutputElement>('creativeStrengthValue').value =
      value === 1 ? '轻微调整' : value === 3 ? '大幅重做' : '适度调整';
  });

  bus.subscribe((message) => {
    if (message.type === 'view.mode') {
      setMode(message.mode, false);
      return;
    }
    if (message.type === 'bindings.state') {
      $('bindingLeftGameName').textContent = message.slug || '尚未选择游戏';
      $('bindingLeftRevision').textContent = message.revisionLabel;
      $('bindingLeftCount').textContent = String(message.bindingCount);
      $<HTMLButtonElement>('bindingLeftScanBtn').disabled = message.busy || !message.slug;
      $<HTMLButtonElement>('bindingLeftChooseGameBtn').disabled = message.busy;
      return;
    }
    if (message.type === 'creative.open') {
      creativeReference = message.reference;
      creativeKind = message.reference.kind;
      creativeSourceMode = 'customize';
      $<HTMLTextAreaElement>('generationPrompt').value =
        `保留“${message.reference.name}”的核心感觉，并针对当前游戏进行个性化调整`;
      updateCreativeForm();
      setMode('generate');
      return;
    }
    if (message.type === 'creative.status' && message.requestId === latestCreativeRequestId) {
      const button = $<HTMLButtonElement>('runCreativeBtn');
      if (message.status === 'loading') {
        $('creativeStatus').textContent = '准备版本中…';
        button.disabled = true;
      } else if (message.status === 'done') {
        $('creativeStatus').textContent = `已生成 ${message.count ?? 0} 个版本`;
        button.disabled = false;
      } else {
        $('creativeStatus').textContent = '生成失败';
        button.disabled = false;
        showToast(message.error || '生成失败', 'error');
      }
      return;
    }
    if (message.type !== 'search.status' || message.requestId !== latestSearchRequestId) return;
    const button = $<HTMLButtonElement>('runSearchBtn');
    if (message.status === 'loading') {
      $('searchStatus').textContent = '搜索中…';
      button.disabled = true;
    } else if (message.status === 'done') {
      $('searchStatus').textContent = `找到 ${message.count ?? 0} 个候选`;
      button.disabled = false;
    } else {
      $('searchStatus').textContent = '搜索失败';
      button.disabled = false;
      showToast(message.error || '搜索失败', 'error');
    }
  });

  updateCreativeForm();
  void refreshAudioGenerationStatus();
  setMode(mode);
  renderFilters();
  void Promise.all([fetchAllAssetsOfType(3), fetchAllAssetsOfType(7)])
    .then(([bgm, sfx]) => {
      onlineSfxAssets = sfx;
      $('assetCountPill').textContent = `${bgm.length + sfx.length} 项`;
      renderFilters();
    })
    .catch(() => {
      $('assetCountPill').textContent = '资产库';
    });
}

function initCenterPane(): void {
  const bindings = initAudioBindingsUi(
    bus.projectId,
    ({ slug, revision }) => {
      bridge.postChat(
        `请完成游戏“${slug}”的音频事件接入：音频项目 v${revision} 已由用户在事件绑定界面应用。请读取 audio/project.json 和 src/forgeax-audio，仅在事件真正成立的位置最小化插入 gameAudio.emit 字面量调用，保留用户现有逻辑，然后运行 verify-audio-project、typecheck 和现有测试。无需再次询问是否应用音频项目。`,
      );
    },
    (state) => {
      bus.post({
        schemaVersion: HUMAN_SEARCH_SCHEMA,
        type: 'bindings.state',
        requestId: requestId(),
        projectId: bus.projectId,
        ...state,
      });
    },
  );
  customAudioUi = initCustomAudioUi({
    onChanged: () => {
      bus.post({
        schemaVersion: HUMAN_SEARCH_SCHEMA,
        type: 'custom.changed',
        requestId: requestId(),
        projectId: bus.projectId,
      });
    },
    onBind: (asset, slug, attached) => {
      bindings.selectGame(slug);
      bindings.queueAsset({
        assetId: asset.assetId,
        file: attached.file ?? attached.path ?? '',
        name: asset.originalName,
      });
      setMode('bindings');
      showToast('已配入游戏；请选择或扫描事件完成绑定', 'success');
    },
  });
  loadPlayerDiscoveryStats();
  void loadAttachedAssetIds();
  void refreshAudioGenerationStatus();
  const player = $<HTMLAudioElement>('audioPlayer');
  shapingEngine = new AudioShapingEngine(player);
  player.addEventListener('play', () => {
    void shapingEngine?.resume();
  });
  for (const control of SHAPING_CONTROLS) {
    $<HTMLInputElement>(control.inputId).addEventListener('input', (event) => {
      const input = event.target as HTMLInputElement;
      shapingParams = sanitizeAudioShapingParams({
        ...shapingParams,
        [control.key]: input.valueAsNumber,
      });
      shapingBypassed = false;
      const key = selectedShapingKey();
      if (key) shapingDrafts.set(key, { params: { ...shapingParams }, saved: false });
      renderShapingControls();
    });
  }
  $('shapingCompareBtn').addEventListener('click', () => {
    if (isDefaultAudioShaping(shapingParams)) return;
    shapingBypassed = !shapingBypassed;
    renderShapingControls();
  });
  $('shapingResetBtn').addEventListener('click', () => {
    shapingParams = { ...DEFAULT_AUDIO_SHAPING };
    shapingBypassed = false;
    const key = selectedShapingKey();
    if (key) shapingDrafts.set(key, { params: { ...shapingParams }, saved: false });
    renderShapingControls();
  });
  $('shapingSaveBtn').addEventListener('click', () => {
    if (!selectedVariant) return;
    if (storeCurrentShaping()) {
      renderShapingControls();
      showToast('调音参数已保存，原始音频未修改', 'success');
    } else {
      showToast('参数保存失败', 'error');
    }
  });
  renderShapingControls();

  bus.subscribe((message) => {
    if (message.type === 'view.mode') {
      setCenterWorkspace(message.mode);
      if (message.mode === 'custom') void customAudioUi?.refresh();
      return;
    }
    if (message.type === 'bindings.select') {
      bindings.selectGame(message.slug);
      return;
    }
    if (message.type === 'bindings.scan') {
      bindings.scan();
      return;
    }
    if (message.type === 'bindings.state.request') {
      bindings.publishState();
      return;
    }
    if (message.type === 'custom.changed') {
      void customAudioUi?.refresh();
      return;
    }
    if (message.type === 'custom.bind') {
      bindings.selectGame(message.slug);
      bindings.queueAsset({
        assetId: message.asset.assetId,
        file: message.file,
        name: message.asset.originalName,
      });
      setMode('bindings');
      showToast('已配入游戏；请选择或扫描事件完成绑定', 'success');
      return;
    }
    if (message.type === 'search.request') {
      void handleSearchRequest(message.payload, message.requestId);
      return;
    }
    if (message.type === 'creative.reset') {
      latestCreativeRequestId = message.requestId;
      creativeGenerationController?.abort();
      creativeGenerationController = null;
      setCenterWorkspace(message.mode);
      resetCreativePreview();
      return;
    }
    if (message.type === 'creative.request') {
      void handleCreativeRequest(message.payload, message.requestId);
    }
  });
  $<HTMLSelectElement>('resultFilter').addEventListener('change', renderResults);
  $<HTMLSelectElement>('resultSort').addEventListener('change', renderResults);
  $('previewSimilarBtn').addEventListener('click', () => {
    if (!selectedResult || latestResult?.intent.kind !== 'sfx') return;
    void handleSimilarSearch(selectedResult);
  });
  $('previewInfoBtn').addEventListener('click', () => {
    if (!selectedResult) return;
    const details = [
      selectedResult.description,
      `familyId: ${selectedResult.familyId}`,
      `名称来源: ${AUDIO_NAME_SOURCES[selectedResult.nameSource]}`,
      `状态: ${selectedResult.reviewStatus}`,
    ].filter(Boolean).join(' · ');
    showToast(details || '暂无更多信息');
  });
  $('customizeAudioBtn').addEventListener('click', openCreativeFromSelection);
  $('attachAudioBtn').addEventListener('click', () => {
    if (!selectedVariant) {
      showToast('请先选择一个真实变体', 'warning');
      return;
    }
    const button = $<HTMLButtonElement>('attachAudioBtn');
    void openGamePicker(button, async (slug) => {
      const familyId = selectedResult?.familyId;
      const variant = selectedVariant;
      const attached = await attachToGame(
        variant ? {
          ...variantSelection(variant),
          ...(!isDefaultAudioShaping(shapingParams) ? { shaping: { ...shapingParams } } : {}),
        } : null,
        button,
        slug,
      );
      if (!attached || !familyId || !variant) return;
      attachedAssetIds.add(variant.assetId);
      playerDiscoveryStats = markFamilyAttached(playerDiscoveryStats, familyId);
      savePlayerDiscoveryStats();
      renderResults();
    });
  });

  const creativePlayer = $<HTMLAudioElement>('creativeAudioPlayer');
  const creativePlayButton = $('creativeMockPlay');
  const syncCreativePlayback = (): void => {
    const duration = Number.isFinite(creativePlayer.duration)
      ? creativePlayer.duration
      : selectedCreativeVersion?.durationSeconds ?? 0;
    const progress = duration > 0 ? (creativePlayer.currentTime / duration) * 100 : 0;
    $('creativeCurrentTime').textContent = formatCreativeDuration(creativePlayer.currentTime);
    ($('creativeProgress').querySelector('i') as HTMLElement).style.width = `${Math.min(100, progress)}%`;
  };
  creativePlayButton.addEventListener('click', () => {
    if (!selectedCreativeVersion?.dataUrl) {
      showToast('当前版本没有可播放的真实音频', 'warning');
      return;
    }
    if (creativePlayer.paused) void creativePlayer.play();
    else creativePlayer.pause();
  });
  creativePlayer.addEventListener('play', () => {
    creativePlayButton.classList.add('is-playing');
    creativePlayButton.textContent = 'Ⅱ';
    $('creativeMockWave').classList.add('is-playing');
  });
  creativePlayer.addEventListener('pause', () => {
    creativePlayButton.classList.remove('is-playing');
    creativePlayButton.textContent = '▶';
    $('creativeMockWave').classList.remove('is-playing');
  });
  creativePlayer.addEventListener('timeupdate', syncCreativePlayback);
  creativePlayer.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(creativePlayer.duration) && creativePlayer.duration > 0) {
      $('creativeMockDuration').textContent = formatCreativeDuration(creativePlayer.duration);
    }
    syncCreativePlayback();
  });
  creativePlayer.addEventListener('ended', () => {
    creativePlayer.currentTime = 0;
    syncCreativePlayback();
  });
  $('creativeProgress').addEventListener('click', (event) => {
    if (!Number.isFinite(creativePlayer.duration) || creativePlayer.duration <= 0) return;
    const bounds = $('creativeProgress').getBoundingClientRect();
    if (bounds.width <= 0) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    creativePlayer.currentTime = ratio * creativePlayer.duration;
  });
  $('creativeReviseBtn').addEventListener('click', async () => {
    if (!selectedCreativeVersion || !activeCreativeRequest) return;
    const text = $<HTMLTextAreaElement>('creativeRevisionText').value.trim();
    const changes = [...creativeRevisionTags, text].filter(Boolean);
    if (!changes.length) {
      showToast('请选择或输入一个修改方向', 'warning');
      return;
    }
    const button = $<HTMLButtonElement>('creativeReviseBtn');
    const originalLabel = button.textContent;
    const source = selectedCreativeVersion;
    button.disabled = true;
    button.textContent = '正在生成修改版本…';
    creativeGenerationController?.abort();
    const controller = new AbortController();
    creativeGenerationController = controller;
    try {
      const revisionRequest: CreativeRequest = {
        ...activeCreativeRequest,
        direction: [activeCreativeRequest.direction, `修改方向：${changes.join('、')}`]
          .filter(Boolean)
          .join('\n'),
        variationCount: 1,
      };
      const [revision] = await generateCreativeVersions(
        revisionRequest,
        `${requestId()}:revision`,
        undefined,
        controller.signal,
      );
      if (!revision) throw new Error('生成服务没有返回修改版本');
      const nextIndex = creativeVersions.length;
      revision.label = String.fromCharCode(65 + Math.min(nextIndex, 25));
      revision.title = '修改版本';
      revision.summary = `${source.summary} · 修改：${changes.join('、')}`;
      revision.tags = [...new Set([...revision.tags, '派生修改'])];
      revision.derivedFrom = `版本 ${source.label}`;
      creativeVersions.push(revision);
      $<HTMLTextAreaElement>('creativeRevisionText').value = '';
      selectCreativeVersion(revision);
      showToast('修改版本已生成', 'success');
    } catch (error) {
      if (!controller.signal.aborted) showToast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      if (creativeGenerationController === controller) creativeGenerationController = null;
      button.disabled = false;
      button.textContent = originalLabel;
    }
  });
  $('saveCreativeDraftBtn').addEventListener('click', downloadSelectedCreativeVersion);
  $('publishCreativeBtn').addEventListener('click', () => {
    if (!selectedCreativeVersion) return;
    const button = $<HTMLButtonElement>('publishCreativeBtn');
    void openGamePicker(button, async (slug) => {
      if (!selectedCreativeVersion) return;
      button.disabled = true;
      try {
        await saveCreativeVersionToGame(selectedCreativeVersion, slug);
        $('creativeDraftState').textContent = '已配入游戏';
        showToast('生成音频已写入目标游戏并登记到音频清单', 'success');
      } catch (error) {
        showToast(error instanceof Error ? error.message : String(error), 'error');
      } finally {
        button.disabled = false;
      }
    });
  });
}

function initPlatformBridge(): void {
  bridge.onMessage((message) => {
    if (!hasLeftPane) return;
    if (message.type === 'refresh') {
      window.location.reload();
      return;
    }
    if (message.type === 'search' && message.query) {
      formState.queryText = message.query;
      renderFilters();
      dispatchSearch();
    }
  });
  bridge.sendReady();
  bridge.sendStateChange({ status: 'idle' });
}

function init(): void {
  if (hasLeftPane) initLeftPane();
  if (hasCenterPane) initCenterPane();
  initPlatformBridge();
  window.addEventListener('beforeunload', () => {
    creativeGenerationController?.abort();
    shapingEngine?.close();
    bus.close();
  }, { once: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
