<script setup lang="ts">
// Login — OAuth 登录门(provider 由 /api/providers 给;点按钮跳 /auth/<p>/login)。
import { provLabel } from './api'
defineProps<{ providers: string[] }>()
</script>

<template>
  <div class="center">
    <div class="card">
      <h1>✈️ ccfly</h1>
      <p class="sub">cc.hn · Claude Code Hub & Node —— 一个 Hub 网关,统辖你机群里的每个 Node</p>
      <template v-if="providers.length">
        <a v-for="p in providers" :key="p" class="btn" :href="'/auth/' + p + '/login'">
          使用 {{ provLabel(p) }} 登录
        </a>
      </template>
      <p v-else class="muted">未配置任何 OAuth provider。</p>
    </div>
  </div>
</template>
