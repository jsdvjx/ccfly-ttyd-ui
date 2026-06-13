<script setup lang="ts">
import { computed } from 'vue'
import MarkdownIt from 'markdown-it'
import raw from '../docs/jsonl-format.md?raw'

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w一-龥]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const md = new MarkdownIt({ html: false, linkify: true, breaks: false })
// 给标题加 id,供 TOC 锚点跳转
md.renderer.rules.heading_open = (tokens, idx, options, _env, self) => {
  const text = tokens[idx + 1]?.content ?? ''
  tokens[idx].attrSet('id', slug(text))
  return self.renderToken(tokens, idx, options)
}

const html = computed(() => md.render(raw))

interface TocItem {
  level: number
  text: string
  id: string
}
const toc = computed<TocItem[]>(() => {
  const out: TocItem[] = []
  for (const line of raw.split('\n')) {
    const m = /^(#{2,3}) (.+)$/.exec(line)
    if (m) {
      const text = m[2].replace(/`/g, '')
      out.push({ level: m[1].length, text, id: slug(m[2]) })
    }
  }
  return out
})
</script>

<template>
  <div class="wrap">
    <nav class="toc">
      <div class="toc-head">目录</div>
      <a v-for="t in toc" :key="t.id" :href="'#' + t.id" :class="'lv' + t.level">{{ t.text }}</a>
    </nav>
    <article class="doc markdown-body" v-html="html" />
  </div>
</template>

<style scoped>
.wrap {
  display: flex;
  height: 100%; /* 填满 #app(文档已锁滚,见 style.css) */
}
.toc {
  width: 280px;
  flex: none;
  overflow: auto;
  padding: 16px 12px;
  border-right: 1px solid #1f2630;
  background: #0d1118;
}
.toc-head {
  color: #9ca3af;
  font-size: 12px;
  font-weight: 700;
  margin-bottom: 8px;
}
.toc a {
  display: block;
  color: #94a3b8;
  text-decoration: none;
  font-size: 12.5px;
  line-height: 1.5;
  padding: 2px 6px;
  border-radius: 4px;
}
.toc a:hover {
  background: #1e293b;
  color: #e5e7eb;
}
.toc a.lv3 {
  padding-left: 18px;
  color: #6b7280;
}
.doc {
  flex: 1;
  overflow: auto;
  padding: 32px 48px;
}
</style>

<style>
/* markdown-body:深色排版(非 scoped,作用于 v-html 内容) */
.markdown-body {
  max-width: 960px;
  margin: 0 auto;
  color: #d6deeb;
  font-size: 15px;
  line-height: 1.7;
}
.markdown-body h1 {
  font-size: 28px;
  border-bottom: 1px solid #1f2630;
  padding-bottom: 12px;
}
.markdown-body h2 {
  font-size: 22px;
  margin-top: 40px;
  border-bottom: 1px solid #1f2630;
  padding-bottom: 8px;
}
.markdown-body h3 {
  font-size: 18px;
  margin-top: 28px;
  color: #93c5fd;
}
.markdown-body h4 {
  font-size: 15px;
  margin-top: 20px;
  color: #c4b5fd;
}
.markdown-body a {
  color: #60a5fa;
}
.markdown-body code {
  background: #161b24;
  padding: 1.5px 6px;
  border-radius: 4px;
  font-size: 13px;
  font-family: Menlo, Consolas, monospace;
  color: #f0abfc;
}
.markdown-body pre {
  background: #0b0e14;
  border: 1px solid #1f2630;
  border-radius: 8px;
  padding: 14px 16px;
  overflow: auto;
}
.markdown-body pre code {
  background: none;
  padding: 0;
  color: #cbd5e1;
}
.markdown-body table {
  border-collapse: collapse;
  width: 100%;
  margin: 14px 0;
  font-size: 13.5px;
}
.markdown-body th,
.markdown-body td {
  border: 1px solid #283142;
  padding: 6px 10px;
  text-align: left;
  vertical-align: top;
}
.markdown-body th {
  background: #161b24;
  color: #e5e7eb;
}
.markdown-body tr:nth-child(even) td {
  background: #0f141c;
}
.markdown-body blockquote {
  border-left: 3px solid #334155;
  margin: 14px 0;
  padding: 4px 14px;
  color: #94a3b8;
  background: #0f141c;
}
.markdown-body hr {
  border: none;
  border-top: 1px solid #1f2630;
  margin: 28px 0;
}
</style>
