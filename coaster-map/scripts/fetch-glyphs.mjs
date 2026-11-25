// 一次性脚本:从 openmaptiles/fonts 仓库 tree JSON 中挑出所需字形区间,
// 通过 GitHub blob API 下载 base64 内容并解码到 public/glyphs。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const tree = JSON.parse(readFileSync('./scripts/fonttree.json', 'utf8'))
const FONT = 'Klokantech Noto Sans CJK Regular'
const WANT = new Set([
  '0-255',
  '19968-20223', '20992-21247', '21248-21503',
  '24320-24575', '24576-24831',
  '26112-26367', '26368-26623', '26624-26879',
  '27392-27647', '27648-27903', '27904-28159',
  '28672-28927', '28928-29183', '29440-29695',
  '29952-30207', '31232-31487', '32256-32511',
  '32512-32767', '33280-33535', '36096-36351',
  '38400-38655', '38656-38911', '38912-39167',
  '40448-40703', '40704-40959'
])
const OUT = 'public/glyphs'
mkdirSync(OUT, { recursive: true })

const targets = tree.tree.filter((e) => {
  if (e.type !== 'blob' || !e.path.startsWith(FONT + '/')) return false
  const range = e.path.slice(FONT.length + 1).replace('.pbf', '')
  return WANT.has(range)
})
console.log('targets:', targets.length)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ok = 0
for (const t of targets) {
  const range = t.path.slice(FONT.length + 1)
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(
      `https://api.github.com/repos/openmaptiles/fonts/git/blobs/${t.sha}`,
      { headers: { 'User-Agent': 'glyph-fetch', Accept: 'application/vnd.github+json' } }
    )
    if (res.status === 200) {
      const data = await res.json()
      writeFileSync(`${OUT}/${range}`, Buffer.from(data.content, 'base64'))
      ok++
      break
    }
    console.warn('retry', range, res.status)
    await sleep(1500 * (attempt + 1))
  }
}
console.log('done', ok, '/', targets.length)
