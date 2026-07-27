// 新武器 armgun 切件(多武器系统,2026-07-25):每张"同角色持新枪"母本只切一件 armgun
// (双小臂+双手+枪整体,换枪=换整图)。肘点=pivot(attach 在 arm_upper 上不随枪变);muzzle=枪口尖。
// 身高归一化:各母本角色身高不同,统一缩放到现役角色 2x 身高(918×0.218≈200.1px),枪与身体等比。
// 用法: node tools/cut-armguns.mjs preview  → tmp-cuts/armgun-overlay-<key>.jpg(多边形+肘/枪口十字,人眼校版)
//       node tools/cut-armguns.mjs final    → public/assets/img/player_armgun_<key>.png + 打印 rigs.json armguns 数据
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'

const OUT = 'public/assets/img'
const TARGET_H2X = 918 * 0.218 // 现役角色 2x 身高(cut-player 基准)
const mode = process.argv[2] ?? 'preview'
const SP = 'docs/风格参考' // 母本归档位(参考32/33/34)

const WEAPONS = [
  {
    key: 'ricochet',
    src: `${SP}/参考38-反射枪armgun母本.png`,
    headTopY: 104, soleY: 1330,
    elbow: [300, 525], muzzle: [1005, 488],
    // 枪尾贴胸:左缘从肘部起(胸甲在 x<440 y<470,勿越);腰甲在 y>600 x<520,底缘贴前臂/手套下沿走
    poly: [[262, 555], [255, 500], [280, 470], [330, 460], [370, 452], [425, 432], [480, 422], [535, 415],
      [558, 366], [810, 358], [850, 395], [905, 408], [950, 420], [990, 440], [1008, 448], [1014, 470],
      [1014, 510], [1005, 532], [990, 545], [955, 562], [900, 580], [840, 592], [780, 602], [700, 615],
      [620, 612], [540, 600], [480, 585], [420, 575], [340, 572], [285, 565]],
  },
  {
    key: 'supercannon',
    src: `${SP}/参考34-超级大炮母本.png`,
    headTopY: 100, soleY: 1330,
    elbow: [395, 540], muzzle: [1030, 470],
    // 炮尾贴胸:左缘收到 ~430(被胸甲遮住的炮尾不切,否则泛洪清不掉的胸甲像素会跟着炮转=穿帮)
    poly: [[378, 565], [372, 512], [386, 470], [420, 430], [440, 356], [640, 288], [850, 292], [930, 332],
      [1012, 372], [1052, 402], [1060, 470], [1052, 548], [982, 602], [900, 642], [800, 664], [698, 660],
      [600, 640], [520, 612], [465, 585], [420, 575]],
  },
  {
    key: 'shotgun',
    src: `${SP}/参考32-霰弹枪母本.png`,
    headTopY: 96, soleY: 1345,
    elbow: [432, 500], muzzle: [988, 452],
    poly: [[398, 468], [420, 424], [468, 396], [540, 386], [700, 392], [985, 398], [1002, 420], [1004, 478],
      [935, 498], [858, 558], [795, 578], [700, 568], [615, 556], [556, 548], [478, 548], [430, 532], [398, 506]],
  },
  {
    key: 'rpg',
    src: `${SP}/参考33-火箭筒母本.png`,
    headTopY: 100, soleY: 1330,
    elbow: [428, 502], muzzle: [986, 424],
    poly: [[398, 506], [396, 458], [364, 450], [362, 374], [560, 350], [636, 316], [842, 314], [874, 354],
      [986, 360], [1008, 396], [1008, 468], [934, 492], [852, 532], [768, 548], [648, 540], [560, 536],
      [478, 542], [430, 526]],
  },
]

const bbox = (poly, pad = 2) => {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1])
  const x = Math.max(0, Math.min(...xs) - pad), y = Math.max(0, Math.min(...ys) - pad)
  return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y }
}

const polySvg = (poly, box, w, h) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${box.w} ${box.h}">` +
  `<polygon points="${poly.map(([x, y]) => `${x - box.x},${y - box.y}`).join(' ')}" fill="#fff"/></svg>`)

// —— 泛洪清背景/除尘:与 cut-player.mjs 同款(见其注释) ——
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
  for (let i = 0; i < W * H; i++) if (seen[i] && seen[i] !== keep) data[i * 4 + 3] = 0
}

async function run() {
  mkdirSync('tmp-cuts', { recursive: true })
  mkdirSync(OUT, { recursive: true })

  for (const w of WEAPONS) {
    const meta = await sharp(w.src).metadata()
    if (mode === 'preview') {
      let ov = `<polygon points="${w.poly.map((p) => p.join(',')).join(' ')}" fill="none" stroke="#00e5ff" stroke-width="3"/>`
      for (const [k, v] of [['elbow', w.elbow], ['muzzle', w.muzzle]]) {
        ov += `<line x1="${v[0] - 14}" y1="${v[1]}" x2="${v[0] + 14}" y2="${v[1]}" stroke="#ff2b2b" stroke-width="3"/>` +
          `<line x1="${v[0]}" y1="${v[1] - 14}" x2="${v[0]}" y2="${v[1] + 14}" stroke="#ff2b2b" stroke-width="3"/>` +
          `<text x="${v[0] + 16}" y="${v[1] - 8}" font-size="24" fill="#ff2b2b">${k}</text>`
      }
      for (const y of [w.headTopY, w.soleY]) {
        ov += `<line x1="0" y1="${y}" x2="${meta.width}" y2="${y}" stroke="#7cff6b" stroke-width="2" stroke-dasharray="10,6"/>`
      }
      const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${meta.width}" height="${meta.height}">${ov}</svg>`)
      await sharp(w.src).composite([{ input: svg }]).jpeg({ quality: 88 }).toFile(`tmp-cuts/armgun-overlay-${w.key}.jpg`)
      console.log(`preview → tmp-cuts/armgun-overlay-${w.key}.jpg`)
      continue
    }
    // final:裁 bbox → 多边形蒙版 → 身高归一化缩放 → 泛洪清背景 → 除尘 → 输出 + 打印 rigs 数据
    const S = TARGET_H2X / (w.soleY - w.headTopY)
    const box = bbox(w.poly, 4)
    const outW = Math.round(box.w * S), outH = Math.round(box.h * S)
    const cut = await sharp(w.src)
      .extract({ left: box.x, top: box.y, width: box.w, height: box.h })
      .resize(outW, outH)
      .composite([{ input: polySvg(w.poly, box, outW, outH), blend: 'dest-in' }])
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    floodRemoveBg(cut.data, cut.info.width, cut.info.height)
    dedust(cut.data, cut.info.width, cut.info.height)
    const tex = `player_armgun_${w.key}`
    await sharp(cut.data, { raw: cut.info }).png().toFile(`${OUT}/${tex}.png`)
    // **rigs.json 的 size/pivot/muzzle 一律是世界尺寸(1x),贴图是 2x**(CharacterRig 统一 setScale(0.5)):
    // 这里量出来的是 2x 贴图像素,输出前必须 ×0.5 折算,否则 getMuzzle 把 (muzzle-pivot) 当世界偏移用,
    // 枪口点会飞到真炮口外**一倍远**(2026-07-25 用户点名"新武器的枪口火焰离枪口太远",三把新枪全中招;
    // 老管线 cut-player.mjs 的步枪比值≈2 是对的,对照它验收)
    const H = 0.5
    const r1 = (v) => +(v * H).toFixed(2)
    const px = +((w.elbow[0] - box.x) * S).toFixed(1), py = +((w.elbow[1] - box.y) * S).toFixed(1)
    const mx = +((w.muzzle[0] - box.x) * S).toFixed(1), my = +((w.muzzle[1] - box.y) * S).toFixed(1)
    console.log(`${OUT}/${tex}.png  ${outW}x${outH} (贴图2x;下面的 rigs 数据已折算为世界尺寸)`)
    console.log(`  "${w.key}": { "tex": "${tex}", "size": [${r1(outW)}, ${r1(outH)}], "pivot": [${r1(px)}, ${r1(py)}], "muzzle": [${r1(mx)}, ${r1(my)}] }`)
  }
}

run()
