// 可达性泛洪:从基地章所有站立面出发,只用"走+落"(掉出世界只可能靠这两样),
// 用玩家胶囊做位形空间判定 —— 有没有任何可达位形能一路落到世界底(=掉出世界)。
import fs from 'fs'
const L = JSON.parse(fs.readFileSync('C:/Users/surpr/Desktop/TimeWarrior-Game/config/level_slice.json', 'utf8'))
const P = JSON.parse(fs.readFileSync('C:/Users/surpr/Desktop/TimeWarrior-Game/config/player.json', 'utf8'))
const CROUCH = process.argv.includes('--crouch')
const PW = P.capsule.w, PH = CROUCH ? P.crouch.h : P.capsule.h
const solids = L.platforms.map((p) => ({ ...p }))
for (const d of L.doors ?? []) { // 门按"开启"态最危险计:hatch_ra / gate_supply 开着;seal1 关着不影响本段
  if (d.id === 'hatch_ra' || d.id === 'gate_supply') continue
  solids.push({ x: d.x, y: d.y, w: d.w, h: d.h })
  if (!d.hatch) solids.push({ x: d.x + d.w / 2 - 32, y: d.y - 21, w: 64, h: 24 })
}
const hard = solids.filter((s) => !s.oneWay && !s.minor)
const X0 = 4600, X1 = 7790, Y0 = 240, Y1 = 900, S = 5
const free = (x, y) => { // 脚底 (x,y) 的站立胶囊不与任何实体重叠
  const c = { x: x - PW / 2, y: y - PH, w: PW, h: PH }
  return !hard.some((s) => c.x < s.x + s.w && c.x + c.w > s.x && c.y < s.y + s.h && c.y + c.h > s.y)
}
const key = (x, y) => x + ',' + y
const seen = new Set(), stack = []
for (const s of solids) { // 起点=每块实体顶面上方(含 oneWay,玩家能站)
  if (s.x + s.w < X0 || s.x > X1) continue
  for (let x = Math.max(X0, Math.ceil(s.x / S) * S); x <= Math.min(X1, s.x + s.w); x += S) {
    const y = s.y
    if (y < Y0 || y > Y1 || !free(x, y)) continue
    const k = key(x, y); if (!seen.has(k)) { seen.add(k); stack.push([x, y]) }
  }
}
const escapes = []
while (stack.length) {
  const [x, y] = stack.pop()
  for (const [nx, ny] of [[x - S, y], [x + S, y], [x, y + S]]) {
    if (nx < X0 || nx > X1 || ny > Y1) { if (ny > Y1) escapes.push([x, y]); continue }
    if (!free(nx, ny)) continue
    const k = key(nx, ny)
    if (seen.has(k)) continue
    seen.add(k); stack.push([nx, ny])
  }
}
// "落出世界"= 可达位形一路降到 Y1 以下
const deep = [...seen].map((k) => k.split(',').map(Number)).filter(([x, y]) => y >= 860)
console.log(`[${CROUCH ? '蹲姿 52' : '站姿 88'}] 可达位形 ${seen.size} 个;降到 y≥860(世界底方向)的 ${deep.length} 个`)
if (deep.length) {
  const xs = [...new Set(deep.map((d) => d[0]))].sort((a, b) => a - b)
  console.log('  逃逸列 x: ' + xs.join(','))
} else {
  console.log('  ✓ 基地章无"走着走着掉出世界"的可达列(地沟/储藏舱/大厅全部有底,西缘有舱壁)')
}
// 附:各功能位置是否可达
const at = (x, y) => seen.has(key(Math.round(x / S) * S, y))
for (const [n, x, y] of [['地沟沟底(隧道中段)', 5250, 620], ['地沟西踏台', 5100, 560], ['地沟东踏台', 5400, 560],
  ['储藏舱底', 5600, 664], ['储藏舱井道踏板P2', 5575, 504], ['储藏舱踏台P1', 5655, 588], ['储藏舱东侧口袋', 5730, 664],
  ['补给间内(门开)', 6060, 700], ['补给间顶', 6060, 556], ['二层回廊', 6450, 380],
  ['上行踏板E1', 6380, 526], ['上行踏板E2', 6250, 442]]) {
  console.log(`  ${at(x, y) ? '可达' : '【不可达!】'}  ${n} (${x},${y})`)
}
