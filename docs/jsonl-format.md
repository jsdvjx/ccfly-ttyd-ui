# Claude Code Session JSONL 格式完整规范

> 本规范由本机语料逆向(约 44k 条记录,470 个 `.jsonl` 文件,Claude Code **v2.1.143–2.1.168**,模型 `claude-opus-4-8 / -4-7 / haiku-4-5 / sonnet-4-6`)结合联网调研合成。除第 6 节标注为「官方」的部分外,**逐行字段级 schema 均属社区逆向 / 实现细节,无 Anthropic 官方承诺,可能随版本变化。**
>
> **计数免责**:本规范所有计数(行数、字段出现次数、enum 分布等)均为**某一次全量扫描的时点快照**。语料是 append-only 的、会**单调增长**,因此具体数字会随会话持续而漂移;文中数字仅反映扫描时点的量级与相对分布,不应当作恒定值。后文以「约」或注明计数处尤其如此。

---

## 1. 总览

### 1.1 文件与目录

- transcript 存于 `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`(官方文档证实)。
- `<encoded-cwd>` = 工作目录绝对路径,**每个非字母数字字符替换为 `-`**(`/Users/me/proj` → `-Users-me-proj`;Windows 把 `\` 也换 `-`)。
- 文件名三种形态:
  - `<uuid>.jsonl`:主线会话文件,`filename == sessionId`(本机 57 个)。
  - `agent-<agentId>.jsonl`:子代理(sidechain)文件,`filename != sessionId`,其内部 `sessionId` 是**父会话**的 id(本机 382 个)。
  - `journal.jsonl`:纯 `started`/`result` 账本,无内容行(本机 31 个)。

### 1.2 Append-only / 字节 offset 增量

文件是 **append-only** 的:每行一个独立 JSON 事件,新事件追加到文件末尾,**已有行永不原地改写**。这使得增量读取可按字节 offset 续读(记住上次读到的 offset,下次从该处继续解析新行)。

### 1.3 两种行的写入语义:additive-unique vs last-wins

| 类别                                                                                                    | 语义                                                                             | 是否带 uuid | 读取方式                     |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------- | ---------------------------- |
| **内容行**(assistant / user / system / attachment)                                                      | additive-unique:每行有唯一 `uuid`,代表一次真实事件,永不被改写                    | 是          | 全量保留,按 `uuid` 去重/回放 |
| **快照行/旁车行**(mode / permission-mode / ai-title / last-prompt / agent-name / file-history-snapshot) | last-wins:同一 key(多为 `sessionId` 或 `messageId`)反复追加,**最后一行为权威值** | 否          | 扫到 EOF,取该 key 的最后一条 |
| **账本行**(started / result / queue-operation)                                                          | additive:纯追加日志,无 uuid 树身份                                               | 否          | 顺序消费                     |

### 1.4 对话树:parentUuid

- 每个内容行带 `uuid`(36 字符 UUIDv4)与 `parentUuid`(指向同线程前一行的 uuid)。所有 `parentUuid` 边构成**对话树(DAG)**。
- `parentUuid: null` 标记线程根。
- **正常路径是线性链**(每行回指上一行)。当两行共享同一 `parentUuid` 时出现**分支**——这是「回退并改写重发」(rewind / edit-and-resend)的记录方式:旧分支保留在文件里但从活跃叶脱离(成为死分支)。
- **活跃叶**由 `last-prompt` 行的 `leafUuid` 在带外追踪;读者从该 leaf 沿 `parentUuid` 回溯重建实时会话,忽略死分支。

### 1.5 sessionId 与 /clear

- `sessionId` 在单个物理文件内恒定(本机 0 个文件含多个 sessionId)。
- **`/clear` 不追加到旧文件,而是起一个新 `sessionId` 与新 `<uuid>.jsonl`**。`--resume` 是 fork 而非重写,因此「一个文件 = 一个 session」成立。

### 1.6 sidechain 子代理

- 主 assistant 调用 `Task` 工具时,Claude Code 派生子代理,其整段 transcript 写入独立 `agent-<agentId>.jsonl`,**每行 `isSidechain: true`**,`sessionId` 等于**父会话**。
- 子代理文件首个 user 行 `parentUuid: null`(在自己文件内是新根),带 `agentId`;该 `agentId` == 文件名后缀,是关联主线↔侧链的连接键。
- 合并主文件与其 `agent-*` 侧链文件成单一时间线时,**用 `timestamp` 排序,而非 `parentUuid`**(两者物理分文件)。
- `Task` 调用对应的 `tool_result` 回投到主线程。本机近半数内容行为 sidechain,反映子代理重度使用。

---

## 2. 公共信封字段表

适用于全部内容行(assistant / user / system / attachment)。

| key                 | 类型                                    | 含义                                                                                                                                                                                                            | 可选 |
| ------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `type`              | enum                                    | 行类型判别符:`assistant`/`user`/`system`/`attachment` 等                                                                                                                                                        | 否   |
| `uuid`              | string(36-char UUIDv4)                  | 本行唯一 id,树节点身份;100% 存在、永不 null                                                                                                                                                                     | 否   |
| `parentUuid`        | string(uuid) \| null                    | 父行 uuid;`null` 为线程根。**注意:`system` 行的 `parentUuid` 可为 `null`**——孤立系统行(实测 `local_command` / `api_error` / `informational` 等常 `parentUuid:null`)不挂入对话树,作为独立系统事件存在(详见 §3.D) | 否   |
| `timestamp`         | string(ISO-8601 UTC, ms, `Z`)           | 行创建时间,如 `2026-06-08T07:10:14.091Z`                                                                                                                                                                        | 否   |
| `sessionId`         | string(uuid)                            | 所属会话 id;单文件内恒定                                                                                                                                                                                        | 否   |
| `cwd`               | string(绝对路径)                        | 写入时工作目录;cd 后逐行更新                                                                                                                                                                                    | 否   |
| `gitBranch`         | string                                  | 分支名;`HEAD`=detached;`""`=非仓库                                                                                                                                                                              | 否   |
| `version`           | string(semver)                          | 写入的 CLI 版本(如 `2.1.168`);长会话内可变,**解析时按 version 分支处理格式漂移**                                                                                                                                | 否   |
| `userType`          | enum(`external`)                        | 行为者类别;本机恒 `external`                                                                                                                                                                                    | 否   |
| `entrypoint`        | enum(`cli`\|`sdk-cli`\|`claude-vscode`) | 启动入口(分布约 cli 42743 / claude-vscode 685 / sdk-cli 367)                                                                                                                                                    | 否   |
| `isSidechain`       | boolean                                 | true=子代理侧链行,false=主线                                                                                                                                                                                    | 否   |
| `agentId`           | string(17-char hex, `a` 前缀)           | 子代理 id;仅子代理上下文行有,system 行从不有                                                                                                                                                                    | 是   |
| `slug`              | string(kebab `形容词-动名词-名词`)      | 会话级人类可读别名(如 `scalable-zooming-flute`);较新版才写,半数行有,赋值后会话内恒定                                                                                                                            | 是   |
| `isMeta`            | boolean                                 | 系统注入的伪 user/事件内容(不进模型上下文)                                                                                                                                                                      | 是   |
| `logicalParentUuid` | string(uuid)                            | 仅 `system/compact_boundary` 行;跨压缩边界回指压缩前最后一行                                                                                                                                                    | 是   |

> 旁车/账本行(mode / permission-mode / ai-title / last-prompt / agent-name / file-history-snapshot / started / result / queue-operation)**不带** uuid/parentUuid,字段集见第 3 节各条。

---

## 3. 顶层 type 逐个规范

> 本机实测的内容行/快照行/系统行/账本行共覆盖以下顶层 `type`。`assistant`、`user`、`system`、`attachment` 为带 uuid 的内容行;其余为旁车/账本行。下面按**内容行 / 快照行 / 生命周期 / 系统(system 子类型)**分组。
>
> 提醒:本节所有 **count** 字段均为时点快照(见 §1 顶部计数免责),会随 append-only 语料增长而漂移。

### 3.A 内容行(transcript-content)

#### 3.A.1 `assistant`

- **用途**:记录模型一条 API 回复,承载 content blocks(text/thinking/tool_use)、模型 id、stop_reason、token usage 与会话元数据。对话主链核心行。
- **scope**:additive-unique。**hasUuid**:是。**count**:约 25801(快照值;增长中,某次重扫为 25890)。

| key                    | 类型                                                                         | 含义                                                                              | 可选 |
| ---------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---- |
| `type`                 | enum(`assistant`)                                                            | 恒 assistant                                                                      | 否   |
| `uuid`                 | string(uuid)                                                                 | 本行唯一 id                                                                       | 否   |
| `parentUuid`           | string(uuid)                                                                 | 父行 uuid;assistant 行**从不为 null**                                             | 否   |
| `message`              | object                                                                       | Messages API 风格回复体(见 §4 父对象)                                             | 否   |
| `requestId`            | string(`req_*`)                                                              | 对应 Anthropic API 请求 id;合成行无(缺约 27 行)                                   | 是   |
| `agentId`              | string(hex)                                                                  | 仅 `isSidechain=true` 时出现,与 `attributionAgent` 几乎成对(见下方关键规律的例外) | 是   |
| `attributionAgent`     | enum(`workflow-subagent`\|`general-purpose`\|`Explore`\|`claude-code-guide`) | 产生本行的代理类型;仅子代理行,与 agentId 几乎成对(2 行例外)                       | 是   |
| `attributionSkill`     | string                                                                       | Skill 执行上下文(如 `deep-research`/`loop`/`update-config`)                       | 是   |
| `attributionMcpServer` | string                                                                       | 归属 MCP server(如 `fusion360`);约 157 行                                         | 是   |
| `attributionMcpTool`   | string                                                                       | 归属 MCP 工具(如 `fusion_execute`),与 server 成对                                 | 是   |
| `isApiErrorMessage`    | boolean                                                                      | API 错误占位消息标记;仅约 33 行(true 12/false 21)                                 | 是   |
| `apiErrorStatus`       | enum(`403`\|`429`)                                                           | API 错误 HTTP 码;仅 `model=<synthetic>` 错误占位行(约 7 行)                       | 是   |
| `error`                | enum(`authentication_failed`\|`unknown`\|`rate_limit`)                       | API 错误类型;仅合成错误占位行(约 12 行)                                           | 是   |

**enum**:`type=assistant`;`userType=external`;`entrypoint=cli|claude-vscode|sdk-cli`;`isSidechain=true|false`;`message.stop_reason=tool_use|end_turn|stop_sequence|max_tokens|null`。

`message.model` enum(各取值实测计数,反映 opus-4-8 为绝对主体、其余为少数派的真实分布):

| model                       | 实测计数 | 占比说明                 |
| --------------------------- | -------- | ------------------------ |
| `claude-opus-4-8`           | 约 20159 | 绝对多数(约 20159/25890) |
| `claude-opus-4-7`           | 约 3696  | 少数                     |
| `claude-haiku-4-5-20251001` | 约 1559  | 少数                     |
| `claude-sonnet-4-6`         | 约 447   | 少数                     |
| `<synthetic>`               | 约 33    | 本地合成占位/错误        |

> §1 头部概述把模型简写为 `claude-opus-4-8 / -4-7 / haiku-4-5 / sonnet-4-6`,系等价列举;实际分布以 opus-4-8 为主,其余三者为少数派。

**关键规律**:

- **主链行二者皆缺(精确成立)**:当 `isSidechain=false` 时,`agentId` 与 `attributionAgent` **均缺失,0 例外**(实测 13983 行主链 assistant,聚合 `(isSidechain, hasAgentId, hasAttributionAgent) = (False,False,False):13983`)。
- **侧链行二者绝大多数成对,但有 2 行例外**:对 `isSidechain=true` 的 assistant 行,`agentId` 与 `attributionAgent` 在 **11921/11923** 行成对出现;但**存在 2 行 `isSidechain=True` 且有 `agentId` 却缺 `attributionAgent`**。因此「`attributionAgent` 当且仅当 `isSidechain` 成对」应弱化为:**绝大多数(11921/11923)成对,有 2 行例外(有 `agentId` 无 `attributionAgent`)**。
- **聚合证据**:对 assistant 行按 `(isSidechain, hasAgentId, hasAttributionAgent)` 聚合得 `{(False,False,False):13983, (True,True,True):11921, (True,True,False):2}`。注意 `agentId` 仍与 `isSidechain=true` 严格相关(侧链行必有 agentId),仅 `attributionAgent` 有 2 行缺漏。

**合成行(synthetic)约 33 行**:`message.model="<synthetic>"`,`message.id` 为 UUID 格式(非 `msg_`),无 `requestId`,usage 全 0,`service_tier/inference_geo/iterations/speed` 均 null——它们把 API 错误/中断渲染成占位 assistant 消息。

```json
{
  "parentUuid": "0b797284-...",
  "isSidechain": false,
  "message": { "...": "(见 §4)" },
  "requestId": "req_011CbeZBsG5Vwn26scQ6yRja",
  "type": "assistant",
  "uuid": "848caad7-...",
  "timestamp": "2026-06-02T14:01:42.279Z",
  "userType": "external",
  "entrypoint": "cli",
  "cwd": "/Users/<redacted>",
  "sessionId": "0734365d-...",
  "version": "2.1.160",
  "gitBranch": "main",
  "slug": "scalable-zooming-flute"
}
```

#### 3.A.2 `user`

- **用途**:role:user 的对话回合。承载真实 prompt(string 或 text/image 块)**或** assistant tool_use 的结果(tool_result 块 + 可选 `toolUseResult` 富元数据)。也用于系统注入伪 user(isMeta)与压缩摘要。
- **scope**:additive-unique。**hasUuid**:是。**count**:约 14378(快照值;活跃增长语料,某次重扫为 14498)。

| key                         | 类型                                                                                | 含义                                                                                                                                                  | 可选 |
| --------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `type`                      | enum(`user`)                                                                        | 行判别符                                                                                                                                              | 否   |
| `uuid`                      | string                                                                              | 本行唯一 id                                                                                                                                           | 否   |
| `parentUuid`                | string \| null                                                                      | 线程前一行;根为 null                                                                                                                                  | 否   |
| `message`                   | object `{role:"user", content: string\|array}`                                      | API 消息体;仅含 `role`+`content` 两键                                                                                                                 | 否   |
| `toolUseResult`             | object \| string                                                                    | 工具执行的富元数据(按工具判别,见 §5);object 约 5254 / string 约 463;约 5717 个 tool_result 行有                                                       | 是   |
| `sourceToolAssistantUUID`   | string                                                                              | 本行应答的 assistant tool_use 所在消息 uuid;**所有约 12609 个 tool_result 行都有,且仅它们有**                                                         | 是   |
| `promptId`                  | string                                                                              | 把一次 prompt 回合与其工具交换分组(近乎全有,约 14375)                                                                                                 | 是   |
| `slug`                      | string                                                                              | 会话 AI 标题 slug(约 6963)                                                                                                                            | 是   |
| `isMeta`                    | enum(true)                                                                          | 系统注入伪 user(hook/IDE/命令上下文);约 430 行                                                                                                        | 是   |
| `isCompactSummary`          | enum(true)                                                                          | 本行为压缩摘要(大 string content);约 9 行,总伴 `isVisibleInTranscriptOnly`                                                                            | 是   |
| `isVisibleInTranscriptOnly` | enum(true)                                                                          | 渲染入 transcript 但排除出模型上下文;约 9 行                                                                                                          | 是   |
| `promptSource`              | enum(`typed`≈407\|`system`≈59\|`sdk`≈40)                                            | 真实 prompt 来源;仅 prompt 行(约 506)                                                                                                                 | 是   |
| `permissionMode`            | enum(`auto`≈542\|`bypassPermissions`≈388\|`default`≈24\|`acceptEdits`≈24\|`plan`≈1) | 发送 prompt 时的权限模式;仅 prompt 行(约 979)。**注意:`acceptEdits` 仅见于此处的 `user.permissionMode`,不见于 `permission-mode` 旁车行**(详见 §3.B.2) | 是   |
| `origin`                    | object `{kind}`                                                                     | 仅见 `{kind:"task-notification"}`(约 62)                                                                                                              | 是   |
| `imagePasteIds`             | array\<number\>                                                                     | 将 `[Image #N]` 文本占位关联到内联 base64 图块;约 30 行                                                                                               | 是   |
| `interruptedMessageId`      | string                                                                              | 用户打断的 assistant 消息 uuid;content 总为 array[text](重发的 prompt);约 48 行                                                                       | 是   |
| `mcpMeta`                   | object `{structuredContent:{result}}`                                               | MCP 工具结构化负载镜像;约 31 行                                                                                                                       | 是   |
| `sourceToolUseID`           | string                                                                              | 罕见:把 isMeta 跟随文本行系到具体 tool_use;约 5 行                                                                                                    | 是   |

**enum**:`userType=external`;`entrypoint=cli|claude-vscode|sdk-cli`;`permissionMode` 见上;`promptSource` 见上;`origin.kind=task-notification`。

> **`permissionMode` 两处口径差异(易混点)**:`user.permissionMode`(prompt 行)的取值集为 **5 值**:`auto|bypassPermissions|default|acceptEdits|plan`;而 §3.B.2 的 `permission-mode` 旁车行只有 **4 值**:`auto|bypassPermissions|default|plan`。**`acceptEdits` 只出现在 `user.permissionMode`(prompt 行),从不出现在 `permission-mode` 旁车行**(旁车行实测仅 4 值)。两处不是同一枚举,解析时勿混用。

**规律**:`message.content` string 约 1593 / array 约 12767;array 元素 `tool_result` 约 12531 / text 约 238 / image 约 35 / document 约 3。`agentId` 与 `isSidechain` 完美相关(`isSidechain=true` 时必有 `agentId`;true 约 7441 / false 约 6937)。tool_result 行**必有** `sourceToolAssistantUUID`。

```json
{
  "parentUuid": "<uuid>",
  "isSidechain": false,
  "promptId": "<id>",
  "type": "user",
  "message": { "role": "user", "content": "<redacted:107>" },
  "uuid": "<uuid>",
  "timestamp": "<iso>",
  "permissionMode": "auto",
  "promptSource": "typed",
  "userType": "external",
  "entrypoint": "cli",
  "cwd": "<path>",
  "sessionId": "<uuid>",
  "version": "2.1.168",
  "gitBranch": "HEAD"
}
```

#### 3.A.3 `attachment`

- **用途**:带 uuid 的内容行,向父消息注入合成/系统上下文:工具/skill/MCP 可用性增量、提醒、hook 错误、文件引用、plan/effort 模式切换、排队命令、后台任务状态。真实负载在内嵌 `attachment` 对象,其 `.type` 才是真判别符(24 种内类型)。
- **scope**:additive-unique。**hasUuid**:是。**count**:约 2244(快照值;增长中,某次重扫为 2271)。

| key           | 类型                    | 含义                                                                               | 可选 |
| ------------- | ----------------------- | ---------------------------------------------------------------------------------- | ---- |
| `type`        | enum(`attachment`)      | 外层判别符                                                                         | 否   |
| `uuid`        | string(uuid)            | 本行身份                                                                           | 否   |
| `parentUuid`  | string(uuid) \| null    | 链到被增强的消息                                                                   | 否   |
| `attachment`  | object(由 `.type` 判别) | 真实负载(见下方内类型枚举与子结构)                                                 | 否   |
| `isSidechain` | boolean                 | 是否侧链                                                                           | 否   |
| 信封字段      | —                       | `timestamp/sessionId/cwd/gitBranch/version/entrypoint/userType/slug/agentId` 同 §2 | 是   |

**`attachment.attachment.type` 全枚举(24,计数为快照,会增长)**:`task_reminder`(约 818)、`skill_listing`(约 436,某次重扫 438)、`deferred_tools_delta`(约 452,某次重扫 454)、`hook_non_blocking_error`(约 199)、`edited_text_file`(约 80)、`command_permissions`(约 35)、`file`(约 29)、`date_change`(约 24)、`workflow_keyword_request`(约 24)、`todo_reminder`(约 26)、`auto_mode`(约 19)、`ultra_effort_enter`(约 15)、`compact_file_reference`(约 11)、`queued_command`(约 42)、`mcp_instructions_delta`(约 44)、`ultrathink_effort`(约 2)、`plan_mode`(约 2)、`plan_file_reference`(约 3)、`plan_mode_exit`(约 1)、`ultra_effort_exit`(约 1)、`hook_additional_context`(约 1)、`task_status`(约 1)、`invoked_skills`(约 1)、`nested_memory`(约 1)。

**关键内类型子结构**:

- `deferred_tools_delta` / `edited_text_file`(delta 形):`{addedNames,addedLines,removedNames,readdedNames(,pendingMcpServers)}`
- `mcp_instructions_delta`:`{addedNames,addedBlocks,removedNames}`
- `skill_listing`:`{content,names,skillCount,isInitial}`
- `hook_non_blocking_error`:`{hookName,hookEvent,toolUseID,command,stdout,stderr,exitCode,durationMs}`
- `task_reminder`/`todo_reminder`:`{content:[],itemCount}`
- `command_permissions`:`{allowedTools:[]}`
- `file`:`{filename,content:{type,file:{filePath,content}}}`
- `edited_text_file`:`{filename,snippet}`
- `compact_file_reference`/`plan_file_reference`:`{filename,displayPath}` | `{planFilePath,planContent}`
- `plan_mode`/`plan_mode_exit`:`{reminderType,planFilePath,planExists,isSubAgent}`
- `date_change`:`{newDate}`;`queued_command`:`{prompt,commandMode}`
- `ultra_effort_enter`/`auto_mode`:`{reminderType}`;`ultrathink_effort`/`ultra_effort_exit`/`workflow_keyword_request`:`{}`(仅 type)
- `task_status`:`{taskId,taskType,description,status,deltaSummary,outputFilePath}`
- `invoked_skills`:`{skills:[{name,path,content}]}`;`nested_memory`:`{path,content:{path,type,content}}`
- `hook_additional_context`:`{content:[],hookEvent,hookName,toolUseID}`

> `task_status`(taskType=`local_agent`,status running/completed,outputFilePath)与 `queued_command`(commandMode=`task-notification`)是 journal.jsonl 后台代理生命周期在 transcript 内的镜像。

```json
{
  "parentUuid": "<uuid>",
  "isSidechain": false,
  "attachment": {
    "type": "task_status",
    "taskId": "ab639e4de870f9238",
    "taskType": "local_agent",
    "description": "<redacted>",
    "status": "running",
    "deltaSummary": null,
    "outputFilePath": "/private/tmp/.../tasks/ab639e4de870f9238.output"
  },
  "type": "attachment",
  "uuid": "<uuid>",
  "timestamp": "<iso>",
  "userType": "external",
  "entrypoint": "cli",
  "cwd": "<path>",
  "sessionId": "<uuid>",
  "version": "2.1.162",
  "gitBranch": "main"
}
```

### 3.B 快照行(metadata-snapshot,last-wins,无 uuid)

#### 3.B.1 `mode`

- **用途**:会话编辑/UI 输入模式(独立于权限模式的切换)。每变即追加,EOF 该 sessionId 最后一行权威。
- **scope**:last-wins。**hasUuid**:否。**count**:约 1811。

| key         | 类型           | 含义                                             |
| ----------- | -------------- | ------------------------------------------------ |
| `type`      | enum(`mode`)   | 判别符                                           |
| `mode`      | enum(`normal`) | 当前输入/UI 模式;本机所有约 1811 行仅见 `normal` |
| `sessionId` | string(uuid)   | 所属会话                                         |

```json
{ "type": "mode", "mode": "normal", "sessionId": "87b28d2b-023c-44d8-baa7-3c672550c25a" }
```

#### 3.B.2 `permission-mode`

- **用途**:会话当前工具权限模式(控制自动批准/沙箱)。每变追加,last-wins。单会话内可多次切换。
- **scope**:last-wins。**count**:约 2050。

| key              | 类型                                                 | 含义                                                                      |
| ---------------- | ---------------------------------------------------- | ------------------------------------------------------------------------- |
| `type`           | enum(`permission-mode`)                              | 判别符                                                                    |
| `permissionMode` | enum(`auto`\|`bypassPermissions`\|`default`\|`plan`) | 旁车行**仅 4 值**;分布约 auto 1230/bypassPermissions 811/plan 8/default 1 |
| `sessionId`      | string(uuid)                                         | 所属会话                                                                  |

> **口径差异提示**:`permission-mode` 旁车行的 `permissionMode` 实测**只有 4 个取值**(`auto|bypassPermissions|default|plan`),**不含 `acceptEdits`**。`acceptEdits` 仅见于 §3.A.2 的 `user.permissionMode`(prompt 行,5 值),**不见于 permission-mode 旁车行**。两处虽同名 `permissionMode`,但取值集不同,解析/校验时须分别对待。

```json
{
  "type": "permission-mode",
  "permissionMode": "auto",
  "sessionId": "87b28d2b-023c-44d8-baa7-3c672550c25a"
}
```

#### 3.B.3 `ai-title`

- **用途**:AI 生成的会话短标题(会话列表显示)。重生成即追加,last-wins(单文件见多达 15 次追加)。
- **scope**:last-wins。**count**:约 1877。

| key         | 类型             | 含义                            |
| ----------- | ---------------- | ------------------------------- |
| `type`      | enum(`ai-title`) | 判别符                          |
| `aiTitle`   | string           | AI 生成的人类可读标题(自由文本) |
| `sessionId` | string(uuid)     | 所属会话                        |

```json
{
  "type": "ai-title",
  "aiTitle": "<redacted:29>",
  "sessionId": "87b28d2b-023c-44d8-baa7-3c672550c25a"
}
```

#### 3.B.4 `last-prompt`

- **用途**:书签——最近 user prompt 文本 **+** 对话树当前叶(tip)。每回合/分支移动后追加,last-wins;resume/continue 据此重挂到正确节点并回显上次 prompt。
- **scope**:last-wins。**count**:约 2117。

| key          | 类型                 | 含义                                                                                                                      | 可选 |
| ------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---- |
| `type`       | enum(`last-prompt`)  | 判别符                                                                                                                    | 否   |
| `lastPrompt` | string \| null       | 最近 user prompt 文本;约 8/2117 为 null                                                                                   | 是   |
| `leafUuid`   | string(uuid,36-char) | 当前叶/tip 内容行 uuid;**100% 命中同文件真实内容行 uuid**(多指 user 行,有时 assistant)。这是会话跨追加记住分支 tip 的机制 | 否   |
| `sessionId`  | string(uuid)         | 所属会话                                                                                                                  | 否   |

> `leafUuid` 是回指 additive-unique 内容行的**后向引用**,非前向 id。

```json
{
  "type": "last-prompt",
  "lastPrompt": "<redacted:107>",
  "leafUuid": "34a38bc3-b584-428d-a87e-5f98555acaf6",
  "sessionId": "87b28d2b-023c-44d8-baa7-3c672550c25a"
}
```

#### 3.B.5 `agent-name`

- **用途**:会话 agent 的显示名(如命名 worktree/agent 身份)。每变追加,last-wins。
- **scope**:last-wins。**count**:约 519(本机仅一个 distinct 值,跨多文件重复打标)。

| key         | 类型               | 含义                   |
| ----------- | ------------------ | ---------------------- |
| `type`      | enum(`agent-name`) | 判别符                 |
| `agentName` | string             | agent 显示名(自由文本) |
| `sessionId` | string(uuid)       | 所属会话               |

```json
{
  "type": "agent-name",
  "agentName": "<redacted:28>",
  "sessionId": "5dea5258-e743-4532-a24c-e8884a4fe500"
}
```

#### 3.B.6 `file-history-snapshot`

- **用途**:对 agent 正在追踪/编辑文件的备份状态打 checkpoint,支持撤销/恢复(rewind)。每个触碰文件的回合一条基线快照(`isSnapshotUpdate=false`),随备份累积追加增量(`isSnapshotUpdate=true`)。
- **scope**:last-wins(按 `messageId` 折叠)。**count**:约 1579(false 1113 / true 466)。

| key                | 类型                                                | 含义                                                                                                                                                               |
| ------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `type`             | enum(`file-history-snapshot`)                       | 判别符                                                                                                                                                             |
| `messageId`        | string(uuid)                                        | 锚定的 user/assistant 消息 uuid(命中同文件真实消息);恢复锚点(「rewind 到此消息」用此处快照)                                                                        |
| `snapshot`         | object `{messageId, trackedFileBackups, timestamp}` | checkpoint 体。`trackedFileBackups` 为 `<相对/显示路径> -> {backupFileName: string\|null, version: number(从 1 单调递增), backupTime: ISO-8601}`;无追踪文件时 `{}` |
| `isSnapshotUpdate` | boolean                                             | false=新回合基线;true=向既有锚点增量追加更新(同 messageId 多条增量折叠,取最新)                                                                                     |

```json
{
  "type": "file-history-snapshot",
  "messageId": "<uuid>",
  "snapshot": {
    "messageId": "<uuid>",
    "trackedFileBackups": {
      "eh-search.html": {
        "backupFileName": "af2052f25647b2a9@v2",
        "version": 2,
        "backupTime": "2026-06-02T17:35:15.278Z"
      }
    },
    "timestamp": "2026-06-02T17:35:15.278Z"
  },
  "isSnapshotUpdate": true
}
```

### 3.C 生命周期/账本(agent-lifecycle)

#### 3.C.1 `started`(journal.jsonl)

- **用途**:标记后台/侧链代理或 workflow run 的**开始**。**仅存于 `journal.jsonl`**(从不在 session transcript)。与共享 `key`+`agentId` 的 `result` 行配对。
- **scope**:additive。**hasUuid**:否。**count**:约 312(快照值;增长中,某次重扫为 314)。

| key       | 类型                                  | 含义                                                                                                                         |
| --------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `type`    | enum(`started`)                       | 判别符                                                                                                                       |
| `key`     | string(`v2:`+64-hex sha256)           | 任务的内容寻址稳定身份(join key);约 309 distinct,约 298(某次重扫 310)后续有 result(约 11 个 started-only=未完成/运行中/中止) |
| `agentId` | string(17-hex,如 `af8f9292c4eb3b056`) | 每 run 不透明 id;与 key 1:1(此 agentId 区别于内容行上的会话级 agentId)                                                       |

> 非内容行:无 uuid/parentUuid/timestamp/sessionId。约 3 个 key 出现 >1 distinct agentId(重试)。

```json
{ "type": "started", "key": "v2:<64hex>", "agentId": "<17hex>" }
```

#### 3.C.2 `result`(journal.jsonl)

- **用途**:标记配对 `started` 代理的**完成**,携带最终结构化输出。同为 journal.jsonl append-only。`(key, agentId)` 闭合生命周期。
- **scope**:additive。**count**:约 298(快照值;增长中,某次重扫为 310)。

| key       | 类型                 | 含义                                                                                                                                                                                                                                                                                                                                                                                          |
| --------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`    | enum(`result`)       | 判别符                                                                                                                                                                                                                                                                                                                                                                                        |
| `key`     | string(`v2:`+64-hex) | 与 started 同;实测 result 行 100% 有匹配 started                                                                                                                                                                                                                                                                                                                                              |
| `agentId` | string(17-hex)       | 与 started 同                                                                                                                                                                                                                                                                                                                                                                                 |
| `result`  | object \| string     | 代理最终答案。**形状自由,由子代理角色/prompt 决定,无固定 schema**(object 约 245 / string 约 53)。如 web-search:`{results:[{url,title,relevance,snippet}]}`;verifier:`{confidence,evidence,refuted,counterSource}`;claim-extractor:`{claims,sourceQuality,publishDate}`;builder:`{filesWritten,buildOk,summary,uncertainties}`;orchestrator:`{question,summary,angles}`;另约 60 种角色专属键集 |

> `result.result` 是多态 JSON blob,按代理任务类型当作不透明输出。此 journal 的 agentId/key 与派生它的 Task tool 所发 id 相同,让宿主把 Task tool_use → 后台 run start → result 关联。

```json
{
  "type": "result",
  "key": "v2:<64hex>",
  "agentId": "<17hex>",
  "result": {
    "results": [
      { "url": "<redacted>", "title": "<redacted>", "relevance": "high", "snippet": "<redacted>" }
    ]
  }
}
```

#### 3.C.3 `queue-operation`(transcript 内联)

- **用途**:会话内 prompt/命令队列的 append-only 审计:用户(或后台 task-notification)入队/出队/移除排队消息。追踪后台代理/workflow 完成通知与排队斜杠命令。
- **scope**:additive。**hasUuid**:否。**count**:约 378。

| key         | 类型                                 | 含义                                                                                                                                                                                      | 可选 |
| ----------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `type`      | enum(`queue-operation`)              | 判别符                                                                                                                                                                                    | 否   |
| `operation` | enum(`enqueue`\|`dequeue`\|`remove`) | 队列变更;计数约 190/144/44                                                                                                                                                                | 否   |
| `timestamp` | string(ISO-8601 UTC)                 | 操作时间(enqueue+dequeue 对常同时间戳)                                                                                                                                                    | 否   |
| `sessionId` | string(uuid)                         | 所属会话                                                                                                                                                                                  | 否   |
| `content`   | string \| null                       | 排队负载文本;约 225 行 null,约 153 行为 string。常为 `<task-notification>` XML(含 task-id、tool-use-id、output-file、status、summary)——后台代理/workflow 完成后据此回投 prompt 唤醒主代理 | 是   |

```json
{
  "type": "queue-operation",
  "operation": "enqueue",
  "timestamp": "2026-06-02T17:35:17.305Z",
  "sessionId": "<uuid>",
  "content": "<task-notification>\n<task-id>wyavqy195</task-id>\n<tool-use-id>toolu_<redacted></tool-use-id>\n<output-file>/private/tmp/.../tasks/wyavqy195.output</output-file>\n<status>completed</status>\n<summary><redacted></summary>\n</task-notification>"
}
```

### 3.D 系统行 `system`(transcript-content,带 uuid,subtype 判别)

`type:"system"` 是会话内系统事件内容行,带 uuid/parentUuid/timestamp,挂在对话树但非 user/assistant。共约 1489 行,靠 `subtype` 分 8 种。

> **`system` 行 `parentUuid` 可为 `null`(规律)**:并非所有 system 行都挂入对话树。**孤立系统行**——典型为 `local_command`、`api_error`、`informational`——实测 `parentUuid:null`,即它们不是某条 user/assistant 的子节点,而是独立的系统事件。读者重建对话树时应把这类 `parentUuid:null` 的 system 行当作游离/旁注节点,不应误判为线程根或断链。(`turn_duration` / `away_summary` / `scheduled_task_fire` / `compact_boundary` 等多数挂有 `parentUuid`;`compact_boundary` 另以 `logicalParentUuid` 回指压缩前的真实父。)

**共享字段(信封外的 system 专属)**:

| key          | 类型                                           | 含义                                                                                                                                                                              | 可选 |
| ------------ | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `type`       | enum(`system`)                                 | 固定                                                                                                                                                                              | 否   |
| `subtype`    | enum(8 种,见下)                                | 区分系统事件类别                                                                                                                                                                  | 否   |
| `parentUuid` | string(uuid) \| null                           | 父行 uuid;**可为 `null`**(孤立系统行,如 local_command/api_error/informational)                                                                                                    | 否   |
| `level`      | enum(`error`\|`suggestion`\|`info`\|`warning`) | 日志级别,按 subtype 固定:api_error=error,stop_hook_summary=suggestion,local_command/compact_boundary=info,informational=warning;turn_duration/away_summary/scheduled_task_fire 无 | 是   |
| `isMeta`     | boolean                                        | turn_duration/away_summary/local_command/scheduled_task_fire/compact_boundary/informational 有且=false;api_error/stop_hook_summary 无                                             | 是   |
| `slug`       | string                                         | api_error/informational 缺失                                                                                                                                                      | 是   |

**subtype 全枚举(计数为快照,会增长)**:`turn_duration`(约 852)、`stop_hook_summary`(约 198)、`away_summary`(约 165,某次重扫 166)、`local_command`(约 164)、`api_error`(约 63)、`scheduled_task_fire`(约 37)、`compact_boundary`(约 9)、`informational`(约 3)。

#### 3.D.1 `system/turn_duration`

一次回合耗时与状态统计(最常见,约 852)。

| key                           | 类型           | 含义                                           | 可选 |
| ----------------------------- | -------------- | ---------------------------------------------- | ---- |
| `durationMs`                  | number(int)    | 回合耗时毫秒(154 ~ 4789519)                    | 否   |
| `messageCount`                | number(int)    | 回合涉及消息数                                 | 否   |
| `pendingBackgroundAgentCount` | number \| null | 回合结束仍在跑的后台子代理数;无则缺省,实测 1/2 | 是   |
| `pendingWorkflowCount`        | number \| null | 挂起 workflow 数;同上,实测 1/2                 | 是   |

> 无 level、无 content。pending\* 仅 >0 时出现(约 803/852 二者均缺省)。

```json
{
  "type": "system",
  "subtype": "turn_duration",
  "durationMs": 32512,
  "messageCount": 13,
  "pendingBackgroundAgentCount": 1,
  "pendingWorkflowCount": 1,
  "uuid": "<uuid>",
  "parentUuid": "<uuid>",
  "isMeta": false,
  "timestamp": "<iso>"
}
```

#### 3.D.2 `system/stop_hook_summary`

Stop hook(会话停止/回合结束触发的用户配置 hook)执行汇总(约 198)。

| key                     | 类型               | 含义                                  |
| ----------------------- | ------------------ | ------------------------------------- |
| `hookCount`             | number(int)        | 触发 hook 数(恒 1)                    |
| `hookInfos`             | array\<object\>    | 每 hook 信息 `{command, durationMs}`  |
| `hookErrors`            | array\<string\>    | hook 报错(非阻塞失败留此),无错为 `[]` |
| `hookAdditionalContext` | array\<string\>    | hook 欲注入模型的额外上下文;恒 `[]`   |
| `preventedContinuation` | boolean            | 是否阻止会话继续(恒 false)            |
| `stopReason`            | string             | 停止原因文本(恒空串)                  |
| `hasOutput`             | boolean            | hook 是否有输出(恒 true)              |
| `toolUseID`             | string(uuid)       | 关联触发停止的 tool_use/回合标识      |
| `level`                 | enum(`suggestion`) | 恒 suggestion                         |

```json
{
  "type": "system",
  "subtype": "stop_hook_summary",
  "hookCount": 1,
  "hookInfos": [{ "command": "<redacted>", "durationMs": 16 }],
  "hookErrors": ["Failed with non-blocking status code: /bin/sh: uv: command not found"],
  "hookAdditionalContext": [],
  "preventedContinuation": false,
  "stopReason": "",
  "hasOutput": true,
  "level": "suggestion",
  "toolUseID": "<uuid>",
  "uuid": "<uuid>"
}
```

#### 3.D.3 `system/away_summary`

用户离开返回时的「刚才在做什么 + 下一步」回顾(约 166;快照值,草稿曾标 165,增长所致)。

| key       | 类型    | 含义                                                                       |
| --------- | ------- | -------------------------------------------------------------------------- |
| `content` | string  | 离开回顾的自然语言摘要(含 next step,带 `(disable recaps in /config)` 提示) |
| `isMeta`  | boolean | 恒 false                                                                   |

```json
{
  "type": "system",
  "subtype": "away_summary",
  "content": "<redacted:330>",
  "uuid": "<uuid>",
  "parentUuid": "<uuid>",
  "isMeta": false,
  "timestamp": "<iso>",
  "slug": "<redacted>"
}
```

#### 3.D.4 `system/local_command`

本地斜杠命令执行记录:命令调用或命令本地 stdout 输出(约 164)。

| key       | 类型         | 含义                                                                                                                                                                             |
| --------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `content` | string       | 命令调用块(`<command-name>X</command-name><command-message>…</command-message><command-args>…</command-args>`)或输出块(`<local-command-stdout>…</local-command-stdout>`,含 ANSI) |
| `level`   | enum(`info`) | 恒 info                                                                                                                                                                          |
| `isMeta`  | boolean      | 恒 false                                                                                                                                                                         |

> 实测 command-name:`/context`(约 59)、`/model`(约 19);其余约 86 条为 `<local-command-stdout>` 输出。该 subtype 的 `parentUuid` 常为 `null`(孤立系统行,见 §3.D 开头规律)。

```json
{
  "type": "system",
  "subtype": "local_command",
  "content": "<command-name>/context</command-name>\n<command-message>context</command-message>\n<command-args></command-args>",
  "level": "info",
  "uuid": "<uuid>",
  "parentUuid": null,
  "isMeta": false
}
```

#### 3.D.5 `system/api_error`

Anthropic API 请求失败与自动重试遥测(约 63)。`error` 对象多态。

| key            | 类型           | 含义                                                                                                                                                                                                                 |
| -------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `level`        | enum(`error`)  | 恒 error                                                                                                                                                                                                             |
| `cause`        | object \| null | 底层成因(网络类);`{code:string(如 ECONNRESET), path:string(URL), errno:number}`;非网络错误为 null                                                                                                                    |
| `error`        | object         | 多态。网络:`{type:null, message, formatted, connection:{code,message,isSSLError}, isNetworkDown, rateLimits}`;HTTP:`{type:enum(overloaded_error/authentication_error), status:number(529/401), headers:object, ...}` |
| `retryInMs`    | number(float)  | 距下次重试退避毫秒(带抖动)                                                                                                                                                                                           |
| `retryAttempt` | number(int)    | 当前第几次重试                                                                                                                                                                                                       |
| `maxRetries`   | number(int)    | 最大重试次数(实测 10)                                                                                                                                                                                                |

**enum**:`error.type=null|overloaded_error|authentication_error`;`cause.code=null|ECONNRESET|UNKNOWN_CERTIFICATE_VERIFICATION_ERROR`。

> 该 subtype 的 `parentUuid` 常为 `null`(孤立系统行,见 §3.D 开头规律)。

```json
{
  "type": "system",
  "subtype": "api_error",
  "level": "error",
  "cause": {
    "code": "ECONNRESET",
    "path": "https://api.anthropic.com/v1/messages?beta=true",
    "errno": 0
  },
  "error": { "type": null, "cause": { "code": "ECONNRESET", "path": "<redacted>", "errno": 0 } },
  "retryInMs": 561.5,
  "retryAttempt": 1,
  "maxRetries": 10,
  "uuid": "<uuid>"
}
```

#### 3.D.6 `system/scheduled_task_fire`

定时/计划任务(scheduled task / cron routine)被触发的标记行(约 37)。

| key       | 类型    | 含义                                                  |
| --------- | ------- | ----------------------------------------------------- |
| `content` | string  | 触发提示,如 `"Running scheduled task (Jun 7 5:08pm)"` |
| `isMeta`  | boolean | 恒 false                                              |

```json
{
  "type": "system",
  "subtype": "scheduled_task_fire",
  "content": "Running scheduled task (Jun 7 5:08pm)",
  "isMeta": false,
  "uuid": "<uuid>",
  "parentUuid": "<uuid>",
  "slug": "<redacted>"
}
```

#### 3.D.7 `system/compact_boundary`

`/compact`(压缩)时插入的边界标记(约 9)。

| key                 | 类型         | 含义                                                                         |
| ------------------- | ------------ | ---------------------------------------------------------------------------- |
| `content`           | string       | 恒 `"Conversation compacted"`                                                |
| `level`             | enum(`info`) | 恒 info                                                                      |
| `logicalParentUuid` | string(uuid) | 压缩逻辑上承接的上一条消息 uuid(跨边界真实父),区别于 `parentUuid`(常为 null) |
| `compactMetadata`   | object       | 压缩元数据(见下条)                                                           |
| `isMeta`            | boolean      | 恒 false                                                                     |

> trigger 实测 auto(约 5)/manual(约 4)。本 subtype 的 `parentUuid` 常为 `null`,真实承接父在 `logicalParentUuid`。

```json
{
  "type": "system",
  "subtype": "compact_boundary",
  "content": "Conversation compacted",
  "level": "info",
  "parentUuid": null,
  "logicalParentUuid": "<uuid>",
  "compactMetadata": {
    "trigger": "auto",
    "preTokens": 1002491,
    "postTokens": 12345,
    "durationMs": 167194,
    "preCompactDiscoveredTools": ["<redacted>"],
    "preservedSegment": {},
    "preservedMessages": {}
  },
  "uuid": "<uuid>"
}
```

**内嵌 `compactMetadata`**:

| key                         | 类型                   | 含义                                                                |
| --------------------------- | ---------------------- | ------------------------------------------------------------------- |
| `trigger`                   | enum(`auto`\|`manual`) | auto(达阈值自动)/manual(用户 /compact)                              |
| `preTokens`                 | number(int)            | 压缩前 token(可达 1,002,491)                                        |
| `postTokens`                | number(int)            | 压缩后 token                                                        |
| `durationMs`                | number(int)            | 压缩耗时毫秒                                                        |
| `preCompactDiscoveredTools` | array\<string\>        | 压缩前可用工具名(如 TaskCreate, WebFetch)                           |
| `preservedSegment`          | object                 | 保留区段边界 `{headUuid, anchorUuid, tailUuid}`                     |
| `preservedMessages`         | object                 | `{anchorUuid, uuids:[](进入新上下文的子集), allUuids:[](区段全部)}` |

```json
{
  "trigger": "auto",
  "preTokens": 1002491,
  "postTokens": 12345,
  "durationMs": 167194,
  "preCompactDiscoveredTools": ["TaskCreate", "WebFetch", "WebSearch"],
  "preservedSegment": { "headUuid": "<uuid>", "anchorUuid": "<uuid>", "tailUuid": "<uuid>" },
  "preservedMessages": { "anchorUuid": "<uuid>", "uuids": ["<uuid>"], "allUuids": ["<uuid>"] }
}
```

#### 3.D.8 `system/informational`

向用户展示的信息横幅(如 Auto 权限模式说明),最稀有(约 3)。

| key       | 类型            | 含义                                  |
| --------- | --------------- | ------------------------------------- |
| `content` | string          | 信息文本(如 Auto mode 说明与风险提示) |
| `level`   | enum(`warning`) | 恒 warning                            |
| `isMeta`  | boolean         | 恒 false                              |

> 该 subtype 的 `parentUuid` 常为 `null`(孤立系统行,见 §3.D 开头规律)。

```json
{
  "type": "system",
  "subtype": "informational",
  "content": "Auto mode lets Claude handle permission prompts automatically <redacted:380>",
  "level": "warning",
  "parentUuid": null,
  "isMeta": false,
  "uuid": "<uuid>"
}
```

---

## 4. `message` 与 `message.content` block schema

### 4.1 `assistant.message`(父对象)

随父 assistant 行写入,无独立 uuid(有 `message.id`)。

| key                  | 类型                                                                                                        | 含义                                                                                                                                                                                                 | 可选 |
| -------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `id`                 | string                                                                                                      | 真实行 `msg_*` 前缀,合成行为 UUID                                                                                                                                                                    | 否   |
| `type`               | enum(`message`)                                                                                             | 恒 message                                                                                                                                                                                           | 否   |
| `role`               | enum(`assistant`)                                                                                           | 恒 assistant                                                                                                                                                                                         | 否   |
| `model`              | enum(`claude-opus-4-8`\|`claude-opus-4-7`\|`claude-haiku-4-5-20251001`\|`claude-sonnet-4-6`\|`<synthetic>`) | 产生回复的模型;实测分布 opus-4-8 为绝对多数(约 20159),opus-4-7 约 3696、haiku-4-5 约 1559、sonnet-4-6 约 447、`<synthetic>`≈33(=本地合成占位/错误)。详见 §3.A.1 model 计数表                         | 否   |
| `content`            | array\<object\>                                                                                             | 内容块数组,元素 type=text\|thinking\|tool_use,可混合                                                                                                                                                 | 否   |
| `stop_reason`        | enum(`tool_use`\|`end_turn`\|`stop_sequence`\|`max_tokens`\|null)                                           | tool_use=请求工具(约 16316),null=被中断/流式中间态(约 7532),end_turn=自然结束(约 1799),stop_sequence=合成行(约 33),max_tokens(约 2)                                                                  | 否   |
| `stop_sequence`      | string \| null                                                                                              | 真实行恒 null,合成行为空串 `""`                                                                                                                                                                      | 否   |
| `stop_details`       | null                                                                                                        | 全为 null(预留)                                                                                                                                                                                      | 否   |
| `usage`              | object                                                                                                      | token 计量(见 §4.2)                                                                                                                                                                                  | 否   |
| `container`          | null                                                                                                        | 全 null(仅合成行显式带出该键)                                                                                                                                                                        | 是   |
| `diagnostics`        | object \| null                                                                                              | 非 null 时 `{cache_miss_reason:{type, cache_missed_input_tokens?}}`;`type=tools_changed\|previous_message_not_found\|unavailable\|system_changed\|messages_changed\|model_changed`(约 602 行非 null) | 是   |
| `context_management` | object \| null                                                                                              | 非 null 时如 `{applied_edits:[...]}`(自动上下文编辑/压缩,约 6 行)                                                                                                                                    | 是   |

```json
{
  "id": "msg_0165...",
  "type": "message",
  "role": "assistant",
  "model": "claude-opus-4-8",
  "content": [{ "type": "text", "text": "<redacted:5>" }],
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "container": null,
  "diagnostics": null,
  "context_management": null,
  "usage": { "...": "(见 §4.2)" }
}
```

### 4.2 `assistant.message.usage`

| key                           | 类型                              | 含义                                                                                                                                 | 可选 |
| ----------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| `input_tokens`                | number                            | 未走 cache 的输入 token                                                                                                              | 否   |
| `output_tokens`               | number                            | 输出 token                                                                                                                           | 否   |
| `cache_creation_input_tokens` | number                            | 写入 prompt cache 的 token                                                                                                           | 否   |
| `cache_read_input_tokens`     | number                            | 命中 cache 读取的 token                                                                                                              | 否   |
| `cache_creation`              | object                            | 按 TTL:`{ephemeral_5m_input_tokens, ephemeral_1h_input_tokens}`                                                                      | 否   |
| `server_tool_use`             | object                            | `{web_search_requests, web_fetch_requests}`                                                                                          | 否   |
| `service_tier`                | enum(`standard`\|null)            | 服务层级;合成行 null                                                                                                                 | 否   |
| `speed`                       | enum(`standard`\|null)            | 速度档;部分/合成行 null                                                                                                              | 是   |
| `inference_geo`               | enum(`not_available`\|`""`\|null) | 推理地理区;合成行 null                                                                                                               | 是   |
| `iterations`                  | array\<object\> \| null           | 单次 API 内部各轮逐轮计量(每元素含 input/output/cache\_\* token + `type:message`);仅 stop_reason 非 null 的约 18121 行有;合成行 null | 是   |

> 合成行 usage 全 0 且 service_tier/inference_geo/iterations/speed 均 null。

```json
{
  "input_tokens": 2142,
  "output_tokens": 7,
  "cache_creation_input_tokens": 487,
  "cache_read_input_tokens": 16939,
  "service_tier": "standard",
  "speed": "standard",
  "inference_geo": "not_available",
  "server_tool_use": { "web_search_requests": 0, "web_fetch_requests": 0 },
  "cache_creation": { "ephemeral_1h_input_tokens": 487, "ephemeral_5m_input_tokens": 0 },
  "iterations": [
    {
      "input_tokens": 2142,
      "output_tokens": 7,
      "cache_read_input_tokens": 16939,
      "cache_creation_input_tokens": 487,
      "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 487 },
      "type": "message"
    }
  ]
}
```

### 4.3 `message.content[]` 六种 block

`content` 是多态数组,块计数(快照,会增长):tool_use 约 12555 / text 约 8833 / thinking 约 4313 / tool_result 约 12609 / image 约 35 / document 约 3。

#### 4.3.1 `text`

| key    | 类型         | 含义                                                        | 可选 |
| ------ | ------------ | ----------------------------------------------------------- | ---- |
| `type` | enum(`text`) | 判别符                                                      | 否   |
| `text` | string       | assistant 中=模型可见 prose;user 中=输入/注入文本;可为 `""` | 否   |

```json
{ "type": "text", "text": "<redacted:markdown prose>" }
```

#### 4.3.2 `thinking`(仅 assistant)

| key         | 类型             | 含义                                               | 可选 |
| ----------- | ---------------- | -------------------------------------------------- | ---- |
| `type`      | enum(`thinking`) | 判别符                                             | 否   |
| `thinking`  | string           | 扩展思考内容(可为空)                               | 否   |
| `signature` | string           | 思考内容的服务端 base64 签名(replay/tool-use 校验) | 否   |

> 本机无 `redacted_thinking` 变体或 `data` 字段,仅标准 `{type,thinking,signature}`。

```json
{
  "type": "thinking",
  "thinking": "<redacted:reasoning>",
  "signature": "EogDCmMIDhgC<redacted:base64>"
}
```

#### 4.3.3 `tool_use`(仅 assistant)

| key      | 类型              | 含义                                                                               | 可选 |
| -------- | ----------------- | ---------------------------------------------------------------------------------- | ---- |
| `type`   | enum(`tool_use`)  | 判别符                                                                             | 否   |
| `id`     | string(`toolu_*`) | 工具调用 id,与 `tool_result.tool_use_id` 配对                                      | 否   |
| `name`   | string/enum       | 工具名;见下方枚举                                                                  | 否   |
| `input`  | object            | 工具入参(随工具而定;本机恒为对象,非 null)                                          | 否   |
| `caller` | object            | 调用来源;实测恒 `{type:"direct"}`(模型直接发起,Claude Code 自有扩展,非原生 API 块) | 否   |

**name 枚举(高频,计数为快照)**:`Bash`(约 5415)、`Read`(约 2840)、`Edit`(约 1829)、`WebSearch`(约 555)、`Write`(约 540)、`StructuredOutput`(约 347)、`WebFetch`(约 333)、`ToolSearch`(约 169)、`TaskUpdate`、`AskUserQuestion`、`TaskCreate`、`Agent`、`ScheduleWakeup`、`Workflow`、`Grep`、`Glob`、`Skill`、`TaskList`、`TodoWrite`、`EnterPlanMode`、`ExitPlanMode`、`CronCreate`、`CronDelete`、`CronList`、罕见 legacy `bash`,以及命名空间 `mcp__<server>__<tool>`。

```json
{
  "type": "tool_use",
  "id": "toolu_01YRNxUUmHtNntGs4nsRGkBB",
  "name": "Bash",
  "input": { "command": "<redacted:53>", "description": "<redacted:21>" },
  "caller": { "type": "direct" }
}
```

#### 4.3.4 `tool_result`(仅 user)

| key           | 类型                | 含义                                                                                                                                                                                       | 可选 |
| ------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| `type`        | enum(`tool_result`) | 判别符                                                                                                                                                                                     | 否   |
| `tool_use_id` | string(`toolu_*`)   | 应答的 tool_use id(外键)                                                                                                                                                                   | 否   |
| `content`     | string \| array     | 结果负载。string 约 12295;array 元素:`{type:text,text}` / `{type:image,source:{type:base64,media_type,data}}`(约 77) / `{type:tool_reference,tool_name}`(约 169,ToolSearch 延迟工具结果用) | 否   |
| `is_error`    | boolean             | true=工具失败(约 426),false(约 5258),省略=隐式成功(约 6894)                                                                                                                                | 是   |

> 行级富元数据(`toolUseResult`)在外层 user 行,**不在此块内**。

```json
{
  "type": "tool_result",
  "tool_use_id": "toolu_01<redacted>",
  "content": "       0",
  "is_error": false
}
```

#### 4.3.5 `image`(user,也可嵌套于 tool_result.content)

| key      | 类型          | 含义                                                   | 可选 |
| -------- | ------------- | ------------------------------------------------------ | ---- |
| `type`   | enum(`image`) | 判别符                                                 | 否   |
| `source` | object        | `{type:"base64", media_type, data}`;无 url-source 变体 | 否   |

**enum**:`source.type=base64`;`media_type=image/png(约 19)\|image/jpeg(约 16)`。约 35 个顶层块均 base64;同形 source 也现于约 77 个 tool_result.content 内图块。

```json
{
  "type": "image",
  "source": { "type": "base64", "media_type": "image/png", "data": "iVBORw0KGgo<redacted:base64>" }
}
```

#### 4.3.6 `document`(user)

| key      | 类型             | 含义                                                         | 可选 |
| -------- | ---------------- | ------------------------------------------------------------ | ---- |
| `type`   | enum(`document`) | 判别符                                                       | 否   |
| `source` | object           | `{type:"base64", media_type, data}`(data 为 base64 文件字节) | 否   |

**enum**:`media_type=application/pdf`(约 3/3)。本机仅约 3 例,无 title/context/citations 字段。

```json
{
  "type": "document",
  "source": {
    "type": "base64",
    "media_type": "application/pdf",
    "data": "JVBERi0xLjQ<redacted:base64>"
  }
}
```

---

## 5. `toolUseResult` 按工具分组的结果 schema

`toolUseResult` 挂在 `type:user` 行(行本身有 uuid),是描述工具实际运行的行级富元数据(供 harness/UI,非严格给模型)。形状按产生它的工具判别(`tool_use.name`)。值为 **object(约 5254)** 或 **string(约 463,多为 MCP/错误原文)**。硬错误时整个 `toolUseResult` 是 `Error: ...` 开头的纯字符串。

> **判别需经 `tool_use_id` 外键回溯(实现者必踩点)**:`toolUseResult` 对象**本身不含工具名**,无法直接看出该用哪种形状解析。判别要分两步:(1) 先扫描所有 assistant 行的 `message.content[]` 里的 `tool_use` 块,建立 `tool_use.id -> tool_use.name` 映射;(2) 对带 `toolUseResult` 的 user 行,取其 `tool_result` 块的 `tool_use_id`(亦即外层 `sourceToolAssistantUUID` 指向的 assistant 消息内对应的 `tool_use.id`),用该 id 反查上一步映射得到工具名,再据工具名套用本节对应子 schema。换言之,「形状按 `tool_use.name` 判别」必须先经 `tool_use_id` 外键把 `toolUseResult` 关联回它的工具名,纯 `toolUseResult` 本身不携带工具标识。

### 5.1 Bash

| key                         | 类型    | 含义                                                                            | 可选 |
| --------------------------- | ------- | ------------------------------------------------------------------------------- | ---- |
| `stdout`                    | string  | 捕获 stdout(可截断)                                                             | 否   |
| `stderr`                    | string  | 捕获 stderr                                                                     | 否   |
| `interrupted`               | boolean | 被用户中断                                                                      | 否   |
| `isImage`                   | boolean | 输出含图像                                                                      | 否   |
| `noOutputExpected`          | boolean | 命令预期无输出                                                                  | 否   |
| `dangerouslyDisableSandbox` | boolean | 关沙箱运行                                                                      | 是   |
| `backgroundTaskId`          | string  | 后台 shell 任务 id(如 `bjr59low8`)                                              | 是   |
| `assistantAutoBackgrounded` | boolean | harness 自动转后台                                                              | 是   |
| `gitOperation`              | object  | git 副作用,如 `{commit:{sha,kind}}` 或 `{push:{branch}}`(仅 git commit/push 时) | 是   |
| `returnCodeInterpretation`  | string  | 非零退出码人类释义(如 `No matches found`)                                       | 是   |
| `persistedOutputPath`       | string  | 超大输出溢出绝对路径(`.../tool-results/<id>.txt`)                               | 是   |
| `persistedOutputSize`       | number  | 溢出输出字节数                                                                  | 是   |

> 键集签名计数(快照):基本 `{stdout,stderr,interrupted,isImage,noOutputExpected}` 约 2275(+dangerouslyDisableSandbox 约 177 / gitOperation 约 22 / returnCodeInterpretation 约 20 / backgroundTaskId 约 17 / assistantAutoBackgrounded+backgroundTaskId 约 16 / persistedOutputPath+persistedOutputSize 约 7)。

```json
{
  "stdout": "<redacted:380>",
  "stderr": "",
  "interrupted": false,
  "isImage": false,
  "noOutputExpected": false,
  "gitOperation": { "commit": { "sha": "<redacted:7>", "kind": "committed" } }
}
```

### 5.2 Edit / MultiEdit

| key               | 类型            | 含义                                                                                      |
| ----------------- | --------------- | ----------------------------------------------------------------------------------------- |
| `filePath`        | string          | 编辑的绝对路径                                                                            |
| `oldString`       | string          | 被移除的匹配文本                                                                          |
| `newString`       | string          | 替换文本                                                                                  |
| `originalFile`    | string          | 编辑前完整文件内容                                                                        |
| `structuredPatch` | array\<object\> | diff hunks:`{oldStart,oldLines,newStart,newLines,lines:[string]}`(lines 前缀 ` `/`+`/`-`) |
| `userModified`    | boolean         | 用户手改 vs 接受                                                                          |
| `replaceAll`      | boolean         | replace_all 模式                                                                          |

> 约 1018 object + 约 76 string(错误,如 `Error: File has been modified since read...`)。

```json
{
  "filePath": "/abs/x.py",
  "oldString": "<redacted:300>",
  "newString": "<redacted:400>",
  "originalFile": "<redacted:2000>",
  "structuredPatch": [
    {
      "oldStart": 54,
      "oldLines": 32,
      "newStart": 54,
      "newLines": 45,
      "lines": ["<redacted>", "+<redacted>", "-<redacted>"]
    }
  ],
  "userModified": false,
  "replaceAll": false
}
```

### 5.3 Write

| key               | 类型                     | 含义                         |
| ----------------- | ------------------------ | ---------------------------- |
| `type`            | enum(`create`\|`update`) | 新建 vs 覆写                 |
| `filePath`        | string                   | 写入绝对路径                 |
| `content`         | string                   | 写入完整内容                 |
| `structuredPatch` | array\<object\>          | diff hunks(create 时为 `[]`) |
| `originalFile`    | string                   | 先前内容(create 时为 `""`)   |
| `userModified`    | boolean                  | 用户改动                     |

> 约 389 object + 约 10 string(错误)。create:structuredPatch=`[]`,originalFile=`""`。

```json
{
  "type": "create",
  "filePath": "/abs/out.txt",
  "content": "<redacted:900>",
  "structuredPatch": [],
  "originalFile": "",
  "userModified": false
}
```

### 5.4 Read

按 `type` 判别(text/image/pdf/file_unchanged)。

| key                        | 类型                                           | 含义                    | 可选 |
| -------------------------- | ---------------------------------------------- | ----------------------- | ---- |
| `type`                     | enum(`text`\|`image`\|`pdf`\|`file_unchanged`) | 负载种类                | 否   |
| `file`                     | object                                         | 负载(键随 type)         | 否   |
| `file.filePath`            | string                                         | 绝对路径(所有变体)      | 是   |
| `file.content`             | string                                         | 文本内容(text)          | 是   |
| `file.numLines`            | number                                         | 返回行数(text)          | 是   |
| `file.startLine`           | number                                         | 1-based 起始(text)      | 是   |
| `file.totalLines`          | number                                         | 文件总行数(text)        | 是   |
| `file.truncatedByTokenCap` | boolean                                        | 被 token cap 截断(text) | 是   |
| `file.base64`              | string                                         | base64 字节(image/pdf)  | 是   |
| `file.originalSize`        | number                                         | 原始字节数(image)       | 是   |
| `file.dimensions`          | object                                         | 图像宽高(image)         | 是   |

> 约 621 object + 约 30 string(错误)。`file_unchanged`(已在上下文、自上次读未变)仅 `{filePath}`。

```json
{
  "type": "text",
  "file": {
    "filePath": "/abs/f.go",
    "content": "<redacted:1500>",
    "numLines": 120,
    "startLine": 1,
    "totalLines": 120,
    "truncatedByTokenCap": false
  }
}
```

### 5.5 Glob

| key          | 类型            | 含义           |
| ------------ | --------------- | -------------- |
| `filenames`  | array\<string\> | 匹配的绝对路径 |
| `numFiles`   | number          | 匹配数         |
| `truncated`  | boolean         | 结果被截断     |
| `durationMs` | number          | 执行毫秒       |

```json
{
  "filenames": ["/abs/a/package.json", "/abs/b/package.json"],
  "numFiles": 2,
  "truncated": false,
  "durationMs": 12
}
```

### 5.6 Grep

按 `mode` 判别。

| key         | 类型                                  | 含义                             | 可选 |
| ----------- | ------------------------------------- | -------------------------------- | ---- |
| `mode`      | enum(`content`\|`files_with_matches`) | 输出模式                         | 否   |
| `numFiles`  | number                                | 匹配文件数                       | 否   |
| `filenames` | array\<string\>                       | 匹配文件路径(files_with_matches) | 否   |
| `content`   | string                                | 匹配行 `N:text`(content 模式)    | 是   |
| `numLines`  | number                                | 匹配行数(content 模式)           | 是   |

> content 模式 numFiles=0、filenames=[];files_with_matches 模式 content/numLines 缺。

```json
{ "mode": "files_with_matches", "numFiles": 28, "filenames": ["/abs/x.ts", "/abs/y.json"] }
```

### 5.7 TodoWrite

| key        | 类型            | 含义                 |
| ---------- | --------------- | -------------------- |
| `oldTodos` | array\<object\> | 写入前 todo 全量快照 |
| `newTodos` | array\<object\> | 写入后 todo 全量快照 |

> 每 todo 项 `{content:string, status:enum(pending\|in_progress\|completed), activeForm:string}`(activeForm=运行时进行时标签)。快照非增量。

```json
{
  "oldTodos": [],
  "newTodos": [
    { "content": "<redacted>", "status": "in_progress", "activeForm": "<redacted>" },
    { "content": "<redacted>", "status": "pending", "activeForm": "<redacted>" }
  ]
}
```

### 5.8 Agent / Task

按 `status` 判别(async_launched 异步发射 / completed 同步完成)。

| key                 | 类型                                                    | 含义                                                                                                | 可选 |
| ------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---- |
| `status`            | enum(`async_launched`\|`completed`)                     | 发射/完成态                                                                                         | 否   |
| `agentId`           | string                                                  | 子代理 id                                                                                           | 否   |
| `prompt`            | string                                                  | 给子代理的 prompt                                                                                   | 否   |
| `agentType`         | enum(`general-purpose`\|`claude-code-guide`\|`Explore`) | 代理类型(completed)                                                                                 | 是   |
| `content`           | array\<object\>                                         | 最终输出块 `[{type:'text',text}]`(completed)                                                        | 是   |
| `totalDurationMs`   | number                                                  | 墙钟时间(completed)                                                                                 | 是   |
| `totalTokens`       | number                                                  | 总 token(completed)                                                                                 | 是   |
| `totalToolUseCount` | number                                                  | 子代理工具调用次数(completed)                                                                       | 是   |
| `usage`             | object                                                  | 完整 Anthropic usage(含 cache\_\*/server_tool_use/iterations[])(completed)                          | 是   |
| `toolStats`         | object                                                  | `{readCount,searchCount,bashCount,editFileCount,linesAdded,linesRemoved,otherToolCount}`(completed) | 是   |
| `isAsync`           | boolean                                                 | 异步发射(async)                                                                                     | 是   |
| `description`       | string                                                  | 短任务标签(async)                                                                                   | 是   |
| `outputFile`        | string                                                  | 异步代理写出路径(async)                                                                             | 是   |
| `canReadOutputFile` | boolean                                                 | 父可读输出文件(async)                                                                               | 是   |

> 约 40 async_launched + 约 28 completed。

```json
{
  "status": "completed",
  "prompt": "<redacted>",
  "agentId": "<redacted:17>",
  "agentType": "general-purpose",
  "content": [{ "type": "text", "text": "<redacted>" }],
  "totalDurationMs": 15759,
  "totalTokens": 10555,
  "totalToolUseCount": 1,
  "usage": {
    "input_tokens": 127,
    "cache_read_input_tokens": 4699,
    "output_tokens": 3,
    "iterations": [{}]
  },
  "toolStats": { "readCount": 0, "bashCount": 1, "linesAdded": 0 }
}
```

### 5.9 Workflow

启动本地 workflow(多步编排子代理脚本),恒 `status:'async_launched'`。

| key             | 类型                   | 含义                                                 | 可选 |
| --------------- | ---------------------- | ---------------------------------------------------- | ---- |
| `status`        | enum(`async_launched`) | 发射态                                               | 否   |
| `taskId`        | string                 | 任务 slug id(如 `wt21buwsv`)                         | 否   |
| `runId`         | string                 | run id `wf_<hex>-<n>`                                | 否   |
| `summary`       | string                 | workflow 人类描述                                    | 否   |
| `transcriptDir` | string                 | 子代理 transcript 绝对目录                           | 否   |
| `scriptPath`    | string                 | 生成的 workflow `.js` 脚本绝对路径                   | 否   |
| `taskType`      | enum(`local_workflow`) | workflow 种类(named 变体)                            | 是   |
| `workflowName`  | string                 | workflow slug(named 变体,如 `diagnose-image-submit`) | 是   |

> 约 31 行,其中约 13 含 taskType+workflowName。

```json
{
  "status": "async_launched",
  "taskId": "wt21buwsv",
  "taskType": "local_workflow",
  "workflowName": "diagnose-image-submit",
  "runId": "wf_db3279e4-b91",
  "summary": "<redacted>",
  "transcriptDir": "/abs/.../subagents/workflows/wf_db3279e4-b91",
  "scriptPath": "/abs/.../workflows/scripts/diagnose-image-submit-wf_db3279e4-b91.js"
}
```

### 5.10 WebSearch

| key               | 类型                        | 含义                                                                | 可选 |
| ----------------- | --------------------------- | ------------------------------------------------------------------- | ---- |
| `query`           | string                      | 查询串                                                              | 否   |
| `results`         | array(mixed object\|string) | 交错的 `{tool_use_id,content:[{title,url}]}` 搜索批 与 模型中间文本 | 否   |
| `durationSeconds` | number                      | 墙钟秒                                                              | 否   |
| `searchCount`     | number                      | 底层搜索请求数(约 79/95 有)                                         | 是   |

```json
{
  "query": "<redacted>",
  "results": [
    {
      "tool_use_id": "srvtoolu_<redacted>",
      "content": [{ "title": "<redacted>", "url": "https://<redacted>" }]
    },
    "<redacted:interim text>"
  ],
  "durationSeconds": 12.3,
  "searchCount": 3
}
```

### 5.11 WebFetch

| key          | 类型   | 含义                                       |
| ------------ | ------ | ------------------------------------------ |
| `url`        | string | 最终(可能重定向)URL                        |
| `code`       | number | HTTP 码(200/403/404)                       |
| `codeText`   | string | HTTP 文本(`OK`/`Forbidden`/`Not Found`)    |
| `bytes`      | number | 抓取字节数                                 |
| `durationMs` | number | 抓取毫秒                                   |
| `result`     | string | 模型摘要后的页面内容(markdown,非原始 HTML) |

> 约 72 object + 约 8 string(错误)。

```json
{
  "bytes": 39938,
  "code": 200,
  "codeText": "OK",
  "result": "<redacted:markdown summary>",
  "durationMs": 6239,
  "url": "https://<redacted>"
}
```

### 5.12 AskUserQuestion

| key           | 类型            | 含义                                                                            | 可选 |
| ------------- | --------------- | ------------------------------------------------------------------------------- | ---- |
| `questions`   | array\<object\> | 所问问题:`{question,header,options:[{label,description,preview?}],multiSelect}` | 否   |
| `answers`     | object          | **映射** 问题文本 → 所选 label(string),非数组                                   | 否   |
| `annotations` | object          | 映射 问题文本 → `{preview}`(常 `{}`)                                            | 是   |

> 约 78 object + 约 10 string(错误)。

```json
{
  "questions": [
    {
      "question": "<redacted>",
      "header": "<redacted>",
      "options": [{ "label": "<redacted>", "description": "<redacted>" }],
      "multiSelect": false
    }
  ],
  "answers": { "<redacted question>": "<redacted label>" },
  "annotations": {}
}
```

### 5.13 ScheduleWakeup

| key                   | 类型    | 含义                   |
| --------------------- | ------- | ---------------------- |
| `scheduledFor`        | number  | 唤醒触发 epoch-ms      |
| `clampedDelaySeconds` | number  | 钳制后有效延迟(秒)     |
| `wasClamped`          | boolean | 请求延迟是否被钳到上限 |

```json
{ "scheduledFor": 1779035280000, "clampedDelaySeconds": 90, "wasClamped": false }
```

### 5.14 ToolSearch

| key                    | 类型            | 含义                                             |
| ---------------------- | --------------- | ------------------------------------------------ |
| `matches`              | array\<string\> | 匹配的延迟工具名                                 |
| `query`                | string          | 搜索/select 查询(如 `select:WebFetch,WebSearch`) |
| `total_deferred_tools` | number          | 全部延迟工具数                                   |

```json
{
  "matches": ["WebFetch", "WebSearch"],
  "query": "select:WebFetch,WebSearch",
  "total_deferred_tools": 29
}
```

### 5.15 Task\* 任务追踪族(TaskCreate / TaskUpdate / TaskList)

**TaskCreate**(约 87):`{task:{id, subject}}`。

```json
{ "task": { "id": "1", "subject": "<redacted>" } }
```

**TaskUpdate**(约 144 object + 约 2 string):

| key             | 类型            | 含义                                                |
| --------------- | --------------- | --------------------------------------------------- |
| `success`       | boolean         | 更新成功                                            |
| `taskId`        | string          | 被更新任务 id                                       |
| `updatedFields` | array\<string\> | 变更字段名(如 `['status']`)                         |
| `statusChange`  | object          | `{from,to}`(均 `pending`/`in_progress`/`completed`) |

```json
{
  "success": true,
  "taskId": "1",
  "updatedFields": ["status"],
  "statusChange": { "from": "pending", "to": "in_progress" }
}
```

**TaskList**(约 5):`{tasks:[]}`(本机为空,项形同 TaskCreate 的 `{id,subject,status}`)。

### 5.16 Cron 族(CronCreate / CronList / CronDelete)

**CronCreate**(约 2):`{id, humanSchedule, recurring, durable}`。

```json
{ "id": "dd7c7b77", "humanSchedule": "4-59/10 * * * *", "recurring": true, "durable": false }
```

**CronList**(约 1):`{jobs:[{id, cron, humanSchedule, prompt, recurring, durable}]}`(prompt=触发时回投的全文)。

```json
{
  "jobs": [
    {
      "id": "cd8fcbe1",
      "cron": "4-59/10 * * * *",
      "humanSchedule": "4-59/10 * * * *",
      "prompt": "<redacted>",
      "recurring": true,
      "durable": false
    }
  ]
}
```

**CronDelete**(约 2):`{id}`。

### 5.17 Skill

| key            | 类型            | 含义                                                | 可选 |
| -------------- | --------------- | --------------------------------------------------- | ---- |
| `success`      | boolean         | skill 加载成功                                      | 否   |
| `commandName`  | string          | skill/命令 slug(如 `deep-research`/`update-config`) | 否   |
| `allowedTools` | array\<string\> | skill 限制可用工具时出现                            | 是   |

> 约 2 object + 约 1 string(错误)。

```json
{ "success": true, "commandName": "update-config", "allowedTools": ["Read"] }
```

### 5.18 EnterPlanMode / ExitPlanMode

| key        | 类型    | 含义                              | 可选 |
| ---------- | ------- | --------------------------------- | ---- |
| `message`  | string  | plan-mode 进入指令(EnterPlanMode) | 是   |
| `plan`     | string  | 提议计划 markdown(ExitPlanMode)   | 是   |
| `isAgent`  | boolean | 由 agent 触发退出(ExitPlanMode)   | 是   |
| `filePath` | string  | 关联文件路径(ExitPlanMode,可选)   | 是   |

```json
{
  "message": "Entered plan mode. You should now focus on exploring the codebase and designing an implementation approach."
}
```

### 5.19 StructuredOutput(本机仅错误字符串)

约 92 行(快照值;正文他处曾混用 347/355 等数字,系不同口径——347/355 为 `StructuredOutput` 的 `tool_use` 调用块计数,而此处约 92 指持久化为 `toolUseResult` 的行数),全为 string,均 schema 校验错误(成功的结构化输出未在此持久化 toolUseResult)。

```json
"Error: Output does not match required schema: root: must have required property 'results'"
```

### 5.20 MCP 工具(`mcp__*`)

两种形状:stdio/HTTP MCP server(如 fusion360)返回 JSON 编码的**字符串**;claude.ai connector 鉴权工具返回小 dict `{status,message}`。

| key        | 类型   | 含义                                        | 可选 |
| ---------- | ------ | ------------------------------------------- | ---- |
| `(string)` | string | JSON 编码的 MCP 输出(如 `{"result":"..."}`) | 是   |
| `status`   | string | connector 鉴权状态(如 `unsupported`)        | 是   |
| `message`  | string | connector 鉴权人类指引                      | 是   |

> `mcp__fusion360__fusion_execute`(约 30)+`fusion_screenshot`(约 1):string;`mcp__claude_ai_Gmail__authenticate`(约 1):dict。

```json
{
  "status": "unsupported",
  "message": "This is a claude.ai MCP connector. Ask the user to run /mcp and select \"claude.ai Gmail\" to authenticate."
}
```

---

## 6. 联网调研结论与来源

### 6.1 官方文档覆盖度(Anthropic `code.claude.com/docs`)

**官方有载**:transcript 存储位置 `~/.claude/projects/<project>/<session-id>.jsonl`;encoded-cwd 编码规则(非字母数字字符全替换为 `-`);「每行是一个 message / tool use / metadata 的 JSON 对象」这一**大类**描述;`--resume`/`--continue`/`--from-pr`/`/branch`/`--fork-session` 等恢复机制;子目录结构(`subagents/`、`tool-results/`)、`history.jsonl`、30 天清理(`cleanupPeriodDays`)、`CLAUDE_CONFIG_DIR`、`CLAUDE_CODE_SKIP_PROMPT_HISTORY`、`--no-session-persistence`;hooks 暴露的 `transcript_path`/`session_id`/`cwd`。

**官方无载**:**JSONL 逐行字段级 schema**(`type`/`uuid`/`parentUuid`/`message`/`leafUuid`/`isSidechain`/`gitBranch`/`version` 等具体定义)。官方把读取抽象到 SDK 的 `SessionMessage`(仅 `type`=user/assistant、`uuid`、与 Messages API 同形的 `message`),并推荐用 SDK 函数(`getSessionMessages()`/`get_session_messages()`、`listSessions()`/`list_sessions()` 等)而非直接解析 JSONL。

**一句话**:**文件格式/位置有官方文档,逐行字段 schema 无官方规范(属未承诺的实现细节,可能随版本变化)。**

### 6.2 社区资料对照(社区逆向,非规范)

**与本机吻合**:目录/路径编码、JSONL=每行独立事件靠 `parentUuid` 串树、核心信封字段、`assistant.message` 结构(role/model/content/stop_reason/usage)、content block 多态(text/thinking/tool_use/tool_result,本机另有 image/document)、`usage` 字段(本机更细)、`isSidechain` 标记、`toolUseResult` 字段思路、流式落盘(可能无 stop_reason 的局部条目)、`file-history-snapshot`、`queue-operation`。

**社区已过时/不成立(本机 v2.1.x 上)**:

1. **`type:"summary"` 行——本机 0 条**。新版改用 `ai-title`(aiTitle)+`last-prompt`(lastPrompt+leafUuid)承载标题/续接锚点,压缩边界用 `system/compact_boundary`+`compactMetadata`+个别 user 的 `isCompactSummary:true`。`leafUuid` 确实存在但挂在 `last-prompt` 上,**不在 summary 行**。
2. **claude-world 教程类型名几乎全错**(`session_start/message/tool_use/tool_result/compaction/session_end`、`parentSessionId/resumedFrom` 本机均不存在),应忽略。
3. **`teamName`/`thinkingMetadata`/`todos` 顶层字段——本机 0 条**(TODO 走 toolUseResult)。
4. **`sourceToolUseID` 拼写过时**——本机高频是 `sourceToolAssistantUUID`(约 12659)。
5. **子代理「独立 subagents/ 子目录 + Team\* 记录」未复现**——本机子代理直接以 `isSidechain:true` 写进 `agent-<agentId>.jsonl`,靠 `sourceToolAssistantUUID` 关联。
6. **`is_error` 位置**——本机在 content[] 的 tool_result block 内,不在 toolUseResult 顶层。

**本机新增、社区少覆盖**:顶层 `mode`/`permission-mode`/`ai-title`/`last-prompt`/`agent-name`/`started`/`result`;整套 `attachment.type` 子类型体系(24 种);`system.subtype` 8 种;`slug`/`entrypoint`/`promptSource`/`origin`/`imagePasteIds`/`interruptedMessageId`/`isVisibleInTranscriptOnly`/`logicalParentUuid`/`isApiErrorMessage`/`requestId` 等字段。

> 注:社区资料(如 d-kimuson/claude-code-viewer)的 union 含 `type:"summary"` 与 `progress`/`custom-title`/`agent-setting`/`pr-link` 等条目,这些是**其它版本/场景**才出现;本机这台 v2.1.x 未观察到 summary/progress/custom-title/agent-setting/pr-link,但观察到了它们未列全的 `started`/`result`/`mode` 等。解析器应**按 `version` 分支**容错。

### 6.3 来源(标注官方/社区/逆向)

**官方(Anthropic `code.claude.com/docs`)**:

- Manage sessions — https://code.claude.com/docs/en/sessions
- Agent SDK · Work with sessions(encoded-cwd 规则)— https://code.claude.com/docs/en/agent-sdk/sessions
- Explore the .claude directory — https://code.claude.com/docs/en/claude-directory
- Hooks reference(transcript_path,不含逐行 schema)— https://code.claude.com/docs/en/hooks
- 官方稳定 schema 跟踪 issue — https://github.com/anthropics/claude-code/issues/53516

**社区逆向(博客/gist,非规范)**:

- samkeen gist(字段最全、与本机最接近)— https://gist.github.com/samkeen/dc6a9771a78d1ecee7eb9ec1307f1b52
- ywian(解析心得,teamName/sourceToolUseID 已过时)— https://medium.com/@ywian/what-i-learned-parsing-claude-codes-jsonl-session-logs-268248be0a2c
- databunny / Yi Huang(路径编码/usage/summary 说法)— https://databunny.medium.com/inside-claude-code-the-session-file-format-and-how-to-inspect-it-b9998e66d56b
- claude-dev.tools(七种类型/summary/result,is_error 位置说法有误)— https://claude-dev.tools/docs/jsonl-format
- claude-world(类型名多为杜撰,谨慎)— https://claude-world.com/tutorials/s16-session-storage/
- BoQsc gist(最新会话位置/Windows 路径)— https://gist.github.com/BoQsc/8b392c3293107edddbd00117ada0fdd2

**社区逆向(GitHub 解析工具 + 二手 schema)**:

- d-kimuson/claude-code-viewer(最权威,Zod 严格 schema,跟进新版)— https://github.com/d-kimuson/claude-code-viewer(schema 在 `src/lib/conversation-schema/`)
- ryoppippi/ccusage(最流行,token/费用窄子集;TS Zod 在 `v15.9.7` tag,核心已迁 Rust)— https://github.com/ryoppippi/ccusage
- constellos/claude-code(纯 TS interface,无运行时校验)— https://github.com/constellos/claude-code(`plugins/essential-logging/shared/hooks/utils/transcripts.ts`)
- delexw/claude-code-trace — https://github.com/delexw/claude-code-trace
- HillviewCap/clog — https://github.com/HillviewCap/clog
- withLinda/claude-JSONL-browser — https://github.com/withLinda/claude-JSONL-browser
- amac0/ClaudeCodeJSONLParser — https://github.com/amac0/ClaudeCodeJSONLParser
- jhlee0409/claude-code-history-viewer — https://github.com/jhlee0409/claude-code-history-viewer
- DuckDB 分析法 — https://liambx.com/blog/claude-code-log-analysis-with-duckdb
- 历史回放/TaskOutput 相关 issue — https://github.com/anthropics/claude-code/issues/5135 、 https://github.com/anthropics/claude-code/issues/20531

**推荐**:要「最完整、最贴近真实数据、按版本演进维护」的二手字段定义,以 `d-kimuson/claude-code-viewer` 的 `src/lib/conversation-schema/` 为准;只关心 token/费用用 ccusage `v15.9.7` 的 `usageDataSchema`;要轻量纯 TS interface 用 constellos 的 `transcripts.ts`。要稳定接口,应改用 Agent SDK 的 `getSessionMessages()` / `get_session_messages()` 而非直接解析 JSONL。
