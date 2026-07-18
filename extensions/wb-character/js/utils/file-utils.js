export function copyToClipboard(text) {
    if (navigator.clipboard) {
        navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
        fallbackCopy(text);
    }
}

function fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
}

export function setupDragDrop(zoneEl, fileInput) {
    ['dragenter', 'dragover'].forEach(evt => {
        zoneEl.addEventListener(evt, (e) => {
            e.preventDefault();
            e.stopPropagation();
            zoneEl.classList.add('dragover');
        });
    });
    ['dragleave', 'drop'].forEach(evt => {
        zoneEl.addEventListener(evt, (e) => {
            e.preventDefault();
            e.stopPropagation();
            zoneEl.classList.remove('dragover');
        });
    });
    zoneEl.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        if (dt.files && dt.files.length > 0) {
            fileInput.files = dt.files;
            fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
    });
}

export async function downloadFramesAsZip(frameDataUrls) {
    /* global JSZip */
    const zip = new JSZip();
    frameDataUrls.forEach(f => {
        zip.file(f.name, f.data.split(',')[1], { base64: true });
    });
    const content = await zip.generateAsync({ type: 'blob' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(content);
    link.download = 'sprite_frames.zip';
    link.click();
    URL.revokeObjectURL(link.href);
}

export function downloadCanvas(canvas, filename) {
    const link = document.createElement('a');
    link.download = filename;
    link.href = canvas.toDataURL('image/png');
    link.click();
}
