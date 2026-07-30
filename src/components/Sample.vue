<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  renderComponent: {
    type: Object,
    default: null,
  },
  metrics: {
    type: Array,
    default: () => [],
  },
})

const caseStatus = ref('等待加载永川案例')
const isLoadingCase = ref(false)
const chart = {
  width: 336,
  height: 174,
  left: 45,
  right: 12,
  top: 12,
  bottom: 29,
}
const plotWidth = chart.width - chart.left - chart.right
const plotHeight = chart.height - chart.top - chart.bottom
const yTicks = [0, 0.25, 0.5, 0.75, 1]

const depthMetrics = computed(() => props.metrics.slice(-60))
const areaMetrics = computed(() => props.metrics.slice(-24))
const latestMetric = computed(() => props.metrics.at(-1) ?? null)

function niceMaximum(value) {
  if (!Number.isFinite(value) || value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  return Math.ceil((value / magnitude) * 2) / 2 * magnitude
}

const depthMaximum = computed(() => niceMaximum(Math.max(...depthMetrics.value.map((item) => item.maxDepth), 0)))
const areaMaximum = computed(() => niceMaximum(Math.max(...areaMetrics.value.map((item) => item.floodedArea / 1000000), 0)))

function xPosition(item, items) {
  const start = items[0]?.elapsedMinutes ?? 0
  const end = items.at(-1)?.elapsedMinutes ?? start
  return chart.left + ((item.elapsedMinutes - start) / Math.max(end - start, 1)) * plotWidth
}

function yPosition(value, maximum) {
  return chart.top + plotHeight - (value / maximum) * plotHeight
}

const depthLinePoints = computed(() => depthMetrics.value
  .map((item) => `${xPosition(item, depthMetrics.value).toFixed(2)},${yPosition(item.maxDepth, depthMaximum.value).toFixed(2)}`)
  .join(' '))

const depthAreaPoints = computed(() => {
  if (!depthMetrics.value.length) return ''
  const firstX = xPosition(depthMetrics.value[0], depthMetrics.value)
  const lastX = xPosition(depthMetrics.value.at(-1), depthMetrics.value)
  const bottom = chart.top + plotHeight
  return `${firstX},${bottom} ${depthLinePoints.value} ${lastX},${bottom}`
})

const timeLabels = computed(() => {
  const items = depthMetrics.value
  if (!items.length) return []
  const indices = [...new Set([0, Math.floor((items.length - 1) / 2), items.length - 1])]
  return indices.map((index) => ({
    value: items[index].elapsedMinutes,
    x: xPosition(items[index], items),
  }))
})

const areaTimeLabels = computed(() => {
  const items = areaMetrics.value
  if (!items.length) return []
  const indices = [...new Set([0, Math.floor((items.length - 1) / 2), items.length - 1])]
  return indices.map((index) => ({
    value: items[index].elapsedMinutes,
    x: chart.left + ((index + 0.5) / items.length) * plotWidth,
  }))
})

function barX(index) {
  return chart.left + (index / Math.max(areaMetrics.value.length, 1)) * plotWidth
}

function barWidth() {
  return Math.max(2, (plotWidth / Math.max(areaMetrics.value.length, 1)) * 0.68)
}

function formatArea(area) {
  if (!Number.isFinite(area)) return '--'
  if (area >= 1000000) return `${(area / 1000000).toFixed(2)} km²`
  return `${Math.round(area).toLocaleString('zh-CN')} m²`
}

async function loadYongchuanCase() {
  if (isLoadingCase.value) return
  if (!props.renderComponent) {
    caseStatus.value = '洪水渲染组件尚未初始化，请稍后重试。'
    return
  }

  isLoadingCase.value = true
  caseStatus.value = '正在加载案例数据...'
  try {
    const result = await props.renderComponent.loadYongchuanCase()
    caseStatus.value = result.loaded
      ? `共 ${result.frameCount} 帧，正在从第 1 帧开始逐帧播放。`
      : '案例加载失败，请查看左侧状态信息。'
  } catch (error) {
    caseStatus.value = `案例加载失败：${error.message}`
  } finally {
    isLoadingCase.value = false
  }
}
</script>

<template>
  <section class="case-dashboard" aria-label="永川案例动态监测">
    <aside class="panel case-panel">
      <h1>案例演示</h1>
      <p class="hint">加载并渲染 <code>yongchuan</code> 文件夹中的 530 帧 Mesh 动画数据。</p>
      <button class="convert-button" :disabled="isLoadingCase" @click="loadYongchuanCase">
        {{ isLoadingCase ? '正在加载...' : '渲染永川案例' }}
      </button>
      <p class="status">{{ caseStatus }}</p>
    </aside>

    <article class="case-chart-card">
      <header class="chart-card-header">
        <div>
          <span class="chart-kicker">水情演进</span>
          <h2>最大水深变化</h2>
        </div>
        <strong>{{ latestMetric ? `${latestMetric.maxDepth.toFixed(2)} m` : '--' }}</strong>
      </header>
      <svg class="case-chart" :viewBox="`0 0 ${chart.width} ${chart.height}`" role="img" aria-label="最大水深动态折线图">
        <defs>
          <linearGradient id="depthAreaGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#55d7ee" stop-opacity="0.38" />
            <stop offset="100%" stop-color="#55d7ee" stop-opacity="0" />
          </linearGradient>
        </defs>
        <g v-for="tick in yTicks" :key="`depth-${tick}`">
          <line
            :x1="chart.left"
            :x2="chart.width - chart.right"
            :y1="chart.top + plotHeight * tick"
            :y2="chart.top + plotHeight * tick"
            class="chart-grid-line"
          />
          <text :x="chart.left - 7" :y="chart.top + plotHeight * tick + 3" class="chart-axis-label" text-anchor="end">
            {{ (depthMaximum * (1 - tick)).toFixed(1) }}
          </text>
        </g>
        <text x="8" :y="chart.top + 3" class="chart-unit">m</text>
        <polygon v-if="depthAreaPoints" :points="depthAreaPoints" fill="url(#depthAreaGradient)" />
        <polyline v-if="depthLinePoints" :points="depthLinePoints" class="depth-line" />
        <circle
          v-if="latestMetric && depthMetrics.length"
          :cx="xPosition(depthMetrics.at(-1), depthMetrics)"
          :cy="yPosition(depthMetrics.at(-1).maxDepth, depthMaximum)"
          r="3.6"
          class="latest-point"
        />
        <g v-for="label in timeLabels" :key="`depth-time-${label.value}`">
          <text :x="label.x" :y="chart.height - 8" class="chart-axis-label" text-anchor="middle">{{ label.value }}</text>
        </g>
        <text :x="chart.width - chart.right" :y="chart.height - 8" class="chart-unit axis-title" text-anchor="end">时间 / min</text>
        <text v-if="!depthMetrics.length" :x="chart.width / 2" :y="chart.height / 2" class="chart-empty" text-anchor="middle">
          启动案例后显示动态数据
        </text>
      </svg>
    </article>

    <article class="case-chart-card">
      <header class="chart-card-header">
        <div>
          <span class="chart-kicker">影响范围</span>
          <h2>淹没面积变化</h2>
        </div>
        <strong>{{ latestMetric ? formatArea(latestMetric.floodedArea) : '--' }}</strong>
      </header>
      <svg class="case-chart" :viewBox="`0 0 ${chart.width} ${chart.height}`" role="img" aria-label="淹没面积动态柱状图">
        <defs>
          <linearGradient id="areaBarGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#55d7ee" />
            <stop offset="100%" stop-color="#1976b8" />
          </linearGradient>
        </defs>
        <g v-for="tick in yTicks" :key="`area-${tick}`">
          <line
            :x1="chart.left"
            :x2="chart.width - chart.right"
            :y1="chart.top + plotHeight * tick"
            :y2="chart.top + plotHeight * tick"
            class="chart-grid-line"
          />
          <text :x="chart.left - 7" :y="chart.top + plotHeight * tick + 3" class="chart-axis-label" text-anchor="end">
            {{ (areaMaximum * (1 - tick)).toFixed(1) }}
          </text>
        </g>
        <text x="8" :y="chart.top + 3" class="chart-unit">km²</text>
        <rect
          v-for="(item, index) in areaMetrics"
          :key="item.frameNumber"
          :x="barX(index) + (plotWidth / Math.max(areaMetrics.length, 1) - barWidth()) / 2"
          :y="yPosition(item.floodedArea / 1000000, areaMaximum)"
          :width="barWidth()"
          :height="chart.top + plotHeight - yPosition(item.floodedArea / 1000000, areaMaximum)"
          rx="1.5"
          fill="url(#areaBarGradient)"
          class="area-bar"
        />
        <g v-for="label in areaTimeLabels" :key="`area-time-${label.value}`">
          <text :x="label.x" :y="chart.height - 8" class="chart-axis-label" text-anchor="middle">{{ label.value }}</text>
        </g>
        <text :x="chart.width - chart.right" :y="chart.height - 8" class="chart-unit axis-title" text-anchor="end">时间 / min</text>
        <text v-if="!areaMetrics.length" :x="chart.width / 2" :y="chart.height / 2" class="chart-empty" text-anchor="middle">
          启动案例后显示动态数据
        </text>
      </svg>
    </article>
  </section>
</template>
