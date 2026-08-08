import type {
  AudioAssetRef,
  AudioBinding,
  AudioCondition,
  AudioConditionOperator,
  AudioFollowCase,
  AudioFollowRule,
  AudioProject,
  AudioShapingParams,
} from '../shared/audio-project.ts';
import {
  applyBindingEdit,
  buildAudioProjectPatch,
  conditionFromFields,
  createBindingDraft,
  removeBindingFromDraft,
  upsertBindingInDraft,
  type AudioBindingEdit,
} from './audioBindingsWorkbench.ts';
import {
  applyAudioProjectDraft,
  getAudioProject,
  inspectAudioEvents,
  patchAudioProjectDraft,
  verifyAppliedAudioProject,
  type AudioEventCandidate,
} from './audioProjectApi.ts';
import { showToast } from './utils.ts';

const byId = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
};

function option(value: string, label: string): HTMLOptionElement {
  const node = document.createElement('option');
  node.value = value;
  node.textContent = label;
  return node;
}

function input(value: string, placeholder: string, ariaLabel: string): HTMLInputElement {
  const node = document.createElement('input');
  node.value = value;
  node.placeholder = placeholder;
  node.setAttribute('aria-label', ariaLabel);
  return node;
}

const DEFAULT_EVENT_SHAPING: AudioShapingParams = {
  gainDb: 0,
  pitchSemitones: 0,
  highpassHz: 20,
  lowpassHz: 20_000,
  eqLowDb: 0,
  eqMidDb: 0,
  eqHighDb: 0,
};

type FollowPreset = 'none' | 'surface' | 'phase' | 'speed' | 'health' | 'distance' | 'custom-cases' | 'custom-range';
type FollowEffect = 'intense' | 'distant' | 'recover' | 'calm';

function followRange(effect: FollowEffect, min: number, max: number): NonNullable<AudioFollowRule['range']> {
  const effects: Record<FollowEffect, Omit<NonNullable<AudioFollowRule['range']>, 'min' | 'max'>> = {
    intense: { volumeStart: 0.72, volumeEnd: 1.12, pitchStart: -2, pitchEnd: 2, lowpassStart: 8_000, lowpassEnd: 20_000 },
    distant: { volumeStart: 1, volumeEnd: 0.45, pitchStart: 0, pitchEnd: 0, lowpassStart: 20_000, lowpassEnd: 2_500 },
    recover: { volumeStart: 0.82, volumeEnd: 1, pitchStart: -2, pitchEnd: 0, lowpassStart: 3_500, lowpassEnd: 20_000 },
    calm: { volumeStart: 1.08, volumeEnd: 0.72, pitchStart: 2, pitchEnd: -2, lowpassStart: 20_000, lowpassEnd: 7_000 },
  };
  return { min, max, ...effects[effect] };
}

function matchingFollowEffect(range: NonNullable<AudioFollowRule['range']>): FollowEffect {
  if (range.lowpassEnd <= 3_000 && range.volumeEnd < range.volumeStart) return 'distant';
  if (range.lowpassStart <= 4_000 && range.lowpassEnd >= 18_000) return 'recover';
  if (range.pitchStart > range.pitchEnd && range.volumeStart > range.volumeEnd) return 'calm';
  return 'intense';
}

function followPreset(rule: AudioFollowRule | undefined): FollowPreset {
  if (!rule) return 'none';
  if (rule.field === 'surface.material' && rule.cases) return 'surface';
  if (rule.field === 'game.phase' && rule.cases) return 'phase';
  if (rule.field === 'player.speed' && rule.range) return 'speed';
  if (rule.field === 'player.health' && rule.range) return 'health';
  if (rule.field === 'distance' && rule.range) return 'distance';
  return rule.cases ? 'custom-cases' : 'custom-range';
}

export function initAudioBindingsUi(
  initialSlug = '',
  onApplied?: (result: { slug: string; revision: number }) => void,
  onStateChange?: (state: {
    slug: string;
    revisionLabel: string;
    bindingCount: number;
    busy: boolean;
  }) => void,
): {
  selectGame: (slug: string) => void;
  scan: () => void;
  publishState: () => void;
  queueAsset: (asset: AudioAssetRef) => void;
} {
  let slug = initialSlug === 'default' ? '' : initialSlug.trim();
  let project: AudioProject | null = null;
  let draft: AudioBinding[] = [];
  let selectedEventId = '';
  let candidates: AudioEventCandidate[] = [];
  let appliedRevision: number | null = null;
  let busy = false;
  let pendingAsset: AudioAssetRef | null = null;

  const selected = (): AudioBinding | null => (
    draft.find((binding) => binding.eventId === selectedEventId) ?? null
  );

  const setStatus = (message: string): void => {
    byId('bindingStatus').textContent = message;
  };

  const setBusy = (nextBusy: boolean): void => {
    busy = nextBusy;
    for (const id of ['bindingSaveBtn', 'bindingApplyBtn', 'bindingVerifyBtn']) {
      byId<HTMLButtonElement>(id).disabled = nextBusy || !slug;
    }
    publishState();
  };

  const revisionLabel = (): string => project
      ? `草稿 v${project.revision}${appliedRevision === project.revision ? ' · 已应用' : ' · 待应用'}`
      : '先选择目标游戏';

  function publishState(): void {
    onStateChange?.({
      slug,
      revisionLabel: revisionLabel(),
      bindingCount: draft.length,
      busy,
    });
  }

  const updateHeader = (): void => {
    byId('bindingRevision').textContent = revisionLabel();
    publishState();
  };

  const renderBindingList = (): void => {
    const list = byId('bindingList');
    list.innerHTML = '';
    byId('bindingListEmpty').classList.toggle('hidden', draft.length > 0);
    for (const binding of draft) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `binding-list-item${binding.eventId === selectedEventId ? ' is-selected' : ''}`;
      const title = document.createElement('strong');
      title.textContent = binding.label;
      const event = document.createElement('code');
      event.textContent = binding.eventId;
      const meta = document.createElement('span');
      meta.textContent = `${binding.enabled ? '启用' : '停用'} · ${binding.assets.length} 个声音 · ${binding.playback.spatial.toUpperCase()}`;
      button.append(title, event, meta);
      button.addEventListener('click', () => {
        selectedEventId = binding.eventId;
        renderAll();
      });
      list.appendChild(button);
    }
  };

  const renderCandidates = (): void => {
    const list = byId('bindingCandidateList');
    list.innerHTML = '';
    byId('bindingCandidatesEmpty').classList.toggle('hidden', candidates.length > 0);
    const bound = new Set(draft.map((binding) => binding.eventId));
    for (const candidate of candidates) {
      const row = document.createElement('div');
      row.className = 'binding-candidate-item';
      const details = document.createElement('div');
      const event = document.createElement('code');
      event.textContent = candidate.eventId;
      const source = document.createElement('span');
      source.textContent = `${candidate.file}:${candidate.line} · ${candidate.confidence}`;
      details.append(event, source);
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'audio-secondary-btn';
      add.textContent = bound.has(candidate.eventId) ? '已绑定' : '添加';
      add.disabled = bound.has(candidate.eventId);
      add.addEventListener('click', () => {
        const binding = createBindingDraft(candidate.eventId, candidate.eventId);
        draft = upsertBindingInDraft(draft, binding);
        selectedEventId = binding.eventId;
        renderAll();
      });
      row.append(details, add);
      list.appendChild(row);
    }
  };

  const updateSelected = (edit: AudioBindingEdit, rerenderList = false): void => {
    const current = selected();
    if (!current) return;
    draft = upsertBindingInDraft(draft, applyBindingEdit(current, edit));
    if (rerenderList) renderBindingList();
    updateHeader();
  };

  const renderAssets = (binding: AudioBinding): void => {
    const list = byId('bindingAssetList');
    list.innerHTML = '';
    binding.assets.forEach((asset, index) => {
      const row = document.createElement('div');
      row.className = 'binding-repeat-row binding-asset-row';
      const name = input(asset.name ?? '', '显示名称', '声音名称');
      const file = input(asset.file, 'audio/ 内文件，如 hit.wav', '声音文件');
      file.classList.add('binding-asset-file');
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'audio-text-btn';
      remove.textContent = '移除';
      const sync = (): void => {
        const assets = selected()?.assets.map((item) => ({ ...item })) ?? [];
        const shaping = assets[index]?.shaping;
        assets[index] = {
          assetId: asset.assetId,
          file: file.value.trim(),
          ...(name.value.trim() ? { name: name.value.trim() } : {}),
          ...(shaping ? { shaping } : {}),
        };
        updateSelected({ assets });
      };
      name.addEventListener('input', sync);
      file.addEventListener('input', sync);
      remove.addEventListener('click', () => {
        const assets = (selected()?.assets ?? []).filter((_item, itemIndex) => itemIndex !== index);
        updateSelected({ assets });
        const next = selected();
        if (next) renderAssets(next);
      });
      row.append(name, file, remove);
      list.appendChild(row);
    });
  };

  const conditionValueText = (condition: AudioCondition): string => (
    typeof condition.value === 'string' ? condition.value : JSON.stringify(condition.value)
  );

  const renderConditions = (binding: AudioBinding): void => {
    const list = byId('bindingConditionList');
    list.innerHTML = '';
    binding.conditions.forEach((condition, index) => {
      const row = document.createElement('div');
      row.className = 'binding-repeat-row binding-condition-row';
      const field = input(condition.field, '条件字段，如 damage', '条件字段');
      const operator = document.createElement('select');
      for (const [value, label] of [
        ['eq', '等于'], ['neq', '不等于'], ['gt', '大于'], ['gte', '大于等于'],
        ['lt', '小于'], ['lte', '小于等于'], ['in', '包含于'],
      ]) operator.appendChild(option(value, label));
      operator.value = condition.operator;
      const value = input(conditionValueText(condition), '值', '条件值');
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'audio-text-btn';
      remove.textContent = '移除';
      const sync = (): void => {
        const conditions = selected()?.conditions.map((item) => structuredClone(item)) ?? [];
        const next = conditionFromFields(
          field.value,
          operator.value as AudioConditionOperator,
          value.value,
        );
        if (next) conditions[index] = next;
        updateSelected({ conditions });
      };
      field.addEventListener('input', sync);
      operator.addEventListener('change', sync);
      value.addEventListener('input', sync);
      remove.addEventListener('click', () => {
        const conditions = (selected()?.conditions ?? []).filter((_item, itemIndex) => itemIndex !== index);
        updateSelected({ conditions });
        const next = selected();
        if (next) renderConditions(next);
      });
      row.append(field, operator, value, remove);
      list.appendChild(row);
    });
  };

  const renderFollowCases = (binding: AudioBinding, rule: AudioFollowRule): void => {
    const list = byId('bindingFollowCaseList');
    list.innerHTML = '';
    for (const [index, item] of (rule.cases ?? []).entries()) {
      const row = document.createElement('div');
      row.className = 'binding-repeat-row binding-follow-case-row';
      const value = input(String(item.value), '例如 grass', '游戏变量取值');
      const asset = document.createElement('select');
      asset.setAttribute('aria-label', `${String(item.value)}对应的声音`);
      if (binding.assets.length === 0) asset.appendChild(option('', '请先在上方添加声音'));
      binding.assets.forEach((candidate, assetIndex) => {
        asset.appendChild(option(String(assetIndex), candidate.name || candidate.file || `声音 ${assetIndex + 1}`));
      });
      const current = item.assets[0];
      const selectedIndex = binding.assets.findIndex((candidate) => (
        candidate.assetId === current?.assetId && candidate.file === current?.file
      ));
      asset.value = selectedIndex >= 0 ? String(selectedIndex) : '';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'audio-text-btn';
      remove.textContent = '移除';
      const sync = (): void => {
        const currentRule = selected()?.follow;
        if (!currentRule?.cases) return;
        const cases = currentRule.cases.map((candidate) => structuredClone(candidate));
        const assetIndex = Number(asset.value);
        const mapped = binding.assets[assetIndex];
        cases[index] = {
          ...cases[index]!,
          value: value.value.trim(),
          assets: mapped ? [structuredClone(mapped)] : [],
        };
        updateSelected({ follow: { ...currentRule, cases } });
      };
      value.addEventListener('input', sync);
      asset.addEventListener('change', sync);
      remove.addEventListener('click', () => {
        const currentRule = selected()?.follow;
        if (!currentRule?.cases) return;
        const cases = currentRule.cases.filter((_candidate, caseIndex) => caseIndex !== index);
        if (cases.length === 0) updateSelected({ follow: null });
        else updateSelected({ follow: { ...currentRule, cases } });
        const next = selected();
        if (next) renderFollow(next);
      });
      row.append(value, asset, remove);
      list.appendChild(row);
    }
  };

  const renderFollow = (binding: AudioBinding): void => {
    const preset = followPreset(binding.follow);
    setValue('bindingFollowPreset', preset);
    byId('bindingFollowPanel').classList.toggle('hidden', preset === 'none');
    const custom = preset === 'custom-cases' || preset === 'custom-range';
    byId('bindingFollowFieldRow').classList.toggle('hidden', !custom);
    setValue('bindingFollowField', binding.follow?.field ?? 'game.value');
    const cases = Boolean(binding.follow?.cases);
    byId('bindingFollowCasesPanel').classList.toggle('hidden', !cases);
    byId('bindingFollowRangePanel').classList.toggle('hidden', !binding.follow?.range);
    if (binding.follow?.cases) renderFollowCases(binding, binding.follow);
    if (binding.follow?.range) {
      setValue('bindingFollowMin', binding.follow.range.min);
      setValue('bindingFollowMax', binding.follow.range.max);
      setValue('bindingFollowEffect', matchingFollowEffect(binding.follow.range));
    }
  };

  const formatDb = (value: number): string => `${value > 0 ? '+' : ''}${value} dB`;

  const renderShaping = (binding: AudioBinding): void => {
    const shaping = binding.shaping ?? DEFAULT_EVENT_SHAPING;
    for (const [inputId, outputId, value] of [
      ['bindingEqLow', 'bindingEqLowValue', shaping.eqLowDb],
      ['bindingEqMid', 'bindingEqMidValue', shaping.eqMidDb],
      ['bindingEqHigh', 'bindingEqHighValue', shaping.eqHighDb],
    ] as const) {
      setValue(inputId, value);
      byId<HTMLOutputElement>(outputId).value = formatDb(value);
    }
    const distance = Math.round((20_000 - shaping.lowpassHz) / 190);
    setValue('bindingDistance', distance);
    byId<HTMLOutputElement>('bindingDistanceValue').value = distance === 0 ? '原声' : `${distance}%`;
  };

  const setValue = (id: string, value: string | number): void => {
    const node = byId<HTMLInputElement | HTMLSelectElement>(id);
    node.value = String(value);
  };

  const formatDuration = (value: number): string => {
    if (value < 1000) return `${value} 毫秒`;
    const seconds = value / 1000;
    return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} 秒`;
  };

  const setRangeValue = (
    inputId: string,
    outputId: string,
    value: number,
    format: (value: number) => string,
  ): void => {
    const range = byId<HTMLInputElement>(inputId);
    const configuredMax = Number(range.dataset.defaultMax || range.max);
    range.max = String(Math.max(configuredMax, value));
    range.value = String(value);
    byId<HTMLOutputElement>(outputId).value = format(value);
  };

  const renderEditor = (): void => {
    const binding = selected();
    byId('bindingEditorEmpty').classList.toggle('hidden', Boolean(binding));
    byId('bindingEditor').classList.toggle('hidden', !binding);
    if (!binding) return;
    byId<HTMLInputElement>('bindingEnabled').checked = binding.enabled;
    setValue('bindingLabel', binding.label);
    byId('bindingEventId').textContent = binding.eventId;
    setValue('bindingKind', binding.kind);
    setValue('bindingVariation', binding.variation.mode);
    setRangeValue('bindingDelay', 'bindingDelayValue', binding.trigger.delayMs, formatDuration);
    setRangeValue('bindingCooldown', 'bindingCooldownValue', binding.trigger.cooldownMs, formatDuration);
    setRangeValue('bindingProbability', 'bindingProbabilityValue', Math.round(binding.trigger.probability * 100), (value) => `${value}%`);
    setRangeValue('bindingVolume', 'bindingVolumeValue', Math.round(binding.playback.volume * 100), (value) => `${value}%`);
    setValue('bindingBus', binding.playback.bus);
    setValue('bindingSpatial', binding.playback.spatial);
    setValue('bindingPlaybackMode', binding.playback.mode);
    setValue('bindingFadeIn', binding.playback.fadeInMs);
    setValue('bindingFadeOut', binding.playback.fadeOutMs);
    setValue('bindingStopEvent', binding.playback.stopEventId ?? '');
    renderAssets(binding);
    renderFollow(binding);
    renderShaping(binding);
    renderConditions(binding);
  };

  function renderAll(): void {
    updateHeader();
    renderBindingList();
    renderCandidates();
    renderEditor();
  }

  const loadProject = async (): Promise<void> => {
    if (!slug) return;
    setBusy(true);
    setStatus('正在读取共享草稿…');
    try {
      const result = await getAudioProject(slug);
      project = structuredClone(result.project);
      draft = result.project.bindings.map((binding) => structuredClone(binding));
      appliedRevision = result.appliedRevision;
      selectedEventId = draft[0]?.eventId ?? '';
      setStatus('草稿已同步；Agent 和你编辑的是同一份内容');
      renderAll();
    } catch (error) {
      setStatus('草稿读取失败');
      showToast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = async (): Promise<boolean> => {
    if (!slug || !project) return false;
    const incomplete = draft.find((binding) => [
      ...binding.assets,
      ...(binding.follow?.cases ?? []).flatMap((item) => item.assets),
    ].some((asset) => !asset.assetId.trim() || !asset.file.trim()));
    if (incomplete) {
      showToast(`“${incomplete.label}”有未填写完整的声音`, 'warning');
      return false;
    }
    const patch = buildAudioProjectPatch(project, draft);
    if (!patch.upsertBindings.length && !patch.removeEventIds.length) {
      showToast('草稿没有新的改动');
      return true;
    }
    setBusy(true);
    try {
      const result = await patchAudioProjectDraft(
        slug,
        patch.expectedRevision,
        patch.upsertBindings,
        patch.removeEventIds,
      );
      project = structuredClone(result.project);
      draft = result.project.bindings.map((binding) => structuredClone(binding));
      setStatus(`草稿 v${result.project.revision} 已保存，尚未应用到游戏`);
      renderAll();
      showToast('音频绑定草稿已保存', 'success');
      return true;
    } catch (error) {
      showToast(`${error instanceof Error ? error.message : String(error)}；请重新读取后再编辑`, 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const scan = async (): Promise<void> => {
    if (!slug) return;
    setBusy(true);
    setStatus('正在只读扫描游戏事件…');
    try {
      const result = await inspectAudioEvents(slug);
      candidates = result.candidates;
      renderCandidates();
      setStatus(`扫描完成：发现 ${candidates.length} 个候选事件，没有修改游戏`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  byId('bindingManualAddBtn').addEventListener('click', () => {
    const eventInput = byId<HTMLInputElement>('bindingManualEvent');
    const labelInput = byId<HTMLInputElement>('bindingManualLabel');
    const eventId = eventInput.value.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(eventId)) {
      showToast('请输入有效事件名，例如 player.jump', 'warning');
      return;
    }
    if (draft.some((binding) => binding.eventId === eventId)) {
      selectedEventId = eventId;
      renderAll();
      return;
    }
    draft = upsertBindingInDraft(draft, createBindingDraft(eventId, labelInput.value));
    selectedEventId = eventId;
    eventInput.value = '';
    labelInput.value = '';
    renderAll();
  });

  const discreteFollow = (
    field: string,
    label: string,
    values: Array<[string, string]>,
    binding: AudioBinding,
  ): AudioFollowRule => ({
    field,
    label,
    defaultValue: '',
    cases: values.map(([value, caseLabel], index): AudioFollowCase => ({
      value,
      label: caseLabel,
      assets: binding.assets.length > 0
        ? [structuredClone(binding.assets[index % binding.assets.length]!)]
        : [],
    })),
  });

  const buildFollow = (preset: FollowPreset, binding: AudioBinding): AudioFollowRule | null => {
    if (preset === 'none') return null;
    if (preset === 'surface') {
      return discreteFollow('surface.material', '地面材质', [
        ['grass', '草地'], ['stone', '石头'], ['wood', '木板'], ['water', '水面'],
      ], binding);
    }
    if (preset === 'phase') {
      return discreteFollow('game.phase', '游戏阶段', [
        ['explore', '探索'], ['combat', '战斗'], ['danger', '危险'], ['pause', '暂停'],
      ], binding);
    }
    if (preset === 'speed') {
      return { field: 'player.speed', label: '玩家速度', defaultValue: 0, range: followRange('intense', 0, 10) };
    }
    if (preset === 'health') {
      return { field: 'player.health', label: '玩家血量', defaultValue: 100, range: followRange('recover', 0, 100) };
    }
    if (preset === 'distance') {
      return { field: 'distance', label: '与玩家的距离', defaultValue: 0, range: followRange('distant', 0, 50) };
    }
    if (preset === 'custom-cases') {
      if (binding.follow?.cases) return structuredClone(binding.follow);
      return discreteFollow('game.value', '自定义变化', [['default', '默认值']], binding);
    }
    if (binding.follow?.range) return structuredClone(binding.follow);
    return { field: 'game.value', label: '自定义数值', defaultValue: 0, range: followRange('intense', 0, 1) };
  };

  byId<HTMLSelectElement>('bindingFollowPreset').addEventListener('change', (event) => {
    const binding = selected();
    if (!binding) return;
    updateSelected({ follow: buildFollow((event.target as HTMLSelectElement).value as FollowPreset, binding) });
    const next = selected();
    if (next) renderFollow(next);
  });

  byId<HTMLInputElement>('bindingFollowField').addEventListener('input', (event) => {
    const rule = selected()?.follow;
    if (!rule) return;
    updateSelected({ follow: { ...rule, field: (event.target as HTMLInputElement).value.trim() } });
  });

  const updateFollowRange = (): void => {
    const rule = selected()?.follow;
    if (!rule?.range) return;
    const min = Number(byId<HTMLInputElement>('bindingFollowMin').value);
    const requestedMax = Number(byId<HTMLInputElement>('bindingFollowMax').value);
    const max = requestedMax > min ? requestedMax : min + 1;
    const effect = byId<HTMLSelectElement>('bindingFollowEffect').value as FollowEffect;
    updateSelected({ follow: { ...rule, defaultValue: min, range: followRange(effect, min, max) } });
  };
  byId('bindingFollowMin').addEventListener('change', updateFollowRange);
  byId('bindingFollowMax').addEventListener('change', updateFollowRange);
  byId('bindingFollowEffect').addEventListener('change', updateFollowRange);

  byId('bindingAddFollowCaseBtn').addEventListener('click', () => {
    const binding = selected();
    const rule = binding?.follow;
    if (!binding || !rule?.cases || rule.cases.length >= 32) return;
    const mapped = binding.assets[0];
    const cases: AudioFollowCase[] = [
      ...rule.cases.map((item) => structuredClone(item)),
      { value: `value${rule.cases.length + 1}`, assets: mapped ? [structuredClone(mapped)] : [] },
    ];
    updateSelected({ follow: { ...rule, cases } });
    const next = selected();
    if (next) renderFollow(next);
  });

  const updateEventShaping = (key: keyof AudioShapingParams, value: number): void => {
    const binding = selected();
    if (!binding) return;
    updateSelected({ shaping: { ...(binding.shaping ?? DEFAULT_EVENT_SHAPING), [key]: value } });
  };

  for (const [inputId, outputId, key] of [
    ['bindingEqLow', 'bindingEqLowValue', 'eqLowDb'],
    ['bindingEqMid', 'bindingEqMidValue', 'eqMidDb'],
    ['bindingEqHigh', 'bindingEqHighValue', 'eqHighDb'],
  ] as const) {
    byId<HTMLInputElement>(inputId).addEventListener('input', (event) => {
      const value = Number((event.target as HTMLInputElement).value);
      byId<HTMLOutputElement>(outputId).value = formatDb(value);
      updateEventShaping(key, value);
    });
  }
  byId<HTMLInputElement>('bindingDistance').addEventListener('input', (event) => {
    const distance = Number((event.target as HTMLInputElement).value);
    byId<HTMLOutputElement>('bindingDistanceValue').value = distance === 0 ? '原声' : `${distance}%`;
    updateEventShaping('lowpassHz', 20_000 - distance * 190);
  });
  byId('bindingShapingResetBtn').addEventListener('click', () => {
    updateSelected({ shaping: null });
    const binding = selected();
    if (binding) renderShaping(binding);
  });

  const editMap: Array<[
    string,
    keyof AudioBindingEdit,
    'text' | 'number' | 'checked',
    boolean?,
  ]> = [
    ['bindingEnabled', 'enabled', 'checked', true],
    ['bindingLabel', 'label', 'text', true],
    ['bindingKind', 'kind', 'text'],
    ['bindingVariation', 'variationMode', 'text'],
    ['bindingDelay', 'delayMs', 'number'],
    ['bindingCooldown', 'cooldownMs', 'number'],
    ['bindingProbability', 'probabilityPercent', 'number'],
    ['bindingVolume', 'volumePercent', 'number'],
    ['bindingBus', 'bus', 'text'],
    ['bindingSpatial', 'spatial', 'text'],
    ['bindingPlaybackMode', 'playbackMode', 'text'],
    ['bindingFadeIn', 'fadeInMs', 'number'],
    ['bindingFadeOut', 'fadeOutMs', 'number'],
    ['bindingStopEvent', 'stopEventId', 'text'],
  ];
  for (const [id, key, valueType, rerenderList] of editMap) {
    const node = byId<HTMLInputElement | HTMLSelectElement>(id);
    const eventName = node instanceof HTMLInputElement && (valueType === 'text' || node.type === 'range')
      ? 'input'
      : 'change';
    node.addEventListener(eventName, () => {
      const value = valueType === 'checked'
        ? (node as HTMLInputElement).checked
        : valueType === 'number'
          ? Number(node.value)
          : node.value;
      const edit = { [key]: value } as AudioBindingEdit;
      if (key === 'kind') {
        edit.bus = value as AudioBindingEdit['bus'];
        if (value === 'music') edit.playbackMode = 'loop';
      }
      updateSelected(edit, rerenderList);
      if (key === 'kind') {
        const binding = selected();
        if (binding) renderEditor();
      }
    });
  }

  for (const [inputId, outputId, format] of [
    ['bindingDelay', 'bindingDelayValue', formatDuration],
    ['bindingCooldown', 'bindingCooldownValue', formatDuration],
    ['bindingProbability', 'bindingProbabilityValue', (value: number) => `${value}%`],
    ['bindingVolume', 'bindingVolumeValue', (value: number) => `${value}%`],
  ] as const) {
    byId<HTMLInputElement>(inputId).addEventListener('input', (event) => {
      const value = Number((event.target as HTMLInputElement).value);
      byId<HTMLOutputElement>(outputId).value = format(value);
    });
  }

  byId('bindingAddAssetBtn').addEventListener('click', () => {
    const assets: AudioAssetRef[] = [
      ...(selected()?.assets ?? []),
      pendingAsset ? structuredClone(pendingAsset) : { assetId: '', file: '' },
    ];
    pendingAsset = null;
    updateSelected({ assets });
    const binding = selected();
    if (binding) renderAssets(binding);
  });

  byId('bindingAddConditionBtn').addEventListener('click', () => {
    const conditions: AudioCondition[] = [
      ...(selected()?.conditions ?? []),
      { field: 'state', operator: 'eq', value: 'value' },
    ];
    updateSelected({ conditions });
    const binding = selected();
    if (binding) renderConditions(binding);
  });

  byId('bindingDeleteBtn').addEventListener('click', () => {
    const binding = selected();
    if (!binding || !window.confirm(`删除“${binding.label}”绑定？声音文件不会被删除。`)) return;
    draft = removeBindingFromDraft(draft, binding.eventId);
    selectedEventId = draft[0]?.eventId ?? '';
    renderAll();
  });

  byId('bindingSaveBtn').addEventListener('click', () => { void saveDraft(); });
  byId('bindingApplyBtn').addEventListener('click', async () => {
    if (!project || !slug || !await saveDraft()) return;
    if (!window.confirm(`将草稿 v${project.revision} 应用到游戏“${slug}”并更新游戏侧音频运行时。继续吗？`)) return;
    setBusy(true);
    try {
      const result = await applyAudioProjectDraft(slug, project.revision);
      appliedRevision = result.project.revision;
      setStatus(`已应用 v${result.project.revision} · 生成 ${result.files.length} 个游戏侧文件`);
      updateHeader();
      showToast('音频绑定已应用到游戏', 'success');
      onApplied?.({ slug, revision: result.project.revision });
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusy(false);
    }
  });

  byId('bindingVerifyBtn').addEventListener('click', async () => {
    if (!slug) return;
    setBusy(true);
    try {
      const result = await verifyAppliedAudioProject(slug);
      setStatus(result.ok
        ? `验证通过：${result.instrumentedEventIds.length} 个事件已接入`
        : `需要处理：${result.errors.length} 个错误，${result.warnings.length} 个提醒`);
      showToast(result.ok ? '音频事件接入验证通过' : '验证发现需要处理的项目', result.ok ? 'success' : 'warning');
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusy(false);
    }
  });

  setBusy(false);
  renderAll();
  if (slug) void loadProject();
  return {
    selectGame(nextSlug: string): void {
      slug = nextSlug.trim();
      project = null;
      draft = [];
      candidates = [];
      selectedEventId = '';
      renderAll();
      if (slug) void loadProject();
    },
    scan(): void { void scan(); },
    publishState,
    queueAsset(asset: AudioAssetRef): void {
      const binding = selected();
      if (binding) {
        updateSelected({ assets: [...binding.assets, structuredClone(asset)] });
        const next = selected();
        if (next) renderAssets(next);
        showToast('自定义音频已加入当前事件', 'success');
      } else {
        pendingAsset = structuredClone(asset);
        setStatus('自定义音频已准备好；选择事件后点击“添加声音”');
      }
    },
  };
}
