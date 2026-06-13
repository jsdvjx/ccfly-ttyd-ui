// CDP 冒烟 e2e(集成模式):打真实 ccfly,选一个会话,跑通 /context(jsonl)+ /usage(读屏)。
// 前置:ccfly 在跑(默认 7699;E2E_URL 覆盖),且存在一个活的 claude 会话(默认选 ccfly-ttyd-ui)。
//   运行:E2E_URL=http://127.0.0.1:7699 node e2e/smoke.mjs   (npm run e2e)
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL = process.env.E2E_URL || 'http://127.0.0.1:7699/'
const PICK = process.env.E2E_SESSION || 'ccfly-ttyd-ui' // 会话列表里按文本挑(cwd/title 命中)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1600, height: 900 })
await page.goto(URL, { waitUntil: 'networkidle2' })
await sleep(2500)

const picked = await page.evaluate((t) => {
  const it = [...document.querySelectorAll('.item')].find((e) => e.textContent.includes(t))
  if (!it) return false
  it.click()
  return true
}, PICK)
console.log(`选会话「${PICK}」:`, picked)
await sleep(6000) // 等 term + jsonl 连上

async function runSlash(label, want) {
  await page.evaluate((t) => {
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t)?.click()
  }, label)
  let result = '',
    err = ''
  for (let i = 0; i < 30; i++) {
    await sleep(500)
    result = await page.$eval('.slash .out', (el) => el.textContent).catch(() => '')
    err = await page.$eval('.slash .err', (el) => el.textContent).catch(() => '')
    if (result || err) break
  }
  const ok = !err && want.test(result)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}  ${err ? 'err=' + err : ''}`)
  return ok
}

const a = await runSlash('/context', /Context Usage|Free space|tokens/i)
await page.keyboard.press('Escape').catch(() => {})
await sleep(800)
const b = await runSlash('/usage', /Total cost|% of your usage|Usage:.*input/i)

await browser.close()
process.exit(picked && a && b ? 0 : 1)
