// E1 独立仿真:Enemy X 段排出(bug-confirmed #0/#1)修复前/后对比
// 忠实复刻 ArenaScene 的 solids 构建 + Enemy.update 的 Y/X 段与巡逻 AI;
// NEW 路径直接 import 仓库里真正在跑的 src/systems/collide.js(不复制一份)。
import { createRequire } from 'node:module'
import fs from 'node:fs'

const require = createRequire(import.meta.url)
const ROOT = 'C:/Users/surpr/Desktop/TimeWarrior-Game/'
// 直接读磁盘上真正在跑的 collide.js 源码求值(项目 package.json 是 commonjs,不能直接 import 该 .js)
const COLLIDE_SRC = fs.readFileSync(ROOT + 'src/systems/collide.js', 'utf8')
const { resolveXSweep } = await import('data:text/javascript;base64,' + Buffer.from(COLLIDE_SRC).toString('base64'))
const L = require(ROOT + 'config/level_slice.json')
const ECFG = require(ROOT + 'config/enemies.json')
const GAME = require(ROOT + 'config/game.json')
const WEAPONS = require(ROOT + 'config/weapons.json')

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)

// —— 可复现的随机源(替代 Phaser.Math.Between)——
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// —— solids:与 ArenaScene.create + Devices + Elevator 同序同内容 ——
function buildSolids() {
  const solids = L.platforms.map((p) => ({ ...p }))
  for (const st of L.stairs ?? []) {
    for (let k = 1; k <= st.steps; k++) {
      const sx = st.dir > 0 ? st.x + st.stepW * (k - 1) : st.x - st.stepW * k
      solids.push({ x: sx, y: st.y - st.stepH * k, w: st.stepW, h: 8, stair: true })
    }
  }
  // Devices:doors(open:true 的门体在构造末尾被 openDoor 立即摘除,门楣机构盒常驻)
  for (const d of L.doors ?? []) {
    if (!d.open) solids.push({ x: d.x, y: d.y, w: d.w, h: d.h, door: d.id })
    if (!d.hatch) {
      const cx = d.x + d.w / 2, hw = 64, hh = 24
      solids.push({ x: cx - hw / 2, y: d.y - 9 - hh / 2, w: hw, h: hh, housing: d.id })
    }
  }
  for (const b of L.breakables ?? []) solids.push({ x: b.x, y: b.y, w: b.w, h: b.h, breakable: b.id })
  // Elevator:厢底(oneWay)+厢顶(liftRoof);几何按 dev_cab 331x276 实测派生
  const TEX_W = 331, TEX_H = 276, ROOF_ROW = 10, CEIL_ROW = 48, MIN_CLEAR = 96
  for (const e of L.elevators ?? []) {
    const dispW = e.w + 30
    const scaleX = dispW / TEX_W
    const deckRow = TEX_H * 0.87
    const scaleY = Math.max(scaleX, MIN_CLEAR / (deckRow - CEIL_ROW))
    const roofTopOff = (deckRow - ROOF_ROW) * scaleY
    const ceilOff = (deckRow - CEIL_ROW) * scaleY
    const y0 = e.floors[e.start]
    solids.push({ x: e.x, y: y0, w: e.w, h: 16, oneWay: true, elevator: e.id })
    solids.push({ x: e.x, y: y0 - roofTopOff, w: e.w, h: roofTopOff - ceilOff, liftRoof: true, elevator: e.id })
  }
  return solids
}

const blocks = (s) => !s.oneWay && !s.minor
const ov = (c, s) => c.x < s.x + s.w && c.x + c.w > s.x && c.y < s.y + s.h && c.y + c.h > s.y

// —— Enemy 仿真体:mode='old' 用 2026-07-28 现网旧代码,'new' 用 collide.js ——
class SimEnemy {
  constructor(spec, mode, rnd) {
    this.spec = spec
    this.cfg = ECFG[spec.type]
    this.mode = mode
    this.rnd = rnd
    this.x = spec.x; this.y = spec.y
    this.vx = 0; this.vy = 0
    this.state = 'patrol'
    this.dir = 1
    this.staggerUntil = 0
    this.pauseUntil = 0; this.pauseLen = 0; this.pendingTurn = 0
    this.nextIdleAt = 0 + this.between(2000, 6000)
    this._knockVx = 0
  }
  between(a, b) { return Math.floor(this.rnd() * (b - a + 1)) + a }
  get capsule() {
    const c = this.cfg.capsule
    return { x: this.x - c.w / 2, y: this.y - c.h, w: c.w, h: c.h }
  }
  _hold(now, range, turnDir) {
    this.pauseLen = this.between(range[0], range[1])
    this.pauseUntil = now + this.pauseLen
    this.pendingTurn = turnDir
    this.nextIdleAt = this.pauseUntil + this.between(this.cfg.patrolIdleEveryMs[0], this.cfg.patrolIdleEveryMs[1])
  }
  takeHit(now, weapon, dirx) {
    this.staggerUntil = now + this.cfg.hitStaggerMs
    if (weapon?.hitKnockback) {
      if (now - (this._knockWinAt ?? -1e9) > 40) { this._knockWinAt = now; this._knockAcc = 0 }
      const add = Math.min(weapon.hitKnockback, weapon.hitKnockback * 1.6 - this._knockAcc)
      if (add > 0) {
        this._knockAcc += add
        this._knockVx = (this._knockVx ?? 0) + Math.sign(dirx) * add
        this.vy -= add * 1.5
      }
    }
  }
  update(dt, now, solids, engaged, playerX) {
    const cfg = this.cfg
    const staggered = now < this.staggerUntil
    // —— Y 段(两版一致)——
    this.vy = Math.min(this.vy + GAME.gravityY * dt, 1100)
    const prevY = this.y
    this.y += this.vy * dt
    for (const s of solids) {
      if (s.minor) continue
      const c = this.capsule
      if (ov(c, s)) {
        if (this.vy > 0 && !(s.oneWay && prevY > s.y + 1) && !(s.liftRoof && prevY > s.y + 12) &&
            !(prevY > s.y + 12)) { this.y = s.y; this.vy = 0 }
      }
    }
    // —— AI ——
    this.state = engaged ? 'combat' : 'patrol'
    let moveDir = 0
    if (this.state === 'patrol') {
      if (now < this.pauseUntil) { /* 驻足 */ } else {
        if (this.pendingTurn) { this.dir = this.pendingTurn; this.pendingTurn = 0 }
        moveDir = this.dir
        const atEnd = (this.dir > 0 && this.x >= this.spec.patrolMaxX) || (this.dir < 0 && this.x <= this.spec.patrolMinX)
        if (atEnd) { this._hold(now, cfg.patrolEndPauseMs, -this.dir); moveDir = 0 }
        else if (now >= this.nextIdleAt) { this._hold(now, cfg.patrolIdleMs, 0); moveDir = 0 }
      }
    } else {
      const dx = playerX - this.x
      const dist = Math.abs(dx)
      if (dist > cfg.preferredDist + 40) moveDir = Math.sign(dx)
      else if (dist < cfg.preferredDist - 60) moveDir = -Math.sign(dx)
      moveDir = clamp(this.x + moveDir * 10, this.spec.patrolMinX, this.spec.patrolMaxX) === this.x ? 0 : moveDir
    }
    if (staggered) moveDir = 0
    this.vx = moveDir * (this.state === 'combat' ? cfg.chaseSpeed : cfg.patrolSpeed)

    // —— X 段 ——
    const preX = this.x
    if (this.mode === 'old') {
      if (this._knockVx) {
        this.x += this._knockVx * dt
        this._knockVx *= Math.exp(-dt * 7)
        if (Math.abs(this._knockVx) < 4) this._knockVx = 0
      }
      this.x += this.vx * dt
      for (const s of solids) {
        if (s.oneWay || s.minor) continue
        const c = this.capsule
        if (ov(c, s)) {
          if (this.vx > 0) this.x = s.x - c.w / 2
          else if (this.vx < 0) this.x = s.x + s.w + c.w / 2
          this.vx = 0
          if (this.state === 'patrol' && now >= this.pauseUntil) this._hold(now, cfg.patrolEndPauseMs, -this.dir)
        }
      }
      this.x = clamp(this.x, this.spec.patrolMinX, this.spec.patrolMaxX)
    } else {
      if (this._knockVx) {
        this.x += this._knockVx * dt
        this._knockVx *= Math.exp(-dt * 7)
        if (Math.abs(this._knockVx) < 4) this._knockVx = 0
      }
      this.x += this.vx * dt
      this.x = clamp(this.x, this.spec.patrolMinX, this.spec.patrolMaxX)
      resolveXSweep(this, solids, preX, {
        capW: cfg.capsule.w,
        onBlocked: () => {
          if (this.state === 'patrol' && now >= this.pauseUntil) this._hold(now, cfg.patrolEndPauseMs, -this.dir)
        },
      })
    }
    return preX
  }
}

// —— 单次试验 ——
// 返回:{ stuckFrac, xMin, xMax, tunnels, embedded }
function trial({ enemyIdx, mode, seed, hz, knockWeapon, knockDir, hitAtS, totalS, engageS = 0 }) {
  const solids = buildSolids()
  const spec = L.enemies[enemyIdx]
  const rnd = mulberry32(seed)
  const e = new SimEnemy(spec, mode, rnd)
  const dt = 1 / hz
  let now = 0
  const frames = Math.round(totalS * hz)
  const hitFrame = Math.round(hitAtS * hz)
  const tailFrom = Math.round((totalS - 60) * hz)
  let overlapTail = 0, tailFrames = 0
  let xMin = Infinity, xMax = -Infinity
  let tunnels = 0
  const blockers = solids.filter(blocks)
  for (let f = 0; f < frames; f++) {
    now += dt * 1000
    if (f === hitFrame && knockWeapon) e.takeHit(now, WEAPONS[knockWeapon], knockDir)
    const engaged = engageS > 0 && f >= hitFrame && f < hitFrame + engageS * hz
    const before = e.x
    e.update(dt, now, solids, engaged, e.x + 400 * knockDir * -1)
    // 穿越检测:一帧内体心从实体一侧跨到另一侧(且该实体在敌人身高段挡路)
    const after = e.x
    const c = e.capsule
    for (const s of blockers) {
      if (!(c.y < s.y + s.h && c.y + c.h > s.y)) continue
      const mid = s.x + s.w / 2
      if ((before - mid) * (after - mid) < 0 && Math.abs(after - before) > s.w / 2) tunnels++
    }
    if (f >= tailFrom) {
      tailFrames++
      if (blockers.some((s) => ov(c, s))) overlapTail++
      xMin = Math.min(xMin, e.x); xMax = Math.max(xMax, e.x)
    }
  }
  const cEnd = e.capsule
  const embedded = blockers.filter((s) => ov(cEnd, s)).map((s) => s.breakable ?? s.prop ?? s.door ?? s.housing ?? 'plat')
  return { stuckFrac: overlapTail / tailFrames, xMin, xMax, tunnels, embedded, endX: e.x, endY: e.y }
}

// 每台敌人的"健康巡逻带"= 不挨打时尾段 60s 的活动范围(多种子取并集)
const bandCache = new Map()
function baselineBand(enemyIdx) {
  if (bandCache.has(enemyIdx)) return bandCache.get(enemyIdx)
  let lo = Infinity, hi = -Infinity, y = null
  for (const seed of [11, 22, 33]) {
    const r = trial({ enemyIdx, mode: 'new', seed, hz: 165, knockWeapon: null, knockDir: 1, hitAtS: 1e9, totalS: 120 })
    lo = Math.min(lo, r.xMin); hi = Math.max(hi, r.xMax); y = r.endY
  }
  const band = { lo, hi, y }
  bandCache.set(enemyIdx, band)
  return band
}
// 困死判据(比"重叠帧占比"稳健)。注意:被击退**越过矮道具后在另一侧照常巡逻**不算困死
// (那是合理物理,活动范围照样几百像素),只有下面三种才算:
//   ① 终态胶囊嵌在实体里;② 跑满 180s 后仍站在非基线楼面上(被顶上矮道具顶下不来);
//   ③ 尾段 60s 活动范围塌缩(<24px,而健康带 >60px)= 原地抽动
function isStuck(r, band) {
  if (r.embedded.length) return true
  if (Math.abs(r.endY - band.y) > 2) return true
  const span = r.xMax - r.xMin, bandSpan = band.hi - band.lo
  return bandSpan > 60 && span < 24
}

// —— 主程 ——
const args = process.argv.slice(2)
const only = args[0] ?? 'all'

if (only === 'fixdata') {
  // 把清单里提议的巡逻带改动就地套上,再跑一遍全罗盘扫描(只跑新代码)
  const OVERRIDE = {
    0: { patrolMaxX: 1022 },
    6: { patrolMinX: 1580, patrolMaxX: 2052 },
    8: { patrolMinX: 3056, patrolMaxX: 3077 },
    10: { patrolMinX: 4158 },
    14: { patrolMinX: 3576 },
    15: { patrolMaxX: 4082 },
    20: { patrolMaxX: 3487 },
    21: { patrolMinX: 4167, patrolMaxX: 4262 },
  }
  for (const [k, v] of Object.entries(OVERRIDE)) Object.assign(L.enemies[+k], v)
  console.log('=== 套上提议的巡逻带改动后:全 22 台 × 3 武器 × 2 方向(新代码)===')
  let tun = 0, stk = 0, cases = 0
  const bad = []
  for (let idx = 0; idx < L.enemies.length; idx++) {
    const band = baselineBand(idx)
    for (const w of ['rifle', 'shotgun', 'supercannon']) {
      for (const kd of [-1, 1]) {
        cases++
        const r = trial({ enemyIdx: idx, mode: 'new', seed: 100 + idx * 17 + (kd + 1), hz: 165, knockWeapon: w, knockDir: kd, hitAtS: 5, totalS: 125 })
        if (r.tunnels > 0) { tun++; bad.push(`穿越 e${idx} ${w} kd${kd}`) }
        if (isStuck(r, band)) { stk++; bad.push(`困死 e${idx} ${w} kd${kd} x=${r.xMin.toFixed(0)}..${r.xMax.toFixed(0)} y=${r.endY} emb=[${r.embedded.join(',')}] 基线带=${band.lo.toFixed(0)}..${band.hi.toFixed(0)}@y${band.y}`) }
      }
    }
  }
  console.log(`用例 ${cases};单帧穿越 ${tun};困死 ${stk}`)
  console.log(bad.join('\n') || '  (无)')
  process.exit(0)
}

if (only === 'dbg') {
  // 单次试验逐帧诊断:node sim_enemy.mjs dbg <mode> <seed> <weapon> <kd> <hitAtS> <engageS>
  const [, mode = 'old', seed = '9001', wp = 'supercannon', kd = '-1', hitAtS = '13.07', engageS = '15'] = args
  const solids = buildSolids()
  const spec = L.enemies[6]
  const e = new SimEnemy(spec, mode, mulberry32(+seed))
  const hz = 165, dt = 1 / hz
  let now = 0
  const blockers = solids.filter(blocks)
  const frames = Math.round(180 * hz)
  const hitFrame = Math.round(+hitAtS * hz)
  const samples = []
  for (let f = 0; f < frames; f++) {
    now += dt * 1000
    if (f === hitFrame) e.takeHit(now, WEAPONS[wp], +kd)
    const engaged = f >= hitFrame && f < hitFrame + (+engageS) * hz
    e.update(dt, now, solids, engaged, e.x + 400 * (+kd) * -1)
    if (f % Math.round(hz * 5) === 0 || (f >= hitFrame && f < hitFrame + 6)) {
      const c = e.capsule
      const hit = blockers.filter((s) => ov(c, s)).map((s) => s.prop ?? s.breakable ?? 'plat')
      samples.push(`t=${(f / hz).toFixed(2)}s x=${e.x.toFixed(1)} y=${e.y.toFixed(1)} dir=${e.dir} st=${e.state} emb=[${hit}]`)
    }
  }
  console.log(samples.slice(-24).join('\n'))
  process.exit(0)
}

function suiteStuck(mode, forceWest = false, engageS = 0) {
  // 40 次独立试验:随机种子 + 随机武器 + 随机击退方向 + 随机命中时刻(165Hz)
  const rows = []
  let stuck = 0, tunnelTrials = 0
  for (let i = 0; i < 40; i++) {
    const rnd = mulberry32(9000 + i)
    const weapons = ['rifle', 'shotgun', 'supercannon']
    const w = weapons[Math.floor(rnd() * weapons.length)]
    const kd = forceWest ? -1 : (rnd() < 0.5 ? -1 : 1)
    const hitAtS = 8 + rnd() * 12
    const r = trial({ enemyIdx: 6, mode, seed: 9000 + i, hz: 165, knockWeapon: w, knockDir: kd, hitAtS, totalS: 180, engageS })
    const st = isStuck(r, baselineBand(6))
    if (st) stuck++
    if (r.tunnels > 0) tunnelTrials++
    rows.push({ i, w, kd, hit: +hitAtS.toFixed(2), stuck: st, x: `${r.xMin.toFixed(0)}..${r.xMax.toFixed(0)}`, y: r.endY, tun: r.tunnels, emb: r.embedded.join(',') })
  }
  return { stuck, tunnelTrials, rows }
}

if (only === 'all' || only === 'stuck') {
  for (const mode of ['old', 'new']) {
    const { stuck, tunnelTrials, rows } = suiteStuck(mode)
    console.log(`\n=== [${mode.toUpperCase()}] enemies[6] 击退困死试验 40 次 @165Hz ===`)
    console.log(`困死(尾 60s 重叠帧占比>50%) = ${stuck}/40 ;发生过单帧穿越的试验 = ${tunnelTrials}/40`)
    if (mode === 'old') console.log(rows.filter((r) => r.stuck).slice(0, 6).map((r) => JSON.stringify(r)).join('\n'))
    else console.log(rows.slice(0, 6).map((r) => JSON.stringify(r)).join('\n'))
  }
}

if (only === 'all' || only === 'west') {
  // 复刻交接存档 verdict 的协议:掩体侧(西)挨一发 + 随后 15s 交战(玩家在东)
  for (const mode of ['old', 'new']) {
    const { stuck, tunnelTrials, rows } = suiteStuck(mode, true, 15)
    console.log(`\n=== [${mode.toUpperCase()}] enemies[6] 西向击退+15s交战 40 次 @165Hz ===`)
    console.log(`困死 = ${stuck}/40 ;发生过单帧穿越的试验 = ${tunnelTrials}/40`)
    console.log(rows.slice(0, 5).map((r) => JSON.stringify(r)).join('\n'))
  }
}

if (only === 'all' || only === 'baseline') {
  console.log('\n=== 基线:纯巡逻 60s(不挨打),两版都应干净 ===')
  for (const mode of ['old', 'new']) {
    const r = trial({ enemyIdx: 6, mode, seed: 7, hz: 165, knockWeapon: null, knockDir: 1, hitAtS: 1e9, totalS: 60 })
    console.log(mode, JSON.stringify({ stuckFrac: +r.stuckFrac.toFixed(3), x: `${r.xMin.toFixed(0)}..${r.xMax.toFixed(0)}`, tunnels: r.tunnels, endX: +r.endX.toFixed(1) }))
  }
}

if (only === 'all' || only === 'roster') {
  console.log('\n=== 全 22 台敌人 × 4 种击退 × 两个方向(60s)——穿越/嵌固扫描 ===')
  for (const mode of ['old', 'new']) {
    let tun = 0, stk = 0, cases = 0
    const bad = []
    for (let idx = 0; idx < L.enemies.length; idx++) {
      const band = baselineBand(idx)
      for (const w of ['rifle', 'shotgun', 'supercannon']) {
        for (const kd of [-1, 1]) {
          cases++
          const r = trial({ enemyIdx: idx, mode, seed: 100 + idx * 17 + (kd + 1), hz: 165, knockWeapon: w, knockDir: kd, hitAtS: 5, totalS: 125 })
          if (r.tunnels > 0) { tun++; bad.push(`穿越 e${idx} ${w} kd${kd} n=${r.tunnels}`) }
          if (isStuck(r, band)) { stk++; bad.push(`困死 e${idx} ${w} kd${kd} x=${r.xMin.toFixed(0)}..${r.xMax.toFixed(0)} y=${r.endY} emb=[${r.embedded.join(',')}] 基线带=${band.lo.toFixed(0)}..${band.hi.toFixed(0)}@y${band.y}`) }
        }
      }
    }
    console.log(`[${mode}] 用例 ${cases};发生单帧穿越 ${tun};困死 ${stk}`)
    console.log(bad.slice(0, 24).join('\n') || '  (无)')
  }
}
