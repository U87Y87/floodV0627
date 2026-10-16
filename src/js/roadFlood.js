export const ROAD_FLOOD_THRESHOLD = 0.01

// Densify to at most 2 metres so a wet patch between the supplied 10 m points
// does not colour the entire original segment red.
export function densifyRoad(coordinates, spacing = 2) {
  const points = []
  coordinates.forEach(([lon, lat, elevation], index) => {
    const previous = coordinates[index - 1]
    if (previous) {
      const east = (lon - previous[0]) * 111320 * Math.cos(lat * Math.PI / 180)
      const north = (lat - previous[1]) * 111320
      const steps = Math.ceil(Math.hypot(east, north) / spacing)
      for (let step = 1; step < steps; step++) {
        const t = step / steps
        points.push({ lon: previous[0] + (lon - previous[0]) * t, lat: previous[1] + (lat - previous[1]) * t,
          elevation: previous[2] + (elevation - previous[2]) * t, baseHeight: 0 })
      }
    }
    points.push({ lon, lat, elevation, baseHeight: 0 })
  })
  return points
}

export function splitFloodedRoad(points, sampleDepth) {
  if (points.length < 2) return []
  const sampled = points.map((point) => ({ ...point, depth: Math.max(0, sampleDepth(point.lon, point.lat, point)) }))
  const runs = []
  let run = { flooded: sampled[0].depth > ROAD_FLOOD_THRESHOLD, points: [sampled[0]] }
  for (let i = 1; i < sampled.length; i++) {
    const a = sampled[i - 1]
    const b = sampled[i]
    const flooded = b.depth > ROAD_FLOOD_THRESHOLD
    if (flooded !== run.flooded) {
      const t = (ROAD_FLOOD_THRESHOLD - a.depth) / (b.depth - a.depth)
      const boundary = { lon: a.lon + (b.lon - a.lon) * t, lat: a.lat + (b.lat - a.lat) * t,
        baseHeight: a.baseHeight + (b.baseHeight - a.baseHeight) * t,
        waterDepth: (a.waterDepth ?? 0) + ((b.waterDepth ?? 0) - (a.waterDepth ?? 0)) * t,
        depth: ROAD_FLOOD_THRESHOLD }
      run.points.push(boundary)
      runs.push(run)
      run = { flooded, points: [boundary] }
    }
    run.points.push(b)
  }
  runs.push(run)
  return runs
}
