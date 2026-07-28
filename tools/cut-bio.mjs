// 生物敌人A切件管线 —— 母本:docs/风格参考/参考46-生物A母本.png(1086x1448,ChatGPT 严格侧视版)
// 与 cut-robot.mjs 同构(构造性关节对齐/圆帽重叠/边界泛洪/最大连通块除尘),生物专有差异:
//   1. 无 head(无头设定,胸眼长在躯干)、无 armgun(近战);臂=两节(肩→肘→爪);尾=独立切件(挂臀,程序摆动);
//   2. 母本是自然弯腿蹲伏姿(非立正直腿):thigh/shin/arm 用 vert 转正,烘焙角由骨架 stance 重摆;
//      foot(趾行长脚掌)与 tail 不转正,保持原画角度;
//   3. 【苍白皮肉防打穿】背景泛洪阈值按实测收紧:瓷砖 lum .776-.784/sat<.01,皮肉最高 lum .659(尾)——
//      isBg 用 l>0.73 && s<0.06(通用 0.55 阈值会从边界把苍白身体整片吃掉);
//      半透明边缘处理同理提到 l>0.68。
// 用法: node tools/cut-bio.mjs preview → tmp-cuts/bio-polys-overlay.jpg 人眼校版
//       node tools/cut-bio.mjs final   → public/assets/img/bio_*.png + 打印 rigs 数据
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'

const SRC = 'docs/风格参考/参考46-生物A母本.png'
const OUT = 'public/assets/img'
// 全身高:环顶155→趾底1240=1085px;目标 1x 高≈104(与机器人同级的体量压迫感,前倾体态)
const S2X = 0.096 * 2 // ×2=贴图出 2x(rigs 记 1x,CharacterRig setScale(0.5)——坐标系铁律)
const mode = process.argv[2] ?? 'preview'

// —— 关节与基准点(源图像素坐标,探针网格+裁片实测 2026-07-27) ——
const J = {
  shoulder: [742, 338],
  elbow:    [724, 548],
  wrist:    [792, 818],   // 爪臂 vert 轴末端(肘→腕转正)
  hip:      [548, 660],
  knee:     [490, 1000],
  ankle:    [535, 1125],
  tailRoot: [462, 645],
  topY: 148, soleY: 1240,
}

const PARTS = [
  // 躯干=接驳环+背刺+胸眼+躯干主体+臀(root,pivot=髋)。
  // 前缘含近侧臂经过区(挥臂露出的是"烤着淡臂影的肋腹",深色纹理相融——玩家躯干烤臂影同款做法)
  { name: 'bio_torso', z: 5, root: true,
    poly: [[652,148],[884,148],[886,238],[872,268],[880,320],[900,380],[902,452],[878,490],[840,512],[790,528],[736,556],[700,592],[668,636],[644,690],[614,730],[540,730],[470,708],[440,666],[442,600],[455,560],[484,516],[508,472],[530,428],[550,388],[572,344],[594,300],[612,264],[628,218],[638,180]] },

  // 近侧臂上节:肩→肘(vert 转正;圆帽在肩/肘各留 ~40px)
  { name: 'bio_arm_upper', z: 10, parentJoint: J.shoulder, vert: [J.shoulder, J.elbow],
    poly: [[700,300],[786,308],[788,368],[778,440],[768,510],[758,586],[750,614],[698,610],[688,540],[686,450],[690,372]] },

  // 近侧爪臂:肘→腕→三爪(vert 轴取肘→腕;爪指间隙向下开放,泛洪可达)
  { name: 'bio_arm_claw', z: 9, parentJoint: J.elbow, parentName: 'bio_arm_upper', vert: [J.elbow, J.wrist],
    poly: [[680,512],[762,510],[774,590],[786,660],[796,724],[808,788],[830,822],[856,868],[884,920],[888,1000],[878,1070],[850,1130],[832,1195],[806,1200],[782,1150],[762,1070],[744,1000],[706,946],[686,884],[676,806],[668,716],[664,620]] },

  // 近腿三节(趾行):大腿 髋→膝 / 胫 膝→踝(vert 转正);长脚掌 踝→趾(保持原角,压平逻辑接管)
  { name: 'bio_thigh_f', z: 7, parentJoint: J.hip, vert: [J.hip, J.knee],
    poly: [[506,614],[598,606],[650,648],[664,714],[652,792],[624,872],[592,948],[560,1014],[506,1038],[464,1002],[460,930],[468,840],[480,750],[492,672]] },

  { name: 'bio_shin_f', z: 8, parentJoint: J.knee, parentName: 'bio_thigh_f', vert: [J.knee, J.ankle],
    poly: [[444,972],[524,962],[548,1010],[554,1070],[560,1122],[566,1162],[500,1174],[462,1120],[446,1050],[440,1004]] },

  { name: 'bio_foot_f', z: 8, parentJoint: J.ankle, parentName: 'bio_shin_f',
    poly: [[456,1112],[566,1098],[606,1140],[646,1180],[694,1212],[700,1244],[470,1248],[448,1186],[448,1140]] },

  // 尾:挂臀,整件保持原画弧线(pivot=尾根;程序小角度摆动)
  { name: 'bio_tail', z: 2, parentJoint: J.tailRoot,
    poly: [[398,584],[462,592],[480,640],[478,700],[452,752],[404,812],[352,872],[298,932],[246,994],[196,1058],[152,1118],[112,1172],[76,1214],[46,1222],[36,1200],[52,1168],[86,1116],[130,1056],[180,994],[232,932],[286,868],[340,806],[392,742],[428,688],[430,630]] },

  { name: 'bio_thigh_b', copyFrom: 'bio_thigh_f', darken: 0.8 },
  { name: 'bio_shin_b',  copyFrom: 'bio_shin_f',  darken: 0.8 },
  { name: 'bio_foot_b',  copyFrom: 'bio_foot_f',  darken: 0.8 },
  { name: 'bio_arm_b',   copyFrom: 'bio_arm_claw', darken: 0.78 }, // 远侧臂=单节爪臂副本(远侧上节被躯干遮,省一件)
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

// 苍白皮肉版泛洪:阈值收紧(见文件头注释),其余机制与 cut-robot 相同
function floodRemoveBg(data, W, H) {
  const lumSat = (i) => {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
    return [mx / 255, mx ? (mx - mn) / mx : 0]
  }
  const isBg = (i) => { const [l, s] = lumSat(i); return l > 0.73 && s < 0.06 }
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
    if (l > 0.68 && (data[i - 1] === 0 || data[i + 7] === 0 || data[(i - W * 4) + 3] === 0 || data[(i + W * 4) + 3] === 0)) {
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
    const colors = ['#00e5ff', '#ffd166', '#ff6b6b', '#7cff6b', '#e07cff', '#6b9cff', '#ff9d2e', '#2effd0']
    let overlay = ''
    PARTS.filter(p => p.poly).forEach((p, i) => {
      overlay += `<polygon points="${p.poly.map(pt => pt.join(',')).join(' ')}" fill="none" stroke="${colors[i % colors.length]}" stroke-width="3"/>`
      overlay += `<text x="${p.poly[0][0]}" y="${p.poly[0][1] - 6}" font-size="22" fill="${colors[i % colors.length]}">${p.name.replace('bio_', '')}</text>`
    })
    for (const [k, v] of Object.entries(J)) {
      if (!Array.isArray(v)) continue
      overlay += `<line x1="${v[0] - 12}" y1="${v[1]}" x2="${v[0] + 12}" y2="${v[1]}" stroke="#ff2b2b" stroke-width="3"/>` +
        `<line x1="${v[0]}" y1="${v[1] - 12}" x2="${v[0]}" y2="${v[1] + 12}" stroke="#ff2b2b" stroke-width="3"/>` +
        `<text x="${v[0] + 14}" y="${v[1] - 6}" font-size="20" fill="#ff2b2b">${k}</text>`
    }
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1086" height="1448">${overlay}</svg>`)
    await sharp(SRC).composite([{ input: svg }]).jpeg({ quality: 90 }).toFile('tmp-cuts/bio-polys-overlay.jpg')
    console.log('preview → tmp-cuts/bio-polys-overlay.jpg')
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
    // 旋转到标准姿态:vert=纵轴(腿/臂),关节坐标跟踪同一变换
    let mapPoint = (pt) => [pt[0] - box.x, pt[1] - box.y]
    let size = { w: box.w, h: box.h }
    const axis = p.vert ?? p.horiz
    if (axis) {
      const [a, b] = axis
      const phi = p.vert
        ? Math.atan2(b[0] - a[0], b[1] - a[1])
        : Math.atan2(b[1] - a[1], b[0] - a[0])
      const deg = sign * phi * 180 / Math.PI * (p.vert ? 1 : -1)
      const rotated = await sharp(buf).rotate(deg, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
      const meta = await sharp(rotated).metadata()
      const c = [box.w / 2, box.h / 2], cNew = [meta.width / 2, meta.height / 2]
      const rad = sign * deg * Math.PI / 180
      const prevMap = mapPoint
      mapPoint = (pt) => rot(prevMap(pt), c, cNew, rad)
      const [ax] = mapPoint(a), [bx2, by2] = mapPoint(b)
      const err = p.vert ? Math.abs(ax - bx2) : Math.abs((mapPoint(a))[1] - by2)
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
  const torso = rig['bio_torso']
  for (const part of PARTS) {
    if (part.copyFrom) continue
    const { p, toTex1x, size1x } = rig[part.name]
    const pivotJ = p.root ? J.hip : (p.pivotJoint ?? p.parentJoint)
    const pivot = toTex1x(pivotJ)
    let line = `${part.name}: size [${Math.round(size1x[0])}, ${Math.round(size1x[1])}], pivot ${fmt(pivot)}`
    if (!p.root) {
      const parent = p.parentName ? rig[p.parentName] : torso
      line += `, attach@${p.parentName ?? 'torso'} ${fmt(parent.toTex1x(p.parentJoint))}`
    }
    console.log(line)
  }
  const half = S2X / 2 // 源图 → 1x 世界
  console.log(`heightToHip: ${r5((J.soleY - J.hip[1]) * half)}`)
  console.log(`IK 腿长(1x,sole 模型): L1=${r5(Math.hypot(J.knee[0] - J.hip[0], J.knee[1] - J.hip[1]) * half)}  L2(膝→鞋底)=${r5(Math.hypot(J.ankle[0] - J.knee[0], J.soleY - J.knee[1]) * half)}`)
  console.log(`角色 1x 视觉高: ${r5((J.soleY - J.topY) * half)}`)
}

run().catch(e => { console.error(e); process.exit(1) })
