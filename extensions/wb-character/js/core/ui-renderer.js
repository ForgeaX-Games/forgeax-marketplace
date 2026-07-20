import { registry } from './registry.js';
import { generateActionPrompt } from './prompt-engine.js';
import { state } from './state.js';
import { copyToClipboard } from '../utils/file-utils.js';

const CATEGORY_LABELS = {
    basic: '基础动作',
    movement: '移动动作',
    combat: '战斗动作',
    special: '特殊动作'
};

/**
 * Render categorized action checkboxes into the container (Step 3 left panel).
 */
export function renderActionCheckboxes(container) {
    container.innerHTML = '';
    const categories = registry.getCategories();

    categories.forEach(cat => {
        const catActions = registry.getByCategory(cat);
        const section = document.createElement('div');
        section.style.marginBottom = '12px';

        const heading = document.createElement('div');
        heading.style.cssText = 'font-size:12px;color:var(--text-dim);margin-bottom:4px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;';
        heading.textContent = CATEGORY_LABELS[cat] || cat;
        section.appendChild(heading);

        catActions.forEach(action => {
            const label = document.createElement('label');
            label.style.cssText = 'display:flex;align-items:center;gap:6px;color:var(--text);cursor:pointer;padding:3px 0;';

            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'actionCheck';
            cb.value = action.id;
            if (['idle', 'run', 'attack'].includes(action.id)) cb.checked = true;

            label.appendChild(cb);
            label.appendChild(document.createTextNode(` ${action.label}`));

            if (action.ui?.tips) {
                const tip = document.createElement('span');
                tip.style.cssText = 'font-size:11px;color:var(--text-dim);margin-left:4px;';
                tip.textContent = `— ${action.ui.tips}`;
                label.appendChild(tip);
            }

            section.appendChild(label);
        });

        container.appendChild(section);
    });
}

/**
 * Render prompt cards for all checked actions (Step 3 right panel).
 */
export function renderPromptCards(container) {
    container.innerHTML = '';
    const checks = document.querySelectorAll('.actionCheck:checked');

    if (checks.length === 0) {
        container.innerHTML = '<p class="hint">请先在左侧勾选至少一个动作。</p>';
        return;
    }

    checks.forEach(chk => {
        const action = registry.get(chk.value);
        if (!action) return;

        const prompt = generateActionPrompt(action, state);

        const card = document.createElement('div');
        card.style.marginBottom = '16px';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;';

        const tag = document.createElement('span');
        tag.className = 'tag tag-orange';
        tag.textContent = action.label;

        const copyBtn = document.createElement('button');
        copyBtn.className = 'btn-copy';
        copyBtn.textContent = '复制';
        copyBtn.addEventListener('click', () => {
            copyToClipboard(prompt);
            copyBtn.textContent = '已复制!';
            setTimeout(() => { copyBtn.textContent = '复制'; }, 1500);
        });

        header.appendChild(tag);
        header.appendChild(copyBtn);

        const textarea = document.createElement('textarea');
        textarea.readOnly = true;
        textarea.style.minHeight = '220px';
        textarea.value = prompt;

        const hint = document.createElement('div');
        hint.className = 'hint';
        hint.textContent = `将此提示词 + Step2下载的横条画布一起输入 NanoPro2 进行图生图。AI 会自动匹配参考图的尺寸和布局。`;

        card.appendChild(header);
        card.appendChild(textarea);
        card.appendChild(hint);
        container.appendChild(card);
    });
}

/**
 * Populate the action-select dropdown in Step 4.
 */
export function renderStep4ActionSelect(selectEl) {
    selectEl.innerHTML = '';
    registry.getAll().forEach(a => {
        const opt = document.createElement('option');
        opt.value = a.id;
        opt.textContent = a.label;
        selectEl.appendChild(opt);
    });
}

/**
 * Update Step 4 controls based on the currently selected action.
 */
export function updateStep4Controls() {
    const selectEl = document.getElementById('splitAction');
    const action = registry.get(selectEl?.value);
    if (!action) return;

    const config = action.postProcess;

    const modeLabels = {
        bottom: '底部对齐（脚底锚定）',
        top: '顶部对齐（头顶锚定）',
        center: '垂直中心对齐',
        none: '不对齐（保持原始位置）'
    };
    const hLabels = { center: ' + 水平居中对齐', none: '' };

    const infoEl = document.getElementById('alignInfo');
    const vLabel = modeLabels[config.alignMode] || '底部对齐';
    const hLabel = hLabels[config.horizontalAlign || 'none'] || '';
    infoEl.innerHTML = `<b>推荐对齐：</b>${vLabel}${hLabel}`;
    if (action.ui?.tips) {
        infoEl.innerHTML += `<br><span style="color:var(--text-dim);font-size:12px;">${action.ui.tips}</span>`;
    }

    const extraContainer = document.getElementById('extraControls');
    extraContainer.innerHTML = '';
    if (action.ui?.extraControls) {
        action.ui.extraControls.forEach(ctrl => {
            const div = document.createElement('div');
            div.className = 'form-group';
            const lbl = document.createElement('label');
            lbl.textContent = ctrl.label;
            div.appendChild(lbl);

            if (ctrl.type === 'range') {
                const input = document.createElement('input');
                Object.assign(input, { type: 'range', id: `extra_${ctrl.id}`, min: ctrl.min, max: ctrl.max, value: ctrl.default });
                input.style.width = '100%';
                div.appendChild(input);
            } else if (ctrl.type === 'number') {
                const input = document.createElement('input');
                Object.assign(input, { type: 'number', id: `extra_${ctrl.id}`, value: ctrl.default });
                input.style.width = '80px';
                div.appendChild(input);
            } else if (ctrl.type === 'checkbox') {
                const input = document.createElement('input');
                Object.assign(input, { type: 'checkbox', id: `extra_${ctrl.id}`, checked: !!ctrl.default });
                div.appendChild(input);
            }

            extraContainer.appendChild(div);
        });
    }

    document.getElementById('splitCols').value = action.defaultFrameCount || 5;
    document.getElementById('alignThreshold').value = config.defaultAlphaThreshold || 10;

    const skipRefEl = document.getElementById('skipRef');
    if (skipRefEl) {
        skipRefEl.checked = action.skipReferenceFrame !== false;
    }
}
