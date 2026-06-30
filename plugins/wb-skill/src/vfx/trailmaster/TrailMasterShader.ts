// @source wb-character/src/vfx/trailmaster/TrailMasterShader.ts
/**
 * TrailMasterShader — 
 *
 *  UE MM_Trail_01 ：
 *   emissive  = pow(EmissiveTex.R, EmissivePower) × EmissiveStrength
 *   color     = lerp(ColorA, ColorB, emissive) × ParticleColor
 *   opacity   = CavityTex.R × emissive × ParticleAlpha   (+ swipe )
 *
 * ：
 *   GLOW_FRAG     — （  Gaussian）
 *   TRAIL_FRAG    — （  UE ）
 *   CORE_FRAG     — （  bloom）
 *   BLOOD_FRAG    — （RGB  + drip）
 *   LIGHTNING_FRAG — （T_Thunder  + ）
 */

import * as THREE from 'three'

// ──  Vertex Shader ────────────────────────────────────────────────

export const TRAIL_VERT = /* glsl */`
attribute float aAlpha;
attribute float aWidthNorm;

varying vec2  vUv;
varying float vAlpha;
varying float vWidthNorm;

void main() {
  vUv        = uv;
  vAlpha     = aAlpha;
  vWidthNorm = aWidthNorm;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

// ── Layer 0: （GLOW）────────────────────────────────────────────

export const GLOW_FRAG = /* glsl */`
precision highp float;

uniform vec3  uColorA;
uniform vec3  uColorB;
uniform float uParticleAlpha;
uniform float uSwipeProgress;

varying vec2  vUv;
varying float vAlpha;
varying float vWidthNorm;

void main() {
  float swipe = smoothstep(uSwipeProgress - 0.12, uSwipeProgress + 0.12, vUv.x);
  if (swipe < 0.005) discard;

  float edge  = smoothstep(0.0, 0.38, vUv.y) * smoothstep(1.0, 0.62, vUv.y);
  edge = pow(edge, 0.45);

  vec3 color  = mix(uColorA * 0.55, uColorB * 0.45, vUv.x);
  float opacity = edge * vAlpha * swipe * uParticleAlpha * 0.45;
  if (opacity < 0.004) discard;
  gl_FragColor = vec4(color, opacity);
}
`

// ── Layer 1: （TRAIL）—  MM_Trail_01 ─────────────────────
//
// （ ）：
//   Noise UV  = TexCoord × NoiseTile + Time × NoiseSpeed
//   nOff      = (NoiseTex.RG * 2 - 1) × NoiseStrength
//   EmissiveUV = TexCoord × EmissiveTile + Time × EmissiveSpeed + nOff × EmissiveNoiseStr
//   emissive  = pow(EmissiveTex.R, EmissivePower) × EmissiveStrength
//   color     = lerp(ColorA, ColorB, emissive) × ParticleColor
//   CavityUV  = TexCoord + nOff × OpacityNoiseStr  (opacity texture)
//   opacity   = CavityTex.R × emissive × ParticleAlpha

export const TRAIL_FRAG = /* glsl */`
precision highp float;

uniform sampler2D uNoiseTex;
uniform sampler2D uEmissiveTex;
uniform sampler2D uCavityTex;

uniform float uNoiseTileU, uNoiseTileV;
uniform float uNoiseSpeedU, uNoiseSpeedV;
uniform float uNoiseStrength;

uniform float uEmissiveTileU, uEmissiveTileV;
uniform float uEmissiveSpeedU, uEmissiveSpeedV;
uniform float uEmissiveStrength, uEmissivePower;
uniform float uEmissiveNoiseStr;

uniform float uCavityStrength, uCavityMouths;  // OpacityStrength, OpacityPower
uniform float uOpacityNoiseStr;                // OpacityNoiseStrength
uniform float uOpacityStrength, uOpacityPower;

uniform vec3  uColorA, uColorB;
uniform vec3  uParticleColor;
uniform float uParticleAlpha;
uniform float uSwipeProgress;
uniform float uTime;

varying vec2  vUv;
varying float vAlpha;
varying float vWidthNorm;

void main() {
  float swipe = smoothstep(uSwipeProgress - 0.08, uSwipeProgress + 0.08, vUv.x);
  if (swipe < 0.005) discard;

  // ── Noise UV distortion (MM_Trail_01 ) ───────────────
  vec2 nUV  = vec2(vUv.x * uNoiseTileU, vUv.y * uNoiseTileV)
            + uTime * vec2(uNoiseSpeedU, uNoiseSpeedV);
  vec2 nRG  = texture2D(uNoiseTex, nUV).rg;
  vec2 nOff = (nRG * 2.0 - 1.0) * uNoiseStrength * 0.08;

  // ── Emissive texture（ ）────────────────────────────
  vec2 eUV   = vec2(vUv.x * uEmissiveTileU, vUv.y * uEmissiveTileV)
             + uTime * vec2(uEmissiveSpeedU, uEmissiveSpeedV)
             + nOff * uEmissiveNoiseStr;
  float eRaw = texture2D(uEmissiveTex, eUV).r;
  float emis  = pow(max(eRaw, 0.0001), uEmissivePower) * uEmissiveStrength;
  emis = max(emis, vUv.x * 0.15);  // 

  // ── ：lerp(ColorA, ColorB, emissive) —  MM_Trail_01 ──
  vec3 color = mix(uColorA, uColorB, clamp(emis, 0.0, 1.0));
  color *= uParticleColor;

  // ── Cavity（Opacity Texture， ）──────────────────────────
  vec2 cUV   = vUv + nOff * uOpacityNoiseStr;
  float cav  = texture2D(uCavityTex, cUV).r;
  cav = pow(max(cav, 0.0001), max(uCavityMouths, 0.1)) * uCavityStrength;

  // （  tile ）
  float edgeFade = smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.88, vUv.y);

  // ── Opacity = CavityTex × emissive（MM_Trail_01 ）──
  float opacity = cav * emis * edgeFade * vAlpha * swipe * uParticleAlpha;

  if (opacity < 0.004) discard;
  gl_FragColor = vec4(color, clamp(opacity, 0.0, 1.0));
}
`

// ── Layer 2: （CORE）─────────────────────────────────────────

export const CORE_FRAG = /* glsl */`
precision highp float;

uniform vec3  uColorB;
uniform float uParticleAlpha;
uniform float uSwipeProgress;
uniform float uTime;
uniform float uNoiseSpeedU;

varying vec2  vUv;
varying float vAlpha;
varying float vWidthNorm;

void main() {
  float swipe = smoothstep(uSwipeProgress - 0.06, uSwipeProgress + 0.06, vUv.x);
  if (swipe < 0.005) discard;

  float core    = exp(-28.0 * pow(vUv.y - 0.50, 2.0));
  float flicker = 0.72 + 0.28 * sin(vUv.x * 20.0 + uTime * 14.0);
  vec3 color    = uColorB * 1.8 + vec3(0.35);
  float opacity = core * vAlpha * swipe * uParticleAlpha * flicker * 0.88;
  if (opacity < 0.004) discard;
  gl_FragColor = vec4(color, clamp(opacity, 0.0, 1.0));
}
`

// ── Layer BLOOD: （RGB ， ）────────────────────────────
//  MI_Blood_001 ：NoiseSpeedV=0.5, OpacityStrength=2.0,
//  OpacityPower=0.5, EmissiveStrength=0.5, ColorA/B=white
//  NoiseTex=T_Normal_Noise_001, EmissiveTex=CavityTex=T_Blood_0001

export const BLOOD_FRAG = /* glsl */`
precision highp float;

uniform sampler2D uNoiseTex;
uniform sampler2D uEmissiveTex;
uniform sampler2D uCavityTex;

uniform float uNoiseTileU, uNoiseTileV;
uniform float uNoiseSpeedU, uNoiseSpeedV;
uniform float uNoiseStrength;

uniform float uEmissiveTileU, uEmissiveTileV;
uniform float uEmissiveSpeedU, uEmissiveSpeedV;
uniform float uEmissiveStrength, uEmissivePower;
uniform float uEmissiveNoiseStr;

uniform float uCavityStrength, uCavityMouths;
uniform float uOpacityNoiseStr;
uniform float uOpacityStrength, uOpacityPower;

uniform vec3  uColorA, uColorB;
uniform vec3  uParticleColor;
uniform float uParticleAlpha;
uniform float uSwipeProgress;
uniform float uTime;

varying vec2  vUv;
varying float vAlpha;
varying float vWidthNorm;

void main() {
  float swipe = smoothstep(uSwipeProgress - 0.10, uSwipeProgress + 0.10, vUv.x);
  if (swipe < 0.005) discard;

  // T_Normal_Noise_001 UV（speedV=0.5 → ）
  vec2 nUV  = vec2(vUv.x * uNoiseTileU, vUv.y * uNoiseTileV)
            + uTime * vec2(uNoiseSpeedU, uNoiseSpeedV);
  vec2 nRG  = texture2D(uNoiseTex, nUV).rg;
  vec2 nOff = (nRG * 2.0 - 1.0) * uNoiseStrength * 0.06;

  // T_Blood_0001  RGB（ ， ）
  vec2 eUV     = vec2(vUv.x * uEmissiveTileU, vUv.y * uEmissiveTileV)
               + uTime * vec2(uEmissiveSpeedU, uEmissiveSpeedV)
               + nOff * uEmissiveNoiseStr;
  vec3 bloodRGB = texture2D(uEmissiveTex, eUV).rgb;
  bloodRGB      = pow(max(bloodRGB, vec3(0.0001)), vec3(uEmissivePower)) * uEmissiveStrength;

  // ColorA/B=white → pass-through（ × = ）
  vec3 color = bloodRGB * mix(uColorA, uColorB, bloodRGB.r) * uParticleColor;

  // Opacity：T_Blood_0001.R × OpacityStrength
  vec2 oUV    = vUv + nOff * uOpacityNoiseStr;
  float opTex = texture2D(uCavityTex, oUV).r;
  opTex = pow(max(opTex, 0.0001), max(uCavityMouths, 0.1)) * uCavityStrength;
  opTex = clamp(opTex, 0.0, 1.0);

  float opacity = opTex * vAlpha * swipe * uParticleAlpha;
  if (opacity < 0.005) discard;
  gl_FragColor = vec4(color, clamp(opacity, 0.0, 1.0));
}
`

// ── Layer LIGHTNING: （T_Thunder  + ←→ ）───────────
//
// MI_Trail_004 ：
//   EmissiveTex=T_Noise_008( ) → →
//   OpacityTex=T_Thunder_001          →
//   ColorA= (FF7300), ColorB= (00FFFF)
//   EmissiveTileU/V=0.3( )  NoiseTileU/V=0.1( )
//   EmissiveStrength=2.0  EmissivePower=0.5  NoiseSpeedV=0.4

export const LIGHTNING_FRAG = /* glsl */`
precision highp float;

uniform sampler2D uNoiseTex;     // T_Normal_Noise_001
uniform sampler2D uEmissiveTex;  // T_Noise_008（ ）
uniform sampler2D uCavityTex;    // T_Thunder_001（ ）

uniform float uNoiseTileU, uNoiseTileV;
uniform float uNoiseSpeedU, uNoiseSpeedV;
uniform float uNoiseStrength;

uniform float uEmissiveTileU, uEmissiveTileV;
uniform float uEmissiveSpeedU, uEmissiveSpeedV;
uniform float uEmissiveStrength, uEmissivePower;
uniform float uEmissiveNoiseStr;

uniform float uCavityStrength, uCavityMouths;
uniform float uOpacityNoiseStr;
uniform float uOpacityStrength, uOpacityPower;

uniform vec3  uColorA, uColorB;    // orange, cyan
uniform vec3  uParticleColor;
uniform float uParticleAlpha;
uniform float uSwipeProgress;
uniform float uTime;

varying vec2  vUv;
varying float vAlpha;
varying float vWidthNorm;

void main() {
  float swipe = smoothstep(uSwipeProgress - 0.08, uSwipeProgress + 0.08, vUv.x);
  if (swipe < 0.005) discard;

  // ── （Tile=0.1 ，SpeedV=0.4 ）────────────
  vec2 nUV  = vec2(vUv.x * uNoiseTileU, vUv.y * uNoiseTileV)
            + uTime * vec2(uNoiseSpeedU, uNoiseSpeedV);
  vec2 nRG  = texture2D(uNoiseTex, nUV).rg;
  vec2 nOff = (nRG * 2.0 - 1.0) * uNoiseStrength * 0.12;

  // ── Emissive（T_Noise_008，Tile=0.3 ， → ）────────
  vec2 eUV  = vec2(vUv.x * uEmissiveTileU, vUv.y * uEmissiveTileV)
            + uTime * vec2(uEmissiveSpeedU, uEmissiveSpeedV)
            + nOff * uEmissiveNoiseStr;
  float eRaw = texture2D(uEmissiveTex, eUV).r;
  float emis  = pow(max(eRaw, 0.0001), uEmissivePower) * uEmissiveStrength;

  // ── ：orange(ColorA) → cyan(ColorB) ──────────────────────────
  vec3 color = mix(uColorA, uColorB, clamp(emis, 0.0, 1.0));
  color *= uParticleColor;

  // ── T_Thunder_001 （UV.x= , UV.y= ）──────────
  // 4  → ribbon 4 
  vec2 cUV   = vUv + nOff * uOpacityNoiseStr;
  float bolt = texture2D(uCavityTex, cUV).r;
  bolt = pow(max(bolt, 0.0001), max(uCavityMouths, 0.1)) * uCavityStrength;

  // ── （  sin ）────────────────────────────
  float pulse = 0.55 + 0.45 * abs(sin(uTime * 18.0 + vUv.x * 12.0));
  // " " 
  float slow  = 0.70 + 0.30 * sin(uTime * 3.5);

  float opacity = bolt * emis * pulse * slow * vAlpha * swipe * uParticleAlpha;
  if (opacity < 0.004) discard;
  gl_FragColor = vec4(color * (0.8 + 0.4 * pulse), clamp(opacity, 0.0, 1.0));
}
`

// ── Layer THUNDER_BOLT: （ ）──────────────
//    T_Thunder_001 ， " "

export const THUNDER_BOLT_FRAG = /* glsl */`
precision highp float;

uniform sampler2D uCavityTex;    // T_Thunder_001
uniform vec3  uColorA;           // orange
uniform vec3  uColorB;           // cyan
uniform float uParticleAlpha;
uniform float uSwipeProgress;
uniform float uTime;

varying vec2  vUv;
varying float vAlpha;
varying float vWidthNorm;

void main() {
  float swipe = smoothstep(uSwipeProgress - 0.06, uSwipeProgress + 0.06, vUv.x);
  if (swipe < 0.005) discard;

  // （ ）
  float col     = floor(uTime * 1.2 + vUv.x * 2.0);  // 
  float colU    = fract(col * 0.25);                  // 0, 0.25, 0.5, 0.75
  vec2 boltUV   = vec2(colU + 0.125, vUv.y);          // 
  float bolt    = texture2D(uCavityTex, boltUV).r;

  // ： / 
  float flicker = step(0.35, abs(sin(uTime * 22.0 + vUv.x * 8.0)));
  float pulse   = 0.4 + 0.6 * abs(sin(uTime * 8.0));

  vec3 col1  = mix(uColorA, uColorB + 0.3, bolt);
  float opacity = bolt * flicker * pulse * vAlpha * swipe * uParticleAlpha * 0.8;
  if (opacity < 0.01) discard;
  gl_FragColor = vec4(col1 * 1.5, clamp(opacity, 0.0, 1.0));
}
`

// ──  Shader ───────────────────────────────────────────────────────

export const PARTICLE_VERT = /* glsl */`
attribute float size;
varying vec2 vUv;
void main() {
  vUv = vec2(0.5, 0.5);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * (400.0 / max(-mv.z, 0.5));
  gl_PointSize = clamp(gl_PointSize, 2.0, 22.0);
  gl_Position  = projectionMatrix * mv;
}
`

export const PARTICLE_FRAG = /* glsl */`
precision mediump float;
uniform vec3  uParticleColor;
uniform float uAlpha;
uniform float uEmissivePower;
varying vec2 vUv;
void main() {
  vec2  d    = gl_PointCoord - vec2(0.5);
  float dist = length(d) * 2.0;
  float mask = 1.0 - smoothstep(0.5, 1.0, dist);
  mask = pow(mask, max(uEmissivePower, 0.5));
  float alpha = mask * uAlpha;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(uParticleColor * (1.0 + mask * 0.5), alpha);
}
`

// ── Uniforms  ─────────────────────────────────────────────────────

export interface TrailUniforms {
  uNoiseTex:     { value: THREE.Texture | null }
  uEmissiveTex:  { value: THREE.Texture | null }
  uCavityTex:    { value: THREE.Texture | null }

  uNoiseTileU:    { value: number }
  uNoiseTileV:    { value: number }
  uNoiseSpeedU:   { value: number }
  uNoiseSpeedV:   { value: number }
  uNoiseStrength: { value: number }

  uEmissiveTileU:    { value: number }
  uEmissiveTileV:    { value: number }
  uEmissiveSpeedU:   { value: number }
  uEmissiveSpeedV:   { value: number }
  uEmissiveStrength: { value: number }
  uEmissivePower:    { value: number }
  uEmissiveNoiseStr: { value: number }

  uCavityStrength: { value: number }
  uCavityMouths:   { value: number }
  uOpacityNoiseStr:{ value: number }
  uOpacityStrength:{ value: number }
  uOpacityPower:   { value: number }

  uColorA:        { value: THREE.Color }
  uColorB:        { value: THREE.Color }
  uParticleColor: { value: THREE.Color }
  uParticleAlpha: { value: number }
  uSwipeProgress: { value: number }
  uTime:          { value: number }
}

export function makeDefaultTrailUniforms(): TrailUniforms {
  return {
    uNoiseTex:    { value: null },
    uEmissiveTex: { value: null },
    uCavityTex:   { value: null },

    uNoiseTileU:    { value: 1.0 },
    uNoiseTileV:    { value: 1.0 },
    uNoiseSpeedU:   { value: 0.0 },
    uNoiseSpeedV:   { value: 0.0 },
    uNoiseStrength: { value: 1.0 },

    uEmissiveTileU:    { value: 1.0 },
    uEmissiveTileV:    { value: 1.0 },
    uEmissiveSpeedU:   { value: 0.0 },
    uEmissiveSpeedV:   { value: 0.0 },
    uEmissiveStrength: { value: 1.0 },
    uEmissivePower:    { value: 1.0 },
    uEmissiveNoiseStr: { value: 0.0 },

    uCavityStrength:  { value: 1.0 },
    uCavityMouths:    { value: 1.0 },
    uOpacityNoiseStr: { value: 0.1 },
    uOpacityStrength: { value: 1.0 },
    uOpacityPower:    { value: 1.0 },

    uColorA:        { value: new THREE.Color(0xff6600) },
    uColorB:        { value: new THREE.Color(0xffff00) },
    uParticleColor: { value: new THREE.Color(1, 1, 1) },
    uParticleAlpha: { value: 1.0 },
    uSwipeProgress: { value: 1.0 },
    uTime:          { value: 0.0 },
  }
}
