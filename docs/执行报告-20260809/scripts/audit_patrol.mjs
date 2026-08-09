// 出生位/巡逻带审计(level-devices SKILL K 节铁律④ + bug-confirmed #1 fix_note ⑤)
// 判据:①patrolMinX/MaxX 不得落在任何非 oneWay / 非 minor 的 solid 内(含贴边)
//       ②敌人自然停位所在的连通自由段净宽 ≥ 胶囊宽;巡逻带与自由段的交集应 ≥80px,否则该改站桩哨兵
//       ③出生胶囊不得与任何非 oneWay solid 重叠
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const ROOT = 'C:/Users/surpr/Desktop/TimeWarrior-Game/'
const L = require(ROOT + 'config/level_slice.json')
const ECFG = require(ROOT + 'config/enemies.json')

function buildSolids() {
  const solids = L.platforms.map((p) => ({ ...p }))
  for (const st of L.stairs ?? []) {
    for (let k = 1; k <= st.steps; k++) {
      const sx = st.dir > 0 ? st.x + st.stepW * (k - 1) : st.x - st.stepW * k
      solids.push({ x: sx, y: st.y - st.stepH * k, w: st.stepW, h: 8, stair: true, id: `stair@${st.x}` })
    }
  }
  for (const d of L.doors ?? []) {
    if (!d.open) solids.push({ x: d.x, y: d.y, w: d.w, h: d.h, id: `door:${d.id}` })
    if (!d.hatch) {
      const cx = d.x + d.w / 2, hw = 64, hh = 24
      solids.push({ x: cx - hw / 2, y: d.y - 9 - hh / 2, w: hw, h: hh, id: `housing:${d.id}` })
    }
  }
  for (const b of L.breakables ?? []) solids.push({ x: b.x, y: b.y, w: b.w, h: b.h, id: `breakable:${b.id}` })
  const TEX_W = 331, TEX_H = 276, ROOF_ROW = 10, CEIL_ROW = 48, MIN_CLEAR = 96
  for (const e of L.elevators ?? []) {
    const scaleX = (e.w + 30) / TEX_W
    const deckRow = TEX_H * 0.87
    const scaleY = Math.max(scaleX, MIN_CLEAR / (deckRow - CEIL_ROW))
    const roofTopOff = (deckRow - ROOF_ROW) * scaleY, ceilOff = (deckRow - CEIL_ROW) * scaleY
    const y0 = e.floors[e.start]
    solids.push({ x: e.x, y: y0, w: e.w, h: 16, oneWay: true, elevator: e.id, id: `lift:${e.id}:floor` })
    solids.push({ x: e.x, y: y0 - roofTopOff, w: e.w, h: roofTopOff - ceilOff, liftRoof: true, id: `lift:${e.id}:roof` })
  }
  return solids
}
const name = (s) => s.id ?? s.prop ?? (s.ground ? 'ground' : s.slab ? 'slab' : s.partition ? 'partition' : s.hivewall ? 'hivewall' : s.ceiling ? 'ceiling' : 'plat')
const solids = buildSolids()
const blockers = solids.filter((s) => !s.oneWay && !s.minor)

// 敌人自然站立面:从 spec.y 起做一次自由落体求落点(与 Enemy Y 段同判据的简化版)
function settleY(x, y0, h, w) {
  let best = null
  for (const s of solids) {
    if (s.minor) continue
    if (!(x + w / 2 > s.x && x - w / 2 < s.x + s.w)) continue
    if (s.y + 1 < y0 - h) continue      // 顶在头顶之上,接不住
    if (s.y < y0 - 1) continue          // 面在脚上方
    if (best === null || s.y < best) best = s.y
  }
  return best ?? y0
}
const capAt = (x, y, w, h) => ({ x: x - w / 2, y: y - h, w, h })
const ov = (c, s) => c.x < s.x + s.w && c.x + c.w > s.x && c.y < s.y + s.h && c.y + c.h > s.y

const rows = []
L.enemies.forEach((spec, i) => {
  const cfg = ECFG[spec.type]
  const { w, h } = cfg.capsule
  const y = settleY(spec.x, spec.y, h, w)
  const free = (x) => !blockers.some((s) => ov(capAt(x, y, w, h), s))
  // 自然停位所在的连通自由段(±400px 扫描)
  let lo = spec.x, hi = spec.x
  if (!free(spec.x)) { rows.push({ i, id: spec.type, x: spec.x, y, err: '出生胶囊嵌固', hit: blockers.filter((s) => ov(capAt(spec.x, y, w, h), s)).map(name).join(',') }); return }
  while (lo > spec.x - 600 && free(lo - 1)) lo--
  while (hi < spec.x + 600 && free(hi + 1)) hi++
  const inSolid = (x) => blockers.filter((s) => x >= s.x && x <= s.x + s.w &&
    capAt(x, y, w, h).y < s.y + s.h && capAt(x, y, w, h).y + h > s.y).map(name)
  const minIn = inSolid(spec.patrolMinX), maxIn = inSolid(spec.patrolMaxX)
  const effLo = Math.max(lo, spec.patrolMinX), effHi = Math.min(hi, spec.patrolMaxX)
  rows.push({
    i, id: spec.type, spawn: spec.x, y,
    band: `${spec.patrolMinX}..${spec.patrolMaxX}`,
    free: `${lo}..${hi}(${hi - lo})`,
    eff: `${effLo}..${effHi}(${(effHi - effLo).toFixed(0)})`,
    minInSolid: minIn.join(',') || '-',
    maxInSolid: maxIn.join(',') || '-',
  })
})

console.log('idx type          spawn   y     band            自由段(连通)        有效带         minX嵌?        maxX嵌?')
for (const r of rows) {
  if (r.err) { console.log(`${String(r.i).padEnd(4)}${r.id.padEnd(14)}${String(r.x).padEnd(8)}${String(r.y).padEnd(6)}!! ${r.err} [${r.hit}]`); continue }
  console.log(
    String(r.i).padEnd(4) + r.id.padEnd(14) + String(r.spawn).padEnd(8) + String(r.y).padEnd(6) +
    r.band.padEnd(16) + r.free.padEnd(20) + r.eff.padEnd(15) + r.minInSolid.padEnd(16) + r.maxInSolid)
}
console.log('\n=== 违规汇总 ===')
for (const r of rows) {
  if (r.err) { console.log(`e${r.i}: 出生嵌固 ${r.hit}`); continue }
  const w = ECFG[L.enemies[r.i].type].capsule.w
  const eff = +r.eff.match(/\((\d+)\)/)[1]
  const msgs = []
  if (r.minInSolid !== '-') msgs.push(`patrolMinX 落在实体内/贴边 [${r.minInSolid}]`)
  if (r.maxInSolid !== '-') msgs.push(`patrolMaxX 落在实体内/贴边 [${r.maxInSolid}]`)
  if (eff < w) msgs.push(`有效巡逻净宽 ${eff} < 胶囊 ${w}`)
  else if (eff < 80) msgs.push(`有效巡逻净宽 ${eff} < 80(SKILL K:该改站桩哨兵或让路)`)
  if (msgs.length) console.log(`e${r.i} (${r.band}, 自由段 ${r.free}): ` + msgs.join(' ; '))
}
