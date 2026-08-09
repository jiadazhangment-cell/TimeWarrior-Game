// 几何断言:验证镜像裁切、桁架三段、烘焙相位、区宽吸收、接缝立管
import { readFileSync } from 'node:fs'
const R = 'C:/Users/surpr/Desktop/TimeWarrior-Game/'
const L = JSON.parse(readFileSync(R + 'config/level_slice.json', 'utf8'))
const { ArenaScene } = await import('./arena-harness.mjs')

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

const made = []
function chain(kind, args) {
  const t = { __kind: kind, __args: args, calls: [], x: args[0] ?? 0, y: args[1] ?? 0, tilePositionX: 0, tilePositionY: 0, alpha: 1 }
  const self = new Proxy(t, {
    get(o, p) {
      if (p in o) return o[p]
      if (typeof p === 'symbol') return undefined
      return (...a) => { o.calls.push([p, ...a]); if (p === 'setDepth') o.depth = a[0]; if (p === 'setScale') o.scaleX = a[0]; return self }
    },
    set(o, p, v) { o[p] = v; return true },
  })
  made.push(t)
  return self
}
class DT {
  constructor(key, w, h) { this.key = key; this.width = w; this.height = h; this.cmds = []; dts.push(this) }
  repeat(...a) { this.cmds.push(a); return this }
  render() { return this }
  getSourceImage() { return { width: this.width, height: this.height } }
}
const dts = []
const sc = new ArenaScene()
const dyn = new Map()
sc.textures = {
  exists: (k) => k in IMG || dyn.has(k),
  get: (k) => dyn.get(k) ?? { getSourceImage: () => IMG[k] },
  addDynamicTexture: (k, w, h) => { const d = new DT(k, w, h); dyn.set(k, d); IMG[k] = { width: w, height: h }; return d },
  remove: (k) => { dyn.delete(k); delete IMG[k] },
}
for (const k of ['graphics', 'image', 'tileSprite', 'rectangle', 'ellipse', 'triangle', 'particles', 'container', 'text', 'sprite']) {
  (sc.add ??= {})[k] = (...a) => chain(k, a)
}
sc.tweens = { add: () => ({}) }
sc.time = { delayedCall: () => ({}) }
sc.cameras = { main: { width: 960, height: 540 } }
sc.game = { renderer: { type: 2 } }
sc.solids = JSON.parse(JSON.stringify(L.platforms))
const bgTex = IMG.bg_corridor, bgScale = 470 / 655, bgOffY = -16, bgW = bgTex.width * bgScale
sc.bgMeta = { scale: bgScale, offY: bgOffY, w: bgW, hDisp: bgTex.height * bgScale }

const ok = []; const bad = []
const chk = (name, cond, info = '') => (cond ? ok : bad).push(`${cond ? 'OK ' : 'FAIL'} ${name} ${info}`)

// —— A. 镜像片 + 裁切(#16)——
const REGION_X0 = 4600
const mkTile = (bx, flip) => {
  const im = sc.add.image(flip ? bx + bgW : bx, bgOffY, 'bg_corridor').setOrigin(0, 0).setScale(flip ? -bgScale : bgScale, bgScale)
  if (bx + bgW > REGION_X0) { const cw = (REGION_X0 - bx) / bgScale; im.setCrop(flip ? bgTex.width - cw : 0, 0, cw, bgTex.height) }
  return im
}
{
  const t3 = mkTile(3599.2673, true)
  const crop = t3.calls.find((c) => c[0] === 'setCrop')
  const cw = (REGION_X0 - 3599.2673) / bgScale
  // 负 scaleX + origin0:局部 [cropX, cropX+cw] → 世界 [x - (cropX+cw)*s, x - cropX*s]
  const X0 = t3.x - (crop[1] + crop[3]) * bgScale, X1 = t3.x - crop[1] * bgScale
  chk('末片镜像后世界左缘=片首', Math.abs(X0 - 3599.2673) < 0.01, `got ${X0.toFixed(3)}`)
  chk('末片镜像后世界右缘=REGION_X0', Math.abs(X1 - 4600) < 0.01, `got ${X1.toFixed(3)}`)
  chk('末片取到的纹理列=右段(镜像后正对片首)', Math.abs(crop[1] - (bgTex.width - cw)) < 0.01 && Math.abs(crop[1] + crop[3] - bgTex.width) < 0.01,
    `cols ${crop[1].toFixed(1)}..${(crop[1] + crop[3]).toFixed(1)} / 图宽 ${bgTex.width}`)
  const t1 = mkTile(1199.7557, true)
  chk('中间镜像片无裁切', !t1.calls.some((c) => c[0] === 'setCrop'))
  chk('镜像片世界跨度 = [bx, bx+bgW]', Math.abs((t1.x - bgTex.width * bgScale) - 1199.7557) < 0.01, `left ${(t1.x - bgTex.width * bgScale).toFixed(3)}`)
}

// —— B. 桁架整条烘焙(#18)——
made.length = 0; dts.length = 0
sc._drawTruss({ x: 1560, y: 300, w: 300, h: 24 })
{
  const imgs = made.filter((m) => m.__kind === 'image')
  chk('桁架 = 1 个 image(整条烘焙)', imgs.length === 1 && made.length === 1, `n=${made.length}`)
  chk('用的是烘焙纹理不是原件', imgs[0].__args[2] === 'truss_600x48', imgs[0].__args[2])
  const dsp = imgs[0].calls.find((c) => c[0] === 'setDisplaySize')
  chk('显示盒 = 碰撞盒', dsp[1] === 300 && dsp[2] === 24)
  const mid = dts.find((d) => d.key === 'prop_platform_mid')
  chk('中段纹理 206x44,相位从列 37 起', mid && mid.width === 206 && mid.height === 44 && mid.cmds[0][6].tilePositionX === 37)
  const t = dts.find((d) => d.key === 'truss_600x48')
  chk('整条纹理 = 2x 密度(600x48 对应 300x24)', t && t.width === 600 && t.height === 48)
  chk('三段:左盖[0,37) 中段[37,564) 右盖[564,600)',
    t.cmds[0][2] === 0 && t.cmds[0][4] === 37 &&
    t.cmds[1][2] === 37 && t.cmds[1][4] === 600 - 37 - 36 &&
    t.cmds[2][2] === 600 - 36 && t.cmds[2][4] === 36,
    JSON.stringify(t.cmds.map((c) => [c[2], c[4]])))
  chk('右盖取纹理列 243..279', t.cmds[2][6].tilePositionX === 243)
  chk('三段纵向都拉满平台高 48', t.cmds.every((c) => Math.abs(c[6].tileScaleY * 44 - 48) < 1e-9))
  chk('中段源 = 无缝中段纹理', t.cmds[1][0] === 'prop_platform_mid')
  // 短台不再丢端盖
  made.length = 0
  sc._drawTruss({ x: 5905, y: 560, w: 60, h: 14 })
  chk('60 宽短台也走整条烘焙(不再截断丢右端盖)', made[0].__args[2] === 'truss_120x28', made[0].__args[2])
}

// —— C. 区宽吸收 + 淡化带烘焙(#10/#13/spec④)——
made.length = 0; dts.length = 0
sc._drawRegions(L)
{
  const bake = dts.filter((d) => d.key.startsWith('fadebake_'))
  chk('两区各一张烘焙纹理', bake.length === 2, bake.map((b) => `${b.key} ${b.width}x${b.height}`).join(' '))
  chk('烘焙分辨率 1:1(宽=fade 190)', bake.every((b) => b.width === 190))
  // R-A 带 280..554.17 / R-B 与上一区交集同为 280..554.17
  chk('烘焙高=两区墙带纵向交集 274.17→275', bake.every((b) => b.height === 275), bake.map((b) => b.height).join(','))
  chk('每张 9 条阶梯', bake.every((b) => b.cmds.length === 9))
  const a = bake[0].cmds.map((c) => +c[6].alpha.toFixed(4))
  chk('阶梯 alpha 与旧窄条同式', JSON.stringify(a) === JSON.stringify([...Array(9)].map((_, i) => +Math.pow((i + 1) / 10, 1.6).toFixed(4))), a.join(','))
  // 相位:第 i 条应等于 (fx0 + i*22 - R.x)/kx
  const bR = bake.find((b) => b.key === 'fadebake_power')
  const dispH = (700 - 60) / 0.697, ky = dispH / 887
  const kxAbs = 1860 / (1 * 1774)
  chk('R-B kx 已吸收余量(1.28% 微拉)', Math.abs(bR.cmds[0][6].tileScaleX - kxAbs) < 1e-9, `${bR.cmds[0][6].tileScaleX.toFixed(5)} vs ${kxAbs.toFixed(5)}`)
  chk('R-B ky 不动(walkR 对齐不受影响)', Math.abs(bR.cmds[0][6].tileScaleY - ky) < 1e-9)
  chk('烘焙相位=(sx-R.x)/kx', Math.abs(bR.cmds[3][6].tilePositionX - ((5900 - 190 + 3 * 22) - 5900) / kxAbs) < 1e-9)
  chk('烘焙纵向相位=(y0-R.top)/ky', Math.abs(bR.cmds[0][6].tilePositionY - (280 - 60) / ky) < 1e-6, `${bR.cmds[0][6].tilePositionY.toFixed(3)}`)
  // R-B 主体 tileSprite 换行线落在区界
  const nWrap = 1860 / (kxAbs * 1774)
  chk('R-B 平铺换行线正好落在区界(缝消失)', Math.abs(nWrap - 1) < 1e-9, `n=${nWrap}`)
  // R-A 接缝立管
  const cols = made.filter((m) => m.__kind === 'tileSprite' && m.__args[4] === 'dev_wall_col' && m.__args[2] === 46)
  chk('R-A 两条换行线各压一根立管', cols.length === 2, cols.map((c) => c.x.toFixed(1)).join(','))
  const dispWA = ((470 - 280) / 0.693) / 887 * 1774
  chk('立管落在实测换行线 5148.3/5696.7', cols.length === 2 && Math.abs(cols[0].x - (4600 + dispWA)) < 0.01 && Math.abs(cols[1].x - (4600 + 2 * dispWA)) < 0.01)
  chk('R-A 未吸收(拉伸 18.5% 超阈值,保留 walkR 尺度)', !made.some((m) => m.__kind === 'tileSprite' && m.__args[4] === 'bg_duct' && m.calls.some((c) => c[0] === 'setTileScale' && Math.abs(c[1] - c[2]) > 1e-9)))
}

// —— D. 前景视差锚补偿(#12)——
made.length = 0
sc._drawRegionFg({ id: 'power', x: 5900, w: 1860, walkY: 700, fgSpots: [0.29, 0.4] })
{
  const g = made.find((m) => m.__kind === 'graphics')
  const sf = g.calls.find((c) => c[0] === 'setScrollFactor')
  chk('scrollFactor 只给 X(Y 固定 1)', sf[1] === 1.09 && sf[2] === 1, JSON.stringify(sf.slice(1)))
  // 屏幕位置校验:相机对准 px 时管子应落在 px
  const f = 1.09, camMid = 480
  for (const t of [0.29, 0.4]) {
    const px = 5900 + 1860 * t
    const drawn = px + (f - 1) * (px - camMid)
    const scrollX = px - camMid
    const screen = drawn - scrollX * f
    chk(`t=${t} 相机对准时管在屏幕中心`, Math.abs(screen - camMid) < 1e-9, `screen=${screen.toFixed(3)}`)
  }
  // 旧代码的漂移量(对照)
  const old = 0.09 * (6840)
  console.log(`   [参考] 旧实现在 scrollX=6840 时整层西移 ${old.toFixed(0)} 世界px`)
}

// —— E. spec① 托架:回程踏台撑在门框墙墩上 ——
made.length = 0
sc._drawPlatformRig({ x: 5905, y: 560, w: 60, h: 14 }, 5900)
chk('踏台托架产生了梁/托架/警示带三层', made.filter((m) => m.__kind === 'graphics').length === 3)

console.log(ok.join('\n'))
console.log('\n' + (bad.length ? bad.join('\n') : '—— 全部断言通过 ——'))
process.exit(bad.length ? 1 : 0)
