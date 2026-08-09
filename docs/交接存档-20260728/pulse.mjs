import fs from 'fs'
const { BigFan } = await import('./BigFan.run.mjs')
const mk = () => { const g = {}; for (const m of ['fillRect','fillCircle','fillPath','strokeRect','strokeCircle','lineBetween','strokePath','fillStyle','lineStyle','beginPath','moveTo','lineTo','closePath','clear','setDepth']) g[m] = () => g; return g }
let TNOW = 0
const scene = { add: { graphics: mk }, time: { get now(){return TNOW} }, events: { once: () => {} }, player: null, addTrauma: () => {} }
const def = JSON.parse(fs.readFileSync('C:/Users/surpr/Desktop/TimeWarrior-Game/config/level_slice.json','utf8')).fans[0]
const fan = new BigFan(scene, def)
// slow 档跑 30s,记录脉冲峰值转速
fan._setMode('slow'); fan.speed = 0.5
let peak = 0, dt = 1/60
for (let i = 0; i < 30*60; i++) { TNOW += dt*1000; fan.update(dt); peak = Math.max(peak, fan.speed) }
console.log('slow 档 30s 内脉冲峰值转速 =', peak.toFixed(3), 'rad/s (基准 0.5)')
// 总闸停机:滑停耗时 + 终态
fan._setMode('full'); fan.speed = 3; fan.mode = 'full'; fan.angle = 0.05
fan._shutdown()
let t = 0
while (fan._alignTarget != null && t < 10) { TNOW += dt*1000; fan.update(dt); t += dt }
console.log('停机滑到 Y 形位耗时 =', t.toFixed(2), 's;终态 angle =', fan.angle.toFixed(4), '= 120°×', (fan.angle/(Math.PI*2/3)).toFixed(3), ';speed =', fan.speed)
const tips = [0,1,2].map(i => +(def.cy - def.r*Math.cos(fan.angle + i*Math.PI*2/3)).toFixed(1))
console.log('三片叶梢 y =', tips.join(' / '), ' → 洞底 630 以上最低叶梢 =', Math.max(...tips))
// 最坏情况滑停耗时(刚过停位点)
fan2: { }
const f2 = new BigFan(scene, def); f2.mode='full'; f2.speed=3; f2.angle = (Math.PI*2/3) + 0.001; f2._shutdown()
let t2 = 0
while (f2._alignTarget != null && t2 < 10) { TNOW += dt*1000; f2.update(dt); t2 += dt }
console.log('最坏情况(刚错过停位点)滑停耗时 =', t2.toFixed(2), 's')
