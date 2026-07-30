<script setup>
import * as Cesium from 'cesium'
import { onBeforeUnmount, onMounted, ref } from 'vue'

import 'cesium/Build/Cesium/Widgets/widgets.css'

const emit = defineEmits(['viewer-ready', 'terrain-state', 'case-start', 'frame-metrics'])

defineProps({
  visible: {
    type: Boolean,
    default: false,
  },
})

const CESIUM_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI5ZjUyMWMzYi1hM2IwLTRiNDItODRhNC1kMzVlNjk2YzAwMTgiLCJpZCI6MjQ1NzQxLCJpYXQiOjE3NTM1MjU5MjJ9.lYglm9ETzaBqJf9h_j7MpyQmBNBuX5DwTmCJF_UgQ6U'
const YONGCHUAN_CASE_FOLDER = 'D:\\Debris Flow\\V0622\\yongchuan'
const MAX_TERRAIN_HEIGHT_CACHE_ENTRIES = 150000
const EARTH_RADIUS_METERS = 6378137
const MONITOR_POINTS = [
  { id: 'Y01', lon: 103.545935, lat: 31.446383, height: 1293.72 },
  { id: 'Y02', lon: 103.541318, lat: 31.438676, height: 1270.62 },
  { id: 'Y03', lon: 103.554222, lat: 31.453673, height: 1278.15 },
]
const MONITOR_DEPTH_SCALE = 8
const MONITOR_SPEED_SCALE = 5
const emptyMonitorScreen = () => ({ x: -1000, y: -1000, onScreen: false })
const emptyMonitorState = () => ({ depth: 0, speed: 0, flooded: false })

const cesiumContainer = ref(null)
const status = ref('正在初始化 Cesium...')
const fileName = ref('尚未选择洪水文件')
const meshFolder = ref('')
const animationFrames = ref([])
const activeFrameIndex = ref(0)
const isPlaying = ref(false)
const pointCount = ref(0)
const triangleCount = ref(0)
const floodAreaText = ref('-')
const depthRange = ref('-')
const opacity = ref(0.78)
const heightScale = ref(1)
const colorRamp = ref('water')
const playbackRate = ref(1)
const isTerrainEnabled = ref(false)
const isTerrainLoading = ref(false)
const buildingStats = ref({ safe: 0, partial: 0, submerged: 0 })
const monitorVisible = ref(false)
const monitorScreens = ref(MONITOR_POINTS.map(emptyMonitorScreen))
const monitorStates = ref(MONITOR_POINTS.map(emptyMonitorState))

let viewer
let floodPrimitive
let floodMesh
let playbackTimer
let frameSeekTimer
let buildingEntities = []
let buildingModels = []
let isCasePlayback = false
let removeMonitorPostRender
const terrainHeightCache = new Map()

const BUILDING_COLORS = {
  safe: Cesium.Color.fromCssColorString('#1fbf5b').withAlpha(0.92),
  partial: Cesium.Color.fromCssColorString('#ffd43b').withAlpha(0.95),
  submerged: Cesium.Color.fromCssColorString('#e03131').withAlpha(0.96),
}

const BUILDING_STATE_RANK = { safe: 0, partial: 1, submerged: 2 }

const FIXED_BUILDINGS = [
  { id: 'building-1', lon: 112.9111824, lat: 35.3970286, width: 34, depth: 24, height: 10, rotation: -8 },
  { id: 'building-2', lon: 112.9124103, lat: 35.3932976, width: 42, depth: 28, height: 15, rotation: 5 },
  { id: 'building-3', lon: 112.9152695, lat: 35.3874576, width: 38, depth: 26, height: 22, rotation: -12 },
  { id: 'building-4', lon: 112.9106694, lat: 35.3895418, width: 46, depth: 30, height: 18, rotation: 8 },
  { id: 'building-5', lon: 112.9073984, lat: 35.3928142, width: 36, depth: 25, height: 12, rotation: -4 },
  { id: 'building-6', lon: 112.9244666, lat: 35.3841990, width: 36, depth: 25, height: 12, rotation: -4 },
  { id: 'building-7', lon: 112.9265053, lat: 35.3821095, width: 36, depth: 10, height: 12, rotation: -4 },
  { id: 'building-8', lon: 112.9241440, lat: 35.3805142, width: 36, depth: 10, height: 12, rotation: -4 },
  { id: 'building-9', lon: 112.9275802, lat: 35.3852738, width: 36, depth: 5, height: 12, rotation: -4 },
]

const COLOR_RAMPS = {
  water: ['#d9fbff', '#87d8f5', '#3b9fe0', '#1766bd', '#102f83'],
  heat: ['#fff7a8', '#6ed6e6', '#2584d9', '#3846b5', '#32176b'],
  depth: ['#e9f9ff', '#a9dff7', '#4aa7dd', '#1761aa', '#092d68'],
}

function toRgb(hex) {
  const number = Number.parseInt(hex.slice(1), 16)
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255]
}

function colorFor(value, min, max) {
  const colors = COLOR_RAMPS[colorRamp.value].map(toRgb)
  const ratio = Cesium.Math.clamp((value - min) / Math.max(max - min, 0.000001), 0, 1)
  const scaled = ratio * (colors.length - 1)
  const lower = Math.floor(scaled)
  const upper = Math.min(lower + 1, colors.length - 1)
  const t = scaled - lower
  return [
    Math.round(Cesium.Math.lerp(colors[lower][0], colors[upper][0], t)),
    Math.round(Cesium.Math.lerp(colors[lower][1], colors[upper][1], t)),
    Math.round(Cesium.Math.lerp(colors[lower][2], colors[upper][2], t)),
    Math.round(Number(opacity.value) * 255),
  ]
}

function numberValue(value) {
  const result = Number(value)
  return Number.isFinite(result) ? result : null
}

function normalizedVertices(raw) {
  const points = Array.isArray(raw) ? raw : raw.points ?? raw.data ?? []
  return points.map((point) => {
    if (Array.isArray(point)) {
      return { lon: numberValue(point[0]), lat: numberValue(point[1]), value: numberValue(point[2]) }
    }
    return {
      lon: numberValue(point?.lon ?? point?.lng ?? point?.longitude ?? point?.x),
      lat: numberValue(point?.lat ?? point?.latitude ?? point?.y),
      value: numberValue(point?.depth ?? point?.value ?? point?.z),
    }
  }).filter((point) => point.lon !== null && point.lat !== null && point.value !== null)
}

function normalizeFloodFile(data) {
  if (Array.isArray(data.positions) && Array.isArray(data.values)) {
    const vertices = data.values.map((value, index) => ({
      lon: numberValue(data.positions[index * 2]),
      lat: numberValue(data.positions[index * 2 + 1]),
      value: numberValue(value),
    })).filter((point) => point.lon !== null && point.lat !== null && point.value !== null)
    return { vertices, triangles: data.triangles ?? data.faces ?? [] }
  }

  if (Array.isArray(data.Vector) && Array.isArray(data.Depth)) {
    const vertices = data.Vector.map((vector, index) => ({
      lon: numberValue(vector?.x ?? vector?.X ?? vector?.[0]),
      lat: numberValue(vector?.y ?? vector?.Y ?? vector?.[1]),
      value: numberValue(data.Depth[index]),
    })).filter((point) => point.lon !== null && point.lat !== null && point.value !== null)
    return { vertices, triangles: data.Face ?? data.face ?? [] }
  }

  return { vertices: normalizedVertices(data), triangles: data.triangles ?? data.faces ?? data.Face ?? [] }
}

function flattenTriangles(rawTriangles, vertexCount) {
  const flat = []
  const source = Array.isArray(rawTriangles) ? rawTriangles : []
  const candidates = source.length && typeof source[0] === 'number'
    ? source
    : source.flatMap((face) => Array.isArray(face) ? face : [face?.a ?? face?.A, face?.b ?? face?.B, face?.c ?? face?.C])
  for (let index = 0; index + 2 < candidates.length; index += 3) {
    const a = Number(candidates[index])
    const b = Number(candidates[index + 1])
    const c = Number(candidates[index + 2])
    if ([a, b, c].every((item) => Number.isInteger(item) && item >= 0 && item < vertexCount)) flat.push(a, b, c)
  }
  return flat
}

function calculateMeshArea(vertices, triangles) {
  if (!vertices.length || !triangles.length) return 0
  const referenceLat = vertices.reduce((sum, vertex) => sum + vertex.lat, 0) / vertices.length
  const xScale = EARTH_RADIUS_METERS * Math.cos(Cesium.Math.toRadians(referenceLat))
  const projected = vertices.map((vertex) => ({
    x: Cesium.Math.toRadians(vertex.lon) * xScale,
    y: Cesium.Math.toRadians(vertex.lat) * EARTH_RADIUS_METERS,
  }))
  let area = 0
  for (let index = 0; index + 2 < triangles.length; index += 3) {
    const a = projected[triangles[index]]
    const b = projected[triangles[index + 1]]
    const c = projected[triangles[index + 2]]
    if (!a || !b || !c) continue
    const triangleArea = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2
    if (Number.isFinite(triangleArea)) area += triangleArea
  }
  return area
}

function formatArea(area) {
  if (!Number.isFinite(area) || area <= 0) return '-'
  if (area >= 1000000) return `${(area / 1000000).toFixed(3)} km²`
  return `${area.toLocaleString('zh-CN', { maximumFractionDigits: 0 })} m²`
}

function removeBuildings() {
  if (!viewer) return
  buildingEntities.forEach((entity) => viewer.entities.remove(entity))
  buildingEntities = []
  buildingModels = []
  buildingStats.value = { safe: 0, partial: 0, submerged: 0 }
}

function createBuildingModels() {
  return FIXED_BUILDINGS.map((building) => ({
    ...building,
    baseHeight: 0,
    state: 'safe',
    rotation: Cesium.Math.toRadians(building.rotation),
  }))
}

function interpolateTriangleDepth(lon, lat, a, b, c) {
  const denominator = (b.lat - c.lat) * (a.lon - c.lon) + (c.lon - b.lon) * (a.lat - c.lat)
  if (Math.abs(denominator) < 1e-14) return null
  const w1 = ((b.lat - c.lat) * (lon - c.lon) + (c.lon - b.lon) * (lat - c.lat)) / denominator
  const w2 = ((c.lat - a.lat) * (lon - c.lon) + (a.lon - c.lon) * (lat - c.lat)) / denominator
  const w3 = 1 - w1 - w2
  if (w1 < -1e-8 || w2 < -1e-8 || w3 < -1e-8) return null
  return Math.max(0, w1 * a.value + w2 * b.value + w3 * c.value)
}

function setBuildingEntityTransform(model, entity) {
  const basePosition = Cesium.Cartesian3.fromDegrees(model.lon, model.lat, model.baseHeight)
  entity.position = Cesium.Cartesian3.fromDegrees(model.lon, model.lat, model.baseHeight + model.height / 2)
  entity.orientation = Cesium.Transforms.headingPitchRollQuaternion(
    basePosition,
    new Cesium.HeadingPitchRoll(model.rotation, 0, 0),
  )
}

async function updateBuildingTerrainHeights() {
  if (!viewer || !buildingModels.length) return
  if (!isTerrainEnabled.value) {
    buildingModels.forEach((model, index) => {
      model.baseHeight = 0
      if (buildingEntities[index]) setBuildingEntityTransform(model, buildingEntities[index])
    })
    return
  }

  const cartographics = buildingModels.map((model) => Cesium.Cartographic.fromDegrees(model.lon, model.lat))
  const sampled = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, cartographics)
  sampled.forEach((position, index) => {
    const model = buildingModels[index]
    model.baseHeight = Number.isFinite(position.height) ? position.height + 0.4 : 0
    if (buildingEntities[index]) setBuildingEntityTransform(model, buildingEntities[index])
  })
}

function floodDepthAtBuilding(lon, lat) {
  if (!floodMesh?.vertices?.length || !floodMesh?.triangles?.length) return 0
  const { vertices, triangles } = floodMesh
  for (let index = 0; index + 2 < triangles.length; index += 3) {
    const a = vertices[triangles[index]]
    const b = vertices[triangles[index + 1]]
    const c = vertices[triangles[index + 2]]
    if (!a || !b || !c) continue
    const depth = interpolateTriangleDepth(lon, lat, a, b, c)
    if (depth !== null) return depth
  }
  return 0
}

function updateMonitorPosition() {
  if (!viewer || !monitorVisible.value) return
  const projectToWindow = Cesium.SceneTransforms.worldToWindowCoordinates
    ?? Cesium.SceneTransforms.wgs84ToWindowCoordinates
  const canvas = viewer.scene.canvas
  const nextScreens = MONITOR_POINTS.map((point) => {
    const worldPosition = Cesium.Cartesian3.fromDegrees(point.lon, point.lat, point.height)
    const screen = projectToWindow?.(viewer.scene, worldPosition)
    const onScreen = Boolean(
      screen
      && Number.isFinite(screen.x)
      && Number.isFinite(screen.y)
      && screen.x >= 0
      && screen.y >= 0
      && screen.x <= canvas.clientWidth
      && screen.y <= canvas.clientHeight,
    )
    return {
      x: screen?.x ?? -1000,
      y: screen?.y ?? -1000,
      onScreen,
    }
  })
  const changed = nextScreens.some((screen, index) => {
    const current = monitorScreens.value[index] ?? emptyMonitorScreen()
    return current.onScreen !== screen.onScreen
      || Math.abs(current.x - screen.x) > 0.5
      || Math.abs(current.y - screen.y) > 0.5
  })
  if (changed) monitorScreens.value = nextScreens
}

function updateMonitorState() {
  if (!monitorVisible.value) return
  monitorStates.value = MONITOR_POINTS.map((point) => {
    const depth = floodDepthAtBuilding(point.lon, point.lat)
    const flooded = depth > 0.01
    const speed = flooded ? Math.sqrt(2 * 9.81 * depth) * 0.35 : 0
    return { depth, speed, flooded }
  })
}

function monitorLevelStyle(value, maximum) {
  return { '--level': Math.max(0.06, Math.min(value / maximum, 1)).toFixed(3) }
}

function applyBuildingState(model, entity) {
  const depth = floodDepthAtBuilding(model.lon, model.lat)
  const measuredState = depth <= 0.05 ? 'safe' : depth < model.height ? 'partial' : 'submerged'
  if (BUILDING_STATE_RANK[measuredState] > BUILDING_STATE_RANK[model.state]) model.state = measuredState
  entity.box.material = BUILDING_COLORS[model.state]
  entity.box.outlineColor = Cesium.Color.WHITE.withAlpha(model.state === 'safe' ? 0.45 : 0.75)
  return model.state
}

function updateBuildingFloodStates() {
  const counts = { safe: 0, partial: 0, submerged: 0 }
  buildingModels.forEach((model, index) => {
    const entity = buildingEntities[index]
    if (entity) counts[applyBuildingState(model, entity)] += 1
  })
  buildingStats.value = counts
}

function ensureBuildingsForFlood() {
  if (!viewer) return
  if (buildingEntities.length) {
    updateBuildingFloodStates()
    return
  }
  buildingModels = createBuildingModels()
  buildingEntities = buildingModels.map((model) => {
    const entity = viewer.entities.add({
      id: model.id,
      position: Cesium.Cartesian3.fromDegrees(model.lon, model.lat, model.baseHeight + model.height / 2),
      orientation: Cesium.Transforms.headingPitchRollQuaternion(
        Cesium.Cartesian3.fromDegrees(model.lon, model.lat, model.baseHeight),
        new Cesium.HeadingPitchRoll(model.rotation, 0, 0),
      ),
      box: {
        dimensions: new Cesium.Cartesian3(model.width, model.depth, model.height),
        material: BUILDING_COLORS.safe,
        outline: true,
        outlineColor: Cesium.Color.WHITE.withAlpha(0.45),
      },
    })
    setBuildingEntityTransform(model, entity)
    return entity
  })
  updateBuildingFloodStates()
  updateBuildingTerrainHeights().catch((error) => console.warn('Building terrain sampling failed:', error))
}

function removeFlood() {
  if (viewer && floodPrimitive) viewer.scene.primitives.remove(floodPrimitive)
  floodPrimitive = undefined
}

async function updateFloodTerrainHeights() {
  if (!viewer || !floodMesh || !isTerrainEnabled.value) return
  const heights = new Float64Array(floodMesh.vertices.length)
  const missing = []
  floodMesh.vertices.forEach((vertex, index) => {
    const key = `${vertex.lon.toFixed(9)},${vertex.lat.toFixed(9)}`
    if (terrainHeightCache.has(key)) heights[index] = terrainHeightCache.get(key)
    else missing.push({ index, key, cartographic: Cesium.Cartographic.fromDegrees(vertex.lon, vertex.lat) })
  })

  if (missing.length) {
    if (terrainHeightCache.size + missing.length > MAX_TERRAIN_HEIGHT_CACHE_ENTRIES) terrainHeightCache.clear()
    const sampled = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, missing.map((item) => item.cartographic))
    sampled.forEach((position, sampleIndex) => {
      const item = missing[sampleIndex]
      const height = Number.isFinite(position.height) ? position.height : 0
      terrainHeightCache.set(item.key, height)
      heights[item.index] = height
    })
  }
  floodMesh.terrainHeights = heights
}

function renderFlood() {
  if (!viewer || !floodMesh) return null
  removeFlood()
  const { vertices, triangles } = floodMesh
  const depths = vertices.map((vertex) => vertex.value)
  const min = Math.min(...depths)
  const max = Math.max(...depths)
  const positions = new Float64Array(vertices.length * 3)
  const colors = new Uint8Array(vertices.length * 4)

  vertices.forEach((vertex, index) => {
    const terrainHeight = isTerrainEnabled.value ? floodMesh.terrainHeights?.[index] ?? 0 : 0
    const height = terrainHeight + Math.max(0, vertex.value) * Number(heightScale.value) + 0.5
    Cesium.Cartesian3.pack(Cesium.Cartesian3.fromDegrees(vertex.lon, vertex.lat, height), positions, index * 3)
    colors.set(colorFor(vertex.value, min, max), index * 4)
  })

  const geometry = new Cesium.Geometry({
    attributes: new Cesium.GeometryAttributes({
      position: new Cesium.GeometryAttribute({
        componentDatatype: Cesium.ComponentDatatype.DOUBLE,
        componentsPerAttribute: 3,
        values: positions,
      }),
      color: new Cesium.GeometryAttribute({
        componentDatatype: Cesium.ComponentDatatype.UNSIGNED_BYTE,
        componentsPerAttribute: 4,
        normalize: true,
        values: colors,
      }),
    }),
    indices: Cesium.IndexDatatype.createTypedArray(vertices.length, triangles),
    primitiveType: Cesium.PrimitiveType.TRIANGLES,
    boundingSphere: Cesium.BoundingSphere.fromVertices(positions),
  })
  floodPrimitive = viewer.scene.primitives.add(new Cesium.Primitive({
    geometryInstances: new Cesium.GeometryInstance({ geometry }),
    appearance: new Cesium.PerInstanceColorAppearance({
      flat: true,
      translucent: Number(opacity.value) < 1,
      renderState: {
        depthTest: { enabled: true },
        depthMask: false,
        blending: Cesium.BlendingState.ALPHA_BLEND,
      },
    }),
    asynchronous: false,
  }))
  pointCount.value = vertices.length
  triangleCount.value = triangles.length / 3
  const area = calculateMeshArea(vertices, triangles)
  floodAreaText.value = formatArea(area)
  depthRange.value = `${min.toFixed(3)} ~ ${max.toFixed(3)} m`
  ensureBuildingsForFlood()
  return { area, minDepth: min, maxDepth: max }
}

function flyToFlood() {
  if (!viewer || !floodMesh?.vertices.length) return
  const positions = floodMesh.vertices.map((vertex) => Cesium.Cartesian3.fromDegrees(vertex.lon, vertex.lat, 0))
  viewer.camera.flyToBoundingSphere(Cesium.BoundingSphere.fromPoints(positions), {
    duration: 1.2,
    offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-55), 0),
  })
}

function stopPlayback() {
  isPlaying.value = false
  if (playbackTimer) clearTimeout(playbackTimer)
  playbackTimer = undefined
}

function cancelFrameSeek() {
  if (frameSeekTimer) clearTimeout(frameSeekTimer)
  frameSeekTimer = undefined
}

function seekToFrame(event) {
  if (!animationFrames.value.length) return
  stopPlayback()
  cancelFrameSeek()
  const frameIndex = Math.max(
    0,
    Math.min(Number(event.currentTarget.value) || 0, animationFrames.value.length - 1),
  )
  activeFrameIndex.value = frameIndex
  frameSeekTimer = setTimeout(() => {
    frameSeekTimer = undefined
    renderMeshFrame(frameIndex)
  }, 80)
}

async function renderMeshFrame(frameIndex, shouldFly = false) {
  const frame = animationFrames.value[frameIndex]
  if (!frame) return
  try {
    status.value = `正在加载第 ${frameIndex + 1} / ${animationFrames.value.length} 帧...`
    const response = await fetch(`/api/mesh-frame?folder=${encodeURIComponent(meshFolder.value)}&name=${encodeURIComponent(frame.name)}`)
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? 'Mesh 文件读取失败。')
    const mesh = normalizeFloodFile(data)
    const triangles = flattenTriangles(mesh.triangles, mesh.vertices.length)
    if (mesh.vertices.length < 3 || triangles.length < 3) throw new Error('该帧没有有效三角网格。')
    floodMesh = { vertices: mesh.vertices, triangles }
    activeFrameIndex.value = frameIndex
    fileName.value = frame.name
    await updateFloodTerrainHeights()
    const metrics = renderFlood()
    updateMonitorState()
    if (shouldFly) flyToFlood()
    if (isCasePlayback && metrics) {
      emit('frame-metrics', {
        frameIndex,
        frameNumber: Number(frame.index) || frameIndex + 1,
        elapsedMinutes: Math.max(0, (Number(frame.index) || frameIndex + 1) - 1),
        maxDepth: metrics.maxDepth,
        floodedArea: metrics.area,
      })
    }
    status.value = `已渲染第 ${frameIndex + 1} / ${animationFrames.value.length} 帧：${frame.name}`
  } catch (error) {
    status.value = `加载失败：${error.message}`
  }
}

async function loadMeshAnimationFolder(folder, initialFrame = 0) {
  if (!folder) return false
  try {
    stopPlayback()
    cancelFrameSeek()
    status.value = '正在读取 index.json...'
    const response = await fetch('/api/mesh-index', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder }),
    })
    const index = await response.json()
    if (!response.ok) throw new Error(index.error ?? 'index.json 读取失败。')
    meshFolder.value = index.folder
    animationFrames.value = index.frames.sort((a, b) => a.index - b.index)
    const frameIndex = initialFrame === 'last'
      ? animationFrames.value.length - 1
      : Math.max(0, Math.min(Number(initialFrame) || 0, animationFrames.value.length - 1))
    await renderMeshFrame(frameIndex, true)
    return true
  } catch (error) {
    status.value = `索引加载失败：${error.message}`
    return false
  }
}

function startPlayback() {
  if (!animationFrames.value.length || isPlaying.value) return
  cancelFrameSeek()
  isPlaying.value = true
  const playbackDelay = () => Math.round(350 / playbackRate.value)
  const playNext = async () => {
    if (!isPlaying.value) return
    await renderMeshFrame((activeFrameIndex.value + 1) % animationFrames.value.length)
    if (isPlaying.value) playbackTimer = setTimeout(playNext, playbackDelay())
  }
  playbackTimer = setTimeout(playNext, playbackDelay())
}

function renderPreviousFrame() {
  if (!animationFrames.value.length) return
  stopPlayback()
  cancelFrameSeek()
  const previousIndex = (activeFrameIndex.value - 1 + animationFrames.value.length) % animationFrames.value.length
  renderMeshFrame(previousIndex)
}

function renderNextFrame() {
  if (!animationFrames.value.length) return
  stopPlayback()
  cancelFrameSeek()
  renderMeshFrame((activeFrameIndex.value + 1) % animationFrames.value.length)
}

function clearFlood() {
  stopPlayback()
  cancelFrameSeek()
  monitorVisible.value = false
  monitorStates.value = MONITOR_POINTS.map(emptyMonitorState)
  removeBuildings()
  removeFlood()
  floodMesh = undefined
  fileName.value = '尚未选择洪水文件'
  pointCount.value = 0
  triangleCount.value = 0
  floodAreaText.value = '-'
  depthRange.value = '-'
  status.value = '已清除洪水图层'
}

async function chooseMeshFolder() {
  isCasePlayback = false
  monitorVisible.value = false
  status.value = '正在打开文件夹选择窗口...'
  try {
    const response = await fetch('/api/select-folder', { method: 'POST' })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error ?? '无法打开文件夹选择窗口。')
    if (!result.path) {
      status.value = '已取消文件夹选择。'
      return
    }
    await loadMeshAnimationFolder(result.path)
  } catch (error) {
    status.value = `选择失败：${error.message}`
  }
}

async function loadYongchuanCase() {
  isCasePlayback = true
  monitorVisible.value = true
  monitorStates.value = MONITOR_POINTS.map(emptyMonitorState)
  emit('case-start')
  const loaded = await loadMeshAnimationFolder(YONGCHUAN_CASE_FOLDER, 0)
  if (loaded) {
    playbackRate.value = 8
    startPlayback()
  } else {
    isCasePlayback = false
    monitorVisible.value = false
  }
  return { loaded, frameCount: animationFrames.value.length }
}

async function toggleTerrain() {
  if (!viewer || isTerrainLoading.value) return
  isTerrainLoading.value = true
  emit('terrain-state', { enabled: isTerrainEnabled.value, loading: true })
  try {
    if (isTerrainEnabled.value) {
      viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider()
      isTerrainEnabled.value = false
      await updateBuildingTerrainHeights()
      renderFlood()
      status.value = '地形已关闭。'
    } else {
      status.value = '正在加载全球地形...'
      viewer.terrainProvider = await Cesium.createWorldTerrainAsync()
      isTerrainEnabled.value = true
      await updateFloodTerrainHeights()
      await updateBuildingTerrainHeights()
      renderFlood()
      status.value = '全球地形已开启。'
    }
  } catch (error) {
    status.value = `地形切换失败：${error.message ?? '请检查网络连接'}`
  } finally {
    isTerrainLoading.value = false
    emit('terrain-state', { enabled: isTerrainEnabled.value, loading: false })
  }
}

function setTerrainEnabled(enabled) {
  isTerrainEnabled.value = Boolean(enabled)
  emit('terrain-state', { enabled: isTerrainEnabled.value, loading: isTerrainLoading.value })
}

async function loadBingImagery() {
  try {
    const provider = await Cesium.IonImageryProvider.fromAssetId(2, {
      accessToken: CESIUM_TOKEN,
      server: 'https://api.cesium.com/',
    })
    viewer.imageryLayers.addImageryProvider(provider)
    status.value = '必应卫星影像已加载，请选择洪水 JSON 文件'
  } catch (error) {
    console.error('Bing imagery loading failed:', error)
    status.value = `必应影像加载失败：${error.message ?? '请检查网络连接'}`
  }
}

onMounted(async () => {
  Cesium.Ion.defaultAccessToken = CESIUM_TOKEN
  Cesium.Ion.defaultServer = new Cesium.Resource({ url: 'https://api.cesium.com/' })
  viewer = new Cesium.Viewer(cesiumContainer.value, {
    baseLayer: false,
    animation: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    timeline: false,
    navigationHelpButton: false,
    infoBox: false,
    selectionIndicator: false,
  })
  viewer.scene.globe.depthTestAgainstTerrain = true
  viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#273b4b')
  viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#101a28')
  removeMonitorPostRender = viewer.scene.postRender.addEventListener(updateMonitorPosition)
  viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(103.4147, 30.934, 6200) })
  window.Cesium = Cesium
  window.cesiumViewer = viewer
  emit('viewer-ready', viewer)
  emit('terrain-state', { enabled: isTerrainEnabled.value, loading: false })
  await loadBingImagery()
})

onBeforeUnmount(() => {
  stopPlayback()
  cancelFrameSeek()
  removeMonitorPostRender?.()
  removeMonitorPostRender = undefined
  removeBuildings()
  emit('viewer-ready', null)
  if (window.cesiumViewer === viewer) window.cesiumViewer = undefined
  viewer?.destroy()
  viewer = undefined
})

defineExpose({
  loadYongchuanCase,
  getViewer: () => viewer,
  setTerrainEnabled,
  toggleTerrain,
})
</script>

<template>
  <Transition name="panel-slide">
  <aside v-if="visible" class="panel render-panel">
    <h1>洪水渲染</h1>
    <div class="folder-choice">
      <button @click="chooseMeshFolder">选择 Mesh 文件夹</button>
      <span>{{ meshFolder || '选择含 index.json 的文件夹' }}</span>
    </div>
    <p class="file-name">{{ fileName }}</p>

    <label>透明度 <output>{{ Math.round(opacity * 100) }}%</output></label>
    <input v-model.number="opacity" type="range" min="0.1" max="1" step="0.05" @input="renderFlood">
    <label>水深高程倍率 <output>{{ heightScale.toFixed(1) }}x</output></label>
    <input v-model.number="heightScale" type="range" min="0" max="5" step="0.1" @input="renderFlood">
    <label>
      数据帧
      <output>{{ animationFrames.length ? `${activeFrameIndex + 1} / ${animationFrames.length}` : '0 / 0' }}</output>
    </label>
    <input
      class="frame-slider"
      type="range"
      min="0"
      :max="Math.max(animationFrames.length - 1, 0)"
      step="1"
      :value="activeFrameIndex"
      :disabled="!animationFrames.length"
      @input="seekToFrame"
    >
    <label>颜色带</label>
    <select v-model="colorRamp" @change="renderFlood">
      <option value="water">水蓝</option>
      <option value="depth">深水蓝</option>
      <option value="heat">深度热图</option>
    </select>
    <label>渲染速率 <output>{{ playbackRate.toFixed(2) }}x</output></label>
    <input v-model.number="playbackRate" type="range" min="0.25" max="10" step="0.25">

    <div class="actions">
      <button @click="flyToFlood">定位洪水</button>
      <button class="secondary" @click="clearFlood">清除图层</button>
    </div>
    <div class="actions">
      <button :disabled="!animationFrames.length || isPlaying" @click="startPlayback">
        连续播放
      </button>
      <button
        class="secondary"
        :disabled="!animationFrames.length"
        @click="renderNextFrame"
      >
        下一帧
      </button>
    </div>
    <div class="actions playback-secondary-actions">
      <button :disabled="!isPlaying" @click="stopPlayback">暂停播放</button>
      <button class="secondary" :disabled="!animationFrames.length" @click="renderPreviousFrame">上一帧</button>
    </div>
    <p class="status">{{ status }}</p>
  </aside>
  </Transition>
  <div ref="cesiumContainer" class="cesium-container" />
  <div
    v-for="(point, index) in MONITOR_POINTS"
    v-show="monitorVisible && monitorScreens[index]?.onScreen"
    :key="point.id"
    class="monitor-anchor"
    :class="{ flooded: monitorStates[index]?.flooded }"
    :style="{ left: `${monitorScreens[index]?.x ?? -1000}px`, top: `${monitorScreens[index]?.y ?? -1000}px` }"
  >
    <section class="monitor-gauges" :aria-label="`${point.id} 监测点水深和流速`">
      <div class="monitor-gauge">
        <div class="monitor-ring">
          <span class="monitor-ring-fill" :style="monitorLevelStyle(monitorStates[index]?.depth ?? 0, MONITOR_DEPTH_SCALE)" />
          <strong>{{ (monitorStates[index]?.depth ?? 0).toFixed(2) }}</strong>
          <small>m</small>
        </div>
        <span>水深</span>
      </div>
      <div class="monitor-gauge">
        <div class="monitor-ring">
          <span class="monitor-ring-fill speed-fill" :style="monitorLevelStyle(monitorStates[index]?.speed ?? 0, MONITOR_SPEED_SCALE)" />
          <strong>{{ (monitorStates[index]?.speed ?? 0).toFixed(2) }}</strong>
          <small>m/s</small>
        </div>
        <span>流速（估算）</span>
      </div>
    </section>
    <span class="monitor-stem" aria-hidden="true" />
    <span class="monitor-location-dot" aria-hidden="true" />
  </div>
</template>
