// 忠实复刻 Enemy.js update() 的 X 段(+重力/落地)逻辑,喂真实 level_slice.json 的 solids。
// 目的:独立验证"击退→深叠→按速度方向弹到另一侧→Clamp 拉回 patrolMinX(在障碍肚子里)=永久嵌固"。
import fs from 'fs'
const L = JSON.parse(fs.readFileSync('C:/Users/surpr/Desktop/TimeWarrior-Game/config/level_slice.json', 'utf8'))
const E = JSON.parse(fs.readFileSync('C:/Users/surpr/Desktop/TimeWarrior-Game/config/enemies.json', 'utf8'))
const G = JSON.parse(fs.readFileSync('C:/Users/surpr/Desktop/TimeWarrior-Game/config/game.json', 'utf8'))

// solids = platforms(+stairs 展开) + Devices 追加的 breakables(顺序与 ArenaScene/Devices 一致)
const solids = L.platforms.slice()
for (const st of L.stairs ?? []) for (let k = 1; k <= st.steps; k++) {
  const sx = st.dir > 0 ? st.x + st.stepW * (k - 1) : st.x - st.stepW * k
  solids.push({ x: sx, y: st.y - st.stepH * k, w: st.stepW, h: 8, stair: true })
}
for (const b of L.breakables ?? []) solids.push({ x: b.x, y: b.y, w: b.w, h: b.h, breakable: b.id })

const cfg = E.robot_grunt
const spec = L.enemies.find((e) => e.patrolMinX === 1450)
const CAP = cfg.capsule
const Clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const Between=(a,b)=>a+Math.random()*(b-a);

function mk(x) {
  return { x, y: 470, vx: 0, vy: 0, dir: 1, state: 'patrol', pauseUntil: 0, pauseLen: 0,
           pendingTurn: 0, nextIdleAt: 1e9, staggerUntil: 0, _knockVx: 0 }
}
const capOf = (e) => ({ x: e.x - CAP.w / 2, y: e.y - CAP.h, w: CAP.w, h: CAP.h })
const hit = (c, s) => c.x < s.x + s.w && c.x + c.w > s.x && c.y < s.y + s.h && c.y + c.h > s.y

function hold(e, now, range, turnDir) {
  e.pauseLen = Between(range[0], range[1]); e.pauseUntil = now + e.pauseLen; e.pendingTurn = turnDir
  e.nextIdleAt = e.pauseUntil + Between(cfg.patrolIdleEveryMs[0], cfg.patrolIdleEveryMs[1])
}

// 只跑 patrol 分支(combat 另测);dt 固定 1/60
function step(e, now, dt, forceCombatDir /* null=patrol */) {
  const staggered = now < e.staggerUntil
  e.vy = Math.min(e.vy + G.gravityY * dt, 1100)
  const prevY = e.y; e.y += e.vy * dt
  for (const s of solids) {
    if (s.minor) continue
    const c = capOf(e)
    if (hit(c, s) && e.vy > 0 && !(s.oneWay && prevY > s.y + 1) && !(s.liftRoof && prevY > s.y + 12) && !(prevY > s.y + 12)) { e.y = s.y; e.vy = 0 }
  }
  let moveDir = 0
  if (forceCombatDir === null) {
    if (now < e.pauseUntil) { /* 驻足 */ }
    else {
      if (e.pendingTurn) { e.dir = e.pendingTurn; e.pendingTurn = 0 }
      moveDir = e.dir
      const atEnd = (e.dir > 0 && e.x >= spec.patrolMaxX) || (e.dir < 0 && e.x <= spec.patrolMinX)
      if (atEnd) { hold(e, now, cfg.patrolEndPauseMs, -e.dir); moveDir = 0 }
      else if (now >= e.nextIdleAt) { hold(e, now, cfg.patrolIdleMs, 0); moveDir = 0 }
    }
  } else {
    moveDir = forceCombatDir
    moveDir = Clamp(e.x + moveDir * 10, spec.patrolMinX, spec.patrolMaxX) === e.x ? 0 : moveDir
  }
  if (staggered) moveDir = 0
  e.vx = moveDir * (forceCombatDir === null ? cfg.patrolSpeed : cfg.chaseSpeed)
  if (e._knockVx) {
    e.x += e._knockVx * dt
    e._knockVx *= Math.exp(-dt * 7)
    if (Math.abs(e._knockVx) < 4) e._knockVx = 0
  }
  e.x += e.vx * dt
  for (const s of solids) {
    if (s.oneWay || s.minor) continue
    const c = capOf(e)
    if (hit(c, s)) {
      if (e.vx > 0) e.x = s.x - c.w / 2
      else if (e.vx < 0) e.x = s.x + s.w + c.w / 2
      e.vx = 0
      if (e.state === 'patrol' && forceCombatDir === null && now >= e.pauseUntil) hold(e, now, cfg.patrolEndPauseMs, -e.dir)
    }
  }
  e.x = Clamp(e.x, spec.patrolMinX, spec.patrolMaxX)
}

const barrier = solids.find((s) => s.prop === 'prop_barrier')
const cab = solids.find((s) => s.breakable === 'cab1')
console.log('spec        =', JSON.stringify(spec))
console.log('barrier     =', barrier.x, '..', barrier.x + barrier.w, ' y', barrier.y, '..', barrier.y + barrier.h)
console.log('cab1        =', cab.x, '..', cab.x + cab.w, ' y', cab.y, '..', cab.y + cab.h)
console.log('gap barrier→cab1 =', cab.x - (barrier.x + barrier.w), 'px   (胶囊宽', CAP.w, ')')
console.log('patrolMinX 1450 在 barrier 内?', 1450 > barrier.x && 1450 < barrier.x + barrier.w)

// ---- A. 无干扰基线:纯巡逻 60 秒,看它自然停位与是否嵌固 ----
function run(label, e, frames, combatDirFn = () => null, knockAt = -1, knockV = 0) {
  let now = 0, dt = 1 / 165
  let overlapFrames = 0, minX = 1e9, maxX = -1e9
  for (let f = 0; f < frames; f++) {
    if (f === knockAt) { e._knockVx = knockV; e.staggerUntil = now + cfg.hitStaggerMs }
    step(e, now, dt, combatDirFn(e, f))
    now += dt * 1000
    const c = capOf(e)
    if (hit(c, barrier) || hit(c, cab)) overlapFrames++
    minX = Math.min(minX, e.x); maxX = Math.max(maxX, e.x)
  }
  const c = capOf(e)
  console.log(`\n[${label}] frames=${frames} 终态 x=${e.x.toFixed(1)} 胶囊 ${c.x.toFixed(0)}..${(c.x + c.w).toFixed(0)}` +
    ` | x 区间 ${minX.toFixed(0)}..${maxX.toFixed(0)} | 与 barrier/cab1 重叠帧 ${overlapFrames}/${frames}` +
    ` | 埋在 barrier 里=${hit(c, barrier)} 埋在 cab1 里=${hit(c, cab)}`)
}


let trapped=0, N=40
for (let i=0;i<N;i++){
  const e = mk(spec.x); let now=0, dt=1/165
  for (let f=0; f<165*90; f++){
    if (f===165*15) { e._knockVx=-130; e.staggerUntil=now+cfg.hitStaggerMs }
    step(e, now, dt, (f>165*25 && f<165*40) ? +1 : null)
    now += dt*1000
  }
  const c = capOf(e)
  if (hit(c,barrier)||hit(c,cab)||e.x<1500) trapped++
}
console.log('165Hz + 真随机驻足时长,40 次独立试验(击退一次+15s交战):嵌固/困死 =', trapped, '/', N)
