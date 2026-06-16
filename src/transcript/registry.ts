// transcript/registry.ts — 工具名 → 卡片组件。加一种工具卡 = 一行映射,永不改 switch。
// MVP 覆盖 Bash/Read/Edit;其余落 GenericCard(P2 再补 Grep/Glob/Todo/Task/Web/...)。
import type { Component } from 'vue'
import BashCard from '../components/chat/blocks/BashCard.vue'
import ReadCard from '../components/chat/blocks/ReadCard.vue'
import EditCard from '../components/chat/blocks/EditCard.vue'
import WriteCard from '../components/chat/blocks/WriteCard.vue'
import AskUserQuestionCard from '../components/chat/blocks/AskUserQuestionCard.vue'
import GenericCard from '../components/chat/blocks/GenericCard.vue'

export const toolRegistry: Record<string, Component> = {
  Bash: BashCard,
  BashOutput: BashCard,
  Read: ReadCard,
  Edit: EditCard,
  MultiEdit: EditCard,
  Write: WriteCard,
  AskUserQuestion: AskUserQuestionCard, // 问题+选项+选中答案,平铺不折叠
}

export function toolComponent(name?: string): Component {
  return (name && toolRegistry[name]) || GenericCard
}
