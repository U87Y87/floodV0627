<script setup>
import * as Cesium from 'cesium'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import '../js/huaxian.js'

const props = defineProps({
  viewer: {
    type: Object,
    default: null,
  },
  initialConvertFile: {
    type: File,
    default: null,
  },
})

const emit = defineEmits(['initial-file-consumed', 'pipeline-file'])

const API_BASE = 'http://localhost:5000'
const tools = [
  { id: 'tif2asc', name: '格式转换', index: '01' },
  { id: 'roughness', name: '粗糙度计算', index: '02' },
  { id: 'rowcol', name: '获取 ASC 行列号', index: '03' },
  { id: 'draw', name: '地形工具', index: '04' },
  { id: 'spatial-reference', name: '空间参考文件', index: '05' },
  { id: 'asc-file', name: 'ASC 文件', index: '06' },
  { id: 'roughness-file', name: '糙率文件', index: '07' },
  { id: 'breach-file', name: '溃口文件', index: '08' },
]

const menuExpanded = ref(true)
const activeTool = ref(null)
const convertFile = ref(null)
const convertFileSource = ref('')
const convertLoading = ref(false)
const convertMessage = ref('')
const convertError = ref('')
const spatialReferenceFile = ref(null)
const sharedAscFile = ref(null)
const sharedRoughnessFile = ref(null)
const sharedBreachFile = ref(null)
const roughnessShowBounds = ref(false)
const roughnessLoading = ref(false)
const roughnessMessage = ref('')
const roughnessError = ref('')
const lineTxtFile = ref(null)
const rowcolLoading = ref(false)
const rowcolMessage = ref('')
const rowcolError = ref('')
const drawingStatus = ref('等待开始绘制')
const boundsEntities = []
const visibleTools = computed(() => tools.filter((tool) => {
  if (tool.id === 'asc-file') return sharedAscFile.value
  if (tool.id === 'roughness-file') return sharedRoughnessFile.value
  if (tool.id === 'breach-file') return sharedBreachFile.value
  return true
}))

function getViewer() {
  return props.viewer || window.cesiumViewer || null
}

function selectTool(toolId) {
  if (activeTool.value === toolId) {
    activeTool.value = null
    return
  }
  activeTool.value = toolId
  if (toolId === 'draw') {
    nextTick(async () => {
      try {
        await ensureDrawingModuleReady()
        drawingStatus.value = '地形绘制工具已就绪'
      } catch (error) {
        drawingStatus.value = `绘制工具加载失败：${error.message}`
      }
    })
  }
}

function setFile(event, targetRef) {
  targetRef.value = event.target.files?.[0] ?? null
}

function apiErrorMessage(error) {
  if (error instanceof TypeError && /fetch/i.test(error.message)) {
    return '无法连接数据处理服务，请先启动 backend/app.py（端口 5000）'
  }
  return error?.message || '请求失败'
}

function clearBoundsOnMap() {
  const viewer = getViewer()
  if (!viewer) return
  boundsEntities.splice(0).forEach((entity) => viewer.entities.remove(entity))
}

function displayBoundsOnMap(bounds) {
  const viewer = getViewer()
  if (!viewer) return
  const coordinates = bounds?.boundary_points?.length ? bounds.boundary_points : bounds?.coordinates
  if (!Array.isArray(coordinates) || !coordinates.length) return

  clearBoundsOnMap()
  const positions = coordinates
    .filter((coordinate) => Array.isArray(coordinate) && coordinate.length >= 2)
    .map((coordinate) => Cesium.Cartesian3.fromDegrees(Number(coordinate[0]), Number(coordinate[1]), 0))
  if (positions.length < 2) return

  if (Cesium.Cartesian3.distance(positions[0], positions[positions.length - 1]) > 1) {
    positions.push(Cesium.Cartesian3.clone(positions[0]))
  }

  const polygon = viewer.entities.add({
    name: 'Data Processing Boundary',
    polygon: {
      hierarchy: positions,
      material: Cesium.Color.RED.withAlpha(0.02),
      outline: true,
      outlineColor: Cesium.Color.RED,
    },
  })
  const polyline = viewer.entities.add({
    name: 'Data Processing Boundary Line',
    polyline: {
      positions,
      width: 3,
      material: Cesium.Color.RED,
      clampToGround: true,
    },
  })
  boundsEntities.push(polygon, polyline)
  viewer.flyTo(polyline, { duration: 1.2 })
}

async function fetchAndDisplayTiffBounds(file) {
  if (!file || !getViewer()) return
  try {
    const formData = new FormData()
    formData.append('file', file)
    const response = await fetch(`${API_BASE}/get_tiff_bounds`, {
      method: 'POST',
      body: formData,
    })
    const result = await response.json()
    if (response.ok && result.success && result.bounds) displayBoundsOnMap(result.bounds)
  } catch (error) {
    console.warn('TIFF 边界读取失败：', error)
  }
}

function triggerDownload(path, filename) {
  const link = document.createElement('a')
  link.style.display = 'none'
  link.href = path.startsWith('http') ? path : `${API_BASE}${path}`
  if (filename) link.download = filename
  document.body.appendChild(link)
  link.click()
  window.setTimeout(() => link.remove(), 100)
}

function formatStoredFileSize(bytes) {
  if (!Number.isFinite(bytes)) return '--'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

async function fileFromDownload(path, filename) {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`
  const response = await fetch(url)
  if (!response.ok) throw new Error('ASC 结果文件读取失败')
  const blob = await response.blob()
  return new File([blob], filename, { type: blob.type || 'text/plain' })
}

function registerSpatialReference(file) {
  convertFile.value = file
  spatialReferenceFile.value = file
  sharedAscFile.value = null
  invalidateDerivedFiles()
  emit('pipeline-file', { kind: 'dem', file: null })
  convertMessage.value = ''
  convertError.value = ''
  roughnessMessage.value = ''
  roughnessError.value = ''
  rowcolMessage.value = ''
  rowcolError.value = ''
}

function invalidateDerivedFiles() {
  sharedRoughnessFile.value = null
  sharedBreachFile.value = null
  emit('pipeline-file', { kind: 'roughness', file: null })
  emit('pipeline-file', { kind: 'breach', file: null })
}

function clearDependentResults() {
  roughnessMessage.value = ''
  roughnessError.value = ''
  rowcolMessage.value = ''
  rowcolError.value = ''
}

function handleSharedAscFileChange(event) {
  sharedAscFile.value = event.target.files?.[0] ?? null
  invalidateDerivedFiles()
  emit('pipeline-file', { kind: 'dem', file: sharedAscFile.value })
  clearDependentResults()
}

async function handleSharedTifFileChange(event) {
  const file = event.target.files?.[0] ?? null
  convertFile.value = file
  spatialReferenceFile.value = file
  convertFileSource.value = file ? 'manual' : ''
  invalidateDerivedFiles()
  clearDependentResults()
  await fetchAndDisplayTiffBounds(file)
}

async function handleConvertFileChange(event) {
  const file = event.target.files?.[0] ?? null
  registerSpatialReference(file)
  convertFileSource.value = convertFile.value ? 'manual' : ''
  await fetchAndDisplayTiffBounds(convertFile.value)
}

async function handleConvertSubmit() {
  if (!convertFile.value || convertLoading.value) return
  convertLoading.value = true
  convertMessage.value = ''
  convertError.value = ''
  try {
    const formData = new FormData()
    formData.append('file', convertFile.value)
    const response = await fetch(`${API_BASE}/convert`, { method: 'POST', body: formData })
    const result = await response.json()
    if (!response.ok || !result.success) throw new Error(result.message || '格式转换失败')
    convertMessage.value = result.message || '格式转换完成'
    if (result.download_url) {
      const outputFilename = result.output_filename || `${convertFile.value.name.replace(/\.tiff?$/i, '')}.asc`
      sharedAscFile.value = await fileFromDownload(result.download_url, outputFilename)
      emit('pipeline-file', { kind: 'dem', file: sharedAscFile.value })
      triggerDownload(result.download_url, outputFilename)
    }
  } catch (error) {
    convertError.value = `转换失败：${apiErrorMessage(error)}`
  } finally {
    convertLoading.value = false
  }
}

async function handleRoughnessSubmit() {
  if (!sharedAscFile.value || !spatialReferenceFile.value || roughnessLoading.value) return
  roughnessLoading.value = true
  roughnessMessage.value = ''
  roughnessError.value = ''
  try {
    const formData = new FormData()
    formData.append('file', sharedAscFile.value)
    formData.append('tif_file', spatialReferenceFile.value)
    formData.append('show_bounds', roughnessShowBounds.value ? 'true' : 'false')
    const response = await fetch(`${API_BASE}/roughness`, { method: 'POST', body: formData })
    const result = await response.json()
    if (!response.ok || !result.success) throw new Error(result.message || '粗糙度计算失败')
    roughnessMessage.value = result.message || '粗糙度计算完成'
    if (roughnessShowBounds.value && result.bounds) displayBoundsOnMap(result.bounds)
    if (result.download_url) {
      const outputFilename = result.output_filename || result.roughness_file || 'roughness.asc'
      sharedRoughnessFile.value = await fileFromDownload(result.download_url, outputFilename)
      emit('pipeline-file', { kind: 'roughness', file: sharedRoughnessFile.value })
      triggerDownload(result.download_url, outputFilename)
    }
  } catch (error) {
    roughnessError.value = `计算失败：${apiErrorMessage(error)}`
  } finally {
    roughnessLoading.value = false
  }
}

function handleLineTxtFileChange(event) {
  setFile(event, lineTxtFile)
  sharedBreachFile.value = null
  emit('pipeline-file', { kind: 'breach', file: null })
  rowcolMessage.value = ''
  rowcolError.value = ''
}

function parseCoordinatesFromTxt(content) {
  const coordinates = []
  let pendingLongitude = null
  let pendingLatitude = null

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const longitudeMatch = line.match(/(?:^|\s)(?:lon|longitude)\s*[:=]\s*(-?\d+(?:\.\d+)?)/i)
    const latitudeMatch = line.match(/(?:^|\s)(?:lat|latitude)\s*[:=]\s*(-?\d+(?:\.\d+)?)/i)
    if (longitudeMatch) pendingLongitude = Number(longitudeMatch[1])
    if (latitudeMatch) pendingLatitude = Number(latitudeMatch[1])

    if (!longitudeMatch && !latitudeMatch) {
      const values = line.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
      if (values.length >= 2 && Math.abs(values[0]) <= 180 && Math.abs(values[1]) <= 90) {
        coordinates.push({ lon: values[0], lat: values[1] })
      }
    }

    if (pendingLongitude !== null && pendingLatitude !== null) {
      if (Math.abs(pendingLongitude) <= 180 && Math.abs(pendingLatitude) <= 90) {
        coordinates.push({ lon: pendingLongitude, lat: pendingLatitude })
      }
      pendingLongitude = null
      pendingLatitude = null
    }
  }
  return coordinates
}

async function handleRowcolSubmit() {
  if (!sharedAscFile.value || !spatialReferenceFile.value || !lineTxtFile.value || rowcolLoading.value) return
  rowcolLoading.value = true
  rowcolMessage.value = ''
  rowcolError.value = ''
  try {
    const coordinates = parseCoordinatesFromTxt(await lineTxtFile.value.text())
    if (!coordinates.length) throw new Error('未从 TXT 中解析到有效经纬度坐标')

    const formData = new FormData()
    formData.append('ascii_file', sharedAscFile.value)
    formData.append('tif_file', spatialReferenceFile.value)
    formData.append('coordinates', JSON.stringify(coordinates))
    const response = await fetch(`${API_BASE}/get_ascii_values`, { method: 'POST', body: formData })
    const result = await response.json()
    if (!response.ok || !result.success) throw new Error(result.message || '行列号获取失败')
    rowcolMessage.value = result.message || `成功处理 ${coordinates.length} 个坐标点`
    if (result.download_url) {
      const outputFilename = result.output_filename || 'breach.dat'
      sharedBreachFile.value = await fileFromDownload(result.download_url, outputFilename)
      emit('pipeline-file', { kind: 'breach', file: sharedBreachFile.value })
      triggerDownload(result.download_url, outputFilename)
    }
  } catch (error) {
    rowcolError.value = `导出失败：${apiErrorMessage(error)}`
  } finally {
    rowcolLoading.value = false
  }
}

async function ensureDrawingModuleReady() {
  window.Cesium = Cesium
  const viewer = getViewer()
  if (!viewer) throw new Error('Cesium Viewer 尚未就绪')
  window.cesiumViewer = viewer
  if (!window.drawingModule) throw new Error('地形绘制模块尚未就绪')
  window.drawingModule?.init?.()
  window.drawingModule?.initializeDrawingEventListeners?.()
}

async function startDrawing() {
  try {
    await ensureDrawingModuleReady()
    window.drawingModule?.startDrawing?.()
    drawingStatus.value = '绘制中：左键添加点，右键结束当前线段'
  } catch (error) {
    drawingStatus.value = `无法开始绘制：${error.message}`
  }
}

function stopDrawing() {
  window.drawingModule?.stopDrawing?.()
  drawingStatus.value = '绘制已停止'
}

function clearDrawing() {
  window.drawingModule?.clearDrawing?.()
  drawingStatus.value = '线段与点位已清空'
}

function exportTerrainLine() {
  window.drawingModule?.exportLineTerrainDataTXT?.()
}

function checkTerrainTiles() {
  window.drawingModule?.checkAllTilesExist?.()
}

function calculateGridPoints() {
  window.drawingModule?.calculateAllIntermediatePoints?.()
}

watch(
  () => props.viewer,
  (viewer) => {
    if (!viewer) return
    window.Cesium = Cesium
    window.cesiumViewer = viewer
  },
  { immediate: true },
)

watch(
  () => props.initialConvertFile,
  (file) => {
    if (!file) return
    menuExpanded.value = true
    activeTool.value = 'tif2asc'
    registerSpatialReference(file)
    convertFileSource.value = 'agent'
    emit('initial-file-consumed')
    fetchAndDisplayTiffBounds(file)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (
    activeTool.value === 'draw'
    && document.getElementById('startDrawing')
    && window.cesiumViewer?.cesiumWidget?.screenSpaceEventHandler
  ) {
    try {
      window.drawingModule?.stopDrawing?.()
    } catch (error) {
      console.warn('停止地形绘制工具失败：', error)
    }
  }
  clearBoundsOnMap()
})
</script>

<template>
  <aside class="panel data-processing-panel">
    <header class="data-panel-header">
      <div>
        <span class="panel-eyebrow">DATA WORKBENCH</span>
        <h1>数据处理</h1>
      </div>
    </header>

    <div class="data-panel-layout">
      <nav class="data-tree" aria-label="数据处理工具">
        <button class="data-tree-group" type="button" @click="menuExpanded = !menuExpanded">
          <span class="tree-arrow" :class="{ expanded: menuExpanded }">▶</span>
          <strong>数据处理</strong>
        </button>
        <div v-show="menuExpanded" class="data-tree-children">
          <template v-for="tool in visibleTools" :key="tool.id">
            <div v-if="tool.id === 'spatial-reference'" class="data-existing-title">
              <span>已有数据</span>
              <i></i>
            </div>
            <button
              class="data-tool-nav"
              :class="{ active: activeTool === tool.id }"
              type="button"
              @click="selectTool(tool.id)"
            >
              <span>{{ tool.index }}</span>
              {{ tool.name }}
              <i
                v-if="
                  (tool.id === 'spatial-reference' && spatialReferenceFile)
                    || tool.id === 'asc-file'
                    || tool.id === 'roughness-file'
                    || tool.id === 'breach-file'
                "
                class="stored-tool-dot"
                aria-label="文件已就绪"
              ></i>
            </button>
          </template>
        </div>
      </nav>
    </div>
    <Transition name="tool-drawer">
      <section v-if="activeTool" class="data-tool-content data-tool-drawer">
        <button class="tool-drawer-close" type="button" aria-label="收起工具内容" @click="activeTool = null">
          <span aria-hidden="true">›</span>
          收起
        </button>
        <div v-show="activeTool === 'tif2asc'" class="data-tool-block">
          <div class="tool-heading">
            <span>01</span>
            <div><h2>格式转换</h2><p>TIF数据转为ASC格式</p></div>
          </div>
          <form @submit.prevent="handleConvertSubmit">
            <label class="upload-field">
              <span>选择 TIFF 文件</span>
              <input
                class="convert-file-input"
                type="file"
                accept=".tif,.tiff"
                @change="handleConvertFileChange"
              >
              <span class="convert-file-picker">
                <strong>选择文件</strong>
                <small>{{ convertFile?.name || '未选择文件' }}</small>
              </span>
            </label>
            <p v-if="convertFileSource === 'agent'" class="agent-file-ready">
              <span aria-hidden="true">✓</span>
              智能体检验通过并已载入，等待执行格式转换
            </p>
            <button class="data-primary-button" type="submit" :disabled="!convertFile || convertLoading">
              {{ convertLoading ? '正在转换...' : '转换并下载 ASC' }}
            </button>
            <p v-if="convertMessage" class="data-result success">{{ convertMessage }}</p>
            <p v-if="convertError" class="data-result error">{{ convertError }}</p>
          </form>
        </div>

        <div v-show="activeTool === 'roughness'" class="data-tool-block">
          <div class="tool-heading">
            <span>02</span>
            <div><h2>粗糙度计算</h2><p>根据 ASC/TXT 地形数据生成粗糙度栅格。</p></div>
          </div>
          <form @submit.prevent="handleRoughnessSubmit">
            <span class="dependency-title">优先自动引用共享数据，也可手动替换</span>
            <label class="upload-field shared-upload-field">
              <span>
                ASC/TXT 数据文件
                <i v-if="sharedAscFile">06 已自动填充</i>
              </span>
              <input
                class="shared-file-input"
                type="file"
                accept=".asc,.txt"
                @change="handleSharedAscFileChange"
              >
              <span class="convert-file-picker">
                <strong>{{ sharedAscFile ? '重新选择' : '选择文件' }}</strong>
                <small>{{ sharedAscFile?.name || '未选择文件' }}</small>
              </span>
            </label>
            <label class="upload-field shared-upload-field">
              <span>
                TIF 参考文件
                <i v-if="spatialReferenceFile">05 已自动填充</i>
              </span>
              <input
                class="shared-file-input"
                type="file"
                accept=".tif,.tiff"
                @change="handleSharedTifFileChange"
              >
              <span class="convert-file-picker">
                <strong>{{ spatialReferenceFile ? '重新选择' : '选择文件' }}</strong>
                <small>{{ spatialReferenceFile?.name || '未选择文件' }}</small>
              </span>
            </label>
            <label class="data-check">
              <input v-model="roughnessShowBounds" type="checkbox">
              <span>在三维地图中显示数据边界</span>
            </label>
            <button
              class="data-primary-button"
              type="submit"
              :disabled="!sharedAscFile || !spatialReferenceFile || roughnessLoading"
            >
              {{ roughnessLoading ? '正在计算...' : '计算并下载粗糙度' }}
            </button>
            <p v-if="roughnessMessage" class="data-result success">{{ roughnessMessage }}</p>
            <p v-if="roughnessError" class="data-result error">{{ roughnessError }}</p>
          </form>
        </div>

        <div v-show="activeTool === 'rowcol'" class="data-tool-block">
          <div class="tool-heading">
            <span>03</span>
            <div><h2>获取 ASC 行列号</h2><p>根据绘制点经纬度导出对应格网行列号。</p></div>
          </div>
          <form @submit.prevent="handleRowcolSubmit">
            <span class="dependency-title">优先自动引用共享数据，也可手动替换</span>
            <label class="upload-field shared-upload-field">
              <span>
                ASC 数据文件
                <i v-if="sharedAscFile">06 已自动填充</i>
              </span>
              <input
                class="shared-file-input"
                type="file"
                accept=".asc,.txt"
                @change="handleSharedAscFileChange"
              >
              <span class="convert-file-picker">
                <strong>{{ sharedAscFile ? '重新选择' : '选择文件' }}</strong>
                <small>{{ sharedAscFile?.name || '未选择文件' }}</small>
              </span>
            </label>
            <label class="upload-field shared-upload-field">
              <span>
                TIF 参考文件
                <i v-if="spatialReferenceFile">05 已自动填充</i>
              </span>
              <input
                class="shared-file-input"
                type="file"
                accept=".tif,.tiff"
                @change="handleSharedTifFileChange"
              >
              <span class="convert-file-picker">
                <strong>{{ spatialReferenceFile ? '重新选择' : '选择文件' }}</strong>
                <small>{{ spatialReferenceFile?.name || '未选择文件' }}</small>
              </span>
            </label>
            <label class="upload-field">
              <span>绘制坐标 TXT 文件</span>
              <input type="file" accept=".txt" required @change="handleLineTxtFileChange">
            </label>
            <button
              class="data-primary-button"
              type="submit"
              :disabled="!sharedAscFile || !spatialReferenceFile || !lineTxtFile || rowcolLoading"
            >
              {{ rowcolLoading ? '正在导出...' : '导出行列号文件' }}
            </button>
            <p v-if="rowcolMessage" class="data-result success">{{ rowcolMessage }}</p>
            <p v-if="rowcolError" class="data-result error">{{ rowcolError }}</p>
          </form>
        </div>

        <div v-show="activeTool === 'draw'" class="data-tool-block terrain-tool">
          <div class="tool-heading">
            <span>04</span>
            <div><h2>地形工具</h2><p>在 Cesium 场景中绘线并提取沿线地形信息。</p></div>
          </div>
          <div class="drawing-actions">
            <button id="startDrawing" type="button" @click="startDrawing">开始绘制</button>
            <button id="stopDrawing" type="button" @click="stopDrawing">停止绘制</button>
            <button id="clearDrawing" type="button" @click="clearDrawing">清空线段</button>
          </div>
          <p class="drawing-status">{{ drawingStatus }}</p>
          <div class="coordinate-section">
            <div class="section-label">坐标点位</div>
            <div id="coordinatesList" class="coordinates-list">
              <p class="text-muted">暂无点位</p>
            </div>
          </div>
          <div class="terrain-actions">
            <button type="button" @click="exportTerrainLine">导出线段地形数据（TXT）</button>
            <button type="button" @click="checkTerrainTiles">检查地形瓦片</button>
            <button type="button" @click="calculateGridPoints">计算地形网格信息</button>
          </div>
          <div id="intermediatePointsContainer" class="intermediate-points d-none">
            <div class="section-label">地形网格结果</div>
            <div id="intermediatePointsList"></div>
          </div>
        </div>

        <div v-show="activeTool === 'spatial-reference'" class="data-tool-block">
          <div class="tool-heading">
            <span>05</span>
            <div><h2>空间参考文件</h2><p>保存格式转换步骤中选择的 TIF 地理空间参考。</p></div>
          </div>
          <div v-if="spatialReferenceFile" class="stored-file-card ready">
            <span class="stored-file-icon">TIF</span>
            <div>
              <strong>{{ spatialReferenceFile.name }}</strong>
              <small>{{ formatStoredFileSize(spatialReferenceFile.size) }} · TIFF 空间参考</small>
            </div>
            <i>已就绪</i>
          </div>
          <div v-else class="stored-file-empty">
            <span>暂无空间参考文件</span>
            <p>请先进入“01 格式转换”并选择 TIF 文件。</p>
            <button type="button" @click="activeTool = 'tif2asc'">前往格式转换</button>
          </div>
          <p v-if="spatialReferenceFile" class="stored-file-note">
            粗糙度计算和 ASC 行列号计算将自动使用此文件，无需再次上传。
          </p>
        </div>

        <div v-show="activeTool === 'asc-file'" class="data-tool-block">
          <div class="tool-heading">
            <span>06</span>
            <div><h2>ASC 文件</h2><p>保存格式转换完成后生成的共享高程数据。</p></div>
          </div>
          <div v-if="sharedAscFile" class="stored-file-card ready">
            <span class="stored-file-icon asc">ASC</span>
            <div>
              <strong>{{ sharedAscFile.name }}</strong>
              <small>{{ formatStoredFileSize(sharedAscFile.size) }} · ESRI ASCII Grid</small>
            </div>
            <i>已就绪</i>
          </div>
          <p class="stored-file-note">
            此文件由“01 格式转换”自动生成，并被粗糙度计算和 ASC 行列号计算共享使用。
          </p>
        </div>

        <div v-show="activeTool === 'roughness-file'" class="data-tool-block">
          <div class="tool-heading">
            <span>07</span>
            <div><h2>糙率文件</h2><p>保存粗糙度计算完成后生成的模拟输入数据。</p></div>
          </div>
          <div v-if="sharedRoughnessFile" class="stored-file-card ready">
            <span class="stored-file-icon asc">ASC</span>
            <div>
              <strong>{{ sharedRoughnessFile.name }}</strong>
              <small>{{ formatStoredFileSize(sharedRoughnessFile.size) }} · 洪水模拟糙率</small>
            </div>
            <i>已就绪</i>
          </div>
          <p class="stored-file-note">
            此文件由“02 粗糙度计算”自动生成，将作为洪水模拟的糙率输入。
          </p>
        </div>

        <div v-show="activeTool === 'breach-file'" class="data-tool-block">
          <div class="tool-heading">
            <span>08</span>
            <div><h2>溃口文件</h2><p>保存 ASC 行列号计算完成后生成的 DAT 数据。</p></div>
          </div>
          <div v-if="sharedBreachFile" class="stored-file-card ready">
            <span class="stored-file-icon dat">DAT</span>
            <div>
              <strong>{{ sharedBreachFile.name }}</strong>
              <small>{{ formatStoredFileSize(sharedBreachFile.size) }} · 洪水模拟溃口</small>
            </div>
            <i>已就绪</i>
          </div>
          <p class="stored-file-note">
            此文件由“03 获取 ASC 行列号”自动生成，将作为洪水模拟的溃口输入。
          </p>
        </div>
      </section>
    </Transition>
  </aside>
</template>
