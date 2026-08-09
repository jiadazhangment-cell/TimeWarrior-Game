// 开销对比:分别驱动 HEAD 版与工作树版的绘制路径,统计"上屏对象数"与"逐帧动态对象"
import { readFileSync } from 'node:fs'
const R = 'C:/Users/surpr/Desktop/TimeWarrior-Game/'
const L = JSON.parse(readFileSync(R + 'config/level_slice.json', 'utf8'))
const which = process.argv[2] // 'head' | 'work'

function pngSize(p) { const b = readFileSync(p); return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) } }
function jpgSize(p) {
  const b = readFileSync(p); let i = 2
  while (i < b.length) {
    if (b[i] !== 0xff) { i++; continue }
    const m = b[i + 1]
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) }
    i += 2 + b.readUInt16BE(i + 2)
  }
  throw new Error('no SOF')
}
const IMG = {}
for (const [k, f] of Object.entries({ bg_corridor: 'bg_corridor.jpg', bg_duct: 'bg_duct.jpg', bg_power: 'bg_power.jpg', bg_hive_admin: 'bg_hive_admin.jpg', bg_hive_lab: 'bg_hive_lab.jpg', bg_hive_sec: 'bg_hive_sec.jpg', bg_hive_server: 'bg_hive_server.jpg' })) IMG[k] = jpgSize(R + 'public/assets/img/' + f)
for (const k of ['dev_wall_col', 'dev_hivewall', 'dev_slab', 'dev_shaftwall', 'dev_shaft_rim', 'prop_platform', 'dev_stair_tread', 'dev_stair_beam', 'dev_stair_post', 'dev_stair_anchor', 'px_glow', 'px_bubble', 'px_scanline', ...new Set((L.decor || []).map((d) => d.img))]) {
  try { IMG[k] = pngSize(R + 'public/assets/img/' + k + '.png') } catch (e) { IMG[k] = { width: 64, height: 64 } }
}

const { ArenaScene } = await import(which === 'head' ? './arena-head.mjs' : './arena-harness.mjs')
const cnt = {}
const bump = (k) => { cnt[k] = (cnt[k] || 0) + 1 }
const dts = []
function chain(kind, args) {
  const t = { __kind: kind, __args: args, x: args[0] ?? 0, y: args[1] ?? 0, tilePositionX: 0, tilePositionY: 0, alpha: 1 }
  const self = new Proxy(t, {
    get(o, p) { if (p in o) return o[p]; if (typeof p === 'symbol') return undefined; return () => self },
    set(o, p, v) { o[p] = v; return true },
  })
  bump(kind); return self
}
class DT {
  constructor(k, w, h) { this.key = k; this.width = w; this.height = h; this.cmds = []; dts.push(this) }
  repeat(...a) { this.cmds.push(a); return this }
  render() { return this }
  getSourceImage() { return { width: this.width, height: this.height } }
}
const sc = new ArenaScene()
const dyn = new Map()
sc.textures = {
  exists: (k) => k in IMG || dyn.has(k),
  get: (k) => dyn.get(k) ?? { getSourceImage: () => IMG[k] },
  addDynamicTexture: (k, w, h) => { const d = new DT(k, w, h); dyn.set(k, d); IMG[k] = { width: w, height: h }; return d },
  remove: (k) => { dyn.delete(k); delete IMG[k] },
}
sc.add = {}
for (const k of ['graphics', 'image', 'tileSprite', 'rectangle', 'ellipse', 'triangle', 'particles', 'container', 'text', 'sprite']) sc.add[k] = (...a) => chain(k, a)
sc.tweens = { add: () => { bump('tween'); return {} } }
sc.time = { delayedCall: () => { bump('timer'); return {} } }
sc.cameras = { main: { width: 960, height: 540 } }
sc.game = { renderer: { type: 2 } }
sc.solids = JSON.parse(JSON.stringify(L.platforms))
for (const st of L.stairs ?? []) for (let k = 1; k <= st.steps; k++) {
  const sx = st.dir > 0 ? st.x + st.stepW * (k - 1) : st.x - st.stepW * k
  sc.solids.push({ x: sx, y: st.y - st.stepH * k, w: st.stepW, h: 8, stair: true })
}
const bgTex = IMG.bg_corridor, bgScale = 470 / 655, bgOffY = -16, bgW = bgTex.width * bgScale
sc.bgMeta = { scale: bgScale, offY: bgOffY, w: bgW, hDisp: bgTex.height * bgScale }
const REGION_X0 = 4600
const origWarn = console.warn; console.warn = () => {}

// 背景片
if (which === 'head') {
  for (let bx = 0; bx < REGION_X0; bx += bgW) {
    const img = sc.add.image(bx, bgOffY, 'bg_corridor'); void img
    sc._decorateBackdrop(bx, bgScale, bgOffY, REGION_X0)
  }
} else {
  const coolAt = (wx) => Math.min(1, Math.max(0, (wx - 2340) / 220))
  let i = 0
  for (let bx = 0; bx < REGION_X0; bx += bgW, i++) {
    const aL = coolAt(bx), aR = coolAt(bx + bgW)
    sc.add.image(bx, bgOffY, 'bg_corridor')
    if (!(aL >= 1 && aR >= 1) && aR > 0) sc.add.image(bx, bgOffY, 'bg_corridor')
    sc._decorateBackdrop(bx, bgScale, bgOffY, REGION_X0, i % 2 === 1)
  }
}
sc._drawRegions(L)
sc._drawUnderdeck()
sc._drawPowerDetail()
sc._drawHiveBackdrop(L)
for (const st of L.stairs ?? []) sc._buildStairs(st)
// decor
const decorRun = new Map()
for (const d of L.decor ?? []) {
  const src = sc.textures.get(d.img).getSourceImage()
  const skew = (d.w / src.width) / (d.h / src.height)
  if (which === 'work' && Math.abs(skew - 1) > 0.15) sc.add.tileSprite(d.x, d.y, d.w, d.h, d.img)
  else sc.add.image(d.x, d.y, d.img)
  if (d.shadow !== false) sc.add.ellipse(d.x, d.y - 2, d.w * 0.7, 6, 0x04060a, 0.32)
}
// solids 绘制分支
const pg = sc.add.graphics()
for (const p of sc.solids) {
  if (which === 'work') {
    if (p.prop === 'prop_platform' && (p.dispH ?? p.h) > 26.4) { sc._drawTruss({ x: p.x, y: p.y, w: p.w, h: 22 }, 5.02); sc._drawRiserBody(p) }
    else if (p.prop) sc.add.image(0, 0, p.prop)
    else if (p.oneWay) sc._drawTruss(p)
    else if (p.wall) { sc.add.tileSprite(0, 0, 1, 1, 'dev_hivewall'); sc.add.graphics() }
    else if (p.hivewall) sc.add.tileSprite(0, 0, 1, 1, 'dev_hivewall')
    else if (p.slab) sc.add.tileSprite(0, 0, 1, 1, 'dev_slab')
    else if (p.partition) sc.add.tileSprite(0, 0, 1, 1, 'dev_wall_col')
  } else {
    if (p.prop) sc.add.image(0, 0, p.prop)
    else if (p.oneWay) sc.add.tileSprite(0, 0, 1, 1, 'prop_platform')
    else if (p.hivewall) sc.add.tileSprite(0, 0, 1, 1, 'dev_hivewall')
    else if (p.slab) sc.add.tileSprite(0, 0, 1, 1, 'dev_slab')
    else if (p.partition) sc.add.image(0, 0, 'dev_wall_col')
  }
}
console.warn = origWarn
const total = Object.entries(cnt).filter(([k]) => k !== 'tween' && k !== 'timer').reduce((a, [, v]) => a + v, 0)
console.log(which.toUpperCase(), JSON.stringify(cnt), 'DISPLAY_OBJECTS=' + total, 'DT=' + dts.length)
