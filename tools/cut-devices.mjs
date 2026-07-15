// 机关件切件 —— 母本:docs/风格参考/参考16-机关件套图v1.png(1672x941,浅灰底)
// cut-props 同构(多边形→泛洪→除尘→透明边裁剪→按目标高缩放)+ erase 橡皮擦(把门体从门框里挖出)。
// 门=框(静止)+体(升降滑板)两件:框整体切+erase 挖掉门体区;体单独切。
// 用法: node tools/cut-devices.mjs → public/assets/img/dev_*.png + 打印 1x 尺寸
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'

const SRC = 'docs/风格参考/参考16-机关件套图v1.png'
const SRC_EDGE = 'docs/风格参考/参考17-闸门侧棱v1.png' // 闸门侧棱视图(用户点名:门是侧着放的,不是正对镜头)
const SRC_TURRET = 'docs/风格参考/参考18-壁挂炮塔v1.png' // 壁挂机枪炮塔(基座+可旋枪体两件)
const OUT = 'public/assets/img'

const ITEMS = [
  // 壁挂炮塔:基座(挂板+铰接臂+转环)与枪体(双联短管,绕尾部转轴旋转)分件
  { name: 'dev_turret_base', targetH: 46, src: SRC_TURRET, poly: [[95, 185], [640, 185], [640, 875], [95, 875]] },
  { name: 'dev_turret_gun',  targetH: 27, src: SRC_TURRET, poly: [[715, 365], [1395, 365], [1395, 765], [715, 765]] },
  // 闸门(侧棱三件,现役):门棱柱+门楣机构+门槛座
  { name: 'dev_gate_edge',    targetH: 200, src: SRC_EDGE, poly: [[352, 105], [532, 105], [532, 848], [352, 848]] },
  { name: 'dev_gate_housing', targetH: 24,  src: SRC_EDGE, poly: [[700, 175], [1235, 175], [1235, 385], [700, 385]] },
  { name: 'dev_gate_sill',    targetH: 12,  src: SRC_EDGE, poly: [[740, 750], [1180, 750], [1180, 850], [740, 850]] },
  // 正脸门(参考16,备用:面向镜头的装饰门洞/背景门)
  { name: 'dev_gate_slab',  targetH: 200, poly: [[174, 158], [404, 158], [404, 792], [174, 792]] },
  { name: 'dev_gate_frame', targetH: 206, poly: [[98, 126], [480, 126], [480, 802], [98, 802]],
    erase: [[[180, 164], [398, 164], [398, 786], [180, 786]]] },
  { name: 'dev_gate_top',   targetH: 36,  poly: [[545, 138], [1115, 138], [1115, 322], [545, 322]] },
  { name: 'dev_laser_down', targetH: 40,  poly: [[610, 425], [777, 425], [777, 806], [610, 806]] },
  { name: 'dev_laser_up',   targetH: 40,  poly: [[850, 420], [1015, 420], [1015, 806], [850, 806]] },
  { name: 'dev_console',    targetH: 56,  poly: [[1135, 435], [1345, 435], [1345, 802], [1135, 802]] },
  { name: 'dev_pylon',      targetH: 60,  poly: [[1465, 295], [1605, 295], [1605, 802], [1465, 802]] },
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

// 除尘:门框有 erase 挖洞后是"回字形"多连通体——保留所有足够大的块(≥总面积2%),只清浮尘
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
  const total = areas.reduce((s, a) => s + a, 0)
  const keep = new Set()
  areas.forEach((a, i) => { if (i > 0 && a >= total * 0.02) keep.add(i) })
  for (let i = 0; i < W * H; i++) {
    if (seen[i] && !keep.has(seen[i])) data[i * 4 + 3] = 0
  }
}

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

const polySvg = (poly, box, fill = '#ffffff') => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${box.w}" height="${box.h}">` +
  `<polygon points="${poly.map(([x, y]) => `${x - box.x},${y - box.y}`).join(' ')}" fill="${fill}"/></svg>`)

mkdirSync(OUT, { recursive: true })
console.log('—— 1x 尺寸 ——')
for (const item of ITEMS) {
  const box = bbox(item.poly)
  const raw = await sharp(item.src ?? SRC).extract({ left: box.x, top: box.y, width: box.w, height: box.h })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let masked = await sharp(raw.data, { raw: raw.info })
    .composite([{ input: polySvg(item.poly, box), blend: 'dest-in' }])
    .raw().toBuffer({ resolveWithObject: true })
  if (item.erase?.length) {
    const holes = item.erase.map(ep =>
      `<polygon points="${ep.map(([x, y]) => `${x - box.x},${y - box.y}`).join(' ')}" fill="#ffffff"/>`).join('')
    const eraseSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${box.w}" height="${box.h}">${holes}</svg>`)
    masked = await sharp(masked.data, { raw: masked.info })
      .composite([{ input: eraseSvg, blend: 'dest-out' }])
      .raw().toBuffer({ resolveWithObject: true })
  }
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
