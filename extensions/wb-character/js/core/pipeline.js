import { generateStaticPrompt } from './prompt-engine.js';
import { state } from './state.js';
import { copyToClipboard, downloadCanvas } from '../utils/file-utils.js';

/**
 * Initialize Step 1 (static frame extraction) and Step 2 (strip canvas composition).
 */
export function initPipeline() {
    initStep1();
    initStep2();
}

function initStep1() {
    const promptEl = document.getElementById('step1Prompt');
    const styleEl = document.getElementById('pixelStyle');
    const ratioEl = document.getElementById('headBodyRatio');

    function refreshPrompt() {
        const style = styleEl.value;
        const ratio = ratioEl.value;
        state.char.style = style;
        promptEl.value = generateStaticPrompt(style, ratio);
    }

    refreshPrompt();
    styleEl.addEventListener('change', refreshPrompt);
    ratioEl.addEventListener('change', refreshPrompt);

    document.getElementById('btnCopyStep1').addEventListener('click', () => {
        const text = promptEl.value;
        if (!text) return;
        copyToClipboard(text);
        const btn = document.getElementById('btnCopyStep1');
        const orig = btn.textContent;
        btn.textContent = '已复制!';
        btn.style.background = 'var(--green)';
        setTimeout(() => { btn.textContent = orig; btn.style.background = ''; }, 1500);
    });
}

function initStep2() {
    const refCanvas = document.getElementById('refCanvas');
    let refCtx = refCanvas.getContext('2d');

    function clearCanvas() {
        refCanvas.width = state.strip.width;
        refCanvas.height = 200;
        refCtx = refCanvas.getContext('2d');
        refCtx.fillStyle = '#ffffff';
        refCtx.fillRect(0, 0, state.strip.width, 200);
        document.getElementById('stripDimInfo').style.display = 'none';
    }
    clearCanvas();

    document.getElementById('staticUpload').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const img = new Image();
            img.onload = () => {
                state.strip.frameCount = parseInt(document.getElementById('totalFrames').value) || 5;
                const cellW = Math.floor(state.strip.width / state.strip.frameCount);
                const cellH = cellW;
                state.strip.height = cellH;

                refCanvas.width = state.strip.width;
                refCanvas.height = state.strip.height;
                refCtx = refCanvas.getContext('2d');

                refCtx.fillStyle = '#ffffff';
                refCtx.fillRect(0, 0, state.strip.width, state.strip.height);

                refCtx.strokeStyle = '#cccccc';
                refCtx.lineWidth = 1;
                for (let i = 1; i < state.strip.frameCount; i++) {
                    refCtx.beginPath();
                    refCtx.moveTo(i * cellW, 0);
                    refCtx.lineTo(i * cellW, state.strip.height);
                    refCtx.stroke();
                }

                const pad = 4;
                const availW = cellW - pad * 2;
                const availH = cellH - pad * 2;
                const scale = Math.min(availW / img.width, availH / img.height);
                const drawW = Math.round(img.width * scale);
                const drawH = Math.round(img.height * scale);
                const offX = pad + Math.round((availW - drawW) / 2);
                const offY = pad + Math.round((availH - drawH) / 2);

                refCtx.drawImage(img, offX, offY, drawW, drawH);

                const dimInfo = document.getElementById('stripDimInfo');
                dimInfo.style.display = 'block';
                dimInfo.innerHTML =
                    `<b>画布尺寸：</b>${state.strip.width} x ${state.strip.height}px &nbsp;|&nbsp; ` +
                    `<b>每格：</b>${cellW} x ${cellH}px &nbsp;|&nbsp; ` +
                    `<b>总帧数：</b>${state.strip.frameCount}（第1格为参考，后${state.strip.frameCount - 1}格留给AI）`;
            };
            img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
    });

    document.getElementById('btnDownloadCanvas').addEventListener('click', () => {
        downloadCanvas(refCanvas, `ref_strip_${state.strip.width}x${state.strip.height}.png`);
    });

    document.getElementById('btnClearCanvas').addEventListener('click', clearCanvas);
}
