=== PLAN ===

# ccfly-ttyd-ui — VSCode-dark Chat/Transcript page (merged plan)

## 0. North star & what we reuse unchanged

Render a rich VSCode-dark transcript **from jsonl** (`useJsonl.events[]`) + terminal-derived **live state** (`sessionStatus`), while the xterm stays **mounted off-screen** as the _only_ live-state source and the _only_ send mechanism. Build a thin **rendering + composer** layer on top of the existing, deployed infra — change as little as possible.

Reuse with ZERO changes: `useJsonl` / `useLiveTerminal` / `useScreen` / `useSessions`; all of `src/state/*` (`sessionStatus` + detectors); all of `src/send/*` (`sendMessage` confirmed-send, `sendSlashCommand`, `commands`); `config.ts` seams; `idb.ts`. The only existing files touched are `Workspace.vue` (toggle + offscreen term), `config.ts` (add `imageUrl`), and `package.json` (deps).

Net-new is four layers, taken as the strongest idea from each design:

- **DATA port** (Design 1/2): a pure `useTranscript(events)` porting `transcript.go`'s `contentBlocks`/`extractStructuredPatch`/`resultTextRaw`/`renderEvent` + `store.ts` `indexResults`, derived **incrementally** off the same `events[]`.
- **REGISTRY** (Design 3's best idea): `messageRegistry` (item kind→component) + `toolRegistry` (tool name→component) so adding a message type = one `.vue` + one map line, never a switch edit.
- **COMPONENTS**: per-type Vue SFCs ported 1:1 from `/Users/jinxing/Jarvis/web/src/blocks/`, restyled via rebound CSS tokens, plus net-new catalog cards.
- **COMPOSER**: `ChatComposer.vue`, a VSCode-CC-styled extension of `InputBridge.vue` driven by `sessionStatus()`, wired through a `useSend` bundle.

---

## 1. Component tree + data flow

```
App.vue (unchanged: node→Workspace, hub→HubShell→Workspace)
└─ Workspace.vue  (MODIFIED — single wiring owner; consumes useTerminalSession())
   ├─ header.bar  + NEW segmented toggle [terminal | chat]  (localStorage 'ccfly:view')
   ├─ SessionList.vue        (existing left rail — UNCHANGED, both modes; selSid shared)
   ├─ section.termwrap :class="{ offscreen: mode==='chat' }"
   │    └─ <div ref=termEl class=term>   ← ALWAYS mounted; offscreen (not display:none) in chat
   ├─ (mode==='term') existing side panel: InputBridge + SlashBar + StatusPanel + rawscreen
   └─ (mode==='chat') ChatView.vue   ← gets the live controller refs as props
        └─ .ccfly-chat (theme scope root)
           ├─ ChatHeader.vue          title · permission badge · model · busy pulse · 2 conn dots · toggle
           ├─ Transcript.vue          scroll region; useTranscript(events)→{turns,resultById}; provide('resultById')
           │   └─ v-for turn → TurnGroup.vue
           │        ├─ v-for item → MsgBoundary.vue (onErrorCaptured) → MessageItem.vue
           │        │     ├─ user:  classifyUserItem → UserBubble | SystemNotice | (other→null)
           │        │     └─ asst:  per block → AssistantText | ThinkingBlock | ImageChip
           │        │                 | <ToolCard via toolRegistry> (tool_use)
           │        │                 (tool_result NOT rendered standalone — folded via resultById)
           │        │     + system items → SystemBanner | CompactionDivider | ApiErrorBubble | AttachmentNotice
           │        └─ TurnFooter.vue  (after last assistant of the turn)
           ├─ ChatComposer.vue        pinned bottom; useSend + state
           └─ ReaderOverlay.vue + Lightbox.vue   (Teleport singletons, reactive module store)
```

### Data flow (one `events[]` feeds BOTH state and transcript — no second SSE)

```
useTerminalSession(termEl):
  useSessions → selSid → sel = tmuxName(selSid)
  useLiveTerminal(termEl, termUrl(sel)) → term, connected, send, refit
  useScreen(term) → { screen, suggest }                         (50ms poll, off-screen)
  useJsonl('session:'+sel) → events (shallowRef, idb cache, ?since resume, CAP 12000)
  state = computed(sessionStatus(events.value, screen.value, suggest.value))
  readInput = extractInputBox(screen) minus ghost suggest        (verbatim Workspace L36–43)
  exposes: { sessions, selSid, sel, termEl, term, connected, jsonlConnected,
             events, screen, suggest, state, send, readInput, getEvents, getScreen, reconnect, refit }

useTranscript(events) → { items, resultById, turns }            (NEW derived layer, incremental)
state    → ChatHeader badges + ChatComposer enable/CTA
items+resultById → Transcript (provide resultById; cards read it via useToolStatus)
turns    → TurnGroup grouping + TurnFooter
send/readInput/events → useSend → ChatComposer → sendMessage
```

**Why one controller:** Workspace already builds every closure (`readInput`, `getEvents`, `getScreen`). Extracting it into `useTerminalSession.ts` lets Workspace (term) and ChatView (chat) share one terminal+jsonl+state+send instance. Recommended: keep ALL wiring in the controller; **ChatView owns no terminal**, just renders and passes `send/readInput/events` down to the composer.

---

## 2. The DATA port — `useTranscript(events)`

### Types — `src/transcript/types.ts` (port Jarvis `types.ts` + Go `tItem`/`tBlock`)

```ts
type BlockType = 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'image'
interface PatchHunk {
  oldStart
  oldLines
  newStart
  newLines
  lines: string[]
} // lines[] prefixed ' '|'-'|'+'
interface Block {
  type: BlockType
  text?
  id?
  name?
  input?: Record<string, unknown>
  forId?
  content?
  isError?
  patch?: PatchHunk[]
  path?
  mediaType?
  imgIdx? // image: base64 → mediaType (bytes inline in row); path-style → path
}
interface Item {
  role: 'user' | 'assistant' | 'system'
  kind
  text
  ts
  uuid?
  model?
  outTokens?
  blocks?: Block[]
}
interface Turn {
  anchorUuid?
  durSec
  outTokens
  items: Item[]
}
```

### `src/transcript/toItems.ts` — PURE port of `transcript.go` (verified L437–577)

- `contentBlocks(content)`: string content → one `text` block; array → walk:
  - `text` whose trimmed value matches `/^\[Image: source: (.+)\]$/` → `image` block w/ `path` + running `imgIdx`; else `text`.
  - `image` source → `image` block w/ `mediaType` (+ imgIdx). **Divergence from Go (intentional, verified):** `/sse/jsonl` rows DO carry `source.data` base64 (Go strips it for `/transcript`). So toItems keeps the base64 available to ImageChip and only path-style needs `/image`.
  - `thinking` → `thinking` (usually empty), `tool_use` → keep raw `input`, `tool_result` → `forId`+`isError`+`content` via `resultTextRaw`.
- `extractStructuredPatch(toolUseResult)`: non-empty `structuredPatch` array → attach to the row's `tool_result` block `.patch`.
- `renderEvent(line)`: keep `user|assistant` rows with `text||blocks`; carry `ts`, `uuid`, `model` (shortModel), `outTokens` (assistant `message.usage.output_tokens`).
- **EXTENSION beyond Go (Design 3):** also emit lightweight `Item{role:'system', kind:<subtype>}` for top-level `type:'system'` rows + mode/permission/title/api_error sidecars, routed to SystemBanner / CompactionDivider / ApiErrorBubble / AttachmentNotice. Go drops these; the chat page wants them.

### `src/transcript/indexResults.ts` — port `store.ts`

- `indexResults(items)`: `resultById[forId] = {content,isError,patch}`.
- `itemKey(it)` = `role|ts|kind|firstBlockType|text.slice(0,120)` — stable dedup key (NOT array index).

### `src/transcript/turns.ts` — port `components.tsx` `computeTurnFootnotes`

- A turn = from one real-user prompt (role user AND `classifyUserItem.kind==='user'`) to just before the next; carries `anchorUuid` (last assistant uuid), `durSec` (user ts → last event ts), `outTokens` (Σ assistant outTokens).

### `src/transcript/useTranscript.ts` — incremental derivation (CRITICAL)

- Returns `shallowRef` `{ items, resultById, turns }`.
- **Incremental**: cache `lastLen`; on `events.value.length` grow, flatten only the tail, push to items, merge resultById, re-group affected turns. **Reset detection:** if length shrank or first uuid changed (`useJsonl` resets `events.value=[]` on `fresh`/`switched`/compact), full rebuild. Dedup via `itemKey`. Rationale: `useJsonl` pushes via `shallowRef+triggerRef` up to ~20Hz and caps at 12000 — a naive `computed` rebuilding 10k items per push will jank.

Pin behavior with a **vitest fixture** from a real captured jsonl: assert block flattening, tool_result pairing, structuredPatch attach.

---

## 3. The REGISTRY (extensibility seam) — `src/transcript/registry.ts`

```ts
type ItemKind = 'user'|'assistant-text'|'thinking'|'tool_use'|'system-notice'
              | 'api-error'|'compaction'|'system-banner'|'attachment'|'image-row'
export const messageRegistry: Record<ItemKind, Component> = { ... }

export const toolRegistry: Record<string, Component> = {
  Read:ReadCard, Write:WriteCard, Edit:EditCard, MultiEdit:MultiEditCard, NotebookEdit:NotebookEditCard,
  Bash:BashCard, BashOutput:BashOutputCard, Grep:GrepCard, Glob:GlobCard, LS:LsCard,
  TodoWrite:TodoCard, Task:AgentCard, Agent:AgentCard, ExitPlanMode:PlanCard,
  AskUserQuestion:AskUserQuestionCard, Skill:SkillCard, WebFetch:WebFetchCard,
  WebSearch:WebSearchCard, Workflow:WorkflowCard,
}
// renderToolUse(block): exact name → card; mcp__* → McpCard; else GenericCard.
```

`MessageItem.vue` and tool cards use `<component :is="...">`. Adding a type is purely additive.

---

## 4. Full per-message-type component list

**Shared primitives** (port `shell.tsx`/`FileHeader.tsx`/`components.tsx MD`): `BlockShell` (accent left-bar + icon/title/brief/headerExtra + err badge + `RunIndicator` braille spinner/timer w/ 6h stale guard + chevron; `defaultOpen` from `TOOL_META`), `Collapsible` (clamp `N*1.55em` + fade + "展开 (N 行)"), `CodeCanvas` (line-numbered shiki, >24 lines → openReader; **render plain text first, backfill highlight** so slow shiki never blocks), `CodeBlock` (prose fence + copy), `ResultPane` (mono/md/list; `unwrapErr` strips `<tool_use_error>`), `Md` (markdown-it v-html; fence→CodeBlock), `FileHeader` (icon + breadcrumb lead/dir/base + ftag + stat + copy-path), `DiffCanvas` (diffLines/diffWords, FoldedRows collapse >6 ctx, red/green gutter, shiki backfill), `PatchCanvas` (structuredPatch hunks w/ real line numbers, multi-hunk gaps), `AnsiText` (ANSI→html). Composables `useToolStatus(block)` (inject resultById → running|ok|err+res), `useHighlighter()` (shiki singleton, lazy).

**Text family**: `UserBubble` (MD; pre+Collapsible if >20 lines / non-md multiline), `AssistantText` (MD; soft-fold >120 lines), `ThinkingBlock` (💭 brief + char count), `SystemNotice` (dim foldable pseudo-user; ANSI for command output).

**File**: `ReadCard` (parseCatN strips `NNN\t` + `<system-reminder>`, real startLine), `WriteCard` (all-green CodeCanvas), `EditCard` (PatchCanvas if `.patch` else DiffCanvas, ±stat), `MultiEditCard` (merged PatchCanvas or per-seg DiffCanvas), `NotebookEditCard` (cell header; replace→diff / insert→green / delete→red).

**Exec/Search**: `BashCard` (❯, CommandLines blue $, TermOut collapse@16/fullscreen@24, running pulse), `BashOutputCard`, `GrepCard`/`GlobCard`/`LsCard` (parse → file lists / path:count / path:line:text, `<mark>` highlight, per-file collapsible).

**Meta**: `TodoCard` (gauge + ✓◐○), `AgentCard` (🤖 prompt + result; P4 "查看记录"→openSubagent), `PlanCard` (待确认/已批准 pill + MD), `AskUserQuestionCard` (options + picked detection), `SkillCard` (kv + ResultPane), `McpCard` (server·tool split), `GenericCard` (input JSON + ResultPane).

**Web/Workflow/Image**: `WebFetchCard`, `WebSearchCard`, `WorkflowCard` (P4 polls /workflow), `ImageChip` (base64 → `data:` URI from the row; path-style → `imageUrl(selSid,uuid,imgIdx)`; click→Lightbox).

**Net-new catalog** (no Jarvis equivalent; from raw events): `ApiErrorBubble` (`isApiErrorMessage` model `<synthetic>` + system/api_error 403/429 telemetry), `TurnFooter` (✻ verb · dur · tokens), `CompactionDivider` (system/compact_boundary + pre/post tokens), `SystemBanner` (away_summary/informational/scheduled_task_fire/stop_hook_summary/turn_duration), `AttachmentNotice` (~24 attachment inner types, grouped dim foldable). P1 may drop unknown system rows and add these incrementally.

**Overlays**: `ReaderOverlay` (openReader), `Lightbox` (openLightbox) — Teleport singletons backed by a `reactive()` module store (Vue equivalent of Jarvis's `useSyncExternalStore`). `MsgBoundary` = `onErrorCaptured` wrapper (React ErrorBoundary equivalent); `Transcript` keys use `itemKey`, not index.

---

## 5. The VSCode-CC composer — `ChatComposer.vue`

Keep `InputBridge.vue`'s `run(submit)`/`abort()`/`onEnter` logic VERBATIM (it already does confirmed-send with `onPhase`/`AbortSignal`, Enter/Shift+Enter, fill-without-submit). Wire via a `useSend(deps)` bundle (`src/composables/useSend.ts`) that owns one AbortController + `{phase,error,busy}` and exposes `sendText/fillText/runSlash/interrupt`, so ChatView and the composer share one pipeline.

Layout (VSCode-CC faithful, top→bottom): attachment chips row (v1 empty) · auto-grow `<textarea>` rows 1→~10 (placeholder "Plan, build, debug — Enter 发送, Shift+Enter 换行") · toolbar (LEFT: permission-mode button [label from `state.permissionMode`; click cycles via `send('\x1b[Z')` = Shift+Tab — **gated to status==='idle'**]; `/` slash menu folding `runContext`/`runUsage` + model/thinking/compact items that just type the slash command; ✨ suggest enabled only when `state.suggest`, behind a self-drawn confirm) · (RIGHT: optional usage indicator; **Send** when idle / **Stop** when busy) · inline status line (reuse `PHASE_LABEL` phase chip + error).

State→CTA (off `sessionStatus().status`; treat **disabled when `!connected`** since status is screen-authoritative):

- `idle` → enabled, Send.
- `generating|awaiting-tool` → BusyLine (spinner + elapsed from `state.lastActivity`) + **Stop** = `send('\x1b')` behind a **self-drawn confirm** (never native).
- `select` → option-button affordance (v1: "menu open in terminal, use arrows"; full parser deferred).
- `usage|help|status|config|stats|mcp|plugin` → disable free text, show "overlay open (Esc 关闭)" with an Esc button (`send('\x1b')`).
- `offline` → disabled, "session not running".
- `unknown` → disable Send (don't type into an unrecognized screen).
- `state.interrupted` / `state.apiError` → inline banners.

Known v1 gap: `@`-mention has no file-list endpoint → ship `@` as passthrough text (TUI resolves on submit). InputBridge/SlashBar kept for term mode in v1.

---

## 6. VSCode dark theme tokens (scoped under `.ccfly-chat`)

Strategy (consensus across all three): REUSE Jarvis CSS var **names** (so the 1629-line `blocks.css` — verified to use only `var(--bg/--bg2/--card/--bd/--fg/--mut/--acc/--green/--amber/--red)` — drops in nearly verbatim) but REBIND values to VSCode Dark Modern. Declare tokens on `.ccfly-chat` (NOT `:root`) so the Workspace terminal pane / hub / DocView keep their existing `#0b0e14`/`#11151c` slate. Prefix ported `blocks.css` selectors under `.ccfly-chat`.

Rebound: `--bg:#1F1F1F` `--bg2:#181818` `--card:#202020` `--bd:#2B2B2B` `--fg:#CCCCCC` `--mut:#9D9D9D` `--acc:#0078D4` `--green:#2EA043` `--amber:#CCA700` `--red:#F85149`. Result/term panes keep `#0c0e13`.

Composer/chrome extras: `--vsc-input-bg:#313131` `--vsc-input-border:#3C3C3C` `--vsc-btn-bg:#0078D4` `--vsc-btn-hover:#026EC1` `--vsc-btn-fg:#FFF` `--vsc-btn2-bg:#313131` `--vsc-list-hover:#2A2D2E` `--vsc-list-sel:#04395E` `--vsc-link:#4DAAFC` `--vsc-add-wash:#2EA04326` `--vsc-del-wash:#F8514926` `--vsc-badge:#616161` `--vsc-scrollbar:rgba(121,121,121,.4)`. Fonts: `--vsc-sans:-apple-system,'Segoe UI',system-ui` (UI 13px, desc 12px), `--vsc-mono:Menlo,Monaco,monospace` (code 14px; or reuse the already-@font-face'd JetBrainsMono). Accent left-bars: file/web=`--acc`, exec/skill=#4dd0e1, task=#b794f6, mcp=`--amber`, plan=`--green`, unknown=#5a6473, err=`--red`. Diff: `+`→`--vsc-add-wash`+`--green` gutter, `-`→`--vsc-del-wash`+`--red`. shiki theme stays `github-dark` (what the ports expect; matches VSCode dark).

---

## 7. Hidden-terminal session controller — `src/composables/useTerminalSession.ts`

Extracts Workspace.vue's exact wiring (L22–73) so both Workspace and ChatView consume one instance. Owns lifecycle: `onMounted` connect if `sel`; `watch(sel)` → reconnect (jsonl auto-reconnects via its own `watch(src)`); `window.resize` → refit; auto-select first live session.

Off-screen mounting (load-bearing, verified against `useLiveTerminal.ts`: ensureTerm needs a sized attached container; FitAddon+ResizeObserver default to **cols 80/rows 30** when unsized; `extractInputBox` keys on `/^\s*─{6,}\s*$/` border widths and select/usage detectors key on frame geometry):

```css
.termwrap.offscreen {
  position: absolute;
  left: -99999px;
  top: 0;
  width: 900px;
  height: 640px;
  pointer-events: none;
}
```

NEVER `display:none`/`visibility:hidden`/zero-size + `aria-hidden`. The term is **never unmounted** on toggle, so ttyd never drops; on `term→chat` and `chat→term`, call `refit()` once after the class settles (RAF) to re-measure geometry.

Sending = 100% reuse `src/send/*`: `send` (useLiveTerminal), `readInput` (extractInputBox(screen) minus ghost), `events` (()=>events.value). `sendMessage`'s confirmed-send (clear→verify-screen→bracketed-paste→verify-screen→Enter→verify-via-jsonl) needs BOTH the hidden term's screen AND jsonl — both flow from this controller. State validity guard: composer hard-disables when `!connected.value` (else sends hang at the clear/verify step).

---

## 8. Routing / coexistence with Workspace

Smallest diff: **in-Workspace view toggle**, NO route/App.vue changes. Works identically node + hub (both mount Workspace).

Workspace.vue changes (the only existing component modified): (1) consume `useTerminalSession()`; (2) `const mode = ref<'term'|'chat'>(localStorage 'ccfly:view' ?? 'term')`, persist on change, `refit()` (RAF) on switch back to term; (3) header segmented `[terminal | chat]` toggle (next to conn dots); (4) `termwrap :class="{ offscreen: mode==='chat' }"` (always mounted); (5) in chat mode render `<ChatView v-if="mode==='chat'" :events :screen :suggest :state :send :read-input :connected :sel-sid="selSid" />` taking the full main area, hide the term-mode side panel; term-mode layout stays **byte-identical**. `SessionList` (selSid) shared across modes.

Optional (defer): `?view=chat` deep-link via `hub/useRoute.ts`; localStorage suffices for v1.

`config.ts` add (P1: `imageUrl`; P4 rest), all through `httpUrl` (hub base `/x/<node>` correctness):

```ts
export const imageUrl = (sid, uuid, idx) =>
  httpUrl(`/image?sid=${sid}&uuid=${encodeURIComponent(uuid)}&idx=${idx}`)
// P4: subtranscriptUrl/workflowUrl/infoUrl similarly via httpUrl
```

**Verified pitfall:** `/image`, `/subtranscript`, `/workflow`, `/info` take **`sid` = RAW claude session id** (`handleImage` uses `?sid=`; `safeImagePath` checks `~/.claude/image-cache/<sid>/`), while `/term` and `/sse/jsonl?session=` take the **tmux name** (`cc-<sid[:8]>`). Pass `selSid` (raw) explicitly into ChatView/ImageChip — never `tmuxName`.

---

## 9. Risk register (carried from all three, deduped)

1. **Incremental useTranscript is mandatory** — naive computed over a 12k shallowRef pushed at ~20Hz janks. Cache lastLen, flatten tail only; detect shrink/uuid-change reset.
2. **toItems is a hand-port of Go** — drift risk; the base64 divergence is real and intentional (rows carry `source.data`). Pin with a vitest fixture (resultById pairing + patch presence).
3. **Off-screen geometry** — any 0-size/`display:none` collapses FitAddon to 80×30 → detectors misfire → wrong status → composer wrongly enabled and confirmed-send verify fails. Fixed off-screen size + refit after toggle + assert cols/rows.
4. **Composer must hard-disable when `!connected`** — status is screen-authoritative; a disconnected term hangs sends at clear/verify.
5. **tool_result pairs on the FOLLOWING line** — running tools have no result yet → `useToolStatus` shows 'running'; reproduce the 6h stale-timer guard so reloaded old sessions don't show "running 72h".
6. **shiki bundle weight** — lazy singleton; render plain text immediately and backfill (as ports do); trim langs if needed.
7. **Per-message error isolation** — `MsgBoundary` (`onErrorCaptured`) around every item; stable `itemKey` keys (prepend/dedup would remap index keys and crash).
8. **classifyUserItem + ~24 attachment + ~8 system subtypes are a long tail** — port the regex classifier faithfully; default unknowns to dim foldable AttachmentNotice/SystemBanner, never a "you" bubble.
9. **Hub base correctness** — all P4 endpoint helpers via `httpUrl` (base `/x/<node>`); never absolute. sid-vs-tmuxName mixups → 404s.
10. **Coexistence regressions** — Workspace stays single wiring owner; term mode byte-identical; refit on toggle-back; hub inherits the toggle for free.

=== FILES ===

- NEW src/transcript/types.ts — Block/Item/PatchHunk/Turn types (port Jarvis types.ts + Go tItem/tBlock)
- NEW src/transcript/toItems.ts — pure port of transcript.go contentBlocks/extractStructuredPatch/resultTextRaw/renderEvent, EXTENDED to emit system/sidecar items
- NEW src/transcript/useTranscript.ts — incremental events[] → {items, resultById, turns} derived shallowRef
- NEW src/transcript/indexResults.ts — port store.ts indexResults + itemKey (dedup)
- NEW src/transcript/turns.ts — groupTurns + computeTurnFootnotes (port components.tsx)
- NEW src/transcript/classifyUserItem.ts — verbatim port of SystemNotice.tsx classifier (+ vitest fixture test)
- NEW src/transcript/registry.ts — messageRegistry (ItemKind→Component) + toolRegistry (name→Component) + renderToolUse fallback
- NEW src/transcript/meta.ts — TOOL_META/fileIcon/langOf/briefOf (pure data, port 1:1)
- NEW src/transcript/useHighlighter.ts — shiki singleton (port highlight.ts, lazy)
- NEW src/transcript/useToolStatus.ts — inject('resultById') → running|ok|err+res
- NEW src/transcript/blocks.css — port of Jarvis blocks.css, all selectors prefixed-scoped under .ccfly-chat
- NEW src/theme/vscode.css — VSCode Dark Modern tokens (rebind --bg/--bg2/--card/--bd/--fg/--mut/--acc/--green/--amber/--red + --vsc-\* chrome) scoped under .ccfly-chat
- NEW src/composables/useTerminalSession.ts — hidden-terminal session controller (extracts Workspace wiring; owns lifecycle + refit)
- NEW src/composables/useSend.ts — bundles send/readInput/getEvents/getScreen + AbortController/phase; exposes sendText/fillText/runSlash/interrupt + {phase,error,busy}
- NEW src/ChatView.vue — page root: consumes controller + useTranscript, provides resultById/selSid, layout header/transcript/composer/offscreen-term/overlays
- NEW src/components/chat/Transcript.vue — scroll container, v-for turns, auto-scroll, provide resultById
- NEW src/components/chat/TurnGroup.vue — renders turn.items + optional TurnFooter
- NEW src/components/chat/MsgBoundary.vue — onErrorCaptured wrapper (one bad card must not blank tree)
- NEW src/components/chat/MessageItem.vue — dispatch via messageRegistry + classifyUserItem
- NEW src/components/chat/ChatHeader.vue — title/permission badge/model/busy pulse/conn dots/view toggle
- NEW src/components/chat/ChatComposer.vue — VSCode-CC composer: extends InputBridge logic, toolbar + state-driven CTA
- NEW src/components/chat/blocks/ — shell primitives: BlockShell.vue, Collapsible.vue, CodeCanvas.vue, CodeBlock.vue, ResultPane.vue, Md.vue, FileHeader.vue, DiffCanvas.vue, PatchCanvas.vue, AnsiText.vue
- NEW src/components/chat/blocks/ — text family: UserBubble.vue, AssistantText.vue, ThinkingBlock.vue, SystemNotice.vue
- NEW src/components/chat/blocks/ — file tools: ReadCard.vue, WriteCard.vue, EditCard.vue, MultiEditCard.vue, NotebookEditCard.vue
- NEW src/components/chat/blocks/ — exec/search: BashCard.vue, BashOutputCard.vue, GrepCard.vue, GlobCard.vue, LsCard.vue
- NEW src/components/chat/blocks/ — meta: TodoCard.vue, AgentCard.vue, PlanCard.vue, AskUserQuestionCard.vue, SkillCard.vue, McpCard.vue, GenericCard.vue
- NEW src/components/chat/blocks/ — web/workflow/image: WebFetchCard.vue, WebSearchCard.vue, WorkflowCard.vue, ImageChip.vue
- NEW src/components/chat/blocks/ — net-new catalog: ApiErrorBubble.vue, TurnFooter.vue, CompactionDivider.vue, SystemBanner.vue, AttachmentNotice.vue
- NEW src/components/chat/overlays/ — ReaderOverlay.vue, Lightbox.vue + overlayStore.ts (reactive module store + Teleport singletons)
- MODIFY src/config.ts — add imageUrl(sid,uuid,idx); (P4) subtranscriptUrl/workflowUrl/infoUrl helpers (all via httpUrl)
- MODIFY src/Workspace.vue — consume useTerminalSession, add mode ref + header toggle + offscreen term class + render ChatView in chat mode
- MODIFY package.json — add deps: shiki, diff (+ @types/diff dev); markdown-it already present

=== COMPONENTS ===

- ChatView.vue — page root; owns selection, consumes useTerminalSession + useTranscript, provides resultById/selSid, hosts overlays + offscreen term ref
- ChatHeader.vue — title (state.title) + permission-mode badge + model badge + busy/idle pulse + ttyd/jsonl conn dots + [terminal|chat] toggle
- Transcript.vue — scroll region; useTranscript(events)→{turns}, auto-scroll-to-bottom-unless-scrolled-up, provides resultById
- TurnGroup.vue — renders one turn's items, appends TurnFooter after last assistant
- MsgBoundary.vue — onErrorCaptured per-item wrapper; renders inline error chip, never blanks the tree
- MessageItem.vue — per-item dispatch: classifyUserItem for user role, messageRegistry for kind, toolRegistry for tool_use
- ChatComposer.vue — VSCode-CC composer: auto-grow textarea + toolbar (permission/slash/suggest) + state-driven Send/Stop/overlay CTA + phase chip
- BlockShell.vue — foldable card: accent left-bar + icon + title + brief + headerExtra + err badge + RunIndicator + chevron
- Collapsible.vue — clamp N\*1.55em + fade + '展开 (N 行)' button
- CodeCanvas.vue — line-numbered shiki code, >24 lines → openReader; renders plain text first, backfills highlight
- CodeBlock.vue — prose fenced code (no gutter) + copy button
- ResultPane.vue — mono/md/list variants; unwrapErr strips <tool_use_error>; Collapsible-wrapped
- Md.vue — markdown-it v-html; fenced code → CodeBlock
- FileHeader.vue — file icon + breadcrumb (lead/dir/base) + ftag + stat + copy-path
- DiffCanvas.vue — diffLines/diffWords fallback; FoldedRows (collapse >6 context) + red/green gutter + shiki backfill
- PatchCanvas.vue — structuredPatch hunks with real line numbers + multi-hunk separators + shiki backfill
- AnsiText.vue — ANSI escape → colored HTML (command-output rendering)
- UserBubble.vue — MD; degrade to pre+Collapsible if >20 lines / non-md multiline
- AssistantText.vue — MD; soft-fold >120 lines
- ThinkingBlock.vue — BlockShell 💭, first-line brief + char count (usually empty)
- SystemNotice.vue — dim foldable pseudo-user notice (notification/command/system/interrupt), ANSI for cmd output
- ReadCard.vue — FileHeader + CodeCanvas; parseCatN strips 'NNN\t' + <system-reminder>; real startLine
- WriteCard.vue — FileHeader + all-green CodeCanvas of content
- EditCard.vue — FileHeader + PatchCanvas (prefers structuredPatch) else DiffCanvas; ±stat
- MultiEditCard.vue — merged PatchCanvas or per-segment DiffCanvas; Σ±·N stat
- NotebookEditCard.vue — cell-index header; replace→diff / insert→green / delete→red
- BashCard.vue — ❯ exec card; CommandLines (blue $) + TermOut (collapse@16/fullscreen@24) + running pulse
- BashOutputCard.vue — background task output (reuses BashCard)
- GrepCard.vue / GlobCard.vue / LsCard.vue — parse result into file lists / path:count / path:line:text with <mark> highlight, per-file collapsible
- TodoCard.vue — progress gauge (done/total + bar) + ✓◐○ status list
- AgentCard.vue — 🤖 prompt section + result summary; P4 '查看记录' → openSubagent overlay
- PlanCard.vue — ExitPlanMode: 待确认/已批准 pill + MD plan
- AskUserQuestionCard.vue — questions[].options with picked-detection from answer result
- SkillCard.vue — kv param rows + ResultPane
- McpCard.vue — mcp**server**tool split; input JSON + ResultPane
- GenericCard.vue — fallback: input JSON CodeBlock + ResultPane
- WebFetchCard.vue / WebSearchCard.vue — web tool cards
- WorkflowCard.vue — Task input + result summary; P4 polls /workflow
- ImageChip.vue — base64 inline data:URI from streamed row; path-style → /image?sid=selSid&uuid&idx; click → Lightbox
- ApiErrorBubble.vue — assistant isApiErrorMessage ('<synthetic>') + system/api_error retry telemetry
- TurnFooter.vue — ✻ verb · duration · tokens, anchored on last assistant of turn
- CompactionDivider.vue — system/compact_boundary 'Conversation compacted' + pre/post tokens
- SystemBanner.vue — away_summary/informational/scheduled_task_fire/stop_hook_summary/turn_duration dim banners
- AttachmentNotice.vue — the ~24 attachment inner types, grouped dim foldable
- ReaderOverlay.vue — full-screen code reader (Teleport singleton, openReader)
- Lightbox.vue — full-screen image viewer (Teleport singleton, openLightbox)

=== BUILD PHASES ===

1.  P0 Scaffolding + seams (no UI): add deps shiki+diff; src/transcript/types.ts; toItems.ts + useTranscript.ts (incremental) with vitest fixture from a captured jsonl; meta.ts; useHighlighter.ts; classifyUserItem.ts (+test); indexResults.ts/turns.ts; registry.ts (empty maps + fallback); useToolStatus.ts; theme/vscode.css tokens + scoped blocks.css; config.ts imageUrl helper.
2.  P1 MVP walking skeleton (replaces terminal, can send): useTerminalSession.ts + useSend.ts; primitives BlockShell/Collapsible/Md/CodeCanvas/ResultPane/FileHeader/DiffCanvas/PatchCanvas; Transcript/TurnGroup/MsgBoundary/MessageItem/ChatHeader/ChatView; core blocks UserBubble/AssistantText/SystemNotice + BashCard/ReadCard/EditCard (diff is the headline asset); ChatComposer (idle Send + busy Stop); Workspace.vue toggle + offscreen term + pass controller. → switch to chat, see faithful transcript with diffs, send a message and see it appear.
3.  P2 Full per-type coverage + polish: WriteCard/MultiEditCard/NotebookEditCard, GrepCard/GlobCard/LsCard, TodoCard/PlanCard/AskUserQuestionCard/SkillCard/McpCard/GenericCard, WebFetch/WebSearch, ThinkingBlock, CodeBlock, AnsiText; ImageChip + Lightbox + ReaderOverlay (overlay store); ApiErrorBubble/TurnFooter/CompactionDivider/SystemBanner/AttachmentNotice registered; Composer toolbar (permission-mode button gated to idle, '/' menu folding runContext/runUsage, ✨ suggest, phase chip, select-state affordance, overlay Esc).
4.  P3 Streaming/scroll robustness: auto-scroll-to-bottom unless scrolled up; scroll anchoring across async shiki height (record scrollHeight, restore over 2 RAFs); near-bottom detection. (useJsonl caps at 10k so windowing deferred.)
5.  P4 Subagent/workflow drill-down: config.ts subtranscriptUrl/workflowUrl/infoUrl (httpUrl + ?sid=selSid); AgentCard '查看记录' → openSubagent overlay (fetch /subtranscript, render via shared renderer with a provide-override resultById); WorkflowCard polls /workflow; optional /info context gauge in composer; optional ?view=chat deep-link in useRoute.ts.

=== OPEN QUESTIONS ===

- Coexistence shape: in-place 'mode' toggle inside Workspace.vue (smallest diff, class-swaps the term) vs. extract useTerminalSession into a thin parent that renders <Workspace> OR <ChatView> as siblings (cleaner templates, no class gymnastics, term survives switch). Recommend in-place for P1 but still extract useTerminalSession so the sibling refactor is a later no-cost option. Confirm preference.
- select-state composer fidelity: ccfly-ttyd-ui has only screen-derived 'select' status without parsed options (unlike Jarvis /state). v1 fallback = 'menu open in terminal, use arrows' affordance, OR invest in a select-options screen parser now. Confirm whether a parser is in scope for v1.
- @-mention autocomplete: no file-list endpoint on the node. Ship '@' as passthrough text (TUI resolves on submit) and document the gap, or defer mention UI entirely? Recommend passthrough.
- Retire InputBridge.vue/SlashBar.vue once ChatComposer subsumes them, or keep them for term mode? Recommend keep for term mode in v1 (zero risk), revisit later.
- Stop/interrupt + permission-mode cycling write into the hidden terminal (send('\x1b'), send('\x1b[Z')). Confirm gating: Stop only when busy; permission cycle only when status==='idle' (avoid side effects mid-generation).
- Offscreen term geometry: fixed 800–900×600–640 px off-screen. Confirm acceptable (must never be display:none/0-size or FitAddon degrades to 80×30 and detectors misfire).
- shiki bundle weight: adds ~19 langs + github-dark to a previously markdown-it-only app. Accept lazy-loaded singleton, or trim the lang set / use shiki fine-grained bundle? Recommend lazy singleton for v1.
- docs/jsonl-format.md path: the brief references it but it was not found under /Users/jinxing/ccfly (only transcript.go's catalog comments). Confirm the canonical source for the full system-subtype + 24-attachment-type catalog used to build SystemBanner/AttachmentNotice/ApiErrorBubble.
