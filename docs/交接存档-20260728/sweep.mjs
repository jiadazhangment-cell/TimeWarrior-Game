// 三档扫掠节奏推演:直接驱动真的 _applyPlayer,逐相位问"这一刻会不会被打",
// 再把角度窗口按 ω 换成秒。姿态两种:站立(胶囊 88)与蹲行(52,config/player.json)。
import fs from 'fs'
const { BigFan } = await import('./BigFan.run.mjs')
const mk = () => { const g = {}; for (const m of ['fillRect', 'fillCircle', 'fillPath', 'strokeRect', 'strokeCircle', 'lineBetween', 'strokePath', 'fillStyle', 'lineStyle', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'clear', 'setDepth']) g[m] = () => g; return g }
let TNOW = 0
const player = {
  alive: true, x: 6899.5, y: 630, vx: 0, vy: 0, hits: 0, h: 88,
  get capsule () { return { x: this.x - 15, y: this.y - this.h, w: 30, h: this.h } },
  hurt () { this.hits++ },
}
const scene = { add: { graphics: mk }, time: { get now () { return TNOW } }, events: { once: () => {} }, player, addTrauma: () => {} }
const L = JSON.parse(fs.readFileSync('C:/Users/surpr/Desktop/TimeWarrior-Game/config/level_slice.json', 'utf8'))
const def = L.fans[0]
const fan = new BigFan(scene, def)

const STEPS = 36000
const scan = (omega, capH, py) => {
  fan.speed = omega; fan.mode = 'run'; player.h = capH; player.y = py
  const hit = new Uint8Array(STEPS)
  for (let s = 0; s < STEPS; s++) {
    fan.angle = (s / STEPS) * Math.PI * 2
    player.x = 6899.5; player.vx = 0; player.vy = 0; player.hits = 0
    fan._applyPlayer(1 / 60)
    hit[s] = player.hits ? 1 : 0
  }
  // 一圈里有 3 片叶子 → 危险段应当出现 3 次,取其中一段的长度
  let danger = 0, segs = [], cur = 0
  for (let s = 0; s < STEPS; s++) { if (hit[s]) { danger++; cur++ } else if (cur) { segs.push(cur); cur = 0 } }
  if (cur) { if (segs.length && hit[0]) segs[0] += cur; else segs.push(cur) }
  const rad = (n) => (n / STEPS) * Math.PI * 2
  const segRad = segs.length ? rad(Math.max(...segs)) : 0
  const gapRad = (Math.PI * 2) / 3 - segRad
  return {
    dutyPct: +((danger / STEPS) * 100).toFixed(1),
    segs: segs.length,
    dangerRad: +segRad.toFixed(3),
    dangerSec: +(segRad / omega).toFixed(2),
    gapSec: +(gapRad / omega).toFixed(2),
    passPerSec: +((3 * omega) / (Math.PI * 2)).toFixed(2),
  }
}

const FLOOR = def.cy + def.r // 洞底通行带地面 630
console.log('=== 近侧扫掠节奏(玩家站在洞底通行带 y=630,x=洞心)===')
const rows = []
for (const [name, w] of [['full 3.0', 3], ['mid 1.7', 1.7], ['slow 0.5', 0.5], ['slow+脉冲峰值 ~0.72', 0.72]]) {
  rows.push({ 档位: name, 姿态: '站立88', ...scan(w, 88, FLOOR) })
  rows.push({ 档位: name, 姿态: '蹲行52', ...scan(w, 52, FLOOR) })
}
console.table(rows)

// 穿越耗时参照:X 门宽 = wallW/2+24 两侧 = 93px;玩家满速 360,吸力削速后按净 260 估
console.log('X 判定门宽 =', def.wallW + 48, 'px;满速 360 穿过需', ((def.wallW + 48) / 360).toFixed(2), 's,被吸力削到 260 时需', ((def.wallW + 48) / 260).toFixed(2), 's')

// 站在大厅地面(700)贴墙根:必须打不到(它在筒子外面)
const outside = scan(3, 88, 700)
console.log('\n站在大厅地面 y=700 贴墙根 → 一圈内被打帧数占比:', outside.dutyPct, '%(应为 0)')
// 跳起来把头伸进洞口(脚 620)→ 该被打
const jumped = scan(3, 88, 620)
console.log('跳进洞口(脚 620)→ 危险占比:', jumped.dutyPct, '%(应 > 0)')
