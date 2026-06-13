// tasks jsonl 检测器(独立单元)。
// 语义:折叠全部事件,重建 TUI 那份任务列表。两套来源并存:
//   - TodoWrite(老):input.todos 是全量快照 → 整表替换(id 用序号)。
//   - TaskCreate/TaskUpdate(新):增量。TaskCreate 的 tool_use 先入占位(id=null),
//     等配对 tool_result 所在 user 行的 toolUseResult.task.id 回填;没拿到 id(创建失败)→ 移除占位。
//     TaskUpdate 按 taskId 改 status/subject/activeForm;status='deleted' → 删行。
// 子代理(isSidechain)的任务不入主列表。
import type { JEvent, TaskItem, TaskStatus } from '../types.ts'

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null
}

const STATUSES: TaskStatus[] = ['pending', 'in_progress', 'completed']
function asStatus(x: unknown): TaskStatus | null {
  return STATUSES.includes(x as TaskStatus) ? (x as TaskStatus) : null
}

export function detectTasks(events: JEvent[]): TaskItem[] {
  let tasks: TaskItem[] = []
  const pendingCreate = new Map<string, TaskItem>() // TaskCreate 的 tool_use id → 占位(等结果回填真 id)
  for (const e of events) {
    if (e.isSidechain) continue
    const content = e.message?.content
    if (!Array.isArray(content)) continue
    for (const b of content) {
      if (!isObj(b)) continue
      if (b.type === 'tool_use') {
        const input = isObj(b.input) ? b.input : {}
        if (b.name === 'TodoWrite' && Array.isArray(input.todos)) {
          tasks = input.todos.filter(isObj).map((t, i) => ({
            id: String(i + 1),
            subject: String(t.content ?? ''),
            status: asStatus(t.status) ?? 'pending',
            activeForm: typeof t.activeForm === 'string' ? t.activeForm : undefined,
          }))
        } else if (b.name === 'TaskCreate') {
          const t: TaskItem = {
            id: null,
            subject: String(input.subject ?? ''),
            status: 'pending',
            activeForm: typeof input.activeForm === 'string' ? input.activeForm : undefined,
          }
          tasks.push(t)
          if (typeof b.id === 'string') pendingCreate.set(b.id, t)
        } else if (b.name === 'TaskUpdate') {
          const t = tasks.find((t) => t.id != null && t.id === String(input.taskId))
          if (!t) continue
          if (input.status === 'deleted') {
            tasks = tasks.filter((x) => x !== t)
          } else {
            const st = asStatus(input.status)
            if (st) t.status = st
            if (typeof input.subject === 'string') t.subject = input.subject
            if (typeof input.activeForm === 'string') t.activeForm = input.activeForm
          }
        }
      } else if (b.type === 'tool_result' && typeof b.tool_use_id === 'string') {
        const t = pendingCreate.get(b.tool_use_id)
        if (!t) continue
        pendingCreate.delete(b.tool_use_id)
        const tr = e.toolUseResult
        const id = isObj(tr) && isObj(tr.task) ? tr.task.id : undefined
        if (id != null) t.id = String(id)
        else tasks = tasks.filter((x) => x !== t)
      }
    }
  }
  return tasks
}
