// highlight.ts — 精简版 highlight.js(core + 常用语言),给 markdown 代码块 / Read 文件 / Bash 命令上色。
// 配色由 theme/vscode.css 的 .hljs-* 规则映射到 VSCode Dark Modern 的 token 颜色(贴近 vscode 深色风)。
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import go from 'highlight.js/lib/languages/go'
import json from 'highlight.js/lib/languages/json'
import python from 'highlight.js/lib/languages/python'
import cssLang from 'highlight.js/lib/languages/css'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import markdown from 'highlight.js/lib/languages/markdown'
import diff from 'highlight.js/lib/languages/diff'
import ini from 'highlight.js/lib/languages/ini'
import sql from 'highlight.js/lib/languages/sql'
import dockerfile from 'highlight.js/lib/languages/dockerfile'

const LANGS: Record<string, Parameters<typeof hljs.registerLanguage>[1]> = {
  bash,
  javascript,
  typescript,
  go,
  json,
  python,
  css: cssLang,
  xml,
  yaml,
  markdown,
  diff,
  ini,
  sql,
  dockerfile,
}
for (const [name, def] of Object.entries(LANGS)) hljs.registerLanguage(name, def)

// 常见别名/扩展名 → 已注册语言。
const ALIAS: Record<string, string> = {
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  vue: 'xml',
  html: 'xml',
  htm: 'xml',
  svg: 'xml',
  xml: 'xml',
  yml: 'yaml',
  md: 'markdown',
  markdown: 'markdown',
  golang: 'go',
  py: 'python',
  toml: 'ini',
  conf: 'ini',
  env: 'ini',
  dockerfile: 'dockerfile',
  patch: 'diff',
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'))
}

// hlLang — 把语言名/别名规整成已注册语言,未知返回 null(→ 不高亮,纯转义)。
export function hlLang(lang?: string | null): string | null {
  if (!lang) return null
  const l = lang.toLowerCase().trim()
  const m = ALIAS[l] || l
  return hljs.getLanguage(m) ? m : null
}

// langFromPath — 由文件名后缀推断语言。
export function langFromPath(path?: string | null): string | null {
  if (!path) return null
  const base = path.split('/').pop() || path
  if (/^dockerfile$/i.test(base)) return 'dockerfile'
  const ext = base.includes('.') ? base.split('.').pop() : ''
  return hlLang(ext)
}

// hl — 返回高亮后的安全 HTML(highlight.js 自带转义);语言未知则只转义不上色。绝不抛。
export function hl(code: string, lang?: string | null): string {
  const l = hlLang(lang)
  if (!l) return escapeHtml(code)
  try {
    return hljs.highlight(code, { language: l, ignoreIllegals: true }).value
  } catch {
    return escapeHtml(code)
  }
}
