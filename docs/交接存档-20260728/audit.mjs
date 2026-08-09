import fs from 'fs'
const { BigFan } = await import('./BigFan.run.mjs')
const mn=(a)=>a.reduce((p,c)=>c<p?c:p,Infinity), mx=(a)=>a.reduce((p,c)=>c>p?c:p,-Infinity)
const pts = []   // 收集所有落笔坐标做包围盒审计
const rec = (x, y) => { if (Number.isFinite(x) && Number.isFinite(y)) pts.push([x, y]) }
function mk (tag) {
  const g = { _tag: tag }
  g.fillStyle = () => g; g.lineStyle = () => g; g.clear = () => g; g.setDepth = () => g
  g.beginPath = () => g; g.closePath = () => g; g.fillPath = () => g; g.strokePath = () => g
  g.moveTo = (x, y) => (rec(x, y), g); g.lineTo = (x, y) => (rec(x, y), g)
  g.fillRect = (x, y, w, h) => (rec(x, y), rec(x + w, y + h), g)
  g.strokeRect = g.fillRect
  g.fillCircle = (x, y, r) => (rec(x - r, y - r), rec(x + r, y + r), g)
  g.lineBetween = (a, b, c, d) => (rec(a, b), rec(c, d), g)
  return g
}
let TNOW = 0
const gfx = []
const scene = { add: { graphics: () => { const g = mk('g' + gfx.length); gfx.push(g); return g } }, time: { get now () { return TNOW } }, events: { once: () => {} }, player: null, addTrauma: () => {} }
const def = JSON.parse(fs.readFileSync('C:/Users/surpr/Desktop/TimeWarrior-Game/config/level_slice.json', 'utf8')).fans[0]
const fan = new BigFan(scene, def)
fan.mode = 'full'; fan.speed = 3
for (let s = 0; s < 360; s++) { fan.angle = (s / 360) * Math.PI * 2; TNOW = 1000 + s * 16; fan._draw(TNOW) }
const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
const wall = def.wall
console.log('落笔包围盒  X:', mn(xs).toFixed(1), '..', mx(xs).toFixed(1), ' Y:', mn(ys).toFixed(1), '..', mx(ys).toFixed(1))
console.log('墙体视觉范围 X:', wall.x, '..', wall.x + wall.w, ' Y:', wall.top, '..', wall.bottom)
console.log('吸/排风线允许范围 X:', def.suction.x1, '..', def.blowX2)
console.log('世界天花板 y=60 / 地面 y=700;超出者:',
  ys.filter(y => y < 55 || y > 702).length, '个落笔')
// 只统计非气流件(把气流关掉重跑)
pts.length = 0
fan.speed = 0.2; fan.mode = 'slow'   // k=0.067 < 0.3 → 不画气流
for (let s = 0; s < 360; s++) { fan.angle = (s / 360) * Math.PI * 2; TNOW = 1000 + s * 16; fan._draw(TNOW) }
const xs2 = pts.map(p => p[0]), ys2 = pts.map(p => p[1])
console.log('\n关掉气流后(纯机体+墙)包围盒  X:', mn(xs2).toFixed(1), '..', mx(xs2).toFixed(1),
  ' Y:', mn(ys2).toFixed(1), '..', mx(ys2).toFixed(1))
console.log('→ 是否全部落在墙体视觉矩形内:', mn(xs2) >= wall.x - 0.01 && mx(xs2) <= wall.x + wall.w + 0.01 && mn(ys2) >= wall.top - 0.01 && mx(ys2) <= wall.bottom + 0.01)
