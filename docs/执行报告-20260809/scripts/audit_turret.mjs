// 炮塔扇区落点复核(主控裁决② / exec-map-report §6.2:Turret.js dir=-1 俯角符号反了)
// 复用 audit-map.mjs 的 solids 约定(门按关闭态最保守),对 level 的 turrets + lockdown.turrets 全体,
// 分别按【旧】homeRel = dir>0?pitch:-pitch 与【新】homeRel = pitch 复算扇区,打印落点与覆盖差异。
import fs from 'fs'
const R = 'C:/Users/surpr/Desktop/TimeWarrior-Game/'
const L = JSON.parse(fs.readFileSync(R + 'config/level_slice.json', 'utf8'))
const P = JSON.parse(fs.readFileSync(R + 'config/player.json', 'utf8'))
const DEG = Math.PI / 180
const PW = P.capsule.w, PH = P.capsule.h, PC = P.crouch.h

const solids = L.platforms.map((p) => ({ ...p }))
for (const st of L.stairs ?? []) for (let k = 1; k <= st.steps; k++) {
  const sx = st.dir > 0 ? st.x + st.stepW * (k - 1) : st.x - st.stepW * k
  solids.push({ x: sx, y: st.y - st.stepH * k, w: st.stepW, h: 8, stair: true })
}
for (const d of L.doors ?? []) {
  solids.push({ x: d.x, y: d.y, w: d.w, h: d.h, door: d.id })
  if (!d.hatch) solids.push({ x: d.x + d.w / 2 - 32, y: d.y - 21, w: 64, h: 24, housing: d.id })
}
for (const b of L.breakables ?? []) solids.push({ x: b.x, y: b.y, w: b.w, h: b.h, breakable: b.id })

const segVsRect = (x1, y1, x2, y2, r) => {
  if (!(r.w > 0) || !(r.h > 0)) return null
  const dx = x2 - x1, dy = y2 - y1
  let tmin = 0, tmax = 1
  for (const [p, d, lo, hi] of [[x1, dx, r.x, r.x + r.w], [y1, dy, r.y, r.y + r.h]]) {
    if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) return null; continue }
    let t1 = (lo - p) / d, t2 = (hi - p) / d
    if (t1 > t2) [t1, t2] = [t2, t1]
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2)
    if (tmin > tmax) return null
  }
  return tmin
}

const MOUNT = 80 * DEG, CONE = 9 * DEG
function sector(T, mode) {
  const dir = T.dir ?? 1
  const pitch = (T.pitchDeg ?? 0) * DEG, sweep = (T.sweepDeg ?? 40) * DEG
  const homeRel = mode === 'old' ? (dir > 0 ? pitch : -pitch) : pitch
  return {
    dir, homeRel,
    relLo: Math.max(homeRel - sweep, -MOUNT),
    relHi: Math.min(homeRel + sweep, MOUNT),
    pivotX: T.x + dir * 35 * 0.83,
    pivotY: T.y + (0.54 - 0.5) * 46,
    range: T.range ?? 640,
  }
}
const aimW = (s, rel) => (s.dir > 0 ? rel : Math.PI - rel)

// 扇区(含锥半角)全部射线的落点包络
function envelope(s) {
  const pts = []
  for (let rel = s.relLo - CONE; rel <= s.relHi + CONE + 1e-9; rel += 0.25 * DEG) {
    const a = aimW(s, rel)
    const dx = Math.cos(a), dy = Math.sin(a)
    const x1 = s.pivotX + dx * 40, y1 = s.pivotY + dy * 40
    const x2 = s.pivotX + dx * s.range, y2 = s.pivotY + dy * s.range
    let end = 1, hit = null
    for (const o of solids) { const t = segVsRect(x1, y1, x2, y2, o); if (t !== null && t < end) { end = t; hit = o } }
    pts.push({ rel, ex: x1 + (x2 - x1) * end, ey: y1 + (y2 - y1) * end, hit })
  }
  return pts
}
// 站位是否被扇区罩到(与 Turret.update 的 touching 判据同口径:锥内射线段 vs 玩家胶囊)
function covers(s, px, py, crouch = false) {
  const h = crouch ? PC : PH
  const cap = { x: px - PW / 2, y: py - h, w: PW, h }
  for (let rel = s.relLo - CONE; rel <= s.relHi + CONE + 1e-9; rel += 0.25 * DEG) {
    const a = aimW(s, rel)
    const dx = Math.cos(a), dy = Math.sin(a)
    const x1 = s.pivotX + dx * 40, y1 = s.pivotY + dy * 40
    const x2 = s.pivotX + dx * s.range, y2 = s.pivotY + dy * s.range
    let end = 1
    for (const o of solids) { const t = segVsRect(x1, y1, x2, y2, o); if (t !== null && t < end) end = t }
    if (segVsRect(x1, y1, x1 + (x2 - x1) * end, y1 + (y2 - y1) * end, cap) !== null) return true
  }
  return false
}
// 追瞄可达域:锁定后 rel 被 Clamp 进 [relLo, relHi],所以"能不能打到"要看 clamp 后的枪口能否命中胶囊
function canShoot(s, px, py, crouch = false) {
  const h = crouch ? PC : PH
  const cap = { x: px - PW / 2, y: py - h, w: PW, h }
  const wantW = Math.atan2((py - 44) - s.pivotY, px - s.pivotX)
  let wantRel = s.dir > 0 ? wantW : Math.PI - wantW
  while (wantRel > Math.PI) wantRel -= 2 * Math.PI
  while (wantRel < -Math.PI) wantRel += 2 * Math.PI
  const rel = Math.min(Math.max(wantRel, s.relLo), s.relHi)
  const a = aimW(s, rel)
  const dx = Math.cos(a), dy = Math.sin(a)
  const x1 = s.pivotX + dx * 40, y1 = s.pivotY + dy * 40
  const x2 = s.pivotX + dx * s.range, y2 = s.pivotY + dy * s.range
  let end = 1
  for (const o of solids) { const t = segVsRect(x1, y1, x2, y2, o); if (t !== null && t < end) end = t }
  return segVsRect(x1, y1, x1 + (x2 - x1) * end, y1 + (y2 - y1) * end, cap) !== null
}

const ALL = [
  ...(L.turrets ?? []).map((t) => ({ ...t, _src: 'level.turrets(常驻)' })),
  ...((L.lockdown?.turrets) ?? []).map((t) => ({ ...t, _src: 'lockdown.turrets(蜂巢)' })),
]
// 各炮塔要复核的"必经点/守卫面"(x, 行走面 y)
const PROBES = {
  '5500,586': [[5520, 664], [5580, 664], [5640, 664], [5700, 664], [5745, 664], [5530, 470], [5620, 470], [5720, 470]],
  '2612,230': [[2560, 470], [2600, 470], [2660, 470], [2734, 470], [2800, 470], [2900, 470]],
  '4413,640': [[4100, 760], [4160, 760], [4200, 760], [4260, 760], [4270, 760], [4300, 760], [4360, 760], [4420, 760],
    [4100, 1050], [4150, 1050], [4200, 1050], [4240, 1050], [4265, 1050], [4300, 1050], [4380, 1050]],
  '2647,930': [[2700, 1050], [2760, 1050], [2850, 1050], [2950, 1050], [3050, 1050]],
  '2647,1180': [[2700, 1340], [2760, 1340], [2850, 1340], [2950, 1340], [3050, 1340]],
  '2647,1490': [[2700, 1630], [2760, 1630], [2850, 1630], [2950, 1630], [3050, 1630]],
}

for (const T of ALL) {
  const key = `${T.x},${T.y}`
  console.log(`\n===== 炮塔 ${key} dir=${T.dir} pitch=${T.pitchDeg ?? 0}° sweep=${T.sweepDeg ?? 40}° range=${T.range ?? 640}  [${T._src}] =====`)
  const out = {}
  for (const mode of ['old', 'new']) {
    const s = sector(T, mode)
    const env = envelope(s)
    const exs = env.map((p) => p.ex), eys = env.map((p) => p.ey)
    out[mode] = { s, env }
    console.log(`  [${mode}] homeRel=${(s.homeRel / DEG).toFixed(1)}°  扫掠界 rel=[${(s.relLo / DEG).toFixed(1)}°, ${(s.relHi / DEG).toFixed(1)}°]` +
      `  世界角=[${(aimW(s, s.relLo) / DEG).toFixed(1)}°, ${(aimW(s, s.relHi) / DEG).toFixed(1)}°]`)
    console.log(`         落点包络 x ${Math.min(...exs).toFixed(0)}..${Math.max(...exs).toFixed(0)} , y ${Math.min(...eys).toFixed(0)}..${Math.max(...eys).toFixed(0)}`)
    const probes = PROBES[key] ?? []
    const cov = probes.map(([px, py]) => `${px}@${py}:${covers(s, px, py) ? (canShoot(s, px, py) ? '锁定+可击' : '锁定(限位打不着)') : '安全'}`)
    if (cov.length) console.log('         ' + cov.join('  '))
  }
  const same = Math.abs(out.old.s.homeRel - out.new.s.homeRel) < 1e-9
  console.log(`  → 符号修复对本台${same ? '【无影响】(dir=+1,homeRel 两式同值)' : '【有影响】'}`)
}

// ===== 附:4413 那台修完符号后的 sweepDeg 取值扫描 =====
// 目标:B1 走道(y760)覆盖尽量保住,同时不透过井道缺口(B1 板止于 4270、蜂巢东墙 4415)打到 B2(y1050)
console.log('\n===== 4413,640 修完符号后 sweepDeg 取值扫描(新公式 homeRel=pitch=25°)=====')
const T4413 = (L.lockdown?.turrets ?? []).find((t) => t.x === 4413)
const B1 = [4100, 4160, 4200, 4260, 4300, 4360]
const B2 = [4100, 4150, 4200, 4225, 4240, 4265]
for (let sw = 20; sw <= 40; sw += 2) {
  const s = sector({ ...T4413, sweepDeg: sw }, 'new')
  const b1 = B1.filter((px) => covers(s, px, 760) && canShoot(s, px, 760))
  const b2 = B2.filter((px) => covers(s, px, 1050) && canShoot(s, px, 1050))
  console.log(`  sweep=${String(sw).padStart(2)}° rel=[${(s.relLo / DEG).toFixed(0)},${(s.relHi / DEG).toFixed(0)}]°  B1可击 x=[${b1.join(',') || '无'}]  B2(跨层)可击 x=[${b2.join(',') || '无'}]`)
}
