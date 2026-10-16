import * as Cesium from 'cesium'
import { buildingFloodState } from './floodRisk.js'
import { YONGCHUAN_ROAD } from './yongchuanRoadAlignment.js'
import { densifyRoad, splitFloodedRoad } from './roadFlood.js'
import { ANNOTATED_BUILDING_BLOCKS } from './yongchuanBuildingBlocks.js'

// Positions follow the annotated residential blocks, factory roofs and riverside highway.
// Building heights remain illustrative until surveyed building data is available.
const GROUPS = [
  ...ANNOTATED_BUILDING_BLOCKS,
  { lon: 103.54525, lat: 31.45455, type: 'residential', name: '河湾对岸居民区', rotation: 25,
    footprints: [[-32,-12,12,16,9],[-8,-18,11,15,12],[18,-20,13,16,9],[-23,13,12,15,12],[2,9,12,17,15],[29,4,11,15,9]] },
  { lon: 103.553763, lat: 31.45236, type: 'rescue', name: '厂房区救援点', rotation: 63,
    footprints: [[31,11,91,16,8],[0,0,91,16,10],[-29,-10,91,16,9],[-57,-22,91,16,9]] },
  { lon: 103.551996, lat: 31.454806, type: 'rescue', name: '对岸厂房安置点', rotation: 30,
    footprints: [[0,0,100,25,10]] },
]
export const CASE_ICONS = {
  residential: '/icons/case-residential.svg',
  rescue: '/icons/case-rescue.svg',
  terminal: '/icons/case-terminal.svg',
}
const COLORS = { safe: '#61e5a2', partial: '#ffc447', submerged: '#ff343e' }

export function createYongchuanInfrastructure(viewer) {
  const entities = []
  const buildings = []
  const markers = []
  const roadPoints = densifyRoad(YONGCHUAN_ROAD)
  const roadEntities = []
  let lastDepthSampler = () => 0
  let disposed = false
  let terrainVersion = 0
  let heightScale = 1
  let visible = true
  const add = (options) => {
    const entity = viewer.entities.add(options)
    entities.push(entity)
    return entity
  }
  function marker(lon, lat, type, name, building) {
    const item = { lon, lat, baseHeight: 0, building }
    item.entity = add({
      name,
      position: Cesium.Cartesian3.fromDegrees(lon, lat, 24),
      billboard: {
        image: CASE_ICONS[type], width: 46, height: 48,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        scaleByDistance: new Cesium.NearFarScalar(700, 1, 12000, 0.55),
        disableDepthTestDistance: 0,
      },
      properties: { category: type, placement: '示意设施' },
    })
    markers.push(item)
  }
  GROUPS.forEach((group) => {
    group.footprints.forEach(([east, north, width, depth, height], i) => {
      const scale = group.scale ?? 1
      const rotation = Cesium.Math.toRadians(group.rotation)
      const offsetEast = group.localOffsets ? east * Math.cos(rotation) + north * Math.sin(rotation) : east
      const offsetNorth = group.localOffsets ? -east * Math.sin(rotation) + north * Math.cos(rotation) : north
      const model = {
        lon: group.lon + offsetEast * scale / (111320 * Math.cos(Cesium.Math.toRadians(group.lat))),
        lat: group.lat + offsetNorth * scale / 111320,
        width: width * scale, depth: depth * scale, height: height * scale, baseHeight: 0,
        rotation, state: 'safe', waterDepth: 0, peakDepth: 0,
      }
      model.entity = add({
        name: `${group.name} · ${i + 1}号楼（示意）`,
        box: { dimensions: new Cesium.Cartesian3(model.width, model.depth, model.height),
          material: Cesium.Color.fromCssColorString(COLORS.safe),
          outline: true, outlineColor: Cesium.Color.WHITE.withAlpha(0.55) },
      })
      model.type = group.type
      buildings.push(model)
      if (i === Math.floor(group.footprints.length / 2)) marker(model.lon, model.lat, group.type, group.name, model)
    })
  })
  function updateRoads() {
    // Preserve the peak at each fixed location, so the historical red extent
    // can only expand, even when water recedes or playback loops to frame one.
    roadPoints.forEach((point) => {
      point.waterDepth = Math.max(0, lastDepthSampler(point.lon, point.lat))
      point.peakDepth = Math.max(point.peakDepth ?? 0, point.waterDepth)
    })
    const runs = splitFloodedRoad(roadPoints, (lon, lat, point) => point.peakDepth)
    runs.forEach((run, index) => {
      let item = roadEntities[index]
      if (!item) {
        item = {
          line: viewer.entities.add({ show: visible, polyline: { width: 4, clampToGround: false,
            material: new Cesium.ColorMaterialProperty() } }),
          alarm: viewer.entities.add({ name: '道路受淹警报', show: false,
            billboard: { image: CASE_ICONS.terminal, width: 42, height: 44,
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
              scaleByDistance: new Cesium.NearFarScalar(700, 1, 12000, 0.55) } }),
        }
        roadEntities.push(item)
      }
      item.line.name = run.flooded ? '受淹道路' : '未受淹道路'
      // Lift above the current water surface, while colour uses historical depth.
      item.line.polyline.positions = Cesium.Cartesian3.fromDegreesArrayHeights(run.points.flatMap((point) =>
        [point.lon, point.lat, point.baseHeight + point.waterDepth * heightScale + 1.5]))
      item.line.polyline.material.color = Cesium.Color.fromCssColorString(run.flooded ? '#ff424d' : '#30c9ff')
      item.line.properties = { flooded: run.flooded, cumulative: true, source: '用户最新标注道路线' }
      item.line.show = visible
      item.alarm.show = visible && run.flooded
      if (run.flooded) {
        const point = run.points.reduce((deepest, next) => next.depth > deepest.depth ? next : deepest)
        item.alarm.position = Cesium.Cartesian3.fromDegrees(point.lon, point.lat, point.baseHeight + point.depth * heightScale + 20)
      }
    })
    while (roadEntities.length > runs.length) {
      const item = roadEntities.pop()
      viewer.entities.remove(item.line)
      viewer.entities.remove(item.alarm)
    }
  }
  function positionBuildings() {
    for (const model of buildings) {
      const position = Cesium.Cartesian3.fromDegrees(model.lon, model.lat, model.baseHeight + model.height / 2)
      model.entity.position = position
      model.entity.orientation = Cesium.Transforms.headingPitchRollQuaternion(position, new Cesium.HeadingPitchRoll(model.rotation, 0, 0))
    }
  }
  function positionMarkers(scale = 1) {
    for (const item of markers) {
      const model = item.building
      const height = model ? Math.max(model.height, model.waterDepth * scale) + 12 : 24
      item.entity.position = Cesium.Cartesian3.fromDegrees(item.lon, item.lat, (model?.baseHeight ?? item.baseHeight) + height)
    }
  }
  positionBuildings()
  positionMarkers()
  updateRoads()
  return {
    setVisible(value) {
      visible = Boolean(value)
      entities.forEach((entity) => { entity.show = visible })
      roadEntities.forEach(({ line, alarm }) => {
        line.show = visible
        alarm.show = visible && line.properties.flooded.getValue()
      })
    },
    update(sampleDepth, scale = 1) {
      heightScale = scale
      lastDepthSampler = sampleDepth
      const counts = { safe: 0, partial: 0, submerged: 0 }
      for (const model of buildings) {
        // Sample the centre and rotated footprint corners, rather than a distant grid vertex.
        const points = [[0, 0], ...[-1, 1].flatMap((x) => [-1, 1].map((y) => [x * model.width / 2, y * model.depth / 2]))]
        model.waterDepth = Math.max(...points.map(([x, y]) => {
          const east = x * Math.cos(model.rotation) + y * Math.sin(model.rotation)
          const north = -x * Math.sin(model.rotation) + y * Math.cos(model.rotation)
          return sampleDepth(model.lon + east / (111320 * Math.cos(Cesium.Math.toRadians(model.lat))), model.lat + north / 111320)
        }))
        model.peakDepth = Math.max(model.peakDepth, model.waterDepth)
        model.state = buildingFloodState(model.peakDepth, model.height)
        const color = COLORS[model.state]
        model.entity.box.material = Cesium.Color.fromCssColorString(color)
        model.entity.properties = { waterDepth: model.waterDepth, peakWaterDepth: model.peakDepth,
          buildingHeight: model.height, inundationRatio: model.peakDepth / model.height }
        counts[model.state]++
      }
      positionMarkers(scale)
      updateRoads()
      return counts
    },
    async refreshTerrain(enabled) {
      const version = ++terrainVersion
      const locations = [...buildings, ...markers, ...roadPoints]
      const sampled = enabled ? await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider,
        locations.map((item) => Cesium.Cartographic.fromDegrees(item.lon, item.lat))) : null
      if (disposed || version !== terrainVersion) return
      locations.forEach((item, i) => { item.baseHeight = sampled && Number.isFinite(sampled[i].height) ? sampled[i].height + 0.4 : 0 })
      positionBuildings()
      positionMarkers(heightScale)
      updateRoads()
    },
    destroy() {
      disposed = true
      entities.forEach((entity) => viewer.entities.remove(entity))
      roadEntities.forEach(({ line, alarm }) => {
        viewer.entities.remove(line)
        viewer.entities.remove(alarm)
      })
    },
  }
}
