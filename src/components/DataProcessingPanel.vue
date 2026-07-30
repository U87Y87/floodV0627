<script setup>
import * as Cesium from 'cesium'
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import '../js/huaxian.js'

const props = defineProps({
  viewer: {
    type: Object,
    default: null,
  },
})

const API_BASE = 'http://localhost:5000'
const tools = [
  { id: 'tif2asc', name: '格式转换', index: '01' },
  { id: 'roughness', name: '粗糙度计算', index: '02' },
  { id: 'rowcol', name: '获取 ASC 行列号', index: '03' },
  { id: 'draw', name: '地形工具', index: '04' },
]

const menuExpanded = ref(true)
const activeTool = ref(null)
const convertFile = ref(null)
const convertLoading = ref(false)
const convertMessage = ref('')
const convertError = ref('')
const roughnessFile = ref(null)
const roughnessTifFile = ref(null)
const roughnessShowBounds = ref(false)
const roughnessLoading = ref(false)
const roughnessMessage = ref('')
const roughnessError = ref('')
const asciiFile = ref(null)
const asciiTifFile = ref(null)
const lineTxtFile = ref(null)
const rowcolLoading = ref(false)
const rowcolMessage = ref('')
const rowcolError = ref('')
const drawingStatus = ref('等待开始绘制')
const boundsEntities = []

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

async function handleConvertFileChange(event) {
  setFile(event, convertFile)
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
    if (result.download_url) triggerDownload(result.download_url)
  } catch (error) {
    convertError.value = `转换失败：${apiErrorMessage(error)}`
  } finally {
    convertLoading.value = false
  }
}

function handleRoughnessFileChange(event) {
  setFile(event, roughnessFile)
}

async function handleRoughnessTifFileChange(event) {
  setFile(event, roughnessTifFile)
  await fetchAndDisplayTiffBounds(roughnessTifFile.value)
}

async function handleRoughnessSubmit() {
  if (!roughnessFile.value || roughnessLoading.value) return
  roughnessLoading.value = true
  roughnessMessage.value = ''
  roughnessError.value = ''
  try {
    const formData = new FormData()
    formData.append('file', roughnessFile.value)
    if (roughnessTifFile.value) formData.append('tif_file', roughnessTifFile.value)
    formData.append('show_bounds', roughnessShowBounds.value ? 'true' : 'false')
    const response = await fetch(`${API_BASE}/roughness`, { method: 'POST', body: formData })
    const result = await response.json()
    if (!response.ok || !result.success) throw new Error(result.message || '粗糙度计算失败')
    roughnessMessage.value = result.message || '粗糙度计算完成'
    if (roughnessShowBounds.value && result.bounds) displayBoundsOnMap(result.bounds)
    if (result.download_url) triggerDownload(result.download_url)
  } catch (error) {
    roughnessError.value = `计算失败：${apiErrorMessage(error)}`
  } finally {
    roughnessLoading.value = false
  }
}

function handleAsciiFileChange(event) {
  setFile(event, asciiFile)
}

async function handleAsciiTifFileChange(event) {
  setFile(event, asciiTifFile)
  await fetchAndDisplayTiffBounds(asciiTifFile.value)
}

function handleLineTxtFileChange(event) {
  setFile(event, lineTxtFile)
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
  if (!asciiFile.value || !lineTxtFile.value || rowcolLoading.value) return
  rowcolLoading.value = true
  rowcolMessage.value = ''
  rowcolError.value = ''
  try {
    const coordinates = parseCoordinatesFromTxt(await lineTxtFile.value.text())
    if (!coordinates.length) throw new Error('未从 TXT 中解析到有效经纬度坐标')

    const formData = new FormData()
    formData.append('ascii_file', asciiFile.value)
    if (asciiTifFile.value) formData.append('tif_file', asciiTifFile.value)
    formData.append('coordinates', JSON.stringify(coordinates))
    const response = await fetch(`${API_BASE}/get_ascii_values`, { method: 'POST', body: formData })
    const result = await response.json()
    if (!response.ok || !result.success) throw new Error(result.message || '行列号获取失败')
    rowcolMessage.value = result.message || `成功处理 ${coordinates.length} 个坐标点`
    if (result.download_url) triggerDownload(result.download_url)
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
          <button
            v-for="tool in tools"
            :key="tool.id"
            class="data-tool-nav"
            :class="{ active: activeTool === tool.id }"
            type="button"
            @click="selectTool(tool.id)"
          >
            <span>{{ tool.index }}</span>
            {{ tool.name }}
          </button>
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
              <input type="file" accept=".tif,.tiff" required @change="handleConvertFileChange">
            </label>
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
            <label class="upload-field">
              <span>ASC/TXT 数据文件</span>
              <input type="file" accept=".asc,.txt" required @change="handleRoughnessFileChange">
            </label>
            <label class="upload-field">
              <span>TIF 参考文件（可选）</span>
              <input type="file" accept=".tif,.tiff" @change="handleRoughnessTifFileChange">
            </label>
            <label class="data-check">
              <input v-model="roughnessShowBounds" type="checkbox">
              <span>在三维地图中显示数据边界</span>
            </label>
            <button class="data-primary-button" type="submit" :disabled="!roughnessFile || roughnessLoading">
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
            <label class="upload-field">
              <span>ASC 数据文件</span>
              <input type="file" accept=".asc,.txt" required @change="handleAsciiFileChange">
            </label>
            <label class="upload-field">
              <span>TIF 参考文件（可选）</span>
              <input type="file" accept=".tif,.tiff" @change="handleAsciiTifFileChange">
            </label>
            <label class="upload-field">
              <span>绘制坐标 TXT 文件</span>
              <input type="file" accept=".txt" required @change="handleLineTxtFileChange">
            </label>
            <button
              class="data-primary-button"
              type="submit"
              :disabled="!asciiFile || !lineTxtFile || rowcolLoading"
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
      </section>
    </Transition>
  </aside>
</template>
