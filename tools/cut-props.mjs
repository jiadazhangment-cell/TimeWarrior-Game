// 战场道具切件 —— 母本:docs/风格参考/参考15-战场道具集v1.png(1672x941,浅灰底)
// 角色管线的无关节简化版:多边形粗框 → 边界泛洪去底 → 最大连通块除尘 → 透明边裁剪 → 按玩法目标高度缩放。
// 目标高度(1x)按玩法定:掩体箱52=蹲姿全遮;集装箱84=可跳顶(跳跃顶高>92);路障38=半掩体;平台22≈单向平台碰撞高。
// 用法: node tools/cut-props.mjs → public/assets/img/prop_*.png + 打印 1x 尺寸(抄进 level json)
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'

const SRC = 'docs/风格参考/参考15-战场道具集v1.png'
const OUT = 'public/assets/img'

const ITEMS = [
  { name: 'prop_cover',     targetH: 52, poly: [[55, 235], [410, 235], [410, 465], [55, 465]] },
  { name: 'prop_container', targetH: 84, poly: [[445, 165], [1070, 165], [1070, 465], [445, 465]] },
  { name: 'prop_ammo2',     targetH: 34, poly: [[1095, 215], [1355, 215], [1355, 455], [1095, 455]] },
  { name: 'prop_ammo3',     targetH: 44, poly: [[1375, 185], [1630, 185], [1630, 455], [1375, 455]] },
  { name: 'prop_barrier',   targetH: 38, poly: [[65, 565], [570, 565], [570, 795], [65, 795]] },
  { name: 'prop_platform',  targetH: 22, poly: [[590, 630], [1370, 630], [1370, 790], [590, 790]] },
  { name: 'prop_cabinet',   targetH: 82, poly: [[1390, 495], [1630, 495], [1630, 810], [1390, 810]] },
]

const bbox = (poly, pad = 2) => {
  const xs = poly.map(p => p[0]), ys = poly.map(p => p[1])
  const x = Math.max(0, Math.min(...xs) - pad), y = Math.max(0, Math.min(...ys) - pad)
  return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y }
}

function floodRemoveBg(data, W, H) {
  const lumSat = (i) => {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
    return [mx / 255, mx ? (mx - mn) / mx : 0]
  }
  const isBg = (i) => { const [l, s] = lumSat(i); return l > 0.55 && s < 0.3 }
  const q = []
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4
    if (data[i + 3] === 0) continue
    const edge = x === 0 || y === 0 || x === W - 1 || y === H - 1 ||
      data[i - 1] === 0 || data[i + 7] === 0 || data[(i - W * 4) + 3] === 0 || data[(i + W * 4) + 3] === 0
    if (edge && isBg(i)) { data[i + 3] = 0; q.push(x, y) }
  }
  while (q.length) {
    const y = q.pop(), x = q.pop()
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
      const i = (ny * W + nx) * 4
      if (data[i + 3] !== 0 && isBg(i)) { data[i + 3] = 0; q.push(nx, ny) }
    }
  }
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = (y * W + x) * 4
    if (data[i + 3] === 0) continue
    const [l] = lumSat(i)
    if (l > 0.5 && (data[i - 1] === 0 || data[i + 7] === 0 || data[(i - W * 4) + 3] === 0 || data[(i + W * 4) + 3] === 0)) {
      data[i + 3] = Math.min(data[i + 3], 110)
    }
  }
}

function dedust(data, W, H) {
  const seen = new Uint32Array(W * H)
  const areas = [0]
  let comp = 0
  for (let sy = 0; sy < H; sy++) for (let sx = 0; sx < W; sx++) {
    const si = sy * W + sx
    if (seen[si] || data[si * 4 + 3] === 0) continue
    comp++
    let area = 0
    const q = [sx, sy]
    seen[si] = comp
    while (q.length) {
      const y = q.pop(), x = q.pop()
      area++
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const ni = ny * W + nx
        if (!seen[ni] && data[ni * 4 + 3] !== 0) { seen[ni] = comp; q.push(nx, ny) }
      }
    }
    areas.push(area)
  }
  const keep = areas.indexOf(Math.max(...areas))
  for (let i = 0; i < W * H; i++) {
    if (seen[i] && seen[i] !== keep) data[i * 4 + 3] = 0
  }
}

// 透明边裁剪:扫 alpha 求内容 bbox
function contentBox(data, W, H) {
  let x0 = W, y0 = H, x1 = 0, y1 = 0
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (data[(y * W + x) * 4 + 3] > 12) {
      if (x < x0) x0 = x; if (x > x1) x1 = x
      if (y < y0) y0 = y; if (y > y1) y1 = y
    }
  }
  return { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }
}

const polySvg = (poly, box) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${box.w}" height="${box.h}">` +
  `<polygon points="${poly.map(([x, y]) => `${x - box.x},${y - box.y}`).join(' ')}" fill="#ffffff"/></svg>`)

mkdirSync(OUT, { recursive: true })
console.log('—— 1x 尺寸(抄进 level json) ——')
for (const item of ITEMS) {
  const box = bbox(item.poly)
  const raw = await sharp(SRC).extract({ left: box.x, top: box.y, width: box.w, height: box.h })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const masked = await sharp(raw.data, { raw: raw.info })
    .composite([{ input: polySvg(item.poly, box), blend: 'dest-in' }])
    .raw().toBuffer({ resolveWithObject: true })
  floodRemoveBg(masked.data, masked.info.width, masked.info.height)
  dedust(masked.data, masked.info.width, masked.info.height)
  const cb = contentBox(masked.data, masked.info.width, masked.info.height)
  const trimmed = await sharp(masked.data, { raw: masked.info }).extract(cb).png().toBuffer()
  const scale = item.targetH * 2 / cb.height
  const w2 = Math.max(2, Math.round(cb.width * scale))
  const h2 = item.targetH * 2
  await sharp(trimmed).resize(w2, h2, { fit: 'fill' }).png().toFile(`${OUT}/${item.name}.png`)
  console.log(`${item.name}: ${Math.round(w2 / 2)} x ${Math.round(h2 / 2)}`)
}
