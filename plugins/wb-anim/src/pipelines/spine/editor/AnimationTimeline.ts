// @source wb-character/src/pipelines/spine/editor/AnimationTimeline.ts
import type { EditorSkeleton, EditorAnimation } from './types';
import { spineIcon } from './spine-icons';

const FRAME_RATE = 30;
const TRACK_H = 22;
const LABEL_W = 120;
const RULER_H = 24;
const DIAMOND = 5;
const SNAP_THRESHOLD = 0.5;

type ChannelType = 'rotate' | 'translate' | 'scale' | 'shear';
const CHANNEL_COLORS: Record<ChannelType, string> = {
  rotate: '#d4ff48',
  translate: '#7fb7ff',
  scale: '#65d49a',
  shear: '#c6a4ff',
};
const PLAYHEAD_COLOR = '#d4ff48';

interface KfHit {
  boneName: string;
  channel: ChannelType;
  time: number;
  trackIdx: number;
}

export class AnimationTimeline {
  private root: HTMLDivElement;
  private skeleton: EditorSkeleton | null = null;
  private currentAnim: EditorAnimation | null = null;

  onChange: ((animName: string | null, time: number, playing: boolean) => void) | null = null;

  private _playing = false;
  private _time = 0;
  private _loop = true;
  private _speed = 1;

  private scrollX = 0;
  private pixelsPerSecond = 200;
  private canvasEl!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private labelCanvas!: HTMLCanvasElement;
  private labelCtx!: CanvasRenderingContext2D;

  private selectEl!: HTMLSelectElement;
  private playBtn!: HTMLButtonElement;
  private timeLabel!: HTMLSpanElement;
  private speedLabel!: HTMLSpanElement;
  private vScrollEl!: HTMLDivElement;
  private vScrollThumb!: HTMLDivElement;
  private isDraggingVScroll = false;
  private vScrollDragStartY = 0;
  private vScrollDragStartValue = 0;

  private tracks: { boneName: string; channel: ChannelType; expanded: boolean }[] = [];
  private collapsedBones = new Set<string>();
  private selectedKfs = new Set<string>();
  private hoveredKf: KfHit | null = null;
  private selectedBone: string | null = null;

  private isDraggingPlayhead = false;
  private isDraggingKf = false;
  private kfDragStart: { time: number; mx: number } | null = null;
  private kfDragOrigTimes = new Map<string, number>();
  private isPanning = false;
  private panStartX = 0;
  private panStartScroll = 0;

  private animFrame = 0;
  private dpr = 1;
  private containerHeight = 200;
  private trackScrollY = 0;
  private copyBuffer: { boneName: string; channel: ChannelType; time: number; data: any }[] = [];

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'se-timeline';
    container.appendChild(this.root);

    this.buildToolbar();
    this.buildCanvas();
    this.setupInteraction();
  }

  private buildToolbar(): void {
    const bar = document.createElement('div');
    bar.className = 'tl-toolbar';
    this.root.appendChild(bar);

    const left = document.createElement('div');
    left.className = 'tl-toolbar-left';
    bar.appendChild(left);

    const addBtn = (parent: HTMLElement, content: string, title: string, cb: () => void) => {
      const b = document.createElement('button');
      b.className = 'tl-btn';
      b.innerHTML = content;
      b.title = title;
      b.addEventListener('click', cb);
      parent.appendChild(b);
      return b;
    };

    addBtn(left, spineIcon('skipBack', 'spine-icon-svg tl-icon-svg'), '回到起点 (Home)', () => this.goToStart());
    addBtn(left, spineIcon('stepBack', 'spine-icon-svg tl-icon-svg'), '上一帧 (←)', () => this.prevFrame());
    this.playBtn = addBtn(left, spineIcon('play', 'spine-icon-svg tl-icon-svg'), '播放/暂停 (Space)', () => this.togglePlay());
    addBtn(left, spineIcon('stepForward', 'spine-icon-svg tl-icon-svg'), '下一帧 (→)', () => this.nextFrame());
    addBtn(left, spineIcon('skipForward', 'spine-icon-svg tl-icon-svg'), '跳到末尾 (End)', () => this.goToEnd());
    addBtn(left, spineIcon('stop', 'spine-icon-svg tl-icon-svg'), '停止', () => this.stop());

    const sep1 = document.createElement('span');
    sep1.className = 'tl-sep';
    left.appendChild(sep1);

    this.selectEl = document.createElement('select');
    this.selectEl.className = 'tl-select';
    this.selectEl.addEventListener('change', () => {
      const name = this.selectEl.value || null;
      this.currentAnim = name ? this.skeleton?.animations.get(name) ?? null : null;
      this._time = 0;
      this._playing = false;
      this.setPlayButtonIcon(false);
      this.rebuildTracks();
      this.emitChange();
    });
    left.appendChild(this.selectEl);

    this.timeLabel = document.createElement('span');
    this.timeLabel.className = 'tl-time';
    this.timeLabel.textContent = '0:00 / 0:00';
    left.appendChild(this.timeLabel);

    const right = document.createElement('div');
    right.className = 'tl-toolbar-right';
    bar.appendChild(right);

    addBtn(right, spineIcon('keyframePlus', 'spine-icon-svg tl-icon-svg'), '在当前时间添加关键帧 (K)', () => this.addKeyframeAtCurrent());
    addBtn(right, spineIcon('keyframeMinus', 'spine-icon-svg tl-icon-svg'), '删除选中关键帧 (Del)', () => this.deleteSelectedKeyframes());
    addBtn(right, spineIcon('copy', 'spine-icon-svg tl-icon-svg'), '复制选中关键帧 (Ctrl+C)', () => this.copyKeyframes());
    addBtn(right, spineIcon('paste', 'spine-icon-svg tl-icon-svg'), '粘贴关键帧 (Ctrl+V)', () => this.pasteKeyframes());

    const sep2 = document.createElement('span');
    sep2.className = 'tl-sep';
    right.appendChild(sep2);

    addBtn(right, spineIcon('zoomOut', 'spine-icon-svg tl-icon-svg'), '缩小时间轴', () => this.zoomTimeline(0.8));
    addBtn(right, spineIcon('zoomIn', 'spine-icon-svg tl-icon-svg'), '放大时间轴', () => this.zoomTimeline(1.25));

    const sep3 = document.createElement('span');
    sep3.className = 'tl-sep';
    right.appendChild(sep3);

    const speedBtn = addBtn(right, '1×', '播放速度', () => this.cycleSpeed());
    this.speedLabel = speedBtn as unknown as HTMLSpanElement;

    const loopBtn = addBtn(right, spineIcon('loop', 'spine-icon-svg tl-icon-svg'), '循环播放', () => {
      this._loop = !this._loop;
      loopBtn.classList.toggle('active', this._loop);
    });
    loopBtn.classList.add('active');
  }

  private buildCanvas(): void {
    const wrap = document.createElement('div');
    wrap.className = 'tl-canvas-wrap';
    this.root.appendChild(wrap);

    const labelWrap = document.createElement('div');
    labelWrap.className = 'tl-label-area';
    wrap.appendChild(labelWrap);

    this.labelCanvas = document.createElement('canvas');
    this.labelCanvas.className = 'tl-label-canvas';
    labelWrap.appendChild(this.labelCanvas);
    this.labelCtx = this.labelCanvas.getContext('2d')!;

    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'tl-track-area';
    wrap.appendChild(canvasWrap);

    this.canvasEl = document.createElement('canvas');
    this.canvasEl.className = 'tl-track-canvas';
    canvasWrap.appendChild(this.canvasEl);
    this.ctx = this.canvasEl.getContext('2d')!;

    this.vScrollEl = document.createElement('div');
    this.vScrollEl.className = 'tl-v-scroll';
    this.vScrollThumb = document.createElement('div');
    this.vScrollThumb.className = 'tl-v-scroll-thumb';
    this.vScrollEl.appendChild(this.vScrollThumb);
    this.vScrollEl.setAttribute('aria-label', '时间轴纵向滚动');
    this.vScrollEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const rect = this.vScrollEl.getBoundingClientRect();
      const thumbRect = this.vScrollThumb.getBoundingClientRect();
      if (e.target === this.vScrollThumb) {
        this.isDraggingVScroll = true;
        this.vScrollDragStartY = e.clientY;
        this.vScrollDragStartValue = this.trackScrollY;
        document.addEventListener('mousemove', this.onVScrollDrag);
        document.addEventListener('mouseup', this.onVScrollDragEnd);
        return;
      }
      const max = this.getMaxTrackScroll();
      const trackH = Math.max(1, rect.height - thumbRect.height);
      const y = e.clientY - rect.top - thumbRect.height / 2;
      this.trackScrollY = this.clampTrackScroll((y / trackH) * max);
      this.syncVerticalScrollbar();
    });
    canvasWrap.appendChild(this.vScrollEl);

    new ResizeObserver(() => this.resizeCanvas()).observe(wrap);
  }

  private resizeCanvas(): void {
    const wrap = this.root.querySelector('.tl-canvas-wrap') as HTMLElement;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.containerHeight = rect.height;

    const labelW = LABEL_W * this.dpr;
    const labelH = rect.height * this.dpr;
    this.labelCanvas.width = labelW;
    this.labelCanvas.height = labelH;
    this.labelCanvas.style.width = `${LABEL_W}px`;
    this.labelCanvas.style.height = `${rect.height}px`;

    const trackCssW = Math.max(1, rect.width - LABEL_W - 10);
    const trackW = trackCssW * this.dpr;
    const trackH = rect.height * this.dpr;
    this.canvasEl.width = trackW;
    this.canvasEl.height = trackH;
    this.canvasEl.style.width = `${trackCssW}px`;
    this.canvasEl.style.height = `${rect.height}px`;
    this.syncVerticalScrollbar();
  }

  private getMaxTrackScroll(): number {
    const visibleH = Math.max(0, this.containerHeight - RULER_H);
    return Math.max(0, this.tracks.length * TRACK_H - visibleH);
  }

  private clampTrackScroll(value: number): number {
    return Math.max(0, Math.min(this.getMaxTrackScroll(), value));
  }

  private syncVerticalScrollbar(): void {
    if (!this.vScrollEl || !this.vScrollThumb) return;
    const max = this.getMaxTrackScroll();
    this.trackScrollY = this.clampTrackScroll(this.trackScrollY);
    this.vScrollEl.style.display = max > 1 ? '' : 'none';
    if (max <= 1) return;

    const visibleH = Math.max(1, this.containerHeight - RULER_H);
    const contentH = Math.max(visibleH, this.tracks.length * TRACK_H);
    const trackH = Math.max(1, this.vScrollEl.getBoundingClientRect().height);
    const thumbH = Math.max(18, Math.min(trackH, (visibleH / contentH) * trackH));
    const top = (this.trackScrollY / max) * Math.max(0, trackH - thumbH);
    this.vScrollThumb.style.height = `${thumbH}px`;
    this.vScrollThumb.style.transform = `translateY(${top}px)`;
  }

  private onVScrollDrag = (e: MouseEvent): void => {
    if (!this.isDraggingVScroll) return;
    const max = this.getMaxTrackScroll();
    const trackH = this.vScrollEl.getBoundingClientRect().height;
    const thumbH = this.vScrollThumb.getBoundingClientRect().height;
    const travel = Math.max(1, trackH - thumbH);
    const dy = e.clientY - this.vScrollDragStartY;
    this.trackScrollY = this.clampTrackScroll(this.vScrollDragStartValue + (dy / travel) * max);
    this.syncVerticalScrollbar();
  };

  private onVScrollDragEnd = (): void => {
    this.isDraggingVScroll = false;
    document.removeEventListener('mousemove', this.onVScrollDrag);
    document.removeEventListener('mouseup', this.onVScrollDragEnd);
  };

  private setupInteraction(): void {
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        this.zoomTimeline(e.deltaY < 0 ? 1.15 : 0.87);
      } else if (e.shiftKey) {
        this.scrollX = Math.max(0, this.scrollX + e.deltaY * 0.5);
      } else {
        this.trackScrollY = this.clampTrackScroll(this.trackScrollY + e.deltaY * 0.5);
        this.syncVerticalScrollbar();
      }
    };
    this.canvasEl.addEventListener('mousedown', (e) => this.onCanvasMouseDown(e));
    this.canvasEl.addEventListener('mousemove', (e) => this.onCanvasMouseMove(e));
    this.canvasEl.addEventListener('mouseup', () => this.onCanvasMouseUp());
    this.canvasEl.addEventListener('mouseleave', () => this.onCanvasMouseUp());
    this.canvasEl.addEventListener('dblclick', (e) => this.onCanvasDblClick(e));
    this.canvasEl.addEventListener('wheel', handleWheel, { passive: false });

    this.canvasEl.addEventListener('contextmenu', (e) => e.preventDefault());

    this.labelCanvas.addEventListener('mousedown', (e) => {
      const my = e.offsetY - RULER_H;
      const idx = Math.floor((my + this.trackScrollY) / TRACK_H);
      if (idx >= 0 && idx < this.tracks.length) {
        const t = this.tracks[idx];
        this.selectedBone = t.boneName;
      }
    });
    this.labelCanvas.addEventListener('wheel', handleWheel, { passive: false });

    this.root.addEventListener('keydown', (e) => this.onKeyDown(e));
    this.root.tabIndex = 0;
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key === ' ') { e.preventDefault(); this.togglePlay(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); this.prevFrame(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); this.nextFrame(); }
    else if (e.key === 'Home') { e.preventDefault(); this.goToStart(); }
    else if (e.key === 'End') { e.preventDefault(); this.goToEnd(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.deleteSelectedKeyframes(); }
    else if (e.key === 'k' || e.key === 'K') { e.preventDefault(); this.addKeyframeAtCurrent(); }
    else if ((e.ctrlKey || e.metaKey) && e.key === 'c') { e.preventDefault(); this.copyKeyframes(); }
    else if ((e.ctrlKey || e.metaKey) && e.key === 'v') { e.preventDefault(); this.pasteKeyframes(); }
    else if ((e.ctrlKey || e.metaKey) && e.key === 'a') { e.preventDefault(); this.selectAllKeyframes(); }
  }

  private setPlayButtonIcon(playing: boolean): void {
    if (!this.playBtn) return;
    this.playBtn.innerHTML = spineIcon(playing ? 'pause' : 'play', 'spine-icon-svg tl-icon-svg');
  }

  private timeToX(t: number): number {
    return t * this.pixelsPerSecond - this.scrollX;
  }

  private xToTime(x: number): number {
    return (x + this.scrollX) / this.pixelsPerSecond;
  }

  private snapTime(t: number): number {
    const frameTime = 1 / FRAME_RATE;
    const nearest = Math.round(t / frameTime) * frameTime;
    if (Math.abs(t - nearest) * this.pixelsPerSecond < SNAP_THRESHOLD * this.pixelsPerSecond * 0.05) {
      return Math.round(nearest * 1000) / 1000;
    }
    return Math.round(t * 1000) / 1000;
  }

  private kfKey(bone: string, ch: ChannelType, time: number): string {
    return `${bone}|${ch}|${time.toFixed(3)}`;
  }

  private hitTestKeyframe(mx: number, my: number): KfHit | null {
    const anim = this.currentAnim;
    if (!anim) return null;
    const adjustedY = my - RULER_H + this.trackScrollY;
    const trackIdx = Math.floor(adjustedY / TRACK_H);
    if (trackIdx < 0 || trackIdx >= this.tracks.length) return null;
    const track = this.tracks[trackIdx];
    const tl = anim.boneTimelines[track.boneName];
    if (!tl) return null;

    const arr = tl[track.channel];
    if (!arr) return null;

    for (const kf of arr) {
      const kx = this.timeToX(kf.time);
      if (Math.abs(mx - kx) < DIAMOND + 2) {
        return { boneName: track.boneName, channel: track.channel, time: kf.time, trackIdx };
      }
    }
    return null;
  }

  private onCanvasMouseDown(e: MouseEvent): void {
    const rect = this.canvasEl.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (e.button === 2 || e.button === 1) {
      this.isPanning = true;
      this.panStartX = e.clientX;
      this.panStartScroll = this.scrollX;
      this.canvasEl.style.cursor = 'grabbing';
      return;
    }

    if (my < RULER_H) {
      this.isDraggingPlayhead = true;
      const t = Math.max(0, this.xToTime(mx));
      this._time = this.snapTime(t);
      this._playing = false;
      this.setPlayButtonIcon(false);
      this.emitChange();
      return;
    }

    const hit = this.hitTestKeyframe(mx, my);
    if (hit) {
      const key = this.kfKey(hit.boneName, hit.channel, hit.time);
      if (e.shiftKey) {
        if (this.selectedKfs.has(key)) this.selectedKfs.delete(key);
        else this.selectedKfs.add(key);
      } else if (!this.selectedKfs.has(key)) {
        this.selectedKfs.clear();
        this.selectedKfs.add(key);
      }
      this.isDraggingKf = true;
      this.kfDragStart = { time: hit.time, mx };
      this.kfDragOrigTimes.clear();
      for (const k of this.selectedKfs) {
        const parts = k.split('|');
        this.kfDragOrigTimes.set(k, parseFloat(parts[2]));
      }
      this.selectedBone = hit.boneName;
    } else {
      if (!e.shiftKey) this.selectedKfs.clear();
      this.isDraggingPlayhead = true;
      const t = Math.max(0, this.xToTime(mx));
      this._time = this.snapTime(t);
      this._playing = false;
      this.setPlayButtonIcon(false);
      this.emitChange();
    }
  }

  private onCanvasMouseMove(e: MouseEvent): void {
    const rect = this.canvasEl.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (this.isPanning) {
      this.scrollX = Math.max(0, this.panStartScroll - (e.clientX - this.panStartX));
      return;
    }

    if (this.isDraggingPlayhead) {
      const t = Math.max(0, this.xToTime(mx));
      this._time = this.snapTime(t);
      this.emitChange();
      return;
    }

    if (this.isDraggingKf && this.kfDragStart) {
      const dt = (mx - this.kfDragStart.mx) / this.pixelsPerSecond;
      const anim = this.currentAnim;
      if (!anim) return;

      for (const [key, origTime] of this.kfDragOrigTimes) {
        const parts = key.split('|');
        const bone = parts[0];
        const ch = parts[1] as ChannelType;
        const tl = anim.boneTimelines[bone];
        if (!tl) continue;
        const arr = tl[ch];
        if (!arr) continue;
        const kf = arr.find(k => Math.abs(k.time - origTime) < 0.005);
        if (kf) {
          kf.time = this.snapTime(Math.max(0, origTime + dt));
        }
      }
      return;
    }

    this.hoveredKf = this.hitTestKeyframe(mx, my);
    this.canvasEl.style.cursor = this.hoveredKf ? 'pointer' : (my < RULER_H ? 'col-resize' : 'default');
  }

  private onCanvasMouseUp(): void {
    if (this.isDraggingKf && this.currentAnim) {
      for (const tl of Object.values(this.currentAnim.boneTimelines)) {
        tl.rotate?.sort((a, b) => a.time - b.time);
        tl.translate?.sort((a, b) => a.time - b.time);
        tl.scale?.sort((a, b) => a.time - b.time);
        tl.shear?.sort((a, b) => a.time - b.time);
      }
      const newSelected = new Set<string>();
      for (const [key] of this.kfDragOrigTimes) {
        const parts = key.split('|');
        const bone = parts[0];
        const ch = parts[1] as ChannelType;
        const tl = this.currentAnim.boneTimelines[bone]?.[ch];
        if (tl) {
          for (const kf of tl) {
            newSelected.add(this.kfKey(bone, ch, kf.time));
          }
        }
      }
    }
    this.isDraggingPlayhead = false;
    this.isDraggingKf = false;
    this.kfDragStart = null;
    this.isPanning = false;
    this.canvasEl.style.cursor = 'default';
  }

  private onCanvasDblClick(e: MouseEvent): void {
    const rect = this.canvasEl.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (my < RULER_H) return;

    const hit = this.hitTestKeyframe(mx, my);
    if (hit) {
      this.removeKeyframe(hit.boneName, hit.channel, hit.time);
      this.selectedKfs.delete(this.kfKey(hit.boneName, hit.channel, hit.time));
    } else {
      const adjustedY = my - RULER_H + this.trackScrollY;
      const trackIdx = Math.floor(adjustedY / TRACK_H);
      if (trackIdx >= 0 && trackIdx < this.tracks.length) {
        const track = this.tracks[trackIdx];
        const t = this.snapTime(Math.max(0, this.xToTime(mx)));
        this.addKeyframeAt(track.boneName, track.channel, t);
      }
    }
  }

  draw(): void {
    this.drawLabels();
    this.drawTracks();
  }

  private drawLabels(): void {
    const ctx = this.labelCtx;
    const dpr = this.dpr;
    const W = this.labelCanvas.width / dpr;
    const H = this.labelCanvas.height / dpr;
    ctx.clearRect(0, 0, this.labelCanvas.width, this.labelCanvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.fillStyle = 'rgba(25,20,14,0.98)';
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = 'rgba(30,26,18,1)';
    ctx.fillRect(0, 0, W, RULER_H);
    ctx.strokeStyle = 'rgba(232,196,138,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, RULER_H); ctx.lineTo(W, RULER_H); ctx.stroke();

    ctx.font = '10px sans-serif';
    ctx.textBaseline = 'middle';

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, RULER_H, W, Math.max(0, H - RULER_H));
    ctx.clip();

    let lastBone = '';
    for (let i = 0; i < this.tracks.length; i++) {
      const y = RULER_H + i * TRACK_H - this.trackScrollY;
      if (y + TRACK_H < RULER_H || y > H) continue;
      const t = this.tracks[i];

      if (t.boneName !== lastBone) {
        lastBone = t.boneName;
        ctx.fillStyle = this.selectedBone === t.boneName ? 'rgba(232,196,138,0.12)' : 'rgba(0,0,0,0)';
        ctx.fillRect(0, y, W, TRACK_H);
      }

      ctx.strokeStyle = 'rgba(232,196,138,0.06)';
      ctx.beginPath(); ctx.moveTo(0, y + TRACK_H); ctx.lineTo(W, y + TRACK_H); ctx.stroke();

      const color = CHANNEL_COLORS[t.channel];
      ctx.fillStyle = color;
      ctx.fillRect(4, y + TRACK_H / 2 - 3, 6, 6);

      ctx.fillStyle = this.selectedBone === t.boneName ? '#e8c48a' : 'rgba(200,180,140,0.6)';
      const label = `${t.boneName}.${t.channel.slice(0, 3)}`;
      ctx.fillText(label, 14, y + TRACK_H / 2 + 1, W - 18);
    }

    ctx.restore();

    ctx.strokeStyle = 'rgba(232,196,138,0.15)';
    ctx.beginPath(); ctx.moveTo(W, 0); ctx.lineTo(W, H); ctx.stroke();

    ctx.restore();
  }

  private drawTracks(): void {
    const ctx = this.ctx;
    const dpr = this.dpr;
    const W = this.canvasEl.width / dpr;
    const H = this.canvasEl.height / dpr;
    ctx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);
    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.fillStyle = 'rgba(22,18,12,0.98)';
    ctx.fillRect(0, 0, W, H);

    if (!this.currentAnim) {
      ctx.fillStyle = 'rgba(200,180,140,0.2)';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('选择动画以查看时间线', W / 2, H / 2);
      ctx.restore();
      return;
    }

    this.drawRuler(ctx, W);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, RULER_H, W, Math.max(0, H - RULER_H));
    ctx.clip();
    this.drawGrid(ctx, W, H);
    this.drawKeyframes(ctx, W, H);
    ctx.restore();
    this.drawPlayhead(ctx, H);

    ctx.restore();
  }

  private drawRuler(ctx: CanvasRenderingContext2D, W: number): void {
    ctx.fillStyle = 'rgba(30,26,18,1)';
    ctx.fillRect(0, 0, W, RULER_H);

    const dur = this.currentAnim?.duration ?? 1;
    const frameTime = 1 / FRAME_RATE;
    const startTime = this.scrollX / this.pixelsPerSecond;
    const endTime = (this.scrollX + W) / this.pixelsPerSecond;

    ctx.font = '9px "Orbitron",monospace';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';

    const majorInterval = this.getMajorInterval();
    const minorInterval = majorInterval / 5;

    for (let t = Math.floor(startTime / minorInterval) * minorInterval; t <= endTime; t += minorInterval) {
      if (t < 0) continue;
      const x = this.timeToX(t);
      const isMajor = Math.abs(t % majorInterval) < 0.001 || Math.abs(t % majorInterval - majorInterval) < 0.001;

      if (isMajor) {
        ctx.strokeStyle = 'rgba(232,196,138,0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, 14); ctx.lineTo(x, RULER_H); ctx.stroke();
        ctx.fillStyle = 'rgba(232,196,138,0.7)';
        ctx.fillText(`${t.toFixed(1)}s`, x, 3);
      } else {
        ctx.strokeStyle = 'rgba(232,196,138,0.15)';
        ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(x, 18); ctx.lineTo(x, RULER_H); ctx.stroke();
      }
    }

    if (dur > 0) {
      const endX = this.timeToX(dur);
      ctx.strokeStyle = 'rgba(255,100,100,0.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(endX, 0); ctx.lineTo(endX, RULER_H); ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.strokeStyle = 'rgba(232,196,138,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, RULER_H); ctx.lineTo(W, RULER_H); ctx.stroke();
  }

  private drawGrid(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    const startTime = this.scrollX / this.pixelsPerSecond;
    const endTime = (this.scrollX + W) / this.pixelsPerSecond;
    const majorInterval = this.getMajorInterval();
    const minorInterval = majorInterval / 5;

    for (let t = Math.floor(startTime / minorInterval) * minorInterval; t <= endTime; t += minorInterval) {
      if (t < 0) continue;
      const x = this.timeToX(t);
      const isMajor = Math.abs(t % majorInterval) < 0.001 || Math.abs(t % majorInterval - majorInterval) < 0.001;
      ctx.strokeStyle = isMajor ? 'rgba(232,196,138,0.07)' : 'rgba(232,196,138,0.03)';
      ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(x, RULER_H); ctx.lineTo(x, H); ctx.stroke();
    }

    for (let i = 0; i < this.tracks.length; i++) {
      const y = RULER_H + i * TRACK_H - this.trackScrollY;
      if (y + TRACK_H < RULER_H || y > H) continue;
      ctx.strokeStyle = 'rgba(232,196,138,0.05)';
      ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(0, y + TRACK_H); ctx.lineTo(W, y + TRACK_H); ctx.stroke();
    }
  }

  private drawKeyframes(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    const anim = this.currentAnim;
    if (!anim) return;

    for (let i = 0; i < this.tracks.length; i++) {
      const y = RULER_H + i * TRACK_H - this.trackScrollY;
      if (y + TRACK_H < RULER_H || y > H) continue;

      const track = this.tracks[i];
      const tl = anim.boneTimelines[track.boneName];
      if (!tl) continue;
      const arr = tl[track.channel];
      if (!arr) continue;

      const cy = y + TRACK_H / 2;
      const color = CHANNEL_COLORS[track.channel];

      if (arr.length > 1) {
        const sx = this.timeToX(arr[0].time);
        const ex = this.timeToX(arr[arr.length - 1].time);
        ctx.fillStyle = this.hexToRgba(color, 0.16);
        ctx.fillRect(sx, y + 4, ex - sx, TRACK_H - 8);
      }

      for (const kf of arr) {
        const x = this.timeToX(kf.time);
        if (x < -DIAMOND || x > W + DIAMOND) continue;

        const key = this.kfKey(track.boneName, track.channel, kf.time);
        const isSelected = this.selectedKfs.has(key);
        const isHovered = this.hoveredKf &&
          this.hoveredKf.boneName === track.boneName &&
          this.hoveredKf.channel === track.channel &&
          Math.abs(this.hoveredKf.time - kf.time) < 0.005;

        ctx.save();
        ctx.translate(x, cy);
        ctx.rotate(Math.PI / 4);
        const s = isSelected ? DIAMOND + 1 : DIAMOND;
        ctx.fillStyle = isSelected ? PLAYHEAD_COLOR : (isHovered ? '#e8ff8a' : color);
        ctx.fillRect(-s / 2, -s / 2, s, s);
        if (isSelected) {
          ctx.strokeStyle = 'rgba(255,255,255,0.85)';
          ctx.lineWidth = 1;
          ctx.strokeRect(-s / 2, -s / 2, s, s);
        }
        ctx.restore();
      }
    }
  }

  private drawPlayhead(ctx: CanvasRenderingContext2D, H: number): void {
    const x = this.timeToX(this._time);
    ctx.strokeStyle = PLAYHEAD_COLOR;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();

    ctx.fillStyle = PLAYHEAD_COLOR;
    ctx.beginPath();
    ctx.moveTo(x - 5, 0);
    ctx.lineTo(x + 5, 0);
    ctx.lineTo(x, 8);
    ctx.closePath();
    ctx.fill();
  }

  private hexToRgba(hex: string, alpha: number): string {
    const clean = hex.replace('#', '');
    const value = parseInt(clean.length === 3 ? clean.split('').map(ch => ch + ch).join('') : clean, 16);
    const r = (value >> 16) & 255;
    const g = (value >> 8) & 255;
    const b = value & 255;
    return `rgba(${r},${g},${b},${alpha})`;
  }

  private getMajorInterval(): number {
    const minPx = 80;
    const candidates = [0.1, 0.2, 0.5, 1, 2, 5, 10];
    for (const c of candidates) {
      if (c * this.pixelsPerSecond >= minPx) return c;
    }
    return 10;
  }

  private rebuildTracks(): void {
    this.tracks = [];
    const anim = this.currentAnim;
    if (!anim) return;

    for (const [boneName, tl] of Object.entries(anim.boneTimelines)) {
      const channels: ChannelType[] = ['rotate', 'translate', 'scale', 'shear'];
      for (const ch of channels) {
        if (tl[ch] && tl[ch]!.length > 0) {
          this.tracks.push({ boneName, channel: ch, expanded: true });
        }
      }
    }
    this.syncVerticalScrollbar();
  }

  setSkeleton(skel: EditorSkeleton): void {
    this.skeleton = skel;
    this.selectEl.innerHTML = '<option value="">-- 选择动画 --</option>';
    for (const [name] of skel.animations) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      this.selectEl.appendChild(opt);
    }
    this.currentAnim = null;
    this._time = 0;
    this._playing = false;
    this.rebuildTracks();
  }

  tick(dt: number): void {
    if (!this._playing || !this.currentAnim) return;
    this._time += dt * this._speed;
    if (this._time >= this.currentAnim.duration) {
      if (this._loop) {
        this._time = this._time % this.currentAnim.duration;
      } else {
        this._time = this.currentAnim.duration;
        this._playing = false;
        this.setPlayButtonIcon(false);
      }
    }
    this.autoScrollToPlayhead();
    this.updateTimeLabel();
    this.emitChange();
  }

  private autoScrollToPlayhead(): void {
    const W = this.canvasEl.width / this.dpr;
    const playheadX = this.timeToX(this._time);
    const margin = W * 0.15;
    if (playheadX > W - margin) {
      this.scrollX += playheadX - (W - margin);
    } else if (playheadX < margin && this.scrollX > 0) {
      this.scrollX = Math.max(0, this.scrollX - (margin - playheadX));
    }
  }

  get time(): number { return this._time; }
  get playing(): boolean { return this._playing; }
  get currentAnimName(): string | null { return this.currentAnim?.name ?? null; }

  setSelectedBone(name: string | null): void {
    this.selectedBone = name;
  }

  togglePlay(): void {
    if (!this.currentAnim) return;
    this._playing = !this._playing;
    this.setPlayButtonIcon(this._playing);
    this.emitChange();
  }

  private stop(): void {
    this._playing = false;
    this._time = 0;
    this.setPlayButtonIcon(false);
    this.updateTimeLabel();
    this.emitChange();
  }

  private goToStart(): void {
    this._time = 0;
    this._playing = false;
    this.setPlayButtonIcon(false);
    this.updateTimeLabel();
    this.emitChange();
  }

  private goToEnd(): void {
    this._time = this.currentAnim?.duration ?? 0;
    this._playing = false;
    this.setPlayButtonIcon(false);
    this.updateTimeLabel();
    this.emitChange();
  }

  private prevFrame(): void {
    const frame = 1 / FRAME_RATE;
    this._time = Math.max(0, Math.round((this._time - frame) * FRAME_RATE) / FRAME_RATE);
    this._playing = false;
    this.setPlayButtonIcon(false);
    this.updateTimeLabel();
    this.emitChange();
  }

  private nextFrame(): void {
    const frame = 1 / FRAME_RATE;
    const dur = this.currentAnim?.duration ?? 1;
    this._time = Math.min(dur, Math.round((this._time + frame) * FRAME_RATE) / FRAME_RATE);
    this._playing = false;
    this.setPlayButtonIcon(false);
    this.updateTimeLabel();
    this.emitChange();
  }

  private cycleSpeed(): void {
    const speeds = [0.25, 0.5, 1, 1.5, 2];
    const idx = speeds.indexOf(this._speed);
    this._speed = speeds[(idx + 1) % speeds.length];
    (this.speedLabel as HTMLButtonElement).textContent = `${this._speed}×`;
  }

  private zoomTimeline(factor: number): void {
    this.pixelsPerSecond = Math.max(30, Math.min(2000, this.pixelsPerSecond * factor));
  }

  private updateTimeLabel(): void {
    const dur = this.currentAnim?.duration ?? 0;
    const frame = Math.round(this._time * FRAME_RATE);
    const totalFrames = Math.round(dur * FRAME_RATE);
    this.timeLabel.textContent = `${this._time.toFixed(2)}s  f${frame} / ${totalFrames}`;
  }

  selectAnimation(name: string): void {
    this.selectEl.value = name;
    this.currentAnim = this.skeleton?.animations.get(name) ?? null;
    this._time = 0;
    this.rebuildTracks();
    this.emitChange();
  }

  addOrUpdateKeyframe(boneName: string, prop: 'rotation' | 'position', value: number | { x: number; y: number }): void {
    if (!this.currentAnim) return;
    if (!this.currentAnim.boneTimelines[boneName]) {
      this.currentAnim.boneTimelines[boneName] = {};
    }
    const tl = this.currentAnim.boneTimelines[boneName];
    const time = this.snapTime(this._time);

    if (prop === 'rotation') {
      if (!tl.rotate) tl.rotate = [];
      const kf = tl.rotate.find(k => Math.abs(k.time - time) < 0.005);
      if (kf) kf.value = value as number;
      else tl.rotate.push({ time, value: value as number });
      tl.rotate.sort((a, b) => a.time - b.time);
    } else if (prop === 'position') {
      if (!tl.translate) tl.translate = [];
      const kf = tl.translate.find(k => Math.abs(k.time - time) < 0.005);
      const v = value as { x: number; y: number };
      if (kf) { kf.x = v.x; kf.y = v.y; }
      else tl.translate.push({ time, x: v.x, y: v.y });
      tl.translate.sort((a, b) => a.time - b.time);
    }
    this.rebuildTracks();
    this.emitChange();
  }

  private addKeyframeAtCurrent(): void {
    if (!this.currentAnim || !this.selectedBone) return;
    const boneName = this.selectedBone;
    const time = this.snapTime(this._time);
    if (!this.currentAnim.boneTimelines[boneName]) {
      this.currentAnim.boneTimelines[boneName] = {};
    }
    const tl = this.currentAnim.boneTimelines[boneName];
    const bone = this.skeleton?.bones.get(boneName);
    if (!bone) return;

    if (!tl.rotate) tl.rotate = [];
    if (!tl.rotate.find(k => Math.abs(k.time - time) < 0.005)) {
      tl.rotate.push({ time, value: bone.localRotation - bone.setupRotation });
      tl.rotate.sort((a, b) => a.time - b.time);
    }

    if (!tl.translate) tl.translate = [];
    if (!tl.translate.find(k => Math.abs(k.time - time) < 0.005)) {
      tl.translate.push({ time, x: bone.localX - bone.setupX, y: bone.localY - bone.setupY });
      tl.translate.sort((a, b) => a.time - b.time);
    }

    this.rebuildTracks();
    this.emitChange();
  }

  private addKeyframeAt(boneName: string, channel: ChannelType, time: number): void {
    if (!this.currentAnim) return;
    if (!this.currentAnim.boneTimelines[boneName]) {
      this.currentAnim.boneTimelines[boneName] = {};
    }
    const tl = this.currentAnim.boneTimelines[boneName];

    if (channel === 'rotate') {
      if (!tl.rotate) tl.rotate = [];
      if (!tl.rotate.find(k => Math.abs(k.time - time) < 0.005)) {
        tl.rotate.push({ time, value: 0 });
        tl.rotate.sort((a, b) => a.time - b.time);
      }
    } else if (channel === 'translate') {
      if (!tl.translate) tl.translate = [];
      if (!tl.translate.find(k => Math.abs(k.time - time) < 0.005)) {
        tl.translate.push({ time, x: 0, y: 0 });
        tl.translate.sort((a, b) => a.time - b.time);
      }
    } else if (channel === 'scale') {
      if (!tl.scale) tl.scale = [];
      if (!tl.scale.find(k => Math.abs(k.time - time) < 0.005)) {
        tl.scale.push({ time, x: 1, y: 1 });
        tl.scale.sort((a, b) => a.time - b.time);
      }
    }
    this.rebuildTracks();
  }

  private removeKeyframe(boneName: string, channel: ChannelType, time: number): void {
    if (!this.currentAnim) return;
    const tl = this.currentAnim.boneTimelines[boneName];
    if (!tl) return;
    const arr = tl[channel];
    if (arr) {
      const idx = arr.findIndex(k => Math.abs(k.time - time) < 0.005);
      if (idx >= 0) arr.splice(idx, 1);
    }
    this.rebuildTracks();
  }

  private deleteSelectedKeyframes(): void {
    if (!this.currentAnim || this.selectedKfs.size === 0) return;
    for (const key of this.selectedKfs) {
      const parts = key.split('|');
      this.removeKeyframe(parts[0], parts[1] as ChannelType, parseFloat(parts[2]));
    }
    this.selectedKfs.clear();
  }

  private copyKeyframes(): void {
    if (!this.currentAnim || this.selectedKfs.size === 0) return;
    this.copyBuffer = [];
    for (const key of this.selectedKfs) {
      const parts = key.split('|');
      const bone = parts[0];
      const ch = parts[1] as ChannelType;
      const time = parseFloat(parts[2]);
      const tl = this.currentAnim.boneTimelines[bone]?.[ch];
      if (!tl) continue;
      const kf = tl.find(k => Math.abs(k.time - time) < 0.005);
      if (kf) {
        this.copyBuffer.push({ boneName: bone, channel: ch, time, data: { ...kf } });
      }
    }
  }

  private pasteKeyframes(): void {
    if (!this.currentAnim || this.copyBuffer.length === 0) return;
    const minTime = Math.min(...this.copyBuffer.map(c => c.time));
    const offset = this._time - minTime;

    for (const item of this.copyBuffer) {
      const newTime = this.snapTime(item.time + offset);
      const newData = { ...item.data, time: newTime };
      if (!this.currentAnim.boneTimelines[item.boneName]) {
        this.currentAnim.boneTimelines[item.boneName] = {};
      }
      const tl: any = this.currentAnim.boneTimelines[item.boneName];
      if (!tl[item.channel]) tl[item.channel] = [];
      const arr: any[] = tl[item.channel]!;
      const existing = arr.findIndex((k: any) => Math.abs(k.time - newTime) < 0.005);
      if (existing >= 0) arr[existing] = newData;
      else arr.push(newData);
      arr.sort((a: any, b: any) => a.time - b.time);
    }
    this.rebuildTracks();
  }

  private selectAllKeyframes(): void {
    this.selectedKfs.clear();
    if (!this.currentAnim) return;
    for (const [bone, tl] of Object.entries(this.currentAnim.boneTimelines)) {
      for (const ch of ['rotate', 'translate', 'scale', 'shear'] as ChannelType[]) {
        const arr = tl[ch];
        if (!arr) continue;
        for (const kf of arr) {
          this.selectedKfs.add(this.kfKey(bone, ch, kf.time));
        }
      }
    }
  }

  private emitChange(): void {
    this.onChange?.(this.currentAnim?.name ?? null, this._time, this._playing);
  }
}
