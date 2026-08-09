// 复刻 BigFan._applyPlayer 的叶片投影重叠判定(working copy 181-187 行的条件),
// 用 level_slice.json 真实数值,统计"一次叶片扫过"能连续命中多少帧、trauma 累到多少。
const d = { cx: 6900, cy: 400, r: 230, hub: 46, wallX: 6877, wallW: 45, speeds: { full: 3.0, mid: 1.7, slow: 0.5 } }
const BLADES = 3
const CAP_H = 88

function contactFrames(speed, capTop, hz) {
  const dt = 1 / hz
  const lead = d.r * speed * 0.03
  const pTop = capTop, pBot = capTop + CAP_H
  let angle = 0
  let run = 0, maxRun = 0, hitFrames = 0
  let trauma = 0, maxTrauma = 0
  let runs = []
  const total = Math.round(10 * hz) // 10 秒
  for (let f = 0; f < total; f++) {
    angle += speed * dt
    let hit = false
    for (let i = 0; i < BLADES; i++) {
      const ph = angle + (i * Math.PI * 2) / BLADES
      if (Math.sin(ph) <= 0.15) continue
      const yTip = d.cy - d.r * Math.cos(ph)
      const y0 = Math.min(d.cy, yTip) - lead, y1 = Math.max(d.cy, yTip) + lead
      if (pBot > y0 && pTop < y1) { hit = true; break }
    }
    // trauma: 衰减 1.4/s,命中帧 +0.35 并 clamp 1
    trauma = Math.max(0, trauma - dt * 1.4)
    if (hit) { trauma = Math.min(1, trauma + 0.35); hitFrames++; run++ }
    else { if (run) runs.push(run); run = 0 }
    maxRun = Math.max(maxRun, run)
    maxTrauma = Math.max(maxTrauma, trauma)
  }
  if (run) runs.push(run)
  return { maxRun, hitFrames, duty: (hitFrames / total * 100).toFixed(1) + '%', maxTrauma: maxTrauma.toFixed(2), passes: runs.length, avgRun: runs.length ? (runs.reduce((a, b) => a + b) / runs.length).toFixed(1) : 0 }
}

const spots = [
  ['站在风道底板 630 (capsule 542..630)', 542],
  ['半跳中 (capsule 470..558)', 470],
  ['风扇轴心高度 (capsule 356..444)', 356],
]
for (const hz of [165, 60]) {
  for (const [name, top] of spots) {
    for (const [mode, sp] of Object.entries(d.speeds)) {
      const r = contactFrames(sp, top, hz)
      console.log(`${hz}Hz | ${mode.padEnd(4)} | ${name.padEnd(34)} 连续命中帧 max=${String(r.maxRun).padStart(3)} 平均=${String(r.avgRun).padStart(5)} 次数/10s=${String(r.passes).padStart(3)} 占空比=${r.duty.padStart(6)} trauma峰值=${r.maxTrauma}`)
    }
  }
  console.log('')
}
// 对照:如果只有 hurt 的 700ms 无敌门控生效,10 秒最多扣多少血
console.log('单次 hurt=16,hp=100,700ms 无敌 → 满速持续接触时 10s 内最多 ' + Math.floor(10000 / 700) * 16 + ' 伤害(足够致死)')
