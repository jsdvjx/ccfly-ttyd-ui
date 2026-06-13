// useAttachments — 聊天附图:选/拍/粘贴/拖拽进来的图片,**立即**经 POST /upload 落盘到会话
// cwd 的 .ccfly-uploads/(multipart 字段 file;服务端生成文件名并返回绝对路径)。本地持有
// {objectURL 预览, 上传状态, 服务端路径};提交时把 done 路径列表交给 /sendkeys 的 images
// (设备端 tmux 括号粘贴 → 里世界原生 [Image #N])。
//
// 立即上传(而非提交时才传)的取舍:附图即开始传,提交瞬间只剩一个轻量 /sendkeys;失败也
// 在附图当下就冒出来(红框 + 原因),不会等到发送一刻才发现。删除附件仅本地移除 —— 服务端
// 文件留在 .ccfly-uploads/(无清理端点;它本就是会话工作目录的一部分,且 /sendkeys 只粘
// 提交时点名的路径,多余文件不会进消息)。
import { ref, computed } from 'vue'
import { uploadUrl } from '../config'

export interface Attachment {
  id: number
  name: string
  size: number
  preview: string // 本地 objectURL 预览(remove/clear 时 revoke)
  status: 'uploading' | 'done' | 'error'
  path?: string // 上传成功后服务端返回的绝对路径(.ccfly-uploads/ 内)
  error?: string
}

let seq = 1

export function useAttachments(session: () => string) {
  const items = ref<Attachment[]>([])

  function patch(id: number, p: Partial<Attachment>): void {
    items.value = items.value.map((x) => (x.id === id ? { ...x, ...p } : x))
  }

  async function upload(a: Attachment, f: File): Promise<void> {
    const fd = new FormData()
    fd.append('file', f)
    try {
      const r = await fetch(uploadUrl(session()), {
        method: 'POST',
        body: fd,
        credentials: 'same-origin',
      })
      if (!r.ok) {
        // 413 是设备端体积闸(缺省 32MiB);404/501 多半是设备 ccfly 版本太老没有 /upload。
        const msg =
          r.status === 413
            ? '文件过大'
            : r.status === 404
              ? '设备不支持上传(升级 ccfly)'
              : '上传失败 (' + r.status + ')'
        patch(a.id, { status: 'error', error: msg })
        return
      }
      const j = (await r.json().catch(() => null)) as { path?: string } | null
      if (!j?.path) {
        patch(a.id, { status: 'error', error: '上传响应异常' })
        return
      }
      patch(a.id, { status: 'done', path: j.path })
    } catch {
      patch(a.id, { status: 'error', error: '网络错误' })
    }
  }

  /** 收纳一批文件:只认 image/*,逐个立即上传(并行,互不阻塞)。 */
  function addFiles(files: Iterable<File>): void {
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue
      const a: Attachment = {
        id: seq++,
        name: f.name,
        size: f.size,
        preview: URL.createObjectURL(f),
        status: 'uploading',
      }
      items.value = [...items.value, a]
      void upload(a, f)
    }
  }

  function remove(id: number): void {
    const a = items.value.find((x) => x.id === id)
    if (a) URL.revokeObjectURL(a.preview)
    items.value = items.value.filter((x) => x.id !== id)
  }

  function clear(): void {
    for (const a of items.value) URL.revokeObjectURL(a.preview)
    items.value = []
  }

  const uploading = computed(() => items.value.some((a) => a.status === 'uploading'))
  const failed = computed(() => items.value.some((a) => a.status === 'error'))
  const paths = computed(() =>
    items.value.filter((a) => a.status === 'done').map((a) => a.path as string),
  )

  return { items, addFiles, remove, clear, uploading, failed, paths }
}
