// 驱动 ArenaScene 的全部绘制方法,统计对象/draw call 并抓运行期错误
import { readFileSync } from 'node:fs'
const R = 'C:/Users/surpr/Desktop/TimeWarrior-Game/'
const L = JSON.parse(readFileSync(R + 'config/level_slice.json', 'utf8'))

const { ArenaScene } = await import('./arena-harness.mjs')

const IMG_SIZES = {}
function pngSize(p) { const b = readFileSync(p); return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) } }
// jpg 尺寸(SOF 段扫描)
function jpgSize(p) {
  const b = readFileSync(p)
  let i = 2
  while (i < b.length) {
    if (b[i] !== 0xff) { i++; continue }
    const m = b[i + 1]
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) }
    }
    i += 2 + b.readUInt16BE(i + 2)
  }
  throw new Error('no SOF ' + p)
}
for (const [k, f] of Object.entries({
  bg_corridor: 'bg_corridor.jpg', bg_duct: 'bg_duct.jpg', bg_power: 'bg_power.jpg',
  bg_hive_admin: 'bg_hive_admin.jpg', bg_hive_lab: 'bg_hive_lab.jpg',
  bg_hive_sec: 'bg_hive_sec.jpg', bg_hive_server: 'bg_hive_server.jpg',
})) IMG_SIZES[k] = jpgSize(R + 'public/assets/img/' + f)
for (const k of ['dev_wall_col', 'dev_hivewall', 'dev_slab', 'dev_shaftwall', 'dev_shaft_rim',
  'prop_platform', 'dev_stair_tread', 'dev_stair_beam', 'dev_stair_post', 'dev_stair_anchor',
  'px_glow', 'px_bubble', 'px_scanline',
  ...new Set((L.decor || []).map((d) => d.img))]) {
  try { IMG_SIZES[k] = pngSize(R + 'public/assets/img/' + k + '.png') } catch (e) { IMG_SIZES[k] = { width: 64, height: 64 } }
}

const stats = { objects: {}, dtCalls: [], warns: [] }
const bump = (k) => { stats.objects[k] = (stats.objects[k] || 0) + 1 }

function chain(kind, args) {
  const o = { __kind: kind, __args: args, x: args[0] ?? 0, y: args[1] ?? 0, alpha: 1, tilePositionX: 0, tilePositionY: 0 }
  const self = new Proxy(o, {
    get(t, p) {
      if (p in t) return t[p]
      if (typeof p === 'symbol') return undefined
      // 只允许真实存在的 Phaser 方法名,拼错立刻炸
      const OK = new Set(['setOrigin', 'setScale', 'setDepth', 'setTint', 'setTint2', 'setTintMode', 'setAlpha',
        'setBlendMode', 'setTileScale', 'setTilePosition', 'setCrop', 'setDisplaySize', 'setScrollFactor',
        'setFlipX', 'setFlip', 'setRotation', 'setAngle', 'setPosition', 'setVisible', 'setSize', 'setText',
        'fillStyle', 'fillRect', 'fillCircle', 'fillGradientStyle', 'lineStyle', 'strokeRect', 'lineBetween',
        'beginPath', 'moveTo', 'lineTo', 'closePath', 'fillPath', 'strokePath', 'strokeCircle', 'add', 'play', 'once',
        'setStrokeStyle', 'setInteractive', 'destroy', 'clear'])
      if (!OK.has(p)) throw new Error(`未知方法 ${kind}.${String(p)}()`)
      return (...a) => {
        if (p === 'setCrop') t.__crop = a
        if (p === 'setAlpha') t.alpha = a[0]
        return self
      }
    },
    set(t, p, v) { t[p] = v; return true },
  })
  bump(kind)
  return self
}

class DT {
  constructor(key, w, h) { this.key = key; this.width = w; this.height = h; this.cmds = [] }
  repeat(...a) { this.cmds.push(['repeat', ...a]); return this }
  stamp(...a) { this.cmds.push(['stamp', ...a]); return this }
  render() { stats.dtCalls.push({ key: this.key, w: this.width, h: this.height, n: this.cmds.length }); return this }
  getSourceImage() { return { width: this.width, height: this.height } }
}

const sc = new ArenaScene()
const textures = new Map()
sc.textures = {
  exists: (k) => k in IMG_SIZES || textures.has(k),
  get: (k) => {
    if (textures.has(k)) return textures.get(k)
    if (!(k in IMG_SIZES)) throw new Error('缺纹理 ' + k)
    return { getSourceImage: () => IMG_SIZES[k] }
  },
  addDynamicTexture: (k, w, h) => { const d = new DT(k, w, h); textures.set(k, d); IMG_SIZES[k] = { width: w, height: h }; return d },
  remove: (k) => { textures.delete(k); delete IMG_SIZES[k] },
}
sc.add = {
  graphics: (...a) => chain('graphics', a),
  image: (...a) => chain('image', a),
  tileSprite: (...a) => chain('tileSprite', a),
  rectangle: (...a) => chain('rectangle', a),
  ellipse: (...a) => chain('ellipse', a),
  triangle: (...a) => chain('triangle', a),
  particles: (...a) => chain('particles', a),
  container: (...a) => chain('container', a),
  text: (...a) => chain('text', a),
  sprite: (...a) => chain('sprite', a),
}
sc.tweens = { add: () => { bump('tween'); return {} } }
sc.time = { delayedCall: () => { bump('timer'); return {} } }
sc.cameras = { main: { width: 960, height: 540, setBounds() {}, startFollow() {} } }
sc.game = { renderer: { type: 2 } }
sc.solids = JSON.parse(JSON.stringify(L.platforms))
for (const st of L.stairs ?? []) {
  for (let k = 1; k <= st.steps; k++) {
    const sx = st.dir > 0 ? st.x + st.stepW * (k - 1) : st.x - st.stepW * k
    sc.solids.push({ x: sx, y: st.y - st.stepH * k, w: st.stepW, h: 8, stair: true })
  }
}
const bgTex = IMG_SIZES.bg_corridor
const bgScale = 470 / 655, bgOffY = -16, bgW = bgTex.width * bgScale
sc.bgMeta = { scale: bgScale, offY: bgOffY, w: bgW, hDisp: bgTex.height * bgScale, roomTintFrom: 2450, roomTintTo: 4600 }

const origWarn = console.warn
console.warn = (...a) => stats.warns.push(a.join(' '))

// 背景片(照 create 的循环)
const ROOM_X = 2450, ROOM_R = 110, COOL = 0x7e8dad, NEUTRAL = 0x9096a0
const coolAt = (wx) => Math.min(1, Math.max(0, (wx - (ROOM_X - ROOM_R)) / (ROOM_R * 2)))
let bgTile = 0
const REGION_X0 = 4600
const tileLog = []
for (let bx = 0; bx < REGION_X0; bx += bgW, bgTile++) {
  const flip = bgTile % 2 === 1
  const aL = coolAt(bx), aR = coolAt(bx + bgW)
  tileLog.push({ i: bgTile, bx: +bx.toFixed(2), flip, aL: +aL.toFixed(3), aR: +aR.toFixed(3), cropped: bx + bgW > REGION_X0 })
  sc._decorateBackdrop(bx, bgScale, bgOffY, REGION_X0, flip)
}
sc._drawRegions(L)
sc._drawUnderdeck()
sc._drawPowerDetail()
sc._drawHiveBackdrop(L)
for (const st of L.stairs ?? []) sc._buildStairs(st)

// decor 循环
const decorRun = new Map()
let decorTiled = 0
for (const d of L.decor ?? []) {
  const src = sc.textures.get(d.img).getSourceImage()
  const kxD = d.w / src.width, kyD = d.h / src.height, skew = kxD / kyD
  if (Math.abs(skew - 1) > 0.15) decorTiled++
}
// 平台循环里的桁架/墙
let trussN = 0
for (const p of sc.solids) {
  if (p.prop === 'prop_platform' && (p.dispH ?? p.h) > 44 * 0.6) { sc._drawTruss({ x: p.x, y: p.y, w: p.w, h: 22 }, 5.02); sc._drawRiserBody(p); trussN++ }
  else if (p.oneWay) { sc._drawTruss(p); trussN++ }
}

console.warn = origWarn
console.log('=== 背景片 ===')
console.table(tileLog)
console.log('=== DynamicTexture 烘焙 ===', JSON.stringify(stats.dtCalls, null, 1))
console.log('=== 对象计数 ===', JSON.stringify(stats.objects, null, 1))
console.log('=== decor 走平铺路径的条数 ===', decorTiled, ' / 总', (L.decor || []).length)
console.log('=== 桁架件数 ===', trussN)
console.log('=== DEV 断言告警 ===')
for (const w of stats.warns) console.log('  ', w)
console.log('ALL DRAW PATHS EXECUTED OK')
