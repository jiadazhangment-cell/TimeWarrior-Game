// 离线跑真 BigFan.js:桩掉 phaser/EventBus,用计数 graphics 统计 draw 调用并抓 NaN。
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = fs.readFileSync(path.join(here, 'BigFan.new.js'), 'utf8')
  .replace("import Phaser from 'phaser'", "import Phaser from './stub-phaser.mjs'")
  .replace("import { EventBus } from '../core/EventBus.js'", "import { EventBus } from './stub-phaser.mjs'")
fs.writeFileSync(path.join(here, 'BigFan.run.mjs'), src, 'utf8')
const { BigFan, SteamVent } = await import('./BigFan.run.mjs')

const DRAW = ['fillRect', 'fillCircle', 'fillPath', 'strokeRect', 'strokeCircle', 'lineBetween', 'strokePath', 'slice']
const STATE = ['fillStyle', 'lineStyle', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'clear', 'setDepth', 'fillPoints']
const bad = []
function mkGfx (tag) {
  const g = { _draws: 0, _all: 0, _tag: tag }
  for (const m of DRAW.concat(STATE)) {
    g[m] = (...a) => {
      g._all++
      if (DRAW.includes(m)) g._draws++
      for (const v of a) if (typeof v === 'number' && !Number.isFinite(v)) bad.push(`${tag}.${m}(${a.join(',')})`)
      return g
    }
  }
  return g
}

const gfx = []
let TNOW = 0
const player = {
  alive: true, x: 6870, y: 630, vx: 0, vy: 0, hits: 0,
  get capsule () { return { x: this.x - 15, y: this.y - 88, w: 30, h: 88 } },
  hurt (dmg, fx, hy) { this.hits++; this.lastHit = { dmg, fx, hy } },
}
const scene = {
  add: { graphics: () => { const g = mkGfx('g' + gfx.length); gfx.push(g); return g } },
  time: { get now () { return TNOW } },
  events: { once: () => {} },
  player,
  addTrauma: () => {},
}
const def = JSON.parse(fs.readFileSync('C:/Users/surpr/Desktop/TimeWarrior-Game/config/level_slice.json', 'utf8')).fans[0]
const vdef = JSON.parse(fs.readFileSync('C:/Users/surpr/Desktop/TimeWarrior-Game/config/level_slice.json', 'utf8')).vents[0]

const fan = new BigFan(scene, def)
const vent = new SteamVent(scene, vdef)
const [gMain, gNear, gVent] = gfx

// —— 各档位下的 draw 调用统计:整圈扫一遍取 max/avg(相位不同,近/远侧叶片数在变)——
const rows = []
for (const mode of ['full', 'mid', 'slow', 'stopped']) {
  fan.mode = mode === 'stopped' ? 'stopped' : mode
  fan.speed = mode === 'stopped' ? 0 : def.speeds[mode]
  fan._alignTarget = null
  let mx = 0, sum = 0, n = 0, mxAll = 0
  for (let s = 0; s < 240; s++) {
    fan.angle = (s / 240) * Math.PI * 2
    TNOW = 1000 + s * 16
    gMain._draws = gNear._draws = 0; gMain._all = gNear._all = 0
    fan._draw(TNOW)
    const dd = gMain._draws + gNear._draws
    mx = Math.max(mx, dd); mxAll = Math.max(mxAll, gMain._all + gNear._all); sum += dd; n++
  }
  rows.push({ mode, maxDraw: mx, avgDraw: +(sum / n).toFixed(1), maxAllCalls: mxAll })
}
console.log('=== BigFan graphics 调用统计(整圈 240 相位采样,两层合计)===')
console.table(rows)

// SteamVent:喷发期与预热期
let vmx = 0
for (let s = 0; s < 200; s++) { TNOW = s * 30; gVent._draws = 0; vent.update(); vmx = Math.max(vmx, gVent._draws) }
console.log('SteamVent 单帧最大 draw 调用:', vmx)

console.log('非法坐标(NaN/Infinity)数量:', bad.length, bad.slice(0, 5))

// —— 停位几何复核 ——
fan.mode = 'full'; fan.speed = 3; fan.angle = 5.0
fan._shutdown()
const step = (Math.PI * 2) / 3
console.log('\n=== 停位复核 ===')
console.log('angle=5.0 → alignTarget =', fan._alignTarget.toFixed(4), '= k·120°?', (fan._alignTarget / step).toFixed(4))
let ang = fan._alignTarget
const tips = [0, 1, 2].map((i) => {
  const ph = ang + (i * Math.PI * 2) / 3
  return { i, phiDeg: +((ph % (Math.PI * 2)) * 180 / Math.PI).toFixed(1), sin: +Math.sin(ph).toFixed(3), yTip: +(def.cy - def.r * Math.cos(ph)).toFixed(1) }
})
console.table(tips)
const lowestNear = Math.max(...tips.filter((t) => t.sin > 0).map((t) => t.yTip))
const lowestAny = Math.max(...tips.map((t) => t.yTip))
console.log('最低近侧叶梢 y =', lowestNear, ' / 含远侧 =', lowestAny)
console.log('洞底 y =', def.cy + def.r, ' 通行带净空 =', def.cy + def.r - lowestAny, 'px')
console.log('站立头顶 y =', def.cy + def.r - 88, ' 余量 =', (def.cy + def.r - 88) - lowestAny, 'px  (规格按 92 高算则余量', (def.cy + def.r - 92) - lowestAny, 'px)')

// —— 停机后判定确认:running=false 一律免伤 ——
fan.speed = 0; player.hits = 0; player.x = 6899.5; player.y = 630
fan._applyPlayer(1 / 60)
console.log('停机后站在洞底通行带上受击次数 =', player.hits, '(应为 0)')
