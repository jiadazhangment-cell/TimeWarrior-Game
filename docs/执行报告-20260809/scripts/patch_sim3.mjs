// 从原始 sim3.mjs 生成 sim3_fixed.mjs:**只换 X 段**为仓库现役 src/systems/collide.js 的 resolveXSweep,
// 其余(solids 构建/Y 段/AI/试验协议/无种子 Math.random/困死判据)一字不改。
import fs from 'node:fs'
const SRC = 'C:/Users/surpr/Desktop/TimeWarrior-Game/docs/交接存档-20260728/sim3.mjs'
let s = fs.readFileSync(SRC, 'utf8')

// 1) 顶部注入 collide.js(项目 package.json=commonjs,用 data: URL 求值磁盘上的真源码)
s = s.replace(
  "import fs from 'fs'",
  `import fs from 'fs'
const __collideSrc = fs.readFileSync('C:/Users/surpr/Desktop/TimeWarrior-Game/src/systems/collide.js', 'utf8')
const { resolveXSweep } = await import('data:text/javascript;base64,' + Buffer.from(__collideSrc).toString('base64'))`)

// 2) mk() 补一个 capsule getter(resolveXSweep 读 ent.capsule / ent.x / ent.y / ent.vx)
s = s.replace(
  `  return { x, y: 470, vx: 0, vy: 0, dir: 1, state: 'patrol', pauseUntil: 0, pauseLen: 0,
           pendingTurn: 0, nextIdleAt: 1e9, staggerUntil: 0, _knockVx: 0 }`,
  `  const e = { x, y: 470, vx: 0, vy: 0, dir: 1, state: 'patrol', pauseUntil: 0, pauseLen: 0,
           pendingTurn: 0, nextIdleAt: 1e9, staggerUntil: 0, _knockVx: 0 }
  Object.defineProperty(e, 'capsule', { get() { return capOf(e) } })
  return e`)

// 3) X 段:preX 记在击退之前 → Clamp 移到解算之前 → 三判据排出(与 Enemy.js 落盘改动一一对应)
const OLD_X = `  if (e._knockVx) {
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
  e.x = Clamp(e.x, spec.patrolMinX, spec.patrolMaxX)`
const NEW_X = `  const preX = e.x
  if (e._knockVx) {
    e.x += e._knockVx * dt
    e._knockVx *= Math.exp(-dt * 7)
    if (Math.abs(e._knockVx) < 4) e._knockVx = 0
  }
  e.x += e.vx * dt
  e.x = Clamp(e.x, spec.patrolMinX, spec.patrolMaxX)
  resolveXSweep(e, solids, preX, {
    capW: CAP.w,
    onBlocked: () => {
      if (e.state === 'patrol' && forceCombatDir === null && now >= e.pauseUntil) hold(e, now, cfg.patrolEndPauseMs, -e.dir)
    },
  })`
if (!s.includes(OLD_X)) { console.error('!! 未匹配到原始 X 段,patch 失败'); process.exit(1) }
s = s.replace(OLD_X, NEW_X)
s = s.replace("console.log('165Hz + 真随机驻足时长", "console.log('[FIXED collide.js] 165Hz + 真随机驻足时长")
fs.writeFileSync('sim3_fixed.mjs', s)
console.log('已生成 sim3_fixed.mjs(仅替换 X 段)')
