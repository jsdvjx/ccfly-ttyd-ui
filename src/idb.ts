// idb.ts — 极简 IndexedDB:按会话 src 持久化 jsonl 事件 + 末尾字节 offset。
// 重开/刷新/换标签时先用缓存秒级渲染,再让 SSE 从 offset 只拉增量(见 useJsonl + sse.go 的 ?since)。
// 任何环节失败一律静默降级(当作没缓存),绝不影响主流程。

const DB = 'ccfly'
const STORE = 'jsonl'
const VER = 1

let dbp: Promise<IDBDatabase> | null = null

function db(): Promise<IDBDatabase> {
  if (dbp) return dbp
  dbp = new Promise((res, rej) => {
    let r: IDBOpenDBRequest
    try {
      r = indexedDB.open(DB, VER)
    } catch (e) {
      rej(e)
      return
    }
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE)
    }
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
  return dbp
}

export interface JsonlCache {
  path: string // 该缓存对应的真实 jsonl 文件路径(用于 ?since 续传时校验是否同一文件)
  offset: number // 末尾字节 offset(= 最后一条事件的 SSE id),续传起点
  events: unknown[] // 已收到的事件(上限见 useJsonl 的 KEEP)
  headStart?: number // 最旧已缓存事件的「行首」字节;暖开后据此向上翻页(/jsonl/before?before=)。缺省=未知。
}

export async function loadCache(key: string): Promise<JsonlCache | null> {
  if (!key) return null
  try {
    const d = await db()
    return await new Promise((res) => {
      const tx = d.transaction(STORE, 'readonly').objectStore(STORE).get(key)
      tx.onsuccess = () => res((tx.result as JsonlCache) ?? null)
      tx.onerror = () => res(null)
    })
  } catch {
    return null
  }
}

export async function saveCache(key: string, v: JsonlCache): Promise<void> {
  if (!key) return
  try {
    const d = await db()
    await new Promise<void>((res) => {
      const tx = d.transaction(STORE, 'readwrite').objectStore(STORE).put(v, key)
      tx.onsuccess = () => res()
      tx.onerror = () => res() // 配额满等失败:静默(下次再说)
    })
  } catch {
    /* ignore */
  }
}
