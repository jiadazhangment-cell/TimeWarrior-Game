import { readFileSync, writeFileSync } from 'node:fs'
const [, , SRC, OUT] = process.argv
let s = readFileSync(SRC, 'utf8')
const kept = []
for (const ln of s.split(/\r?\n/)) {
  if (/^import\s/.test(ln)) {
    const m = ln.match(/^import\s+(\{[^}]*\}|\w+)\s+from/)
    if (m) {
      const what = m[1]
      if (what.startsWith('{')) kept.push(`const { ${what.slice(1, -1).split(',').map((x) => x.trim()).filter(Boolean).join(', ')} } = STUBS`)
      else if (what === 'Phaser') kept.push('const Phaser = STUBS.Phaser')
      else kept.push(`const ${what} = STUBS.${what}`)
      continue
    }
  }
  kept.push(ln)
}
s = kept.join('\n').replace(/import\.meta\.env\.DEV/g, 'HARNESS_DEV')
writeFileSync(OUT, `import { STUBS, HARNESS_DEV } from './stubs.mjs'\n` + s, 'utf8')
console.log('written', OUT)
