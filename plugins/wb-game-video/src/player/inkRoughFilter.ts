// 叙事 UI 共用的 inkRough 水墨笔触 SVG 滤镜 —— 对齐原型 新影游平台交互原型.html
// <filter id="inkRoughNarr">。幂等注入一次到 document.body，InkKou/InkYingMo/四维 HUD 共用。
let injected = false

export function ensureInkRoughFilter(): void {
  if (injected || typeof document === 'undefined') return
  if (document.getElementById('narr-ink-rough-defs')) {
    injected = true
    return
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('id', 'narr-ink-rough-defs')
  svg.setAttribute('width', '0')
  svg.setAttribute('height', '0')
  svg.setAttribute('aria-hidden', 'true')
  svg.style.position = 'absolute'
  svg.style.width = '0'
  svg.style.height = '0'
  svg.innerHTML =
    '<filter id="inkRoughNarr" x="-20%" y="-60%" width="140%" height="220%">' +
    '<feTurbulence type="fractalNoise" baseFrequency="0.018 0.5" numOctaves="2" seed="7" result="n"/>' +
    '<feDisplacementMap in="SourceGraphic" in2="n" scale="3" xChannelSelector="R" yChannelSelector="G"/>' +
    '</filter>'
  document.body.appendChild(svg)
  injected = true
}
