// 切件管线 v3 —— 母本:docs/风格参考/参考9-母本v2.png(1122x1402,用户用 ChatGPT Imagine 2 生成)
// 与 v2 的本质区别(修"关节断开/持枪怪"):
//   1. 关节坐标只在 J 里声明一次,部件 pivot 与父件 attach 由同一源点经各自变换自动换算——对齐由构造保证;
//   2. 每个部件的多边形在关节处伸出"圆帽"与邻件重叠(约40px源图≈5px游戏1x),旋转任意角度不露缝;
//   3. 背景去除=从多边形边界泛洪(只清与边界连通的亮色瓷砖),装甲内部高光(可达0.7亮度)不会被打穿;
//   4. 腿部贴图旋转到"髋→膝垂直"标准姿态,旋转矩阵方向用探针图实测,不猜库的约定。
// 用法: node tools/cut-player.mjs preview  → tmp-cuts/polys-overlay.jpg(全部多边形+关节点叠加,人眼校版)
//       node tools/cut-player.mjs final    → public/assets/img/*.png + 打印可直接抄进 rigs.json 的数据
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'

const SRC = 'docs/风格参考/参考9-母本v2.png'
const SRC_LEGS = 'docs/风格参考/参考11-素体母本黑红.png' // 立正直腿素体(899x1750):腿部专用母本
const OUT = 'public/assets/img'
const S2X = 0.26 // 主母本:角色源高约769px(头顶262→鞋底1031) → 1x高约100px
const S2X_LEGS = 0.1215 // 腿部母本:髋→鞋底823px → 1x腿长约50(髋高48+微屈)
const mode = process.argv[2] ?? 'preview'

// —— 关节与基准点(源图像素坐标,唯一事实来源) ——
const J = {
  neck:    [515, 438],
  shoulder:[455, 475],
  elbow:   [447, 560],   // 大臂/小臂分界(两段式手臂:抬枪时大臂带肘部一起动)
  hipMid:  [410, 660],   // 躯干根(两髋中点)
  muzzle:  [943, 463],
  headTopY: 264, soleY: 1030,
  // —— 以下关节属于腿部母本(参考11)坐标系 ——
  hipN:   [435, 785], kneeN: [425, 1140], ankleN: [395, 1450], soleNY: 1608,
}

// —— 部件定义 ——
// poly: 源图多边形(含关节圆帽重叠区); vert:[a,b] 旋转贴图使 a→b 垂直向下; erase: 橡皮擦多边形(清砖缝残留)
const PARTS = [
  { name: 'player_head', z: 6, parentJoint: J.neck,
    poly: [[420,335],[432,292],[468,272],[522,264],[572,282],[622,310],[652,342],[660,378],[648,404],[610,415],[560,418],[545,434],[528,456],[478,458],[442,438],[420,398]] },

  // 躯干含"静止时被枪/臂盖住"的胸区(枪托+上臂一并烤进躯干):抬枪旋开时露出的是完整躯干,
  // 深色臂影贴在深色胸甲上,游戏缩放下不可见——否则胸腔是空洞(用户实测抓到的缺陷)
  { name: 'player_torso', z: 5, root: true,
    poly: [[332,258],[352,254],[358,332],[420,350],[452,338],[470,360],[472,412],[540,416],[556,470],[552,560],[530,624],[548,668],[542,712],[470,724],[420,718],[352,716],[300,706],[246,694],[238,602],[204,592],[199,426],[222,340],[290,318],[326,330]] },

  // 两段式手臂:大臂(肩甲+上臂+肘帽)绕肩按 aimFactor 部分随瞄;小臂+双手+枪绕肘全额随瞄。
  // 抬枪时肘部真的在动("只有小臂动像贴图"的修复);肘部圆帽重叠防露缝
  { name: 'player_arm_upper', z: 10, parentJoint: J.shoulder, aim: true, aimFactor: 0.55,
    poly: [[380,466],[424,452],[454,462],[474,490],[480,532],[472,576],[448,614],[408,618],[380,596],[371,540],[372,498]] },

  { name: 'player_armgun', z: 9, parentJoint: J.elbow, parentName: 'player_arm_upper', aim: true, muzzle: J.muzzle,
    poly: [[424,414],[622,408],[628,356],[782,352],[786,410],[905,418],[946,428],[948,492],[880,528],[795,558],[788,600],[762,655],[688,652],[640,624],[556,622],[518,602],[486,590],[452,548],[450,506],[424,500]] },

  // 腿改切自"立正直腿素体"(参考11):单腿本身是标准挺直的装甲腿,
  // 不再用战斗站姿里带烘焙弯曲的腿(用户:"单条腿不好看/穿战服的腿不是这样")
  { name: 'player_thigh_f', z: 7, src: SRC_LEGS, s2x: S2X_LEGS, parentJoint: J.hipN, vert: [J.hipN, J.kneeN],
    poly: [[382,730],[490,732],[508,800],[512,935],[502,1080],[498,1185],[352,1185],[345,1050],[350,900],[358,790]] },

  { name: 'player_shin_f', z: 8, src: SRC_LEGS, s2x: S2X_LEGS, parentJoint: J.kneeN, parentName: 'player_thigh_f', vert: [J.kneeN, J.ankleN],
    poly: [[360,1092],[492,1090],[488,1200],[478,1330],[472,1420],[545,1490],[562,1560],[554,1610],[286,1612],[290,1540],[330,1470],[345,1330],[352,1200]] },

  // 后腿=前腿贴图的调暗副本(两腿形状一致,走路不穿帮;调暗=天然纵深)。
  // 骨架里 thigh_b/shin_b 用前腿的 pivot/size,attach 仍挂在躯干的 hipB 点
  { name: 'player_thigh_b', copyFrom: 'player_thigh_f', darken: 0.8 },
  { name: 'player_shin_b',  copyFrom: 'player_shin_f',  darken: 0.8 },
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

// 从多边形边界泛洪清除亮背景:亮(>0.55)且低饱和的像素、与透明区/图框 4 连通者 → alpha 0
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
  // 1px 羽化:紧贴被清除区的残余亮像素减半透明,软化锯齿
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = (y * W + x) * 4
    if (data[i + 3] === 0) continue
    const [l] = lumSat(i)
    if (l > 0.5 && (data[i - 1] === 0 || data[i + 7] === 0 || data[(i - W * 4) + 3] === 0 || data[(i + W * 4) + 3] === 0)) {
      data[i + 3] = Math.min(data[i + 3], 110)
    }
  }
}

// 除尘:清掉与主体不相连的小碎块(泛洪清背景后可能残留的瞄具残片/浮尘)
function dedust(data, W, H) {
  const seen = new Uint32Array(W * H) // 0=未访问,否则=组号
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
  // 每个部件应是单一连通体:只留最大块,其余(瞄具残片/浮尘/羽化孤岛)全清
  const keep = areas.indexOf(Math.max(...areas))
  for (let i = 0; i < W * H; i++) {
    if (seen[i] && seen[i] !== keep) data[i * 4 + 3] = 0
  }
}

// 实测 sharp.rotate 的方向约定:3x1 探针,右端红点,rotate(90) 后看红点位置
async function probeRotationSign() {
  const probe = Buffer.from([0, 0, 0, 255, 0, 0, 0, 255, 255, 0, 0, 255])
  const { data, info } = await sharp(probe, { raw: { width: 3, height: 1, channels: 4 } })
    .rotate(90, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).raw().toBuffer({ resolveWithObject: true })
  const bottomRed = data[((info.height - 1) * info.width + 0) * 4] > 200
  return bottomRed ? 1 : -1 // 1: rotate(+θ)=顺时针(屏幕坐标系 y 向下)
}

const rot = (p, c, cNew, rad) => {
  const dx = p[0] - c[0], dy = p[1] - c[1]
  return [cNew[0] + dx * Math.cos(rad) - dy * Math.sin(rad), cNew[1] + dx * Math.sin(rad) + dy * Math.cos(rad)]
}

async function run() {
  mkdirSync('tmp-cuts', { recursive: true })
  mkdirSync(OUT, { recursive: true })

  if (mode === 'preview') {
    // 全图叠加所有多边形 + 关节十字,一张图校版
    const colors = ['#00e5ff', '#ffd166', '#ff6b6b', '#7cff6b', '#e07cff', '#6b9cff', '#ff9d2e']
    let overlay = ''
    PARTS.filter(p => p.poly).forEach((p, i) => {
      overlay += `<polygon points="${p.poly.map(pt => pt.join(',')).join(' ')}" fill="none" stroke="${colors[i % colors.length]}" stroke-width="3"/>`
      overlay += `<text x="${p.poly[0][0]}" y="${p.poly[0][1] - 6}" font-size="22" fill="${colors[i % colors.length]}">${p.name.replace('player_', '')}</text>`
    })
    for (const [k, v] of Object.entries(J)) {
      if (!Array.isArray(v)) continue
      overlay += `<line x1="${v[0] - 12}" y1="${v[1]}" x2="${v[0] + 12}" y2="${v[1]}" stroke="#ff2b2b" stroke-width="3"/>` +
        `<line x1="${v[0]}" y1="${v[1] - 12}" x2="${v[0]}" y2="${v[1] + 12}" stroke="#ff2b2b" stroke-width="3"/>` +
        `<text x="${v[0] + 14}" y="${v[1] - 6}" font-size="20" fill="#ff2b2b">${k}</text>`
    }
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1122" height="1402">${overlay}</svg>`)
    await sharp(SRC).composite([{ input: svg }]).jpeg({ quality: 90 }).toFile('tmp-cuts/polys-overlay.jpg')
    console.log('preview → tmp-cuts/polys-overlay.jpg')
    return
  }

  // final
  const sign = await probeRotationSign()
  const rig = {}
  for (const p of PARTS) {
    if (p.copyFrom) { // 调暗副本:同贴图同 pivot,骨架里挂到各自关节
      const buf = await sharp(`${OUT}/${p.copyFrom}.png`).modulate({ brightness: p.darken ?? 1 }).png().toBuffer()
      await sharp(buf).toFile(`${OUT}/${p.name}.png`)
      rig[p.name] = rig[p.copyFrom]
      console.log('final', p.name, `(copy of ${p.copyFrom}, darken ${p.darken ?? 1})`)
      continue
    }
    const box = bbox(p.poly)
    const raw = await sharp(p.src ?? SRC).extract({ left: box.x, top: box.y, width: box.w, height: box.h })
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    // 1) 多边形外透明
    const masked = await sharp(raw.data, { raw: raw.info })
      .composite([{ input: polySvg(p.poly, box, '#ffffff'), blend: 'dest-in' }])
      .raw().toBuffer({ resolveWithObject: true })
    // 2) 泛洪清背景 + 羽化 + 除尘
    floodRemoveBg(masked.data, masked.info.width, masked.info.height)
    dedust(masked.data, masked.info.width, masked.info.height)
    // 3) 橡皮擦
    let buf = await sharp(masked.data, { raw: masked.info }).png().toBuffer()
    if (p.erase?.length) {
      const holes = p.erase.map(ep =>
        `<polygon points="${ep.map(([x, y]) => `${x - box.x},${y - box.y}`).join(' ')}" fill="#ffffff"/>`).join('')
      const eraseSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${box.w}" height="${box.h}">${holes}</svg>`)
      buf = await sharp(buf).composite([{ input: eraseSvg, blend: 'dest-out' }]).png().toBuffer()
    }
    // 4) 旋转到标准姿态(髋→膝垂直),并跟踪关节坐标变换
    let mapPoint = (pt) => [pt[0] - box.x, pt[1] - box.y] // 源图 → 当前贴图像素
    let size = { w: box.w, h: box.h }
    if (p.vert) {
      const [a, b] = p.vert
      const phi = Math.atan2(b[0] - a[0], b[1] - a[1]) // 相对竖直向下的偏角(+ = 朝前倾)
      // 消偏角需顺时针转 φ(y向下坐标系);sign 把"顺时针"换算成 sharp 的参数方向
      const deg = sign * phi * 180 / Math.PI
      const rotated = await sharp(buf).rotate(deg, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
      const meta = await sharp(rotated).metadata()
      const c = [box.w / 2, box.h / 2], cNew = [meta.width / 2, meta.height / 2]
      const rad = sign * deg * Math.PI / 180
      const prevMap = mapPoint
      mapPoint = (pt) => rot(prevMap(pt), c, cNew, rad)
      // 自检:旋转后 b 应正下方于 a
      const [ax] = mapPoint(a), [bx2] = mapPoint(b)
      if (Math.abs(ax - bx2) > 1.5) throw new Error(`${p.name}: 旋转自检失败 dx=${(bx2 - ax).toFixed(2)}`)
      buf = rotated
      size = { w: meta.width, h: meta.height }
    }
    // 5) 缩放到 2x 贴图
    const sc2 = p.s2x ?? S2X
    const w2 = Math.max(2, Math.round(size.w * sc2)), h2 = Math.max(2, Math.round(size.h * sc2))
    await sharp(buf).resize(w2, h2, { fit: 'fill' }).png().toFile(`${OUT}/${p.name}.png`)
    const scale = w2 / size.w
    const toTex1x = (pt) => { const m = mapPoint(pt); return [m[0] * scale / 2, m[1] * scale / 2] }
    rig[p.name] = { p, toTex1x, size1x: [w2 / 2, h2 / 2] }
    console.log('final', p.name, `${w2}x${h2} (1x=${Math.round(w2 / 2)}x${Math.round(h2 / 2)})`)
  }

  // 6) 输出 rigs.json 数据:pivot=自身关节,attach=父贴图上的同一关节(由同一源点换算,构造性对齐)
  console.log('\n—— rigs.json 数据(1x 像素,四舍五入到 0.5) ——')
  const r5 = (v) => Math.round(v * 2) / 2
  const fmt = (pt) => `[${r5(pt[0])}, ${r5(pt[1])}]`
  const torso = rig['player_torso']
  for (const part of PARTS) {
    if (part.copyFrom) continue
    const { p, toTex1x, size1x } = rig[part.name]
    const pivotJ = p.root ? J.hipMid : p.parentJoint
    const pivot = toTex1x(pivotJ)
    let line = `${part.name}: size [${Math.round(size1x[0])}, ${Math.round(size1x[1])}], pivot ${fmt(pivot)}`
    if (!p.root) {
      const parent = p.parentName ? rig[p.parentName] : torso
      line += `, attach@${p.parentName ?? 'torso'} ${fmt(parent.toTex1x(p.parentJoint))}`
    }
    if (p.muzzle) line += `, muzzle ${fmt(toTex1x(p.muzzle))}`
    console.log(line)
  }
  console.log('thigh_b/shin_b: 前腿副本,attach 手工定(骨盆收窄)')
  console.log(`heightToHip: ${r5((J.soleY - J.hipMid[1]) * S2X / 2)}`)
  console.log(`IK 腿长(1x): L1=${r5(Math.hypot(J.kneeN[0]-J.hipN[0], J.kneeN[1]-J.hipN[1]) * S2X_LEGS / 2)}  L2(膝→鞋底)=${r5(Math.hypot(J.ankleN[0]-J.kneeN[0], J.soleNY-J.kneeN[1]) * S2X_LEGS / 2)}`)
  console.log(`角色 1x 视觉高: ${r5((J.soleY - J.headTopY) * S2X / 2)}`)
}

run().catch(e => { console.error(e); process.exit(1) })
