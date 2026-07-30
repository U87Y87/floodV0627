<script setup>
import * as Cesium from 'cesium'
import { ref } from 'vue'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false,
  },
  viewer: {
    type: Object,
    default: null,
  },
})

const emit = defineEmits(['close', 'terrain-loaded'])
const API_BASE = 'http://localhost:5000'

const activeTileTab = ref('terrain')
const terrainTilePath = ref('')
const terrainTileLoading = ref(false)
const terrainTileMessage = ref('')
const imageryTilePath = ref('')
const imageryTileLoading = ref(false)
const imageryTileMessage = ref('')
const threeDTilePath = ref('')
const threeDTileLoading = ref(false)
const threeDTileMessage = ref('')

let terrainBoundaryEntity = null
let currentImageryLayer = null
let currentThreeDTilesets = []

function isAnyTileLoading() {
  return terrainTileLoading.value || imageryTileLoading.value || threeDTileLoading.value
}

function isAbsoluteLocalPath(path) {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('/')
}

function backendUrl(path) {
  if (/^https?:\/\//i.test(path)) return path
  const normalizedPath = String(path || '').replace(/^\/api(?=\/)/, '')
  return `${API_BASE}${normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`}`
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options)
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !result.success) {
    throw new Error(result.message || `请求失败（${response.status}）`)
  }
  return result
}

function closeTerrainTileDialog() {
  if (!isAnyTileLoading()) emit('close')
}

async function chooseTilePath(pathRef, messageRef) {
  if (isAnyTileLoading()) return
  messageRef.value = '正在打开目录选择...'
  try {
    const result = await requestJson('/choose-path', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'directory' }),
    })
    if (result.path) {
      pathRef.value = result.path
      messageRef.value = ''
    } else {
      messageRef.value = '未选择目录'
    }
  } catch (error) {
    messageRef.value = error instanceof Error ? error.message : '选择目录失败'
  }
}

function chooseTerrainTilePath() {
  return chooseTilePath(terrainTilePath, terrainTileMessage)
}

function chooseImageryTilePath() {
  return chooseTilePath(imageryTilePath, imageryTileMessage)
}

function chooseThreeDTilePath() {
  return chooseTilePath(threeDTilePath, threeDTileMessage)
}

function showTerrainTileBoundary(bounds) {
  if (!props.viewer) return
  if (terrainBoundaryEntity) props.viewer.entities.remove(terrainBoundaryEntity)
  terrainBoundaryEntity = props.viewer.entities.add({
    name: 'Terrain Tile Boundary',
    polyline: {
      positions: Cesium.Cartesian3.fromDegreesArray([
        bounds.west, bounds.south,
        bounds.east, bounds.south,
        bounds.east, bounds.north,
        bounds.west, bounds.north,
        bounds.west, bounds.south,
      ]),
      width: 4,
      material: Cesium.Color.fromCssColorString('#2ddaff'),
      clampToGround: true,
    },
  })
}

function flyToTerrainTileBounds(bounds) {
  props.viewer.camera.flyTo({
    destination: Cesium.Rectangle.fromDegrees(bounds.west, bounds.south, bounds.east, bounds.north),
    duration: 1.1,
  })
}

async function loadTerrainTiles() {
  if (!props.viewer || terrainTileLoading.value) return
  const requestedPath = terrainTilePath.value.trim()
  if (!requestedPath) {
    terrainTileMessage.value = '请先选择或填写地形切片目录'
    return
  }
  if (!isAbsoluteLocalPath(requestedPath)) {
    terrainTileMessage.value = '请填写完整本地路径，例如 D:\\Chain1\\gtt\\测试数据\\安厦\\qp2'
    return
  }

  terrainTileLoading.value = true
  terrainTileMessage.value = '正在读取 meta.json / layer.json 并加载地形切片...'
  try {
    const result = await requestJson('/terrain-tiles/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: requestedPath }),
    })
    const bounds = result.meta?.latLonBounds ?? result.meta?.bounds
    if (!bounds) throw new Error('meta.json 中缺少 bounds 或 latLonBounds')
    props.viewer.terrainProvider = await Cesium.CesiumTerrainProvider.fromUrl(backendUrl(result.url), {
      requestVertexNormals: true,
    })
    showTerrainTileBoundary(bounds)
    flyToTerrainTileBounds(bounds)
    terrainTileMessage.value = '地形切片加载成功'
    emit('terrain-loaded')
    emit('close')
  } catch (error) {
    terrainTileMessage.value = error instanceof Error ? error.message : '加载地形切片失败'
  } finally {
    terrainTileLoading.value = false
  }
}

async function loadImageryTiles() {
  if (!props.viewer || imageryTileLoading.value) return
  const requestedPath = imageryTilePath.value.trim()
  if (!requestedPath) {
    imageryTileMessage.value = '请先选择或填写影像切片目录'
    return
  }
  if (!isAbsoluteLocalPath(requestedPath)) {
    imageryTileMessage.value = '请填写完整本地路径，例如 D:\\Chain1\\gtt\\测试数据\\影像切片'
    return
  }

  imageryTileLoading.value = true
  imageryTileMessage.value = '正在注册并加载影像切片...'
  try {
    const result = await requestJson('/imagery-tiles/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: requestedPath }),
    })
    const template = result.urlTemplate
      ? backendUrl(result.urlTemplate)
      : `${backendUrl(result.url)}/{z}/{x}/{y}.${result.extension || 'png'}`
    const imageryProvider = new Cesium.UrlTemplateImageryProvider({
      url: template,
      minimumLevel: result.minLevel ?? undefined,
      maximumLevel: result.maxLevel ?? undefined,
    })
    if (currentImageryLayer) props.viewer.imageryLayers.remove(currentImageryLayer, false)
    currentImageryLayer = props.viewer.imageryLayers.addImageryProvider(imageryProvider)
    imageryTileMessage.value = '影像切片加载成功'
    emit('close')
  } catch (error) {
    imageryTileMessage.value = error instanceof Error ? error.message : '加载影像切片失败'
  } finally {
    imageryTileLoading.value = false
  }
}

async function loadThreeDTiles() {
  if (!props.viewer || threeDTileLoading.value) return
  const requestedPath = threeDTilePath.value.trim()
  if (!requestedPath) {
    threeDTileMessage.value = '请先选择或填写 3D Tiles 路径'
    return
  }
  if (!isAbsoluteLocalPath(requestedPath)) {
    threeDTileMessage.value = '请填写完整本地路径，例如 D:\\Chain1\\3dtiles\\tileset'
    return
  }

  threeDTileLoading.value = true
  threeDTileMessage.value = '正在读取 tileset.json 并加载 3D Tiles...'
  try {
    const result = await requestJson('/3d-tiles/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: requestedPath }),
    })
    const entries = Array.isArray(result.tilesets) && result.tilesets.length
      ? result.tilesets
      : [{ url: result.url, name: '3D Tiles' }]
    currentThreeDTilesets.forEach((tileset) => props.viewer.scene.primitives.remove(tileset))
    currentThreeDTilesets = []
    for (const entry of entries) {
      const tileset = await Cesium.Cesium3DTileset.fromUrl(backendUrl(entry.url))
      currentThreeDTilesets.push(props.viewer.scene.primitives.add(tileset))
    }
    if (currentThreeDTilesets.length) await props.viewer.flyTo(currentThreeDTilesets[0])
    threeDTileMessage.value = `3D Tiles 加载成功（${currentThreeDTilesets.length} 组）`
    emit('close')
  } catch (error) {
    threeDTileMessage.value = error instanceof Error ? error.message : '加载 3D Tiles 失败'
  } finally {
    threeDTileLoading.value = false
  }
}

async function loadActiveTiles() {
  if (!props.viewer) {
    const message = '三维场景尚未初始化，请稍后再试'
    if (activeTileTab.value === 'terrain') terrainTileMessage.value = message
    else if (activeTileTab.value === 'imagery') imageryTileMessage.value = message
    else threeDTileMessage.value = message
    return
  }
  if (activeTileTab.value === 'imagery') await loadImageryTiles()
  else if (activeTileTab.value === '3dtiles') await loadThreeDTiles()
  else await loadTerrainTiles()
}
</script>

<template>
  <div v-if="visible" class="tile-modal-backdrop" @click.self="closeTerrainTileDialog">
    <section class="terrain-dialog" role="dialog" aria-modal="true" aria-labelledby="terrainDialogTitle">
      <header class="terrain-dialog__header">
        <div>
          <span class="dialog-eyebrow">LOCAL TILE SERVICE</span>
          <h2 id="terrainDialogTitle">加载切片</h2>
        </div>
        <button class="dialog-icon-btn" type="button" aria-label="关闭" @click="closeTerrainTileDialog">×</button>
      </header>

      <div class="terrain-dialog__body">
        <div class="tile-tabs" role="tablist" aria-label="切片类型">
          <button class="tile-tab" :class="{ active: activeTileTab === 'terrain' }" type="button" role="tab" :aria-selected="activeTileTab === 'terrain'" :disabled="isAnyTileLoading()" @click="activeTileTab = 'terrain'">地形切片</button>
          <button class="tile-tab" :class="{ active: activeTileTab === 'imagery' }" type="button" role="tab" :aria-selected="activeTileTab === 'imagery'" :disabled="isAnyTileLoading()" @click="activeTileTab = 'imagery'">影像切片</button>
          <button class="tile-tab" :class="{ active: activeTileTab === '3dtiles' }" type="button" role="tab" :aria-selected="activeTileTab === '3dtiles'" :disabled="isAnyTileLoading()" @click="activeTileTab = '3dtiles'">3D Tiles</button>
        </div>

        <div v-if="activeTileTab === 'terrain'" class="tile-tab-panel" role="tabpanel">
          <label class="terrain-field">
            <span>本地地形切片路径</span>
            <div class="terrain-path-input-row">
              <input v-model="terrainTilePath" type="text" placeholder="D:\Chain1\gtt\测试数据\安厦\qp2">
              <button class="dialog-secondary-btn path-browse-btn" type="button" :disabled="isAnyTileLoading()" @click="chooseTerrainTilePath">浏览路径</button>
            </div>
          </label>
          <p v-if="terrainTileMessage" class="terrain-message">{{ terrainTileMessage }}</p>
        </div>

        <div v-else-if="activeTileTab === 'imagery'" class="tile-tab-panel" role="tabpanel">
          <label class="terrain-field">
            <span>本地影像切片路径</span>
            <div class="terrain-path-input-row">
              <input v-model="imageryTilePath" type="text" placeholder="D:\Chain1\gtt\测试数据\影像切片">
              <button class="dialog-secondary-btn path-browse-btn" type="button" :disabled="isAnyTileLoading()" @click="chooseImageryTilePath">浏览路径</button>
            </div>
          </label>
          <p v-if="imageryTileMessage" class="terrain-message">{{ imageryTileMessage }}</p>
        </div>

        <div v-else class="tile-tab-panel" role="tabpanel">
          <label class="terrain-field">
            <span>本地 3D Tiles 路径</span>
            <div class="terrain-path-input-row">
              <input v-model="threeDTilePath" type="text" placeholder="D:\Chain1\3dtiles\tileset">
              <button class="dialog-secondary-btn path-browse-btn" type="button" :disabled="isAnyTileLoading()" @click="chooseThreeDTilePath">浏览路径</button>
            </div>
          </label>
          <p v-if="threeDTileMessage" class="terrain-message">{{ threeDTileMessage }}</p>
        </div>
      </div>

      <footer class="terrain-dialog__footer">
        <button class="dialog-secondary-btn" type="button" :disabled="isAnyTileLoading()" @click="closeTerrainTileDialog">取消</button>
        <button class="dialog-primary-btn" type="button" :disabled="isAnyTileLoading()" @click="loadActiveTiles">
          {{ isAnyTileLoading() ? '加载中...' : '确定加载' }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.tile-modal-backdrop {
  position: fixed;
  z-index: 120;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(1, 8, 18, 0.68);
  backdrop-filter: blur(5px);
}

.terrain-dialog {
  width: min(520px, calc(100vw - 32px));
  overflow: hidden;
  border: 1px solid rgba(85, 215, 238, 0.55);
  border-radius: 14px;
  color: #eefaff;
  background: linear-gradient(155deg, rgba(15, 34, 54, 0.99), rgba(6, 20, 35, 0.99));
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.55), inset 0 0 32px rgba(33, 185, 216, 0.07);
}

.terrain-dialog__header,
.terrain-dialog__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px;
}

.terrain-dialog__header {
  border-bottom: 1px solid rgba(148, 181, 211, 0.16);
}

.terrain-dialog__header h2 {
  margin: 3px 0 0;
  font-size: 20px;
}

.dialog-eyebrow {
  color: #55d7ee;
  font-size: 9px;
  letter-spacing: 0.16em;
}

.dialog-icon-btn {
  width: 32px;
  height: 32px;
  border: 1px solid rgba(148, 181, 211, 0.28);
  border-radius: 8px;
  color: #dff8ff;
  background: rgba(255, 255, 255, 0.04);
  font-size: 20px;
}

.terrain-dialog__body {
  padding: 18px;
}

.tile-tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  padding: 4px;
  border: 1px solid rgba(70, 157, 190, 0.32);
  border-radius: 9px;
  background: rgba(2, 13, 25, 0.68);
}

.tile-tab {
  height: 36px;
  border: 0;
  border-radius: 6px;
  color: #8faec4;
  background: transparent;
  font-weight: 700;
}

.tile-tab.active {
  color: #041a25;
  background: linear-gradient(135deg, #55d7ee, #21a9d2);
}

.tile-tab:disabled,
.dialog-secondary-btn:disabled,
.dialog-primary-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.tile-tab-panel {
  min-height: 110px;
  padding-top: 18px;
}

.terrain-field {
  display: grid;
  gap: 9px;
  color: #b9cedc;
  font-size: 13px;
  font-weight: 700;
}

.terrain-path-input-row {
  display: grid;
  grid-template-columns: 1fr 94px;
  gap: 8px;
}

.terrain-field input {
  min-width: 0;
  height: 39px;
  padding: 0 11px;
  border: 1px solid rgba(70, 157, 190, 0.42);
  border-radius: 7px;
  outline: 0;
  color: #eefaff;
  background: rgba(3, 16, 29, 0.82);
}

.terrain-field input:focus {
  border-color: #55d7ee;
  box-shadow: 0 0 0 3px rgba(33, 185, 216, 0.1);
}

.terrain-message {
  margin: 11px 0 0;
  color: #55d7ee;
  font-size: 12px;
  overflow-wrap: anywhere;
}

.terrain-dialog__footer {
  justify-content: flex-end;
  border-top: 1px solid rgba(148, 181, 211, 0.13);
}

.dialog-secondary-btn,
.dialog-primary-btn {
  min-width: 88px;
  height: 38px;
  padding: 0 14px;
  border-radius: 7px;
  font-weight: 700;
}

.dialog-secondary-btn {
  border: 1px solid rgba(85, 215, 238, 0.3);
  color: #dff5ff;
  background: rgba(11, 39, 60, 0.82);
}

.dialog-primary-btn {
  border: 1px solid rgba(85, 215, 238, 0.6);
  color: #04151e;
  background: linear-gradient(135deg, #55d7ee, #20a6cf);
}

.path-browse-btn {
  min-width: 94px;
}

@media (max-width: 560px) {
  .terrain-path-input-row {
    grid-template-columns: 1fr;
  }

  .path-browse-btn {
    width: 100%;
  }
}
</style>
