import { state } from './core/state.js';
import { registry } from './core/registry.js';
import { initPipeline } from './core/pipeline.js';
import { processFrames } from './core/post-processor.js';
import { extractFrames, detectBackgroundColor, removeBackground } from './utils/canvas-utils.js';
import { setupDragDrop, downloadFramesAsZip } from './utils/file-utils.js';
import {
    renderActionCheckboxes,
    renderPromptCards,
    renderStep4ActionSelect,
    updateStep4Controls
} from './core/ui-renderer.js';

import idle from './actions/idle.js';
import walk from './actions/walk.js';
import run from './actions/run.js';
import attack from './actions/attack.js';
import cast from './actions/cast.js';
import death from './actions/death.js';
import hit from './actions/hit.js';
import jumpSlam from './actions/jump-slam.js';

[idle, walk, run, attack, cast, death, hit, jumpSlam].forEach(a => registry.register(a));

// =========================================================
//  App init — <script type="module"> is deferred by spec,
//  so DOM is ready when this runs.
// =========================================================

// --- Step navigation ---
const tabs = document.querySelectorAll('.step-tab');
const panels = document.querySelectorAll('.step-panel');

tabs.forEach((tab, idx) => {
    tab.addEventListener('click', () => switchStep(idx));
});

function switchStep(idx) {
    tabs.forEach((t, i) => t.classList.toggle('active', i === idx));
    panels.forEach((p, i) => p.classList.toggle('active', i === idx));
}

function markDone(idx) {
    tabs[idx].classList.add('done');
}

document.querySelectorAll('[data-next-step]').forEach(btn => {
    btn.addEventListener('click', () => {
        const doneIdx = parseInt(btn.dataset.markDone);
        const nextIdx = parseInt(btn.dataset.nextStep);
        if (!isNaN(doneIdx)) markDone(doneIdx);
        if (!isNaN(nextIdx)) switchStep(nextIdx);
    });
});

// --- Step 1 & 2 (pipeline) ---
initPipeline();

// --- Step 3: Action prompt generation ---
renderActionCheckboxes(document.getElementById('actionList'));

document.getElementById('btnGenPrompts').addEventListener('click', () => {
    renderPromptCards(document.getElementById('promptCards'));
});

// --- Step 4: Split & Preview ---
renderStep4ActionSelect(document.getElementById('splitAction'));
updateStep4Controls();

document.getElementById('splitAction').addEventListener('change', updateStep4Controls);
document.getElementById('btnSplit').addEventListener('click', splitAndPreview);
document.getElementById('btnDownloadFrames').addEventListener('click', downloadAllFrames);

let allSpriteSheets = [];
let allFrameDataUrls = [];

document.getElementById('spriteUpload').addEventListener('change', (e) => {
    allSpriteSheets = [];
    const files = e.target.files;
    let loaded = 0;
    for (let i = 0; i < files.length; i++) {
        const reader = new FileReader();
        reader.onload = (ev) => {
            const img = new Image();
            img.onload = () => {
                allSpriteSheets.push({ img, name: files[i].name });
                loaded++;
                if (loaded === files.length) {
                    document.getElementById('framesGrid').innerHTML =
                        `<p class="hint">${loaded} 张横条已加载，点击"拆帧并预览"。</p>`;
                }
            };
            img.src = ev.target.result;
        };
        reader.readAsDataURL(files[i]);
    }
});

function splitAndPreview() {
    const actionId = document.getElementById('splitAction').value;
    const action = registry.get(actionId) || registry.get('idle');
    const cols = parseInt(document.getElementById('splitCols').value) || 5;
    const delay = parseInt(document.getElementById('frameDelay').value) || 120;
    const alphaThresh = parseInt(document.getElementById('alignThreshold').value) || 10;
    const bgTolerance = parseInt(document.getElementById('bgTolerance').value) || 30;
    const overrideAlign = document.getElementById('overrideAlign').value;
    const doRemoveBg = document.getElementById('removeBg').checked;

    const grid = document.getElementById('framesGrid');
    const gifArea = document.getElementById('gifPreview');
    grid.innerHTML = '';
    gifArea.innerHTML = '';
    allFrameDataUrls = [];

    const effectiveAction = overrideAlign === 'auto'
        ? action
        : { ...action, postProcess: { ...action.postProcess, alignMode: overrideAlign } };

    const skipRef = document.getElementById('skipRef').checked;

    allSpriteSheets.forEach((sheet) => {
        const fullCanvas = document.createElement('canvas');
        fullCanvas.width = sheet.img.width;
        fullCanvas.height = sheet.img.height;
        fullCanvas.getContext('2d').drawImage(sheet.img, 0, 0);

        let cleanSheet = fullCanvas;
        if (doRemoveBg) {
            const bgColor = detectBackgroundColor(fullCanvas);
            if (bgColor) {
                cleanSheet = removeBackground(fullCanvas, bgColor, bgTolerance);
            }
        }

        const allFrames = extractFrames(cleanSheet, cols);
        const fw = allFrames[0].width;
        const fh = allFrames[0].height;

        const refFrames = skipRef ? allFrames.slice(0, 1) : [];
        const animRaw = skipRef ? allFrames.slice(1) : allFrames;

        const alignedFrames = processFrames(animRaw, effectiveAction, {
            alphaThreshold: alphaThresh,
            removeBg: false
        });

        const baseName = sheet.name.replace(/\.[^.]+$/, '');

        refFrames.forEach((fc, c) => {
            const div = document.createElement('div');
            div.className = 'preview-item';
            div.style.opacity = '0.35';
            div.style.border = '1px dashed var(--text-dim)';
            const img = document.createElement('img');
            img.src = fc.toDataURL('image/png');
            const lbl = document.createElement('div');
            lbl.className = 'label';
            lbl.textContent = `#${c + 1} 参考帧(已跳过)`;
            div.appendChild(img);
            div.appendChild(lbl);
            grid.appendChild(div);
        });

        const animDataUrls = [];
        alignedFrames.forEach((fc, c) => {
            const dataUrl = fc.toDataURL('image/png');
            animDataUrls.push(dataUrl);
            const frameNum = skipRef ? c + 2 : c + 1;
            allFrameDataUrls.push({
                data: dataUrl,
                name: `${baseName}_frame_${frameNum}.png`
            });

            const div = document.createElement('div');
            div.className = 'preview-item';
            const img = document.createElement('img');
            img.src = dataUrl;
            const lbl = document.createElement('div');
            lbl.className = 'label';
            lbl.textContent = `#${frameNum}`;
            div.appendChild(img);
            div.appendChild(lbl);
            grid.appendChild(div);
        });

        createGifPreview(gifArea, animDataUrls, fw, fh, delay, sheet.name, action.label);
    });

    document.getElementById('gifActions').style.display =
        allSpriteSheets.length > 0 ? 'flex' : 'none';
}

function createGifPreview(container, frames, fw, fh, delay, sheetName, actionLabel) {
    const gifBox = document.createElement('div');
    gifBox.className = 'gif-box';

    const displayScale = Math.max(1, Math.min(3, Math.floor(300 / fh)));
    const gifCanvas = document.createElement('canvas');
    gifCanvas.width = fw * displayScale;
    gifCanvas.height = fh * displayScale;
    gifCanvas.style.width = fw * displayScale + 'px';
    gifCanvas.style.height = fh * displayScale + 'px';

    const gctx = gifCanvas.getContext('2d');
    gctx.imageSmoothingEnabled = false;

    let frameIdx = 0;
    const frameImages = frames.map(f => {
        const img = new Image();
        img.src = f;
        return img;
    });

    function drawFrame() {
        gctx.clearRect(0, 0, gifCanvas.width, gifCanvas.height);
        if (frameImages[frameIdx].complete) {
            gctx.drawImage(frameImages[frameIdx], 0, 0, gifCanvas.width, gifCanvas.height);
        }
        frameIdx = (frameIdx + 1) % frameImages.length;
    }
    setInterval(drawFrame, delay);
    setTimeout(drawFrame, 100);

    const lbl = document.createElement('div');
    lbl.className = 'label';
    lbl.textContent = `${sheetName.replace(/\.[^.]+$/, '')} (${actionLabel})`;
    gifBox.appendChild(gifCanvas);
    gifBox.appendChild(lbl);
    container.appendChild(gifBox);
}

function downloadAllFrames() {
    if (allFrameDataUrls.length === 0) return;
    downloadFramesAsZip(allFrameDataUrls);
}

// --- Drag & Drop setup ---
document.querySelectorAll('.upload-zone').forEach(zone => {
    const input = zone.querySelector('input[type="file"]');
    if (input) setupDragDrop(zone, input);
});

['dragover', 'drop'].forEach(evt => {
    document.addEventListener(evt, (e) => e.preventDefault());
});
