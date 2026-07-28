// 生物A母本关节测量探针:原图叠 100px 网格(百位线加粗),供人眼读关节坐标;
// 另输出关键区域 2x 放大裁片(肩环/髋尾根/膝踝脚/肘爪)细读。
import sharp from 'sharp'

const SRC = 'docs/风格参考/参考46-生物A母本.png'
const OUT = 'tmp-cuts'
const W = 1086, H = 1448

const grid = () => {
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`
  for (let x = 0; x <= W; x += 50) {
    const major = x % 100 === 0
    s += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${major ? '#ff2020' : '#ff9090'}" stroke-width="${major ? 2 : 0.7}" opacity="0.55"/>`
    if (major) s += `<text x="${x + 3}" y="16" font-size="15" fill="#ff2020">${x}</text>`
  }
  for (let y = 0; y <= H; y += 50) {
    const major = y % 100 === 0
    s += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${major ? '#2040ff' : '#90a0ff'}" stroke-width="${major ? 2 : 0.7}" opacity="0.55"/>`
    if (major) s += `<text x="3" y="${y + 16}" font-size="15" fill="#2040ff">${y}</text>`
  }
  s += '</svg>'
  return Buffer.from(s)
}

const img = sharp(SRC)
await img.clone().composite([{ input: grid(), top: 0, left: 0 }]).jpeg({ quality: 88 }).toFile(`${OUT}/bio-grid.jpg`)

const crops = [
  ['bio-c-shoulder', 560, 140, 520, 420],  // 接驳环+肩+胸眼
  ['bio-c-hip',      380, 520, 420, 360],  // 髋+尾根+臀
  ['bio-c-leg',      380, 880, 460, 420],  // 膝+踝+长脚掌
  ['bio-c-arm',      660, 560, 420, 620],  // 臂中段+肘+爪
]
for (const [name, left, top, w, h] of crops) {
  await img.clone().extract({ left, top, width: w, height: h }).resize(w * 2)
    .composite([{ input: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w * 2}" height="${h * 2}">` +
      Array.from({ length: Math.floor(w / 50) + 1 }, (_, i) =>
        `<line x1="${i * 100}" y1="0" x2="${i * 100}" y2="${h * 2}" stroke="#ff2020" stroke-width="1" opacity="0.5"/>` +
        `<text x="${i * 100 + 2}" y="14" font-size="13" fill="#ff2020">${left + i * 50}</text>`).join('') +
      Array.from({ length: Math.floor(h / 50) + 1 }, (_, i) =>
        `<line x1="0" y1="${i * 100}" x2="${w * 2}" y2="${i * 100}" stroke="#2040ff" stroke-width="1" opacity="0.5"/>` +
        `<text x="2" y="${i * 100 + 14}" font-size="13" fill="#2040ff">${top + i * 50}</text>`).join('') +
      '</svg>'), top: 0, left: 0 }])
    .jpeg({ quality: 88 }).toFile(`${OUT}/${name}.jpg`)
}
console.log('probe done -> tmp-cuts/bio-grid.jpg + 4 crops')
