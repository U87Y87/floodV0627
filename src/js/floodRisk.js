// Index each frame's triangles so facility queries use the local mesh only.
export function createDepthSampler(vertices, triangles) {
  const size = 0.001
  const cells = new Map()
  for (let i = 0; i < triangles.length; i += 3) {
    const points = triangles.slice(i, i + 3).map((index) => vertices[index])
    if (points.some((point) => !point)) continue
    const xs = points.map((point) => Math.floor(point.lon / size))
    const ys = points.map((point) => Math.floor(point.lat / size))
    for (let x = Math.min(...xs); x <= Math.max(...xs); x++) {
      for (let y = Math.min(...ys); y <= Math.max(...ys); y++) {
        const key = `${x},${y}`
        if (!cells.has(key)) cells.set(key, [])
        cells.get(key).push(points)
      }
    }
  }
  return (lon, lat) => {
    let depth = 0
    for (const [a, b, c] of cells.get(`${Math.floor(lon / size)},${Math.floor(lat / size)}`) ?? []) {
      const denominator = (b.lat - c.lat) * (a.lon - c.lon) + (c.lon - b.lon) * (a.lat - c.lat)
      if (Math.abs(denominator) < 1e-14) continue
      const u = ((b.lat - c.lat) * (lon - c.lon) + (c.lon - b.lon) * (lat - c.lat)) / denominator
      const v = ((c.lat - a.lat) * (lon - c.lon) + (a.lon - c.lon) * (lat - c.lat)) / denominator
      const w = 1 - u - v
      if (Math.min(u, v, w) >= -1e-8) depth = Math.max(depth, u * a.value + v * b.value + w * c.value)
    }
    return Math.max(0, depth)
  }
}

export function buildingFloodState(depth, height) {
  if (depth > height * 0.5) return 'submerged'
  return depth > 0.05 ? 'partial' : 'safe'
}
