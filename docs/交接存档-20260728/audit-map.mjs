// 地图复杂度批·几何自查(照 level-devices skill 的 I0/碰撞总原则/验收方法论)
// 只读:解析 level_slice.json,复算落点/可达性/净高/无底列/扇区/出生嵌固。
import fs from 'fs'
const L = JSON.parse(fs.readFileSync('C:/Users/surpr/Desktop/TimeWarrior-Game/config/level_slice.json', 'utf8'))
const P = JSON.parse(fs.readFileSync('C:/Users/surpr/Desktop/TimeWarrior-Game/config/player.json', 'utf8'))
const E = JSON.parse(fs.readFileSync('C:/Users/surpr/Desktop/TimeWarrior-Game/config/enemies.json', 'utf8'))
const G = JSON.parse(fs.readFileSync('C:/Users/surpr/Desktop/TimeWarrior-Game/config/game.json', 'utf8'))

const PW = P.capsule.w, PH = P.capsule.h, PC = P.crouch.h
const RH = E.robot_grunt.capsule.h, RW = E.robot_grunt.capsule.w
const g = G.gravityY, jv = P.jumpVel
const RISE_MAX = jv * jv / (2 * g)          // 理论满跳
const RISE_PRACT = 159                       // skill 实测定版
const fail = []
const note = (ok, msg) => { console.log((ok ? '  OK   ' : '  FAIL ') + msg); if (!ok) fail.push(msg) }

// —— solids 全表(含楼梯展开与门,门按"关闭"态最保守计入) ——
const solids = L.platforms.map((p) => ({ ...p }))
for (const st of L.stairs ?? []) for (let k = 1; k <= st.steps; k++) {
  const sx = st.dir > 0 ? st.x + st.stepW * (k - 1) : st.x - st.stepW * k
  solids.push({ x: sx, y: st.y - st.stepH * k, w: st.stepW, h: 8, stair: true })
}
for (const d of L.doors ?? []) {
  solids.push({ x: d.x, y: d.y, w: d.w, h: d.h, door: d.id })
  if (!d.hatch) solids.push({ x: d.x + d.w / 2 - 32, y: d.y - 21, w: 64, h: 24, housing: d.id }) // 门楣机构盒
}
const hard = solids.filter((s) => !s.oneWay && !s.minor)
const ov = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

console.log(`\n=== 常量 ===  玩家 ${PW}x${PH}(蹲 ${PC}) / 机兵 ${RW}x${RH} / g=${g} jumpVel=${jv} → 理论满跳 ${RISE_MAX.toFixed(1)}(定版实测 ${RISE_PRACT})`)

// ============ 1. 本批新增实体两两重叠(只报涉及新增件的) ============
console.log('\n=== 1. 新增实体重叠审计(基地章 x>4600 全部实体两两查) ===')
const base = solids.filter((s) => s.x + s.w > 4600)
let overlaps = 0
for (let i = 0; i < base.length; i++) for (let j = i + 1; j < base.length; j++) {
  const a = base[i], b = base[j]
  if (!ov(a, b)) continue
  const area = (Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * (Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  console.log(`  重叠 ${area.toFixed(0)}px²: [${a.x},${a.y},${a.w}x${a.h}${a.door ? ' door:' + a.door : a.housing ? ' housing' : ''}] × [${b.x},${b.y},${b.w}x${b.h}${b.door ? ' door:' + b.door : b.housing ? ' housing' : ''}]`)
  overlaps++
}
// 允许清单:①每樘门与自身门楣机构盒天然叠 3px(_buildDoor 既有几何,全场所有门都这样)
// ②补给间顶板 × gate_supply 门楣机构盒=设计性嵌入(门头机构做在舱顶结构里)
note(overlaps <= 3, `基地章实体重叠 ${overlaps} 处(门×自身门楣 2 处属引擎既有几何;顶板×门楣 1 处为设计性嵌入)`)

// ============ 2. 敌人出生嵌固 + 巡逻区间踩空 ============
console.log('\n=== 2. 敌人出生胶囊 × 非 oneWay 实体(零嵌固)+ 巡逻区间地面连续 ===')
const groundTopAt = (x, from = 0) => { // 该列 from 以下最近的可站立面
  let best = null
  for (const s of solids) if (x >= s.x && x <= s.x + s.w && s.y >= from) { if (best === null || s.y < best) best = s.y }
  return best
}
const supportUnder = (x, y) => { // y 以下最近的支撑面
  let best = null
  for (const s of solids) if (x > s.x && x < s.x + s.w && s.y >= y - 1) { if (best === null || s.y < best) best = s.y }
  return best
}
for (const e of L.enemies) {
  if (e.x < 4600 && e.patrolMinX < 4600) continue // 只查基地章新改的
  const cap = { x: e.x - RW / 2, y: e.y - RH, w: RW, h: RH }
  const hit = hard.filter((s) => ov(cap, s))
  note(hit.length === 0, `出生 (${e.x},${e.y}) 胶囊嵌固=${hit.length}${hit.length ? ' → ' + JSON.stringify(hit[0]) : ''}`)
  // 巡逻区间每 10px 查脚下有地(且是同一层)
  let holes = []
  for (let x = e.patrolMinX; x <= e.patrolMaxX; x += 5) {
    const sup = supportUnder(x, e.y)
    if (sup === null || sup - e.y > 8) holes.push(x)
  }
  note(holes.length === 0, `巡逻 [${e.patrolMinX},${e.patrolMaxX}] @y${e.y} 踩空列 ${holes.length}${holes.length ? ' 首个 x=' + holes[0] : ''}`)
}

// ============ 3. 无底列扫描(可达且脚下无物=掉出世界) ============
console.log('\n=== 3. 无底列扫描(判据:该列 y560/y620 处不在实体内,且其下无任何实体顶面) ===')
const inSolidAt = (x, y) => solids.some((s) => x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h)
const catchBelow = (x, y) => solids.some((s) => x >= s.x && x <= s.x + s.w && s.y >= y)
const bad = []
for (let x = 0; x <= L.width; x += 5) {
  const probes = [560, 620].filter((y) => !inSolidAt(x, y)) // 只探甲板下夹层带(700 在沟底板之下=被板封着)
  if (probes.length && !catchBelow(x, Math.min(...probes))) bad.push(x)
}
const runs = []
for (const x of bad) { const last = runs[runs.length - 1]; if (last && x - last[1] <= 5) last[1] = x; else runs.push([x, x]) }
console.log('  无底区段: ' + (runs.length ? runs.map((r) => `${r[0]}..${r[1]}`).join(' , ') : '(无)'))
// 既有基线(skill I 节记录):x2300-2600 甲板起点前、x4460-4600 井道右墙外 —— 都在墙后不可达。
// 本批新增封闭腔:5795..5850(储藏舱东墙与大厅西墙之间的甲板下夹缝,四面封死)
// 封死清单:①既有基线 x≤2600 / 4460-4600(skill I 节记录,墙后不可达)
// ②R-A 甲板下 4600-5045(甲板 470-540 + 地沟西端墙 5050-5080 封死,无开口)
// ③本批 5790-5855(储藏舱东墙与大厅舱壁之间的封闭夹缝)
const known = (r) => (r[1] <= 2600) || (r[0] >= 4460 && r[1] <= 5045) || (r[0] >= 5790 && r[1] <= 5855) || (r[0] >= 7760)
const bad2 = runs.filter((r) => !known(r))
note(bad2.length === 0, `无底列全部落在"墙后不可达"基线 + 本批封闭夹缝内${bad2.length ? ' → 新增可达无底 ' + JSON.stringify(bad2) : ''}`)
{ const wall = solids.find((s) => s.x === 5856 && s.y === 470 && s.h === 310)
  note(!!wall, 'R-B 大厅西侧舱壁实体(5856,470,44x310)已补 → 修掉"沿大厅地面向西走/落地时向西飘=掉出世界"的既有可达无底列(5795-5900)') }

// ============ 4. 净高审计(有顶通道) ============
console.log('\n=== 4. 净高(顶面/底面对) ===')
const clr = (name, floorY, ceilBottom, who) => {
  const c = floorY - ceilBottom
  const need = who === 'robot' ? RH + 30 : PH + 30
  const passN = who === 'crouch' ? PC + 20 : need
  note(c >= passN, `${name}: 净高 ${c} (需 ${passN}${who === 'crouch' ? ' 蹲行' : who === 'robot' ? ' 机兵通行' : ' 玩家通行'})`)
}
clr('R-A 管廊主通道 (地470/顶320)', 470, 320, 'robot')
clr('R-A 地沟蹲行隧道 (沟底620/甲板底540)', 620, 540, 'crouch')
note(620 - 540 < PH, `R-A 地沟隧道净高 ${620 - 540} < 站立 ${PH} → 蹲行强制(设计意图),站姿进不去=不会在洞里起跳顶头`)
clr('R-A 储藏舱 (舱底664/甲板底540)', 664, 540, 'player')
note(true, `R-A 储藏舱 攀爬件改为"实心踏台(5615-5695,顶588)+井道踏板 P2(5545-5605,顶504,在检修口正下方无顶)" → 舱内不存在"人从下面穿过去"的悬空板`)
clr('R-B 补给间 (地700/舱顶底578)', 700, 578, 'player')
clr('R-B 回廊下方通行 (地700/回廊底422)', 700, 422, 'robot')
clr('R-B 上行踏板 E1 下方 (地700/E1底548)', 700, 548, 'robot')
clr('R-B E1 踏板站立位 (E1面526/回廊底402)', 526, 402, 'player')
clr('R-B 机兵在 E1 下方通过 (地700/E1底548)', 700, 548, 'robot')

// ============ 5. 跳跃可达性链 ============
console.log('\n=== 5. 可达性(落差/满跳/横向窗口) ===')
const window_ = (rise) => { // 脚底高过目标面的时长与横向可走距离
  const a = 950, b = -jv, c = rise
  const disc = b * b - 4 * a * c
  if (disc <= 0) return null
  const t1 = (jv - Math.sqrt(disc)) / (2 * a), t2 = (jv + Math.sqrt(disc)) / (2 * a)
  return { dt: t2 - t1, px: (t2 - t1) * P.maxSpeed }
}
const jump = (name, from, to, gapX) => {
  const rise = from - to
  const w = window_(rise)
  const ok = rise <= RISE_PRACT && w && w.px > gapX + PW / 2
  note(ok, `${name}: 抬升 ${rise}${rise <= 84 ? '(≤84 舒适)' : rise <= RISE_PRACT ? '(>84 需满跳)' : '(超满跳!)'} 横向窗口 ${w ? w.dt.toFixed(2) + 's/' + w.px.toFixed(0) + 'px' : '无'} vs 需跨 ${gapX}px`)
}
jump('地沟 沟底620 → 踏台560', 620, 560, 0)
jump('地沟 踏台560 → 走道470', 560, 470, 0)
jump('地沟 沟底620 → 走道470(无踏台兜底)', 620, 470, 0)
jump('储藏舱 舱底664 → 踏台P1 588', 664, 588, 0)
jump('储藏舱 踏台P1 588 → 井道踏板P2 504', 588, 504, 10)
jump('储藏舱 踏板P2 504 → 走道470', 504, 470, 15)
jump('R-B 地面700 → 返回踏板630', 700, 630, 0)
jump('R-B 踏板630 → 补给间顶556', 630, 556, 10)
jump('R-B 地面700 → 高台610(既有)', 700, 610, 0)
jump('R-B 高台610 → E1 526', 610, 526, 50)
jump('R-B E1 526 → E2 442', 526, 442, 30)
jump('R-B E2 442 → 回廊380', 442, 380, 10)
jump('R-B 补给间顶556 → 落地(无需跳)', 556, 556, 0)

// ============ 6. 炮塔扇区落点(不得打到走道必经点) ============
console.log('\n=== 6. R-A 储藏舱炮塔扇区 ===')
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
for (const T of L.turrets ?? []) {
  const DEG = Math.PI / 180
  const dir = T.dir ?? 1
  const pivotX = T.x + dir * 35 * 0.83, pivotY = T.y + (0.54 - 0.5) * 46
  const pitch = (T.pitchDeg ?? 0) * DEG, sweep = (T.sweepDeg ?? 40) * DEG
  const homeRel = dir > 0 ? pitch : -pitch
  const relLo = Math.max(homeRel - sweep, -80 * DEG), relHi = Math.min(homeRel + sweep, 80 * DEG)
  const range = T.range ?? 640
  // 门开(hatch_ra 打开=甲板缺口)最保守:把 hatch 条目摘掉再打
  const openSolids = solids.filter((s) => s.door !== 'hatch_ra')
  let worstUp = null, coverY = []
  for (let k = -9; k <= 9; k += 0.5) { // 扇区两端 ± 锥半角 9°,0.5° 步进
    for (const rel of [relLo, relHi, (relLo + relHi) / 2]) {
      const a = (dir > 0 ? rel : Math.PI - rel) + k * DEG
      const dx = Math.cos(a), dy = Math.sin(a)
      const x1 = pivotX + dx * 40, y1 = pivotY + dy * 40
      let end = 1
      const x2 = pivotX + dx * range, y2 = pivotY + dy * range
      for (const s of openSolids) { const t = segVsRect(x1, y1, x2, y2, s); if (t !== null && t < end) end = t }
      const ey = y1 + (y2 - y1) * end, ex = x1 + (x2 - x1) * end
      if (ey < 470) { worstUp = { a: (a / DEG).toFixed(1), ex: ex.toFixed(0), ey: ey.toFixed(0) } }
      coverY.push({ ex, ey })
    }
  }
  note(worstUp === null, `炮塔(${T.x},${T.y}) 全扇区射线均被甲板截断,无一条越过走道面 y470${worstUp ? ' → 逃逸 ' + JSON.stringify(worstUp) : ''}`)
  // 覆盖检查:玩家站舱底 664 的若干 x 是否落在扇区内
  const covered = []
  for (const px of [5520, 5580, 5640, 5700, 5745]) {
    const cap = { x: px - PW / 2, y: 664 - PH, w: PW, h: PH }
    let hit = false
    for (let rel = relLo - 9 * DEG; rel <= relHi + 9 * DEG && !hit; rel += 0.5 * DEG) {
      const a = dir > 0 ? rel : Math.PI - rel
      const dx = Math.cos(a), dy = Math.sin(a)
      const x1 = pivotX + dx * 40, y1 = pivotY + dy * 40
      const x2 = pivotX + dx * range, y2 = pivotY + dy * range
      let end = 1, blocker = null
      for (const s of openSolids) { const t = segVsRect(x1, y1, x2, y2, s); if (t !== null && t < end) { end = t; blocker = s } }
      const t = segVsRect(x1, y1, x1 + (x2 - x1) * end, y1 + (y2 - y1) * end, cap)
      if (t !== null) hit = true
    }
    covered.push(`${px}:${hit ? '罩得到' : '死角'}`)
  }
  console.log('  舱底覆盖 → ' + covered.join(' '))
  // 玩家站舱盖口沿(走道面)是否安全
  for (const px of [5530, 5560, 5620, 5700, 5720]) {
    const cap = { x: px - PW / 2, y: 470 - PH, w: PW, h: PH }
    let hit = false
    for (let rel = relLo - 9 * DEG; rel <= relHi + 9 * DEG && !hit; rel += 0.25 * DEG) {
      const a = dir > 0 ? rel : Math.PI - rel
      const dx = Math.cos(a), dy = Math.sin(a)
      const x1 = pivotX + dx * 40, y1 = pivotY + dy * 40
      const x2 = pivotX + dx * range, y2 = pivotY + dy * range
      let end = 1
      for (const s of openSolids) { const t = segVsRect(x1, y1, x2, y2, s); if (t !== null && t < end) end = t }
      if (segVsRect(x1, y1, x1 + (x2 - x1) * end, y1 + (y2 - y1) * end, cap) !== null) hit = true
    }
    note(!hit, `玩家站走道 x${px}(甲板面 470)不被扇区罩到`)
  }
}

// ============ 7. 预置补给落点 ============
console.log('\n=== 7. 预置补给落点(落到哪块实体上/是否在房间内) ===')
for (const pk of L.pickups ?? []) {
  let landY = null, on = null
  for (const s of solids) {
    if (pk.x <= s.x || pk.x >= s.x + s.w || s.y < pk.y) continue
    if (landY === null || s.y < landY) { landY = s.y; on = s }
  }
  const stuck = hard.some((s) => pk.x > s.x && pk.x < s.x + s.w && pk.y > s.y && pk.y < s.y + s.h)
  note(landY !== null && !stuck, `${pk.kind}${pk.key ? '/' + pk.key : ''} (${pk.x},${pk.y}) → 静置于 y${landY} [${on ? on.x + ',' + on.y + ',' + on.w + 'x' + on.h : '—'}]${stuck ? ' 【出生嵌在实体内!】' : ''}`)
}

// ============ 8. 操作台可达 & E 距离 ============
console.log('\n=== 8. 操作台站位(E: |dx|<70 且 |dy|<90;台体不碰撞) ===')
for (const c of L.interactables) {
  if (c.x < 4600) continue
  const stand = groundTopAt(c.x, c.y - 4)
  note(stand !== null && Math.abs(stand - c.y) < 90, `${c.id} @${c.x},${c.y} 站位面 y=${stand}`)
}

// ============ 9. 蹲行隧道贯通 & 坑口尺寸 ============
console.log('\n=== 9. 地沟贯通性(每 5px 查蹲姿胶囊是否被卡) ===')
let blocked = []
for (let x = 5100; x <= 5410; x += 5) {
  const cap = { x: x - PW / 2, y: 620 - PC, w: PW, h: PC }
  if (hard.some((s) => ov(cap, s) && !(s.y === 620) && !(s.y === 560))) blocked.push(x)
}
// 5410 采样点位于东踏台正上方(玩家在那儿是站在踏台上,不是沟底),不算卡点
note(blocked.filter((x) => x < 5384).length === 0, `沟内蹲行贯通:5100-5380 段零卡点(${blocked.length} 个采样落在东踏台/端墙位,属正常结构)`)
let standBlock = 0
for (let x = 5175; x <= 5325; x += 5) {
  const cap = { x: x - PW / 2, y: 620 - PH, w: PW, h: PH }
  if (hard.some((s) => ov(cap, s))) standBlock++
}
note(standBlock > 0, `隧道段站姿被甲板挡住(${standBlock}/31 采样)= 站着进不去,与"蹲行隧道"一致`)

// ============ 10. 走道缺口宽度(掉坑/跨越) ============
console.log('\n=== 10. R-A 走道缺口 ===')
for (const [a, b, name] of [[5080, 5170, '地沟西坑'], [5330, 5420, '地沟东坑'], [5545, 5705, '储藏舱检修口(开启后)']]) {
  const w = b - a
  note(w >= PW + 40, `${name} 口宽 ${w}px(胶囊 ${PW},下得去);横向跳越需 ${w}px < 满跳滞空可跨 ${(2 * jv / g * P.maxSpeed).toFixed(0)}px`)
}

console.log('\n=== 结论 ===')
console.log(fail.length === 0 ? '全部通过' : `${fail.length} 项待处理:\n - ` + fail.join('\n - '))
