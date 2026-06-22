// @source wb-character/src/pipelines/spine/editor/SpineRenderer.ts
import type { EditorSkeleton, EditorBone, EditorState, EditorAnimation, RawAttachment } from './types';
import { computeWorldTransforms, applyIKConstraints } from './SpineDataParser';

const BONE_COLOR = '#44cc66';
const BONE_SELECTED = '#ffcc00';
const BONE_HOVERED = '#88ffaa';
const JOINT_COLOR = '#ff4444';
const JOINT_SELECTED = '#ffee00';
const SLOT_COLOR = 'rgba(80,160,255,0.25)';
const IK_COLOR = '#cc66ff';
const IK_DASH = [6, 4];
const GRID_COLOR = 'rgba(80,70,55,0.12)';
const ORIGIN_COLOR = 'rgba(255,200,100,0.3)';

export class SpineRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private skeleton: EditorSkeleton | null = null;
  private state: EditorState;

  /** Whether animation is currently being applied (controls whether setup pose is overridden) */
  private animationActive = false;
  private attachmentImages = new Map<string, HTMLImageElement>();

  onBoneClick: ((boneName: string | null) => void) | null = null;
  onBoneHover: ((boneName: string | null) => void) | null = null;
  onBoneEdited: ((boneName: string, prop: 'rotation' | 'position', value: number | { x: number; y: number }) => void) | null = null;
  onDragStart: (() => void) | null = null;
  onDragEnd: (() => void) | null = null;

  private dragMode: 'none' | 'rotate' | 'translate' = 'none';
  private dragBone: string | null = null;
  private dragStartAngle = 0;
  private dragStartBoneRot = 0;
  private dragStartMouse = { x: 0, y: 0 };
  private dragStartBonePos = { x: 0, y: 0 };

  constructor(canvas: HTMLCanvasElement, state: EditorState) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.state = state;
    this.setupInteraction();
  }

  private get dpr(): number { return window.devicePixelRatio || 1; }
  private get lw(): number { return this.canvas.width / this.dpr; }
  private get lh(): number { return this.canvas.height / this.dpr; }

  setSkeleton(skel: EditorSkeleton): void {
    this.skeleton = skel;
    this.animationActive = false;
  }

  setAttachmentImages(images: Map<string, HTMLImageElement>): void {
    this.attachmentImages = images;
  }

  clearAttachmentImages(): void {
    this.attachmentImages.clear();
  }

  draw(): void {
    const ctx = this.ctx;
    const dpr = this.dpr;
    const w = this.lw, h = this.lh;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.fillStyle = 'rgba(22,18,12,0.98)';
    ctx.fillRect(0, 0, w, h);

    if (!this.skeleton) {
      ctx.fillStyle = 'rgba(200,185,160,0.4)';
      ctx.font = '16px "Rajdhani", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('未加载骨骼。按 F9 打开编辑器并加载骨骼 JSON。', w / 2, h / 2);
      ctx.restore();
      return;
    }

    const cx = w / 2 + this.state.panX;
    const cy = h / 2 + this.state.panY;
    const z = this.state.zoom;

    this.drawGrid(ctx, cx, cy, w, h, z);
    this.drawOrigin(ctx, cx, cy, z);

    if (this.state.currentAnimation) {
      this.applyAnimation();
    } else if (this.animationActive) {
      this.resetToSetupPose();
      this.animationActive = false;
    }

    const skel = this.skeleton;
    computeWorldTransforms(skel.bones, skel.boneOrder);
    if (skel.ik.length > 0) applyIKConstraints(skel.bones, skel.boneOrder, skel.ik);

    if (this.attachmentImages.size > 0) this.drawAttachmentImages(ctx, cx, cy, z);
    if (this.state.showSlots) this.drawSlots(ctx, cx, cy, z);
    if (this.state.showIK) this.drawIKChains(ctx, cx, cy, z);
    if (this.state.showBones) this.drawBones(ctx, cx, cy, z);
    if (this.state.mode === 'edit' && this.state.selectedBone) {
      this.drawGizmo(ctx, cx, cy, z);
    }

    ctx.restore();
  }

  private drawGrid(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number, z: number): void {
    const spacing = 50 * z;
    if (spacing < 10) return;
    ctx.fillStyle = GRID_COLOR;
    const sx = ((cx % spacing) - spacing) % spacing;
    const sy = ((cy % spacing) - spacing) % spacing;
    for (let x = sx; x < w; x += spacing)
      for (let y = sy; y < h; y += spacing)
        ctx.fillRect(x - 0.5, y - 0.5, 1, 1);
  }

  private drawOrigin(ctx: CanvasRenderingContext2D, cx: number, cy: number, z: number): void {
    ctx.strokeStyle = ORIGIN_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 20 * z, cy); ctx.lineTo(cx + 20 * z, cy);
    ctx.moveTo(cx, cy - 20 * z); ctx.lineTo(cx, cy + 20 * z);
    ctx.stroke();
  }

  private drawBones(ctx: CanvasRenderingContext2D, cx: number, cy: number, z: number): void {
    const skel = this.skeleton!;
    const sc = z * 0.1;

    for (const name of skel.boneOrder) {
      const bone = skel.bones.get(name)!;
      if (!bone.parent) continue;

      const sx = cx + bone.worldX * sc;
      const sy = cy - bone.worldY * sc;
      const isSelected = this.state.selectedBone === name;
      const isHovered = this.state.hoveredBone === name;

      if (bone.length > 0) {
        // Bone tip: local (length, 0) transformed by world matrix
        const ex = sx + (bone.worldA * bone.length) * sc;
        const ey = sy - (bone.worldC * bone.length) * sc;

        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey);
        ctx.strokeStyle = isSelected ? BONE_SELECTED : isHovered ? BONE_HOVERED : BONE_COLOR;
        ctx.lineWidth = isSelected ? 3 : isHovered ? 2.5 : 1.5;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(sx, sy, isSelected ? 5 : isHovered ? 4 : 3, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? JOINT_SELECTED : JOINT_COLOR;
      ctx.fill();

      if (z > 0.8 && (isSelected || isHovered)) {
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = `${Math.max(9, Math.floor(10 * z))}px monospace`;
        ctx.textAlign = 'left';
        ctx.fillText(name, sx + 8, sy - 6);
      }
    }
  }

  private drawSlots(ctx: CanvasRenderingContext2D, cx: number, cy: number, z: number): void {
    const skel = this.skeleton!;
    const sc = z * 0.1;
    for (const slot of skel.slots) {
      const bone = skel.bones.get(slot.boneName);
      if (!bone) continue;
      const sx = cx + bone.worldX * sc;
      const sy = cy - bone.worldY * sc;
      const atts = skel.skinAttachments.get(slot.name);
      if (atts && slot.attachmentName) {
        const att = atts.get(slot.attachmentName);
        if (att && att.width && att.height) {
          ctx.strokeStyle = SLOT_COLOR; ctx.lineWidth = 1;
          const w = att.width * sc, h = att.height * sc;
          ctx.strokeRect(sx - w / 2, sy - h / 2, w, h);
        }
      }
    }
  }

  private drawIKChains(ctx: CanvasRenderingContext2D, cx: number, cy: number, z: number): void {
    const skel = this.skeleton!;
    const sc = z * 0.1;
    ctx.setLineDash(IK_DASH);
    ctx.strokeStyle = IK_COLOR;
    ctx.lineWidth = 2;
    for (const ik of skel.ik) {
      const target = skel.bones.get(ik.targetName);
      if (!target) continue;
      const tx = cx + target.worldX * sc, ty = cy - target.worldY * sc;
      for (const bname of ik.boneNames) {
        const bone = skel.bones.get(bname);
        if (!bone) continue;
        const bx = cx + bone.worldX * sc, by = cy - bone.worldY * sc;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(tx, ty, 6, 0, Math.PI * 2);
      ctx.strokeStyle = IK_COLOR; ctx.stroke();
      ctx.fillStyle = 'rgba(204,102,255,0.3)'; ctx.fill();
    }
    ctx.setLineDash([]);
  }

  private drawAttachmentImages(ctx: CanvasRenderingContext2D, cx: number, cy: number, z: number): void {
    const skel = this.skeleton!;
    const sc = z * 0.1;

    for (const slot of skel.slots) {
      if (!slot.attachmentName) continue;

      const att = skel.skinAttachments.get(slot.name)?.get(slot.attachmentName);
      if (!att) continue;

      const imgName = att.name || att.path || slot.attachmentName;
      const img = this.attachmentImages.get(imgName)
        || this.attachmentImages.get(slot.name)
        || this.attachmentImages.get(slot.attachmentName);
      if (!img || !img.complete || img.naturalWidth === 0) continue;

      const bone = skel.bones.get(slot.boneName);
      if (!bone) continue;

      if (att.type === 'mesh' && att.uvs && att.triangles && att.vertices) {
        this.drawMesh(ctx, cx, cy, sc, skel, bone, att, img);
      } else if (!att.type || att.type === 'region') {
        this.drawRegion(ctx, cx, cy, sc, bone, att, img);
      }
    }
  }

  private drawRegion(
    ctx: CanvasRenderingContext2D,
    cx: number, cy: number, sc: number,
    bone: EditorBone, att: RawAttachment, img: HTMLImageElement,
  ): void {
    const attX = att.x ?? bone.length / 2;
    const attY = att.y ?? 0;
    const attRot = (att.rotation ?? 0) * Math.PI / 180;
    const attScaleX = att.scaleX ?? 1;
    const attScaleY = att.scaleY ?? 1;
    const attW = att.width ?? img.naturalWidth;
    const attH = att.height ?? img.naturalHeight;

    const worldX = bone.worldX + attX * bone.worldA + attY * bone.worldB;
    const worldY = bone.worldY + attX * bone.worldC + attY * bone.worldD;
    const imgScreenX = cx + worldX * sc;
    const imgScreenY = cy - worldY * sc;

    const ca = Math.cos(attRot), sa = Math.sin(attRot);
    const ma = (bone.worldA * ca + bone.worldB * sa) * sc;
    const mb = (bone.worldA * -sa + bone.worldB * ca) * sc;
    const mc = (bone.worldC * ca + bone.worldD * sa) * sc;
    const md = (bone.worldC * -sa + bone.worldD * ca) * sc;

    const fma = ma * attScaleX;
    const fmb = mb * attScaleY;
    const fmc = mc * attScaleX;
    const fmd = md * attScaleY;

    ctx.save();
    ctx.transform(fma, -fmc, -fmb, fmd, imgScreenX, imgScreenY);
    ctx.globalAlpha = 0.85;
    ctx.drawImage(img, -attW / 2, -attH / 2, attW, attH);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /**
   * Render a mesh attachment with textured triangles.
   * Supports both simple (bone-local) and weighted (multi-bone) vertices.
   */
  private drawMesh(
    ctx: CanvasRenderingContext2D,
    cx: number, cy: number, sc: number,
    skel: EditorSkeleton, bone: EditorBone,
    att: RawAttachment, img: HTMLImageElement,
  ): void {
    const uvs = att.uvs!;
    const triangles = att.triangles!;
    const rawVerts = att.vertices!;
    const vertCount = uvs.length / 2;
    const isWeighted = rawVerts.length > uvs.length;
    const imgW = img.naturalWidth;
    const imgH = img.naturalHeight;
    if (imgW === 0 || imgH === 0) return;

    const worldVerts = new Float32Array(vertCount * 2);

    if (isWeighted) {
      let vi = 0;
      for (let j = 0; j < vertCount; j++) {
        let wx = 0, wy = 0;
        const boneCount = rawVerts[vi++];
        for (let k = 0; k < boneCount; k++) {
          const boneIdx = rawVerts[vi++];
          const lx = rawVerts[vi++];
          const ly = rawVerts[vi++];
          const weight = rawVerts[vi++];
          const bName = skel.boneOrder[boneIdx];
          const b = bName ? skel.bones.get(bName) : undefined;
          if (b) {
            wx += (b.worldA * lx + b.worldB * ly + b.worldX) * weight;
            wy += (b.worldC * lx + b.worldD * ly + b.worldY) * weight;
          }
        }
        worldVerts[j * 2] = wx;
        worldVerts[j * 2 + 1] = wy;
      }
    } else {
      for (let j = 0; j < vertCount; j++) {
        const lx = rawVerts[j * 2];
        const ly = rawVerts[j * 2 + 1];
        worldVerts[j * 2] = bone.worldA * lx + bone.worldB * ly + bone.worldX;
        worldVerts[j * 2 + 1] = bone.worldC * lx + bone.worldD * ly + bone.worldY;
      }
    }

    ctx.globalAlpha = 0.85;
    for (let t = 0; t < triangles.length; t += 3) {
      const i0 = triangles[t], i1 = triangles[t + 1], i2 = triangles[t + 2];

      const x0 = cx + worldVerts[i0 * 2] * sc;
      const y0 = cy - worldVerts[i0 * 2 + 1] * sc;
      const x1 = cx + worldVerts[i1 * 2] * sc;
      const y1 = cy - worldVerts[i1 * 2 + 1] * sc;
      const x2 = cx + worldVerts[i2 * 2] * sc;
      const y2 = cy - worldVerts[i2 * 2 + 1] * sc;

      const u0 = uvs[i0 * 2] * imgW, v0 = uvs[i0 * 2 + 1] * imgH;
      const u1 = uvs[i1 * 2] * imgW, v1 = uvs[i1 * 2 + 1] * imgH;
      const u2 = uvs[i2 * 2] * imgW, v2 = uvs[i2 * 2 + 1] * imgH;

      this.drawTexturedTriangle(ctx, img,
        x0, y0, x1, y1, x2, y2,
        u0, v0, u1, v1, u2, v2,
      );
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Draw a single textured triangle via affine clip+transform.
   * Maps UV pixel coords to screen coords using a 3-point affine solve.
   */
  private drawTexturedTriangle(
    ctx: CanvasRenderingContext2D, img: HTMLImageElement,
    x0: number, y0: number, x1: number, y1: number, x2: number, y2: number,
    u0: number, v0: number, u1: number, v1: number, u2: number, v2: number,
  ): void {
    const denom = u0 * (v1 - v2) + u1 * (v2 - v0) + u2 * (v0 - v1);
    if (Math.abs(denom) < 1e-6) return;

    const invD = 1 / denom;
    const a = (x0 * (v1 - v2) + x1 * (v2 - v0) + x2 * (v0 - v1)) * invD;
    const b = (y0 * (v1 - v2) + y1 * (v2 - v0) + y2 * (v0 - v1)) * invD;
    const c = (x0 * (u2 - u1) + x1 * (u0 - u2) + x2 * (u1 - u0)) * invD;
    const d = (y0 * (u2 - u1) + y1 * (u0 - u2) + y2 * (u1 - u0)) * invD;
    const e = (x0 * (u1 * v2 - u2 * v1) + x1 * (u2 * v0 - u0 * v2) + x2 * (u0 * v1 - u1 * v0)) * invD;
    const f = (y0 * (u1 * v2 - u2 * v1) + y1 * (u2 * v0 - u0 * v2) + y2 * (u0 * v1 - u1 * v0)) * invD;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.closePath();
    ctx.clip();
    ctx.transform(a, b, c, d, e, f);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }

  private applyAnimation(): void {
    if (!this.skeleton || !this.state.currentAnimation) return;
    const anim = this.skeleton.animations.get(this.state.currentAnimation);
    if (!anim) return;
    this.animationActive = true;
    const t = this.state.animationTime % anim.duration;

    // Reset ALL bones to setup pose first, then overlay animation deltas
    for (const [, bone] of this.skeleton.bones) {
      bone.localRotation = bone.setupRotation;
      bone.localX = bone.setupX;
      bone.localY = bone.setupY;
      bone.scaleX = 1;
      bone.scaleY = 1;
      bone.shearX = 0;
      bone.shearY = 0;
    }

    for (const [boneName, tl] of Object.entries(anim.boneTimelines)) {
      const bone = this.skeleton.bones.get(boneName);
      if (!bone) continue;
      if (tl.rotate && tl.rotate.length > 0) {
        bone.localRotation = bone.setupRotation + interpolateValue(tl.rotate, t, 'value');
      }
      if (tl.translate && tl.translate.length > 0) {
        bone.localX = bone.setupX + interpolateValue(tl.translate, t, 'x');
        bone.localY = bone.setupY + interpolateValue(tl.translate, t, 'y');
      }
      if (tl.scale && tl.scale.length > 0) {
        bone.scaleX = interpolateValue(tl.scale, t, 'x');
        bone.scaleY = interpolateValue(tl.scale, t, 'y');
      }
      if (tl.shear && tl.shear.length > 0) {
        bone.shearX = interpolateValue(tl.shear, t, 'x');
        bone.shearY = interpolateValue(tl.shear, t, 'y');
      }
    }
  }

  private resetToSetupPose(): void {
    if (!this.skeleton) return;
    for (const [, bone] of this.skeleton.bones) {
      bone.localRotation = bone.setupRotation;
      bone.localX = bone.setupX;
      bone.localY = bone.setupY;
      bone.scaleX = 1;
      bone.scaleY = 1;
      bone.shearX = 0;
      bone.shearY = 0;
    }
  }

  hitTestBone(clientX: number, clientY: number): string | null {
    if (!this.skeleton) return null;
    const rect = this.canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const w = this.lw, h = this.lh;
    const cx = w / 2 + this.state.panX;
    const cy = h / 2 + this.state.panY;
    const z = this.state.zoom;
    const sc = z * 0.1;

    let closest: string | null = null;
    let closestDist = 15;
    for (const name of this.skeleton.boneOrder) {
      const bone = this.skeleton.bones.get(name)!;
      if (!bone.parent) continue;
      const sx = cx + bone.worldX * sc, sy = cy - bone.worldY * sc;
      const dist = Math.sqrt((mx - sx) ** 2 + (my - sy) ** 2);
      if (dist < closestDist) { closestDist = dist; closest = name; }
    }
    return closest;
  }

  private drawGizmo(ctx: CanvasRenderingContext2D, cx: number, cy: number, z: number): void {
    if (!this.skeleton || !this.state.selectedBone) return;
    const bone = this.skeleton.bones.get(this.state.selectedBone);
    if (!bone) return;
    const sc = z * 0.1;
    const sx = cx + bone.worldX * sc, sy = cy - bone.worldY * sc;
    const radius = 30 * z;

    ctx.save();
    ctx.strokeStyle = 'rgba(255,100,100,0.6)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sx, sy, radius, 0, Math.PI * 2); ctx.stroke();

    // Use worldRotation derived from the matrix for the rotation handle
    const rot = Math.atan2(bone.worldC, bone.worldA);
    const hx = sx + Math.cos(rot) * radius, hy = sy - Math.sin(rot) * radius;
    ctx.fillStyle = '#ff4444';
    ctx.beginPath(); ctx.arc(hx, hy, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '9px monospace'; ctx.textAlign = 'center';
    ctx.fillText('R', hx, hy + 3);

    const tLen = 20 * z;
    ctx.strokeStyle = 'rgba(100,200,255,0.8)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + tLen, sy); ctx.stroke();
    ctx.fillStyle = '#66ccff';
    ctx.beginPath(); ctx.moveTo(sx + tLen + 6, sy); ctx.lineTo(sx + tLen - 2, sy - 5); ctx.lineTo(sx + tLen - 2, sy + 5); ctx.fill();

    ctx.strokeStyle = 'rgba(100,255,100,0.8)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx, sy - tLen); ctx.stroke();
    ctx.fillStyle = '#66ff66';
    ctx.beginPath(); ctx.moveTo(sx, sy - tLen - 6); ctx.lineTo(sx - 5, sy - tLen + 2); ctx.lineTo(sx + 5, sy - tLen + 2); ctx.fill();
    ctx.restore();
  }

  private setupInteraction(): void {
    this.canvas.addEventListener('mousedown', (e) => {
      if (this.state.mode === 'edit' && this.state.selectedBone && this.skeleton) {
        const bone = this.skeleton.bones.get(this.state.selectedBone);
        if (!bone) return;

        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const w = this.lw;
        const cx = w / 2 + this.state.panX;
        const cy = this.lh / 2 + this.state.panY;
        const z = this.state.zoom;
        const sc = z * 0.1;

        const bx = cx + bone.worldX * sc, by = cy - bone.worldY * sc;
        const radius = 30 * z;
        const rot = bone.worldRotation * Math.PI / 180;
        const hx = bx + Math.cos(rot) * radius, hy = by - Math.sin(rot) * radius;

        if (Math.sqrt((mx - hx) ** 2 + (my - hy) ** 2) < 12) {
          this.onDragStart?.();
          this.dragMode = 'rotate';
          this.dragBone = this.state.selectedBone;
          this.dragStartAngle = Math.atan2(-(my - by), mx - bx);
          this.dragStartBoneRot = bone.localRotation;
          e.preventDefault(); return;
        }
        if (Math.sqrt((mx - bx) ** 2 + (my - by) ** 2) < 14) {
          this.onDragStart?.();
          this.dragMode = 'translate';
          this.dragBone = this.state.selectedBone;
          this.dragStartMouse = { x: mx, y: my };
          this.dragStartBonePos = { x: bone.localX, y: bone.localY };
          e.preventDefault(); return;
        }
      }
    });

    this.canvas.addEventListener('click', (e) => {
      if (this.dragMode !== 'none') return;
      this.onBoneClick?.(this.hitTestBone(e.clientX, e.clientY));
    });

    this.canvas.addEventListener('mousemove', (e) => {
      if (this.dragMode !== 'none' && this.dragBone && this.skeleton) {
        const bone = this.skeleton.bones.get(this.dragBone);
        if (!bone) return;

        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        const cx = this.lw / 2 + this.state.panX;
        const cy = this.lh / 2 + this.state.panY;
        const z = this.state.zoom;
        const sc = z * 0.1;

        if (this.dragMode === 'rotate') {
          const bx = cx + bone.worldX * sc, by = cy - bone.worldY * sc;
          const angle = Math.atan2(-(my - by), mx - bx);
          bone.localRotation = this.dragStartBoneRot + (angle - this.dragStartAngle) * 180 / Math.PI;
          this.onBoneEdited?.(this.dragBone, 'rotation', bone.localRotation);
        } else if (this.dragMode === 'translate') {
          const dxScreen = (mx - this.dragStartMouse.x) / sc;
          const dyScreen = -(my - this.dragStartMouse.y) / sc;
          let parentRad = 0;
          if (bone.parent) {
            const p = this.skeleton!.bones.get(bone.parent);
            if (p) parentRad = p.worldRotation * Math.PI / 180;
          }
          const cos = Math.cos(-parentRad);
          const sin = Math.sin(-parentRad);
          bone.localX = this.dragStartBonePos.x + dxScreen * cos - dyScreen * sin;
          bone.localY = this.dragStartBonePos.y + dxScreen * sin + dyScreen * cos;
          this.onBoneEdited?.(this.dragBone, 'position', { x: bone.localX, y: bone.localY });
        }
        return;
      }
      const hovered = this.hitTestBone(e.clientX, e.clientY);
      if (hovered !== this.state.hoveredBone) this.onBoneHover?.(hovered);
    });

    const endDrag = () => {
      if (this.dragMode !== 'none') {
        this.onDragEnd?.();
      }
      this.dragMode = 'none';
      this.dragBone = null;
    };
    this.canvas.addEventListener('mouseup', endDrag);
    this.canvas.addEventListener('mouseleave', endDrag);
    document.addEventListener('mouseup', endDrag, true);
  }

  resetAnimationOffsets(): void {
    this.animationActive = false;
    this.resetToSetupPose();
  }
}

function interpolateValue(keyframes: { time: number;[key: string]: number }[], t: number, prop: string): number {
  if (keyframes.length === 0) return 0;
  if (keyframes.length === 1) return (keyframes[0] as any)[prop] ?? 0;
  if (t <= keyframes[0].time) return (keyframes[0] as any)[prop] ?? 0;
  if (t >= keyframes[keyframes.length - 1].time) return (keyframes[keyframes.length - 1] as any)[prop] ?? 0;
  for (let i = 0; i < keyframes.length - 1; i++) {
    const a = keyframes[i], b = keyframes[i + 1];
    if (t >= a.time && t <= b.time) {
      const frac = (b.time - a.time) > 0 ? (t - a.time) / (b.time - a.time) : 0;
      return ((a as any)[prop] ?? 0) + (((b as any)[prop] ?? 0) - ((a as any)[prop] ?? 0)) * frac;
    }
  }
  return 0;
}
