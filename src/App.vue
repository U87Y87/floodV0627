<script setup>
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import AgentAssistant from './components/AgentAssistant.vue'
import Caculate from './components/Caculate.vue'
import DataProcessingPanel from './components/DataProcessingPanel.vue'
import MeshConvert from './components/meshConvert.vue'
import Render from './components/Render.vue'
import Sample from './components/Sample.vue'
import TileLoaderDialog from './components/TileLoaderDialog.vue'

const renderComponent = ref(null)
const cesiumViewer = shallowRef(null)
const pendingAgentTifFile = shallowRef(null)
const simulationFiles = shallowRef({ dem: null, roughness: null, breach: null })
const activePanel = ref('data')
const searchText = ref('')
const isLoggedIn = ref(false)
const showTileDialog = ref(false)
const terrainState = ref({ enabled: false, loading: false })
const caseMetrics = ref([])
const currentTime = ref(new Date())
let clockTimer

const menuItems = [
  { id: 'data', label: '数据处理', short: '数' },
  { id: 'caculate', label: '洪水模拟', short: '洪' },
  { id: 'mesh', label: '格网转换', short: '网' },
  { id: 'render', label: '可视化', short: '视' },
  { id: 'sample', label: '案例展示', short: '案' },
  { id: 'agent', label: '智能体', short: '智' },
]

const formattedTime = computed(() => new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
}).format(currentTime.value))

function selectPanel(panelId) {
  activePanel.value = activePanel.value === panelId ? null : panelId
}

function handleViewerReady(viewer) {
  cesiumViewer.value = viewer
}

function handleTerrainState(state) {
  terrainState.value = state
}

function handleCaseStart() {
  caseMetrics.value = []
}

function handleFrameMetrics(metrics) {
  if (metrics.frameIndex === 0 && caseMetrics.value.length) {
    caseMetrics.value = []
  }
  const existingIndex = caseMetrics.value.findIndex((item) => item.frameNumber === metrics.frameNumber)
  if (existingIndex >= 0) {
    caseMetrics.value = caseMetrics.value.map((item, index) => index === existingIndex ? metrics : item)
  } else {
    caseMetrics.value = [...caseMetrics.value, metrics]
  }
}

function toggleTerrain() {
  renderComponent.value?.toggleTerrain()
}

function handleLocalTerrainLoaded() {
  renderComponent.value?.setTerrainEnabled(true)
}

function handleAgentTifFile(file) {
  pendingAgentTifFile.value = file
  activePanel.value = 'data'
}

function handlePipelineFile({ kind, file }) {
  const nextFiles = { ...simulationFiles.value, [kind]: file }
  simulationFiles.value = nextFiles
  if (nextFiles.dem && nextFiles.roughness && nextFiles.breach) {
    activePanel.value = 'caculate'
  }
}

function submitSearch() {
  const keyword = searchText.value.trim()
  if (!keyword) return
  const matchedItem = menuItems.find((item) => item.label.includes(keyword))
  if (matchedItem) activePanel.value = matchedItem.id
}

onMounted(() => {
  clockTimer = window.setInterval(() => {
    currentTime.value = new Date()
  }, 1000)
})

onBeforeUnmount(() => {
  window.clearInterval(clockTimer)
})
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">链</span>
        <span class="brand-name">灾害链式服务系统</span>
      </div>

      <form class="search-box" role="search" @submit.prevent="submitSearch">
        <span class="search-symbol" aria-hidden="true"></span>
        <input
          v-model="searchText"
          type="search"
          aria-label="搜索功能"
          placeholder="搜索功能模块"
        >
        <kbd>Enter</kbd>
      </form>

      <div class="topbar-actions">
        <div class="map-tool-actions" aria-label="地图工具">
          <button
            class="top-tool-button"
            :class="{ active: terrainState.enabled }"
            type="button"
            :disabled="!cesiumViewer || terrainState.loading"
            @click="toggleTerrain"
          >
            <span class="top-tool-icon terrain-icon" aria-hidden="true"></span>
            {{ terrainState.loading ? '切换中' : terrainState.enabled ? '关闭地形' : '开启地形' }}
          </button>
          <button
            class="top-tool-button"
            type="button"
            :disabled="!cesiumViewer"
            @click="showTileDialog = true"
          >
            <span class="top-tool-icon tile-icon" aria-hidden="true"></span>
            加载切片
          </button>
        </div>
        <time class="system-time" :datetime="currentTime.toISOString()">
          <span class="time-label">系统时间</span>
          <strong>{{ formattedTime }}</strong>
        </time>
        <button class="login-button" type="button" @click="isLoggedIn = !isLoggedIn">
          {{ isLoggedIn ? '已登录' : '登录' }}
        </button>
      </div>
    </header>

    <nav class="sidebar" aria-label="功能导航">
      <div class="sidebar-caption">功能导航</div>
      <button
        v-for="item in menuItems"
        :key="item.id"
        class="nav-item"
        :class="{ active: activePanel === item.id }"
        type="button"
        :aria-pressed="activePanel === item.id"
        @click="selectPanel(item.id)"
      >
        <span class="nav-icon" aria-hidden="true">{{ item.short }}</span>
        <span>{{ item.label }}</span>
      </button>
      <div class="sidebar-status">
        <span class="status-dot"></span>
        服务在线
      </div>
    </nav>

    <section class="map-workspace" aria-label="三维灾害地图">
      <div class="workspace-label">
        <span>三维灾害场景</span>
        <small>实时态势工作区</small>
      </div>
      <Render
        ref="renderComponent"
        :visible="activePanel === 'render'"
        @viewer-ready="handleViewerReady"
        @terrain-state="handleTerrainState"
        @case-start="handleCaseStart"
        @frame-metrics="handleFrameMetrics"
      />
    </section>

    <Transition name="panel-slide">
      <DataProcessingPanel
        v-show="activePanel === 'data'"
        :viewer="cesiumViewer"
        :initial-convert-file="pendingAgentTifFile"
        @initial-file-consumed="pendingAgentTifFile = null"
        @pipeline-file="handlePipelineFile"
      />
    </Transition>
    <Transition name="panel-slide">
      <Caculate
        v-show="activePanel === 'caculate'"
        :initial-files="simulationFiles"
        @files-change="simulationFiles = $event"
      />
    </Transition>
    <Transition name="panel-slide">
      <MeshConvert v-if="activePanel === 'mesh'" />
    </Transition>
    <Transition name="panel-slide">
      <Sample
        v-if="activePanel === 'sample'"
        :render-component="renderComponent"
        :metrics="caseMetrics"
      />
    </Transition>
    <Transition name="panel-slide">
      <AgentAssistant
        v-if="activePanel === 'agent'"
        @navigate="activePanel = $event"
        @tif-file="handleAgentTifFile"
      />
    </Transition>
    <TileLoaderDialog
      :visible="showTileDialog"
      :viewer="cesiumViewer"
      @close="showTileDialog = false"
      @terrain-loaded="handleLocalTerrainLoaded"
    />
  </main>
</template>
