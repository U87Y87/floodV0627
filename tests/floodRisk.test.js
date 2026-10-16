import assert from 'node:assert/strict'
import test from 'node:test'
import * as Cesium from 'cesium'
import { createDepthSampler, buildingFloodState } from '../src/js/floodRisk.js'
import { createYongchuanInfrastructure } from '../src/js/yongchuanInfrastructure.js'
import { densifyRoad, splitFloodedRoad, ROAD_FLOOD_THRESHOLD } from '../src/js/roadFlood.js'

test('water depth interpolates inside a triangle without flooding outside its footprint', () => {
  const sample = createDepthSampler([
    { lon: 103.54, lat: 31.44, value: 0 },
    { lon: 103.542, lat: 31.44, value: 10 },
    { lon: 103.54, lat: 31.442, value: 10 },
  ], [0, 1, 2])
  assert.ok(Math.abs(sample(103.5405, 31.4405) - 5) < 1e-7)
  assert.equal(sample(103.5419, 31.4419), 0)
  assert.equal(sample(103.55, 31.45), 0)
})

test('instantaneous building classification turns red only above half the height', () => {
  assert.deepEqual([0, 4.99, 5, 5.01, 12].map((depth) => buildingFloodState(depth, 10)),
    ['safe', 'partial', 'partial', 'submerged', 'submerged'])
})

test('case infrastructure updates and cleans up all entities without duplicating on reload', () => {
  const viewer = { entities: new Cesium.EntityCollection() }
  const scene = createYongchuanInfrastructure(viewer)
  const buildingCount = viewer.entities.values.filter((entity) => entity.box).length
  assert.ok(buildingCount > 0)
  assert.deepEqual(scene.update(() => 0), { safe: buildingCount, partial: 0, submerged: 0 })
  assert.deepEqual(scene.update(() => 1), { safe: 0, partial: buildingCount, submerged: 0 })
  assert.deepEqual(scene.update(() => 0), { safe: 0, partial: buildingCount, submerged: 0 })
  assert.deepEqual(scene.update(() => 40), { safe: 0, partial: 0, submerged: buildingCount })
  assert.deepEqual(scene.update(() => 0), { safe: 0, partial: 0, submerged: buildingCount })
  assert.equal(viewer.entities.values.filter((entity) => entity.polyline).length, 1)
  const alarm = viewer.entities.values.find((entity) => entity.name === '道路受淹警报')
  assert.equal(alarm.show, true)
  scene.update(() => 12)
  assert.equal(alarm.show, true)
  scene.update(() => 0)
  assert.equal(alarm.show, true)
  assert.equal(viewer.entities.values.find((entity) => entity.polyline).name, '受淹道路')
  scene.destroy()
  assert.equal(viewer.entities.values.length, 0)
  const next = createYongchuanInfrastructure(viewer)
  assert.equal(viewer.entities.values.filter((entity) => entity.box).length, buildingCount)
  assert.deepEqual(next.update(() => 0), { safe: buildingCount, partial: 0, submerged: 0 })
  assert.equal(viewer.entities.values.find((entity) => entity.polyline).name, '未受淹道路')
  next.destroy()
})

test('a partially flooded road retains exactly its red extent and alarm after water recedes', () => {
  const viewer = { entities: new Cesium.EntityCollection() }
  const scene = createYongchuanInfrastructure(viewer)
  scene.update((lon) => lon > 103.553 && lon < 103.555 ? 2 : 0)
  const lines = () => viewer.entities.values.filter((entity) => entity.name === '受淹道路')
    .map((entity) => entity.polyline.positions.getValue().map((position) => {
      const point = Cesium.Cartographic.fromCartesian(position)
      return [point.longitude.toFixed(10), point.latitude.toFixed(10)]
    }))
  const floodedBefore = lines()
  assert.ok(floodedBefore.length > 0)
  assert.ok(viewer.entities.values.some((entity) => entity.name === '未受淹道路'))
  scene.update(() => 0)
  assert.deepEqual(lines(), floodedBefore)
  assert.equal(viewer.entities.values.filter((entity) => entity.name === '道路受淹警报' && entity.show).length, floodedBefore.length)
  scene.destroy()
})

test('roads stay above water and visibility changes preserve cumulative damage', () => {
  const viewer = { entities: new Cesium.EntityCollection() }
  const scene = createYongchuanInfrastructure(viewer)
  scene.update(() => 6, 2)
  const road = viewer.entities.values.find((entity) => entity.polyline)
  assert.equal(road.polyline.clampToGround.getValue(), false)
  assert.ok(road.polyline.positions.getValue().every((position) => Cesium.Cartographic.fromCartesian(position).height > 13.4))
  scene.setVisible(false)
  assert.ok(viewer.entities.values.every((entity) => !entity.show))
  scene.update(() => 0)
  assert.ok(viewer.entities.values.every((entity) => !entity.show))
  scene.setVisible(true)
  assert.equal(road.name, '受淹道路')
  assert.equal(road.show, true)
  assert.ok(viewer.entities.values.some((entity) => entity.name === '道路受淹警报' && entity.show))
  scene.destroy()
})

test('roads split at the wet boundary and preserve separate dry and wet sections', () => {
  const points = densifyRoad([[103.54,31.44,1280],[103.5402,31.44,1281]])
  assert.ok(points.length > 2)
  const runs = splitFloodedRoad(points, (lon) => lon > 103.54007 && lon < 103.54013 ? 1 : 0)
  assert.deepEqual(runs.map((run) => run.flooded), [false, true, false])
  assert.equal(runs[0].points.at(-1).lon, runs[1].points[0].lon)
  assert.equal(runs[1].points.at(-1).lon, runs[2].points[0].lon)
  assert.equal(runs[1].points[0].depth, ROAD_FLOOD_THRESHOLD)
  assert.deepEqual(splitFloodedRoad(points, () => 0).map((run) => run.flooded), [false])
})
