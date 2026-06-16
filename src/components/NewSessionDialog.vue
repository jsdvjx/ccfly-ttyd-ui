<script setup lang="ts">
// NewSessionDialog — 新建会话:文件系统目录浏览器(fetch /dirs 导航)+ POST /new 在选定目录起
// 全新 claude,拿到真 sid 后 emit('created', sid),由 Workspace 切到新会话。
// 与 CLI `ccfly a` / `ccfly new` 的浏览器同口径:只列子目录、跳过隐藏;底部可选权限模式 / skip。
import { ref, computed, watch, onMounted } from 'vue'
import { dirsUrl, newSessionUrl } from '../config'

// devices 传入(hub 落地页用)→ 顶部出设备选择器,URL 走该设备网关前缀 /x/<id>;
// 不传(节点 / 单设备工作区)→ 用全局 base(httpUrl,DeviceView 已指向 /x/<当前设备>)。
type DeviceOpt = { id: string; name: string }
const props = defineProps<{ devices?: DeviceOpt[] }>()
const emit = defineEmits<{ created: [sid: string, deviceId: string]; close: [] }>()

const hub = computed(() => !!props.devices?.length)
const selDev = ref(props.devices?.[0]?.id ?? '')
const base = computed(() => (hub.value ? '/x/' + selDev.value : ''))
function dUrl(p: string): string {
  return hub.value ? base.value + '/dirs' + (p ? '?path=' + encodeURIComponent(p) : '') : dirsUrl(p)
}
function nUrl(): string {
  return hub.value ? base.value + '/new' : newSessionUrl()
}

const path = ref('')
const parent = ref('')
const dirs = ref<string[]>([])
const loading = ref(false)
const creating = ref(false)
const err = ref('')

const permModes = ['default', 'acceptEdits', 'plan', 'bypassPermissions']
const permMode = ref('default')
const skipPerms = ref(false)

function join(base: string, name: string): string {
  return base === '/' ? '/' + name : base + '/' + name
}

async function browse(p: string): Promise<void> {
  loading.value = true
  err.value = ''
  try {
    const r = await fetch(dUrl(p), { credentials: 'include' })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    const d = await r.json()
    path.value = d.path || p
    parent.value = d.parent || ''
    dirs.value = Array.isArray(d.dirs) ? d.dirs : []
  } catch (e) {
    err.value = '读取目录失败:' + String((e as Error).message || e)
  } finally {
    loading.value = false
  }
}

async function create(): Promise<void> {
  if (!path.value || creating.value) return
  creating.value = true
  err.value = ''
  try {
    const r = await fetch(nUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        cwd: path.value,
        permission_mode: skipPerms.value ? '' : permMode.value,
        skip_permissions: skipPerms.value,
      }),
    })
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200))
    const d = await r.json()
    const sid = d.session_id || d.session
    if (!sid) throw new Error('会话已创建,但还没拿到 id,稍后在列表里打开')
    emit('created', sid, selDev.value)
  } catch (e) {
    err.value = '新建失败:' + String((e as Error).message || e)
  } finally {
    creating.value = false
  }
}

function cyclePerm(): void {
  skipPerms.value = false
  permMode.value = permModes[(permModes.indexOf(permMode.value) + 1) % permModes.length]
}

watch(selDev, () => browse('')) // 切设备 → 从该设备家目录重新浏览
onMounted(() => browse('')) // 空 = 设备家目录
</script>

<template>
  <div class="ov" @click.self="emit('close')">
    <div class="dlg">
      <div class="hd">
        <b>新建会话 — 选择目录</b>
        <button class="x" title="关闭" @click="emit('close')">✕</button>
      </div>

      <div v-if="hub" class="devbar">
        <span class="dl">设备</span>
        <select v-model="selDev" class="devsel">
          <option v-for="d in props.devices" :key="d.id" :value="d.id">{{ d.name }}</option>
        </select>
      </div>

      <div class="pathbar"><span>📁</span><span class="pt">{{ path || '…' }}</span></div>
      <div v-if="err" class="err">{{ err }}</div>

      <div class="list">
        <button
          v-if="parent && parent !== path"
          class="row up"
          @click="browse(parent)"
        >
          <span class="ic">↑</span><span>..</span><span class="sub">上级</span>
        </button>
        <button v-for="d in dirs" :key="d" class="row" @click="browse(join(path, d))">
          <span class="ic">📁</span><span class="nm">{{ d }}</span>
        </button>
        <div v-if="loading" class="hint">载入中…</div>
        <div v-else-if="!dirs.length" class="hint">(此目录下无子目录)</div>
      </div>

      <div class="ft">
        <button class="perm" :class="{ on: skipPerms }" title="--dangerously-skip-permissions" @click="skipPerms = !skipPerms">
          {{ skipPerms ? 'skip-all' : '权限:确认' }}
        </button>
        <button v-if="!skipPerms" class="perm" title="--permission-mode" @click="cyclePerm">
          模式:{{ permMode }}
        </button>
        <div class="sp" />
        <button class="create" :disabled="creating || loading || !path" @click="create">
          {{ creating ? '创建中…' : '＋ 在此目录新建' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ov {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 16px;
}
.dlg {
  width: 520px;
  max-width: 100%;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  background: #11151c;
  border: 1px solid #2a3441;
  border-radius: 10px;
  overflow: hidden;
  color: #e5e7eb;
}
.hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid #1f2630;
  font-size: 13px;
}
.x {
  background: none;
  border: 0;
  color: #6b7280;
  cursor: pointer;
  font-size: 14px;
}
.devbar {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid #1f2630;
}
.dl {
  font-size: 11px;
  color: #6b7280;
  flex: none;
}
.devsel {
  flex: 1;
  background: #0d1117;
  color: #e5e7eb;
  border: 1px solid #2a3441;
  border-radius: 6px;
  padding: 5px 8px;
  font-size: 12.5px;
}
.pathbar {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 7px 12px;
  font-family: var(--vsc-mono, monospace);
  font-size: 11.5px;
  color: #93a3b8;
  border-bottom: 1px solid #1f2630;
}
.pt {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.err {
  padding: 7px 12px;
  color: #ff9b94;
  font-size: 12px;
  background: #2a1414;
}
.list {
  flex: 1;
  overflow: auto;
  padding: 6px;
  min-height: 160px;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  background: none;
  border: 0;
  color: #cbd5e1;
  padding: 7px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
.row:hover {
  background: #1c2430;
}
.row.up {
  color: #93a3b8;
}
.ic {
  flex: none;
  width: 18px;
  text-align: center;
}
.nm {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sub {
  color: #6b7280;
  font-size: 11px;
}
.hint {
  color: #6b7280;
  font-size: 12px;
  padding: 10px 8px;
}
.ft {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid #1f2630;
}
.perm {
  background: #1f2937;
  color: #cbd5e1;
  border: 1px solid #2a3441;
  border-radius: 6px;
  padding: 5px 10px;
  cursor: pointer;
  font-size: 12px;
}
.perm.on {
  color: #fca5a5;
  border-color: #7f1d1d;
}
.sp {
  flex: 1;
}
.create {
  background: #16653a;
  color: #d1fae5;
  border: 1px solid #1f7a47;
  border-radius: 6px;
  padding: 6px 14px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
}
.create:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
