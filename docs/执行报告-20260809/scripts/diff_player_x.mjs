// 回归证明:Player X 段抽进 collide.js 后行为与 2026-07-28 落盘的旧内联实现**逐例等价**。
// 做法:用真实 level solids,随机撒 200000 组玩家状态(位置/速度/姿态/着地/预位),
// 两套实现各跑一次,比对 (x, y, vx) 三元组。
import { createRequire } from 'node:module'
import fs from 'node:fs'
const require = createRequire(import.meta.url)
const ROOT = 'C:/Users/surpr/Desktop/TimeWarrior-Game/'
const L = require(ROOT + 'config/level_slice.json')
const P = require(ROOT + 'config/player.json')
const { resolveXSweep } = await import('data:text/javascript;base64,' +
  Buffer.from(fs.readFileSync(ROOT + 'src/systems/collide.js', 'utf8')).toString('base64'))

const solids = L.platforms.map((p) => ({ ...p }))
for (const st of L.stairs ?? []) for (let k = 1; k <= st.steps; k++) {
  const sx = st.dir > 0 ? st.x + st.stepW * (k - 1) : st.x - st.stepW * k
  solids.push({ x: sx, y: st.y - st.stepH * k, w: st.stepW, h: 8, stair: true })
}
for (const d of L.doors ?? []) {
  if (!d.open) solids.push({ x: d.x, y: d.y, w: d.w, h: d.h, door: d.id })
  if (!d.hatch) solids.push({ x: d.x + d.w / 2 - 32, y: d.y - 21, w: 64, h: 24, housing: d.id })
}
for (const b of L.breakables ?? []) solids.push({ x: b.x, y: b.y, w: b.w, h: b.h, breakable: b.id })

function mkEnt(s) {
  const e = { ...s, cfg: P }
  Object.defineProperty(e, 'capsule', {
    get() {
      const c = P.capsule
      const h = e.crouching ? P.crouch.h : c.h
      return { x: e.x - c.w / 2, y: e.y - h, w: c.w, h }
    },
  })
  return e
}
// —— 2026-07-28 落盘的旧内联实现(逐字搬运,只把 this 换成 e)——
function oldResolve(e, preX) {
  const cap = P.capsule
  const overlap = (s) => { const c = e.capsule; return c.x < s.x + s.w && c.x + c.w > s.x && c.y < s.y + s.h && c.y + c.h > s.y }
  const freeAt = (nx, skip) => {
    const c = e.capsule
    const x0 = nx - cap.w / 2, x1 = nx + cap.w / 2
    return !solids.some((o) => o !== skip && !o.oneWay && !o.minor && !o.pushable &&
      x0 < o.x + o.w && x1 > o.x && c.y < o.y + o.h && c.y + c.h > o.y)
  }
  const supportedAt = (nx) => solids.some((o) => !o.minor && nx > o.x && nx < o.x + o.w &&
    o.y >= e.y - 2 && o.y < e.y + 600)
  for (const s of solids) {
    if (s.oneWay) continue
    if (s.minor) continue
    if (!overlap(s)) continue
    if (e.grounded && e.vy >= 0 && e.y - s.y > 0 && e.y - s.y <= 17) {
      const h = e.crouching ? P.crouch.h : cap.h
      const test = { x: e.x - cap.w / 2, y: s.y - h, w: cap.w, h }
      const blocked = solids.some((o) => o !== s && !o.oneWay && !o.minor &&
        test.x < o.x + o.w && test.x + test.w > o.x && test.y < o.y + o.h && test.y + test.h > o.y)
      if (!blocked) { e.y = s.y; continue }
    }
    if (s.pushable) {
      const penL = e.x + cap.w / 2 - s.x
      const penR = s.x + s.w - (e.x - cap.w / 2)
      e.x = penL < penR ? s.x - cap.w / 2 : s.x + s.w + cap.w / 2
      e.vx = 0
      continue
    }
    const outL = s.x - cap.w / 2, outR = s.x + s.w + cap.w / 2
    const cand = preX <= s.x + s.w / 2 ? [outL, outR] : [outR, outL]
    const nx = cand.find((c) => freeAt(c, s) && supportedAt(c)) ?? cand.find((c) => freeAt(c, s)) ?? preX
    e.x = nx
    e.vx = 0
  }
}
// —— 现役实现(collide.js)——
function newResolve(e, preX) {
  const cap = P.capsule
  resolveXSweep(e, solids, preX, {
    capW: cap.w,
    stepAssist: (s) => {
      if (!(e.grounded && e.vy >= 0 && e.y - s.y > 0 && e.y - s.y <= 17)) return false
      const h = e.crouching ? P.crouch.h : cap.h
      const test = { x: e.x - cap.w / 2, y: s.y - h, w: cap.w, h }
      const blocked = solids.some((o) => o !== s && !o.oneWay && !o.minor &&
        test.x < o.x + o.w && test.x + test.w > o.x && test.y < o.y + o.h && test.y + test.h > o.y)
      if (blocked) return false
      e.y = s.y
      return true
    },
  })
}

function mulberry32(a) {
  return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const rnd = mulberry32(20260809)
// 采样重点落在"实体附近"(纯空气样本没信息量):以每块实体为中心撒点
const N = 200000
let diff = 0, touched = 0, firstDiff = null
for (let i = 0; i < N; i++) {
  const s = solids[Math.floor(rnd() * solids.length)]
  const x = s.x + (rnd() * 1.6 - 0.3) * s.w
  const y = s.y + (rnd() * 2.0 - 1.0) * Math.max(s.h, 60)
  const st = {
    x, y,
    vx: (rnd() * 2 - 1) * 400,
    vy: (rnd() * 2 - 1) * 900,
    grounded: rnd() < 0.5,
    crouching: rnd() < 0.3,
  }
  const preX = x - st.vx * (1 / 60)
  const a = mkEnt(st), b = mkEnt(st)
  oldResolve(a, preX)
  newResolve(b, preX)
  if (a.x !== st.x || a.y !== st.y || a.vx !== st.vx) touched++
  if (a.x !== b.x || a.y !== b.y || a.vx !== b.vx) {
    diff++
    if (!firstDiff) firstDiff = { st, preX, old: { x: a.x, y: a.y, vx: a.vx }, neu: { x: b.x, y: b.y, vx: b.vx } }
  }
}
console.log(`Player X 段 新旧实现差分:样本 ${N},其中真正发生解算 ${touched},不一致 ${diff}`)
if (firstDiff) console.log('首个不一致:', JSON.stringify(firstDiff))
console.log(diff === 0 ? '✅ 逐例等价(重构零行为变化)' : '❌ 有行为变化,必须排查')
