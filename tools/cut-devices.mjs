// 机关件切件 —— 母本:docs/风格参考/参考16-机关件套图v1.png(1672x941,浅灰底)
// cut-props 同构(多边形→泛洪→除尘→透明边裁剪→按目标高缩放)+ erase 橡皮擦(把门体从门框里挖出)。
// 门=框(静止)+体(升降滑板)两件:框整体切+erase 挖掉门体区;体单独切。
// 用法: node tools/cut-devices.mjs → public/assets/img/dev_*.png + 打印 1x 尺寸
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'

const SRC = 'docs/风格参考/参考16-机关件套图v1.png'
const SRC_EDGE = 'docs/风格参考/参考17-闸门侧棱v1.png' // 闸门侧棱视图(用户点名:门是侧着放的,不是正对镜头)
const SRC_TURRET = 'docs/风格参考/参考18-壁挂炮塔v1.png' // 壁挂机枪炮塔(基座+可旋枪体两件)
const SRC_WALL = 'docs/风格参考/参考19-隔墙截面柱v1.png' // 舱段隔墙截面柱(门上方墙体)
const SRC_CAB = 'docs/风格参考/参考21-电梯厢套图v1.png' // 载人电梯三件套(厢体剖面/井道齿轨/呼叫面板)
const SRC_HATCH = 'docs/风格参考/参考22-井口暗门套图v1.png' // 井口暗门(井坑框环/滑轨槽床/厚滑板)
const SRC_STAIR = 'docs/风格参考/参考23-钢楼梯套件v1.png' // 双斜梁开放式钢梯套件(踏步/斜梁/扶手柱/锚固板)
const SRC_HATCH2 = 'docs/风格参考/参考24-暗门地下结构v1.png' // 暗门地下收纳结构(检修盖板/剖面空腔/支撑板/滑板断面)
const SRC_B1 = 'docs/风格参考/参考25-B1行政层家具v1.png' // B1 行政/检疫层家具(房间批次一)
const SRC_B4 = 'docs/风格参考/参考26-B4核心舱家具v1.png' // B4 核心舱家具(机房/维修间)
const OUT = 'public/assets/img'

const ITEMS = [
  // B4 核心舱家具:机柜/货架/桥架/吊钩=后带与天花装饰,工作台=实体掩体
  { name: 'prop_rack',      targetH: 120, src: SRC_B4, poly: [[60, 80], [265, 80], [265, 730], [60, 730]] },
  { name: 'prop_rack_open', targetH: 120, src: SRC_B4, poly: [[320, 85], [540, 85], [540, 730], [320, 730]] },
  { name: 'bg_cable_tray',  targetH: 26,  src: SRC_B4, poly: [[580, 165], [1075, 165], [1075, 270], [580, 270]] },
  { name: 'prop_workbench', targetH: 52,  src: SRC_B4, poly: [[560, 425], [1080, 425], [1080, 745], [560, 745]] , clearPockets: true },
  { name: 'prop_shelf',     targetH: 110, src: SRC_B4, poly: [[55, 810], [520, 810], [520, 1290], [55, 1290]] , clearPockets: true },
  { name: 'bg_hoist',       targetH: 90,  src: SRC_B4, poly: [[560, 850], [1080, 850], [1080, 1280], [560, 1280]] , clearPockets: true },
  // B1 行政/检疫层家具(房间批次一):办公桌+电脑/翻倒椅=R2 可推件;玻璃隔间/储物柜=后带装饰
  { name: 'bg_office_glass',   targetH: 160, src: SRC_B1, poly: [[55, 70], [1065, 70], [1065, 390], [55, 390]] },
  { name: 'prop_desk',         targetH: 56,  src: SRC_B1, poly: [[40, 425], [470, 425], [470, 755], [40, 755]] , clearPockets: true },
  { name: 'prop_filecab',      targetH: 88,  src: SRC_B1, poly: [[545, 420], [730, 420], [730, 760], [545, 760]] },
  { name: 'prop_chair_fallen', targetH: 28,  src: SRC_B1, poly: [[795, 565], [1080, 565], [1080, 770], [795, 770]] , clearPockets: true },
  { name: 'prop_counter',      targetH: 52,  src: SRC_B1, poly: [[40, 820], [520, 820], [520, 1055], [40, 1055]] , clearPockets: true },
  { name: 'prop_gate_turn',    targetH: 54,  src: SRC_B1, poly: [[610, 820], [1075, 820], [1075, 1075], [610, 1075]] , clearPockets: true },
  { name: 'prop_lockers',      targetH: 96,  src: SRC_B1, poly: [[40, 1065], [475, 1065], [475, 1345], [40, 1345]] , clearPockets: true },
  { name: 'prop_bench',        targetH: 22,  src: SRC_B1, poly: [[545, 1155], [1040, 1155], [1040, 1330], [545, 1330]] , clearPockets: true },
  // 暗门 v4 地下结构(用户三次点名定版:门收进地表以下的结构里,结构要画出来):
  // lid=收纳舱检修盖板(顶视,盖在滑板行程上方);xsec=甲板切断面+剖开的收纳舱空腔(滑板断面
  // 条在腔内滑动可见);sub=空腔下方的支撑斜撑板;slab=滑板侧面断面条(与顶视滑板同步平移)
  { name: 'dev_hatch_lid',  targetH: 30, src: SRC_HATCH2, poly: [[95, 145], [1040, 145], [1040, 440], [95, 440]] },
  { name: 'dev_hatch_xsec', targetH: 30, src: SRC_HATCH2, poly: [[45, 565], [690, 565], [690, 855], [45, 855]] },
  { name: 'dev_hatch_sub',  targetH: 30, src: SRC_HATCH2, poly: [[700, 565], [1080, 565], [1080, 1070], [700, 1070]] },
  { name: 'dev_hatch_slab', targetH: 10, src: SRC_HATCH2, poly: [[80, 1180], [1040, 1180], [1040, 1265], [80, 1265]] },
  // 钢楼梯套件(反馈批:开放式钢梯+扶手):踏步=格栅顶面+厚前立面;斜梁母本自带 15.6° 倾角
  // (实测梁顶边 (320,518)→(800,652)),rotate 转平后在游戏里按关卡坡度整体旋转平铺;
  // 立柱带双管夹环(穿上下两根横管);锚固板带警示纹
  { name: 'dev_stair_tread',  targetH: 24, src: SRC_STAIR, poly: [[60, 160], [1060, 160], [1060, 405], [60, 405]] },
  { name: 'dev_stair_beam',   targetH: 20, src: SRC_STAIR, poly: [[300, 495], [835, 495], [835, 880], [300, 880]], rotate: -15.6, insetX: 18 },
  { name: 'dev_stair_post',   targetH: 52, src: SRC_STAIR, poly: [[160, 790], [330, 790], [330, 1260], [160, 1260]] },
  { name: 'dev_stair_anchor', targetH: 16, src: SRC_STAIR, poly: [[540, 1080], [925, 1080], [925, 1260], [540, 1260]] },
  // 井口暗门(R1 结构真实性批次):井坑=加固框环+井内壁(远壁暗板/近唇亮带,画在滑板之下);
  // 槽床=滑板滑出后的停驻导轨位——母本里导轨纵置,rotate:90 让轨向与滑动方向一致;
  // 滑板=厚钢板(防滑顶面+前立面侧棱+黄黑警示带+把手凹槽)
  { name: 'dev_hatch_pit',   targetH: 60, src: SRC_HATCH, poly: [[298, 182], [808, 182], [808, 700], [298, 700]] },
  { name: 'dev_hatch_bed',   targetH: 26, src: SRC_HATCH, poly: [[213, 188], [300, 188], [300, 658], [213, 658]], rotate: 90 },
  { name: 'dev_hatch_plate', targetH: 52, src: SRC_HATCH, poly: [[150, 770], [975, 770], [975, 1195], [150, 1195]] },
  // 载人电梯:厢体(两侧开放剖面,含踏板/按钮背壁/吊索顶棚/角柱)/井道齿轨(竖向平铺)/墙挂呼叫面板
  // clearPockets:开放结构(角柱/顶棚/踏板围出的口袋)会困住画布底色,泛洪进不去,按连通块面积清除
  { name: 'dev_cab',       targetH: 138, src: SRC_CAB, poly: [[145, 130], [980, 130], [980, 830], [145, 830]], clearPockets: true },
  { name: 'dev_rail',      targetH: 240, src: SRC_CAB, poly: [[1105, 28], [1270, 28], [1270, 878], [1105, 878]], clearPockets: true },
  { name: 'dev_callpanel', targetH: 34,  src: SRC_CAB, poly: [[1395, 460], [1530, 460], [1530, 695], [1395, 695]] },
  // 隔墙截面柱(门上方的墙体,建筑构件语言)
  { name: 'dev_wall_col', targetH: 270, src: SRC_WALL, poly: [[390, 40], [650, 40], [650, 1410], [390, 1410]] },
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

// 封闭口袋清除:开放式结构围出的"看穿区"里困着画布底色(不与边界连通,泛洪清不到)——
// 找 亮且低饱和 像素的连通块,面积≥阈值的整块清透明;金属小高光(几十px)不受影响
function clearPockets(data, W, H, minArea = 150) {
  const isBg = (i) => {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
    return mx / 255 > 0.55 && (mx ? (mx - mn) / mx : 0) < 0.28
  }
  const seen = new Uint8Array(W * H)
  for (let sy = 0; sy < H; sy++) for (let sx = 0; sx < W; sx++) {
    const si = sy * W + sx
    if (seen[si] || data[si * 4 + 3] === 0 || !isBg(si * 4)) continue
    const comp = []
    const q = [sx, sy]
    seen[si] = 1
    while (q.length) {
      const y = q.pop(), x = q.pop()
      comp.push(y * W + x)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const ni = ny * W + nx
        if (!seen[ni] && data[ni * 4 + 3] !== 0 && isBg(ni * 4)) { seen[ni] = 1; q.push(nx, ny) }
      }
    }
    if (comp.length >= minArea) for (const i of comp) data[i * 4 + 3] = 0
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
  if (item.clearPockets) clearPockets(masked.data, masked.info.width, masked.info.height)
  dedust(masked.data, masked.info.width, masked.info.height)
  const cb = contentBox(masked.data, masked.info.width, masked.info.height)
  let trimmed = await sharp(masked.data, { raw: masked.info }).extract(cb).png().toBuffer()
  let cw = cb.width, ch = cb.height
  if (item.rotate) { // 旋转件:直角(槽床轨向)或任意角(斜梁转平),转后重找内容盒再裁
    trimmed = await sharp(trimmed).rotate(item.rotate, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
    const r2 = await sharp(trimmed).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const cb2 = contentBox(r2.data, r2.info.width, r2.info.height)
    // insetX:任意角旋转后原裁切边变成斜切口,左右各内缩到满高区(平铺件必须端头齐整)
    const inset = item.insetX ?? 0
    const cbi = { left: cb2.left + inset, top: cb2.top, width: cb2.width - inset * 2, height: cb2.height }
    trimmed = await sharp(trimmed).extract(cbi).png().toBuffer()
    cw = cbi.width; ch = cbi.height
  }
  const scale = item.targetH * 2 / ch
  const w2 = Math.max(2, Math.round(cw * scale))
  const h2 = item.targetH * 2
  await sharp(trimmed).resize(w2, h2, { fit: 'fill' }).png().toFile(`${OUT}/${item.name}.png`)
  console.log(`${item.name}: ${Math.round(w2 / 2)} x ${Math.round(h2 / 2)}`)
}
