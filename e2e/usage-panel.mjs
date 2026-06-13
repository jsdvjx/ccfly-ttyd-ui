// CDP 调试 /usage 富面板:选 idle 会话 → 点「/」→ 点 /usage → 逐秒观测面板 DOM 状态,
// 看卡在哪一阶段(loading / 行数 / 错误)。E2E_URL 指向 vite dev(集成代理到真 ccfly)。
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL =
  (process.env.E2E_URL || 'http://127.0.0.1:5173/') +
  '?sid=' +
  (process.env.E2E_SESSION || '3a019ae8-121d-4cb9-b353-ddf66a09d146')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
})
const page = await browser.newPage()
page.on('console', (m) => {
  const t = m.text()
  if (/usage|error|Error/i.test(t)) console.log('[console]', t.slice(0, 200))
})
await page.setViewport({ width: 1500, height: 900 })
await page.goto(URL, { waitUntil: 'networkidle2' })
await sleep(2500)

await sleep(6000) // ?sid= 深链已钉定会话;等 term + jsonl 连上

// 诊断:composer 当前形态
const diag = await page.evaluate(() => ({
  box: !!document.querySelector('.composer .box'),
  linkbar: document.querySelector('.composer .linkbar')?.textContent?.trim() || '',
  chip: document.querySelector('.stchip')?.textContent?.trim() || '',
  warn: document.querySelector('.composer .warn')?.textContent?.trim() || '',
  ics: [...document.querySelectorAll('button.ic')].map((b) => b.title),
  composer: !!document.querySelector('.composer'),
  chat: !!document.querySelector('.ccfly-chat'),
  body: document.body.innerText.slice(0, 200).replace(/\n/g, '⏎'),
}))
console.log('composer diag:', JSON.stringify(diag))
// 打开斜杠面板
await page.evaluate(() => {
  ;[...document.querySelectorAll('button.ic')].find((b) => b.title === '斜杠命令')?.click()
})
await sleep(600)
const rows = await page.evaluate(() => {
  return [...document.querySelectorAll('.slashrow .slashcmd')].map((e) => e.textContent).join(' ')
})
console.log('slash rows page1:', rows)
// 点 /usage 行(权重排序后应在首页;不在就先筛选)
let clicked = await page.evaluate(() => {
  const row = [...document.querySelectorAll('.slashrow')].find(
    (r) => r.querySelector('.slashcmd')?.textContent === '/usage',
  )
  if (!row) return false
  row.click()
  return true
})
if (!clicked) {
  await page.type('.slashfilter', 'usage')
  await sleep(400)
  clicked = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.slashrow')].find(
      (r) => r.querySelector('.slashcmd')?.textContent === '/usage',
    )
    if (!row) return false
    row.click()
    return true
  })
}
console.log('click /usage:', clicked)

// 逐秒观测 40s
for (let i = 0; i < 40; i++) {
  await sleep(1000)
  const st = await page.evaluate(() => ({
    loading: !!document.querySelector('.usgload'),
    lines: [...document.querySelectorAll('.usgrow .usgtext')].map((e) => e.textContent),
    err: document.querySelector('.selectwrap .selerr')?.textContent || '',
    head: document.querySelector('.selhd')?.textContent || '',
  }))
  console.log(`t=${i + 1}s loading=${st.loading} head=${st.head} lines=${st.lines.length} err=${st.err}`)
  if (st.err) break
}
// 等滚动收全文结束:行数连续 6 秒不变视为完成
let last = -1
let still = 0
for (let i = 0; i < 40 && still < 6; i++) {
  await sleep(1000)
  const n = await page.evaluate(() => document.querySelectorAll('.usgrow').length)
  still = n === last ? still + 1 : 0
  last = n
}
const fin = await page.evaluate(() => ({
  lines: [...document.querySelectorAll('.usgrow .usgtext')].map((e) => e.textContent),
  err: document.querySelector('.selectwrap .selerr')?.textContent || '',
}))
console.log('FINAL lines=' + fin.lines.length + (fin.err ? ' err=' + fin.err : ''))
console.log('  ' + fin.lines.join('\n  '))
await page.screenshot({ path: '/tmp/usage-panel.png' })
await browser.close()
