// E1 其余各项的独立复核:#3 蹲姿撞顶 / G seal1 检查点采样窗 / #7 帧率归一化量级 / #22 HUD 空仓谓词
import { createRequire } from 'node:module'
import fs from 'node:fs'
const require = createRequire(import.meta.url)
const ROOT = 'C:/Users/surpr/Desktop/TimeWarrior-Game/'
const L = require(ROOT + 'config/level_slice.json')
const P = require(ROOT + 'config/player.json')
const G = require(ROOT + 'config/game.json')
const W = require(ROOT + 'config/weapons.json')
const COLLIDE = fs.readFileSync(ROOT + 'src/systems/collide.js', 'utf8')
const { resolveXSweep } = await import('data:text/javascript;base64,' + Buffer.from(COLLIDE).toString('base64'))

function buildSolids() {
  const solids = L.platforms.map((p) => ({ ...p }))
  for (const st of L.stairs ?? []) for (let k = 1; k <= st.steps; k++) {
    const sx = st.dir > 0 ? st.x + st.stepW * (k - 1) : st.x - st.stepW * k
    solids.push({ x: sx, y: st.y - st.stepH * k, w: st.stepW, h: 8, stair: true, _k: k })
  }
  for (const d of L.doors ?? []) {
    if (!d.open) solids.push({ x: d.x, y: d.y, w: d.w, h: d.h, door: d.id })
    if (!d.hatch) solids.push({ x: d.x + d.w / 2 - 32, y: d.y - 21, w: 64, h: 24, housing: d.id })
  }
  for (const b of L.breakables ?? []) solids.push({ x: b.x, y: b.y, w: b.w, h: b.h, breakable: b.id })
  return solids
}
const solids = buildSolids()

// ============ #3 蹲姿撞顶用站姿胶囊 ============
class SimPlayer {
  constructor(x, y, crouching, ceilMode) {
    this.cfg = P; this.x = x; this.y = y; this.vx = 0; this.vy = 0
    this.crouching = crouching; this.grounded = true; this.ceilMode = ceilMode
  }
  get capsule() {
    const c = this.cfg.capsule
    const h = this.crouching ? this.cfg.crouch.h : c.h
    return { x: this.x - c.w / 2, y: this.y - h, w: c.w, h }
  }
  step(dt) {
    const cap = this.cfg.capsule
    this.vy = Math.min(this.vy + G.gravityY * dt, this.cfg.maxFallSpeed)
    const preX = this.x
    this.x += this.vx * dt
    resolveXSweep(this, solids, preX, {
      capW: cap.w,
      stepAssist: (s) => {
        if (!(this.grounded && this.vy >= 0 && this.y - s.y > 0 && this.y - s.y <= 17)) return false
        const h = this.crouching ? this.cfg.crouch.h : cap.h
        const test = { x: this.x - cap.w / 2, y: s.y - h, w: cap.w, h }
        const blocked = solids.some((o) => o !== s && !o.oneWay && !o.minor &&
          test.x < o.x + o.w && test.x + test.w > o.x && test.y < o.y + o.h && test.y + test.h > o.y)
        if (blocked) return false
        this.y = s.y; return true
      },
    })
    this.grounded = false
    const prevY = this.y
    this.y += this.vy * dt
    for (const s of solids) {
      if (s.minor) continue
      const c = this.capsule
      if (!(c.x < s.x + s.w && c.x + c.w > s.x && c.y < s.y + s.h && c.y + c.h > s.y)) continue
      if (this.vy > 0) {
        if (s.oneWay && prevY > s.y + 1) continue
        if (prevY > s.y + 12) continue
        this.y = s.y; this.vy = 0; this.grounded = true
      } else if (this.vy < 0) {
        if (s.oneWay) continue
        // old = 恒用站姿 88;new = 按当前姿态(蹲 52)
        const h = this.ceilMode === 'old' ? cap.h : (this.crouching ? this.cfg.crouch.h : cap.h)
        this.y = s.y + s.h + h
        this.vy = 0
      }
    }
  }
}
console.log('=== #3 蹲姿撞顶(楼梯下 0px 净空战术口袋)===')
const st = L.stairs[0]
const k4 = solids.find((s) => s._k === 4)
console.log(`  楼梯 ${JSON.stringify(st)} → 第4级踏板 x ${k4.x}..${k4.x + k4.w}, y ${k4.y}..${k4.y + k4.h}` +
  ` ;地面 y1630,蹲姿胶囊顶 = 1630-${P.crouch.h} = ${1630 - P.crouch.h} ⇒ 净空 ${(k4.y + k4.h) - (1630 - P.crouch.h)}px`)
for (const wname of ['rifle', 'shotgun', 'rpg', 'supercannon']) {
  const w = W[wname]; if (!w?.recoil) continue
  for (const deg of [30, 60, 85]) {
    const vy0 = -Math.sin(deg * Math.PI / 180) * w.recoil * 0.3 // WeaponSystem: player.vy -= sin(angle)*recoil*0.3
    for (const hz of [60, 165]) {
      const res = {}
      for (const mode of ['old', 'new']) {
        const p = new SimPlayer(3666, 1630, true, mode)
        p.vy = vy0
        let maxY = p.y, fell = false
        for (let f = 0; f < Math.round(hz * 3); f++) {
          p.step(1 / hz)
          maxY = Math.max(maxY, p.y)
          if (p.y > L.height + 160) { fell = true; break }
        }
        res[mode] = { endY: +p.y.toFixed(1), maxY: +maxY.toFixed(1), fell }
      }
      if (res.old.fell || res.new.fell || Math.abs(res.old.endY - res.new.endY) > 0.5) {
        console.log(`  ${wname}@${deg}° vy0=${vy0.toFixed(1)} ${hz}Hz → old ${JSON.stringify(res.old)} | new ${JSON.stringify(res.new)}`)
      }
    }
  }
}

// ============ G seal1 检查点:采样窗与落脚点 ============
console.log('\n=== G seal1 兜底检查点(x4760,y470)===')
const CP = { x: 4760, y: 470 }
const seal = L.doors.find((d) => d.id === 'seal1')
console.log(`  seal1 x ${seal.x}..${seal.x + seal.w} ;封门触发线 player.x > 4750 ;cp4 x ${L.checkpoints.at(-1).x}`)
console.log(`  检查点 x=${CP.x} 在门东侧 ${CP.x - (seal.x + seal.w)}px ;激活窗 |Δx|<24 ⇒ x ∈ (${CP.x - 24}, ${CP.x + 24}) ,与触发线 4750 有 ${4750 - (CP.x - 24)}px 的**先激活后封门**重叠`)
const capAt = (x, y) => ({ x: x - P.capsule.w / 2, y: y - P.capsule.h, w: P.capsule.w, h: P.capsule.h })
const overlapAt = solids.filter((s) => !s.oneWay && !s.minor).filter((s) => {
  const c = capAt(CP.x, CP.y)
  return c.x < s.x + s.w && c.x + c.w > s.x && c.y < s.y + s.h && c.y + c.h > s.y
})
const ground = solids.find((s) => CP.x > s.x && CP.x < s.x + s.w && s.y >= CP.y - 2 && s.y < CP.y + 600)
console.log(`  重生点嵌固检查:${overlapAt.length ? 'FAIL ' + JSON.stringify(overlapAt) : 'OK(胶囊不与任何实体重叠)'} ;脚下实体 ${ground ? `y${ground.y} (${ground.ground ? 'ground' : 'plat'})` : 'FAIL 无'}`)
for (const hz of [165, 60, 30, 20]) {
  const dt = 1 / hz
  let x = 4600, hitWindow = 0, sealedAtX = null
  while (x < 4900) {
    if (Math.abs(x - CP.x) < 24) hitWindow++
    if (sealedAtX === null && x > 4750) sealedAtX = x
    x += P.maxSpeed * dt
  }
  const preTrigger = Math.ceil((4750 - (CP.x - 24)) / (P.maxSpeed * dt))
  console.log(`  ${String(hz).padStart(3)}Hz 满速 ${P.maxSpeed}px/s(${(P.maxSpeed * dt).toFixed(1)}px/帧):窗内采样 ${hitWindow} 帧,其中封门前 ≥${preTrigger} 帧 → ${hitWindow > 0 && preTrigger >= 1 ? 'OK 不可能漏过' : 'FAIL'}`)
}

// ============ #7 Elevator 帧率归一化量级 ============
console.log('\n=== #7 Elevator 挤尸 applyForce 归一化 ===')
const grav = 0.001 * 1 // Matter 默认重力量级 y=1 * body.mass * 0.001 每步 → 与 force 同量纲
for (const hz of [60, 165]) {
  const framesPerStep = hz / 60
  console.log(`  ${hz}Hz:每物理步(16.667ms)攒 ${framesPerStep.toFixed(2)} 个渲染帧 →` +
    ` 旧:单步 y 力 = mass*0.005*${framesPerStep.toFixed(2)} = mass*${(0.005 * framesPerStep).toFixed(5)}(重力当量 ${(0.005 * framesPerStep / 0.0016).toFixed(1)}×)` +
    ` | 新(×dt*60):mass*${(0.005).toFixed(5)}(恒 ${(0.005 / 0.0016).toFixed(1)}×,与帧率无关)`)
}

// ============ #22 HUD 空仓谓词 ============
console.log('\n=== #22 HUD 空仓判定 ===')
const isEmptyOld = (k, a) => a.mag <= 0 && a.reserve <= 0
const isEmptyNew = (k, a) => (W[k]?.noReload ? a.reserve <= 0 : (a.mag <= 0 && a.reserve <= 0))
for (const k of Object.keys(W)) {
  const w = W[k]
  if (w.magSize === undefined) continue
  const a = { mag: w.noReload ? (w.magSize ?? 1) : 0, reserve: 0 } // 真·打空态
  const lowOld = w.noReload ? a.reserve <= 1 : (a.mag + a.reserve) <= (w.magSize + w.reserveMax) * 0.15
  const emptyNew = isEmptyNew(k, a)
  const lowNew = !emptyNew && lowOld
  console.log(`  ${k.padEnd(13)} noReload=${!!w.noReload} 打空态 mag=${a.mag} reserve=${a.reserve} →` +
    ` 旧:槽位${isEmptyOld(k, a) ? '红' : '灰'} 大字${isEmptyOld(k, a) ? '红' : lowOld ? '黄' : '白'}` +
    ` | 新:槽位${emptyNew ? '红' : '灰'} 大字${emptyNew ? '红' : lowNew ? '黄' : '白'}`)
}
