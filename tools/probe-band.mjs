// 背景图局部带 + y 标尺(读走道面上沿用)。用法: node tools/probe-band.mjs <图> <out.jpg> <top> [left] [w] [h]
import sharp from 'sharp'

const [file, out, topS, leftS = '300', wS = '900', hS = '180'] = process.argv.slice(2)
const top = +topS, left = +leftS, w = +wS, h = +hS
const buf = await sharp(file).extract({ left, top, width: w, height: h }).resize(w * 2).png().toBuffer()
let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w * 2}" height="${h * 2}">`
for (let i = 0; i * 20 <= h; i++) {
  const y = i * 20 * 2
  s += `<line x1="0" y1="${y}" x2="${w * 2}" y2="${y}" stroke="#ff2020" stroke-width="1" opacity="0.8"/>`
  s += `<text x="4" y="${y + 15}" font-size="16" fill="#ff2020">${top + i * 20}</text>`
}
s += '</svg>'
await sharp(buf).composite([{ input: Buffer.from(s), top: 0, left: 0 }]).jpeg({ quality: 90 }).toFile(out)
console.log('band ->', out)
