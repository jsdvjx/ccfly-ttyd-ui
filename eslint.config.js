import js from '@eslint/js'
import ts from 'typescript-eslint'
import vue from 'eslint-plugin-vue'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

export default ts.config(
  { ignores: ['dist', 'node_modules', '*.config.js', '*.config.ts'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: ts.parser },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // 单词组件名:App(根)、Login(登录页)、Workspace(单节点工作区)、chat 的 Transcript/Md/Row/Notice 语义清晰,放行。
      'vue/multi-word-component-names': [
        'error',
        { ignores: ['App', 'Login', 'Workspace', 'Transcript', 'Md', 'Row', 'Notice'] },
      ],
    },
  },
  // 控制字符正则(ANSI \x1b、bracketed paste、PTY 模拟字节)是读屏/发送层的本质,关掉该规则。
  // parseContext 剥 /context stdout 的 ANSI 着色,同属此类。
  {
    files: ['src/screen.ts', 'src/send/**/*.ts', 'src/transcript/parseContext.ts', 'test/**/*.ts'],
    rules: { 'no-control-regex': 'off' },
  },
  // 正则里的 NBSP(U+00A0)是 claude 输入行/footer 的真实分隔符;放过正则内的,正文意外 NBSP 仍拦。
  {
    files: ['src/screen.ts', 'src/state/detectors/busy.ts'],
    rules: { 'no-irregular-whitespace': ['error', { skipRegExps: true, skipComments: true }] },
  },
  // DocView / chat 的 Md 渲染的是 markdown-it 输出,v-html 可接受。
  {
    files: [
      'src/DocView.vue',
      'src/components/chat/blocks/Md.vue',
      'src/components/chat/blocks/CodeView.vue',
      'src/components/chat/blocks/BashCard.vue',
      'src/components/chat/blocks/ToolRow.vue', // 行内 SVG 图标(本地静态串)
    ],
    rules: { 'vue/no-v-html': 'off' }, // highlight.js / markdown-it 输出已转义
  },
  // e2e 脚本与 .mjs 在 node 下跑,用 node 全局(process/console 等)。
  {
    files: ['e2e/**', '**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
  prettier,
)
