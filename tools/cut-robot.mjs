// 机器人切件管线 —— 母本:docs/风格参考/参考13-机器人母本v1.png(1086x1448,用户 ChatGPT 生成)
// 与 cut-player.mjs 同构(构造性关节对齐/圆帽重叠/边界泛洪/最大连通块除尘),差异:
//   1. 母本立正直腿(无烘焙姿势),站姿角全部交给 rigs 配置;
//   2. 枪管带下倾 → armgun 用 horiz:[握把,枪口] 旋转到水平(同 vert 机制,轴向不同);
//   3. 关节处有橙色能量核心=天然标记点,J 表按核心圆心测。
// 用法: node tools/cut-robot.mjs preview → tmp-cuts/robot-polys-overlay.jpg 人眼校版
//       node tools/cut-robot.mjs final   → public/assets/img/robot_*.png + 打印 rigs 数据
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'

const SRC = 'docs/风格参考/参考13-机器人母本v1.png'
const OUT = 'public/assets/img'
const S2X = 0.17 // 全身高约1225px(头顶85→鞋底1310) → 1x高约104px(比玩家100略高大)
const mode = process.argv[2] ?? 'preview'

// —— 关节与基准点(源图像素坐标;髋/膝/踝/肘取橙色能量核心圆心) ——
const J = {
  neck:     [516, 296],
  shoulder: [468, 362],
  elbow:    [408, 484],
  muzzle:   [945, 604],
  hipMid:   [470, 655],
  hipF:     [458, 660], kneeF: [452, 903], ankleF: [418, 1218],
  headTopY: 85, soleY: 1308,
}

const PARTS = [
  { name: 'robot_head', z: 6, parentJoint: J.neck,
    poly: [[416,96],[500,80],[566,92],[610,130],[624,182],[614,240],[590,276],[560,300],[510,310],[458,300],[424,258],[408,190],[406,138]] },

  // 躯干=胸/腹/背包/髋部弹挂,含持枪链遮住的胸腹区(抬枪露出完整胸甲)
  { name: 'robot_torso', z: 5, root: true,
    poly: [[470,286],[556,290],[602,332],[630,392],[642,472],[644,562],[630,622],[638,664],[615,702],[548,716],[468,714],[398,702],[356,684],[344,600],[338,470],[336,390],[354,330],[410,296]] },

  // 肩甲固定层:静止盖住肩关节,手臂从其下转出
  { name: 'robot_pauldron', z: 11, parentJoint: J.shoulder,
    poly: [[400,300],[462,286],[514,302],[534,350],[528,408],[496,446],[442,456],[398,436],[378,388],[380,340]] },

  // 两段式手臂:大臂(aimFactor 部分随瞄)+小臂双手枪(绕肘全额随瞄,horiz 旋转枪管归平)
  { name: 'robot_arm_upper', z: 10, parentJoint: J.shoulder, aim: true, aimFactor: 0.55,
    poly: [[402,356],[458,346],[482,392],[480,452],[452,502],[406,516],[374,490],[370,430],[382,384]] },

  { name: 'robot_armgun', z: 9, parentJoint: J.elbow, parentName: 'robot_arm_upper', aim: true, muzzle: J.muzzle,
    horiz: [[750, 558], J.muzzle], // 轴取纯枪管段(机匣尾→枪口),旋转归平

    poly: [[452,432],[520,428],[560,450],[610,428],[660,414],[730,404],[820,396],[900,394],[950,408],[962,430],[958,590],[938,622],[870,630],[800,636],[730,642],[680,660],[640,668],[600,655],[560,625],[516,596],[470,556],[446,505]] },

  // 近腿三件(直腿站立,vert 旋转到标准垂直);远腿=调暗副本
  { name: 'robot_thigh_f', z: 7, parentJoint: J.hipF, vert: [J.hipF, J.kneeF],
    poly: [[396,606],[530,610],[560,660],[552,764],[530,854],[510,918],[428,920],[398,862],[386,760],[388,676]] },

  { name: 'robot_shin_f', z: 8, parentJoint: J.kneeF, parentName: 'robot_thigh_f', vert: [J.kneeF, J.ankleF],
    poly: [[404,862],[508,858],[512,922],[500,1015],[482,1105],[466,1185],[458,1248],[388,1242],[378,1160],[388,1050],[396,948]] },

  // 独立脚掌(真踝关节;底边压 1305 避开地面阴影)
  { name: 'robot_foot_f', z: 8, parentJoint: J.ankleF, parentName: 'robot_shin_f',
    poly: [[346,1196],[430,1186],[472,1196],[522,1212],[566,1240],[584,1274],[580,1304],[350,1304],[340,1250]] },

  { name: 'robot_thigh_b', copyFrom: 'robot_thigh_f', darken: 0.8 },
  { name: 'robot_shin_b',  copyFrom: 'robot_shin_f',  darken: 0.8 },
  { name: 'robot_foot_b',  copyFrom: 'robot_foot_f',  darken: 0.8 },
]

// ---------------------------------------------------------------------------
const bbox = (poly, pad = 2) => {
  const xs = poly.map(p => p[0]), ys = poly.map(p => p[1])
  const x = Math.max(0, Math.min(...xs) - pad), y = Math.max(0, Math.min(...ys) - pad)
  return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y }
}

const polySvg = (poly, box, fill, stroke) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${box.w}" height="${box.h}">` +
  `<polygon points="${poly.map(([x, y]) => `${x - box.x},${y - box.y}`).join(' ')}"` +
  ` fill="${fill}" ${stroke ? `stroke="${stroke}" stroke-width="3" fill-opacity="0"` : ''}/></svg>`)

// 从多边形边界泛洪清除亮背景(瓷砖 lum 高、低饱和;机器人装甲深灰不受影响)
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

async function probeRotationSign() {
  const probe = Buffer.from([0, 0, 0, 255, 0, 0, 0, 255, 255, 0, 0, 255])
  const { data, info } = await sharp(probe, { raw: { width: 3, height: 1, channels: 4 } })
    .rotate(90, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).raw().toBuffer({ resolveWithObject: true })
  const bottomRed = data[((info.height - 1) * info.width + 0) * 4] > 200
  return bottomRed ? 1 : -1
}

const rot = (p, c, cNew, rad) => {
  const dx = p[0] - c[0], dy = p[1] - c[1]
  return [cNew[0] + dx * Math.cos(rad) - dy * Math.sin(rad), cNew[1] + dx * Math.sin(rad) + dy * Math.cos(rad)]
}

async function run() {
  mkdirSync('tmp-cuts', { recursive: true })
  mkdirSync(OUT, { recursive: true })

  if (mode === 'preview') {
    const colors = ['#00e5ff', '#ffd166', '#ff6b6b', '#7cff6b', '#e07cff', '#6b9cff', '#ff9d2e']
    let overlay = ''
    PARTS.filter(p => p.poly).forEach((p, i) => {
      overlay += `<polygon points="${p.poly.map(pt => pt.join(',')).join(' ')}" fill="none" stroke="${colors[i % colors.length]}" stroke-width="3"/>`
      overlay += `<text x="${p.poly[0][0]}" y="${p.poly[0][1] - 6}" font-size="22" fill="${colors[i % colors.length]}">${p.name.replace('robot_', '')}</text>`
    })
    for (const [k, v] of Object.entries(J)) {
      if (!Array.isArray(v)) continue
      overlay += `<line x1="${v[0] - 12}" y1="${v[1]}" x2="${v[0] + 12}" y2="${v[1]}" stroke="#ff2b2b" stroke-width="3"/>` +
        `<line x1="${v[0]}" y1="${v[1] - 12}" x2="${v[0]}" y2="${v[1] + 12}" stroke="#ff2b2b" stroke-width="3"/>` +
        `<text x="${v[0] + 14}" y="${v[1] - 6}" font-size="20" fill="#ff2b2b">${k}</text>`
    }
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1086" height="1448">${overlay}</svg>`)
    await sharp(SRC).composite([{ input: svg }]).jpeg({ quality: 90 }).toFile('tmp-cuts/robot-polys-overlay.jpg')
    console.log('preview → tmp-cuts/robot-polys-overlay.jpg')
    return
  }

  // final
  const sign = await probeRotationSign()
  const rig = {}
  for (const p of PARTS) {
    if (p.copyFrom) {
      const buf = await sharp(`${OUT}/${p.copyFrom}.png`).modulate({ brightness: p.darken ?? 1 }).png().toBuffer()
      await sharp(buf).toFile(`${OUT}/${p.name}.png`)
      rig[p.name] = rig[p.copyFrom]
      console.log('final', p.name, `(copy of ${p.copyFrom}, darken ${p.darken ?? 1})`)
      continue
    }
    const box = bbox(p.poly)
    const raw = await sharp(p.src ?? SRC).extract({ left: box.x, top: box.y, width: box.w, height: box.h })
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const masked = await sharp(raw.data, { raw: raw.info })
      .composite([{ input: polySvg(p.poly, box, '#ffffff'), blend: 'dest-in' }])
      .raw().toBuffer({ resolveWithObject: true })
    floodRemoveBg(masked.data, masked.info.width, masked.info.height)
    dedust(masked.data, masked.info.width, masked.info.height)
    let buf = await sharp(masked.data, { raw: masked.info }).png().toBuffer()
    if (p.erase?.length) {
      const holes = p.erase.map(ep =>
        `<polygon points="${ep.map(([x, y]) => `${x - box.x},${y - box.y}`).join(' ')}" fill="#ffffff"/>`).join('')
      const eraseSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${box.w}" height="${box.h}">${holes}</svg>`)
      buf = await sharp(buf).composite([{ input: eraseSvg, blend: 'dest-out' }]).png().toBuffer()
    }
    // 旋转到标准姿态:vert=纵轴(腿),horiz=横轴(枪管归平);关节坐标跟踪同一变换
    let mapPoint = (pt) => [pt[0] - box.x, pt[1] - box.y]
    let size = { w: box.w, h: box.h }
    const axis = p.vert ?? p.horiz
    if (axis) {
      const [a, b] = axis
      const phi = p.vert
        ? Math.atan2(b[0] - a[0], b[1] - a[1])        // 相对竖直向下的偏角
        : Math.atan2(b[1] - a[1], b[0] - a[0])        // 相对水平向右的偏角
      const deg = sign * phi * 180 / Math.PI * (p.vert ? 1 : -1) // horiz 消偏方向与 vert 相反
      const rotated = await sharp(buf).rotate(deg, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
      const meta = await sharp(rotated).metadata()
      const c = [box.w / 2, box.h / 2], cNew = [meta.width / 2, meta.height / 2]
      const rad = sign * deg * Math.PI / 180
      const prevMap = mapPoint
      mapPoint = (pt) => rot(prevMap(pt), c, cNew, rad)
      const [ax, ay] = mapPoint(a), [bx2, by2] = mapPoint(b)
      const err = p.vert ? Math.abs(ax - bx2) : Math.abs(ay - by2)
      if (err > 1.5) throw new Error(`${p.name}: 旋转自检失败 err=${err.toFixed(2)}`)
      buf = rotated
      size = { w: meta.width, h: meta.height }
    }
    const sc2 = p.s2x ?? S2X
    const w2 = Math.max(2, Math.round(size.w * sc2 * (p.widen ?? 1)))
    const h2 = Math.max(2, Math.round(size.h * sc2))
    await sharp(buf).resize(w2, h2, { fit: 'fill' }).png().toFile(`${OUT}/${p.name}.png`)
    const scaleX = w2 / size.w, scaleY = h2 / size.h
    const toTex1x = (pt) => { const m = mapPoint(pt); return [m[0] * scaleX / 2, m[1] * scaleY / 2] }
    rig[p.name] = { p, toTex1x, size1x: [w2 / 2, h2 / 2] }
    console.log('final', p.name, `${w2}x${h2} (1x=${Math.round(w2 / 2)}x${Math.round(h2 / 2)})`)
  }

  console.log('\n—— rigs.json 数据(1x 像素,四舍五入到 0.5) ——')
  const r5 = (v) => Math.round(v * 2) / 2
  const fmt = (pt) => `[${r5(pt[0])}, ${r5(pt[1])}]`
  const torso = rig['robot_torso']
  for (const part of PARTS) {
    if (part.copyFrom) continue
    const { p, toTex1x, size1x } = rig[part.name]
    const pivotJ = p.root ? J.hipMid : (p.pivotJoint ?? p.parentJoint)
    const pivot = toTex1x(pivotJ)
    let line = `${part.name}: size [${Math.round(size1x[0])}, ${Math.round(size1x[1])}], pivot ${fmt(pivot)}`
    if (!p.root) {
      const parent = p.parentName ? rig[p.parentName] : torso
      line += `, attach@${p.parentName ?? 'torso'} ${fmt(parent.toTex1x(p.parentJoint))}`
    }
    if (p.muzzle) line += `, muzzle ${fmt(toTex1x(p.muzzle))}`
    console.log(line)
  }
  console.log(`heightToHip: ${r5((J.soleY - J.hipMid[1]) * S2X / 2)}`)
  console.log(`IK 腿长(1x): L1=${r5(Math.hypot(J.kneeF[0]-J.hipF[0], J.kneeF[1]-J.hipF[1]) * S2X / 2)}  L2(膝→鞋底)=${r5(Math.hypot(J.ankleF[0]-J.kneeF[0], J.soleY-J.kneeF[1]) * S2X / 2)}`)
  console.log(`角色 1x 视觉高: ${r5((J.soleY - J.headTopY) * S2X / 2)}`)
}

run().catch(e => { console.error(e); process.exit(1) })
