import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const longitude = 103.545809
const latitude = 31.443888
const terrainHeight = 1292.74
const heightOffset = 0.5
const baseHeight = terrainHeight + heightOffset
const outputDirectory = path.resolve('public', 'model')

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  const checksum = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])))
  return Buffer.concat([length, typeBuffer, data, checksum])
}

function createPng(width, height, pixel) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  const scanlines = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1)
    scanlines[rowStart] = 0
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a = 255] = pixel(x, y)
      const offset = rowStart + 1 + x * 4
      scanlines[offset] = r
      scanlines[offset + 1] = g
      scanlines[offset + 2] = b
      scanlines[offset + 3] = a
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

const textures = [
  createPng(128, 128, (x, y) => {
    const course = Math.floor(y / 24)
    const mortarY = y % 24 < 3
    const shiftedX = (x + (course % 2) * 24) % 48
    const mortarX = shiftedX < 3
    if (mortarX || mortarY) return [104, 102, 94, 255]
    const variation = ((x * 17 + y * 29 + course * 11) % 19) - 9
    return [194 + variation, 177 + variation, 145 + variation, 255]
  }),
  createPng(128, 128, (x, y) => {
    const row = Math.floor(y / 20)
    const localY = y % 20
    const localX = (x + (row % 2) * 12) % 24
    if (localY < 2 || localX < 2) return [91, 43, 34, 255]
    const highlight = Math.max(0, 8 - Math.abs(localX - 12))
    return [139 + highlight * 2, 63 + highlight, 47 + Math.floor(highlight / 2), 255]
  }),
  createPng(64, 128, (x, y) => {
    const plank = Math.floor(x / 16)
    if (x % 16 < 2) return [61, 34, 19, 255]
    const grain = Math.round(8 * Math.sin(y * 0.19 + plank * 1.7) + 4 * Math.sin(y * 0.53))
    const knot = (x - 24) ** 2 + (y - 72) ** 2 < 35 ? -28 : 0
    return [112 + grain + knot, 67 + Math.floor(grain / 2) + knot, 35 + knot, 255]
  }),
  createPng(96, 96, (x, y) => {
    const frame = x < 6 || y < 6 || x > 89 || y > 89 || Math.abs(x - 48) < 3 || Math.abs(y - 48) < 3
    if (frame) return [76, 53, 35, 255]
    const gleam = Math.abs(x - y - 13) < 5
    return gleam ? [190, 225, 232, 255] : [63 + Math.floor(y / 5), 117 + Math.floor(y / 8), 143 + Math.floor(y / 10), 255]
  }),
]

const primitiveData = Array.from({ length: 4 }, () => ({
  positions: [],
  normals: [],
  uvs: [],
  indices: [],
}))

function addVertex(data, position, normal, uv) {
  data.positions.push(...position)
  data.normals.push(...normal)
  data.uvs.push(...uv)
}

function addQuad(material, points, normal, uvScale = [1, 1]) {
  const data = primitiveData[material]
  const start = data.positions.length / 3
  const uvs = [[0, 0], [uvScale[0], 0], [uvScale[0], uvScale[1]], [0, uvScale[1]]]
  points.forEach((point, index) => addVertex(data, point, normal, uvs[index]))
  data.indices.push(start, start + 1, start + 2, start, start + 2, start + 3)
}

function addTriangle(material, points, normal, uvs) {
  const data = primitiveData[material]
  const start = data.positions.length / 3
  points.forEach((point, index) => addVertex(data, point, normal, uvs[index]))
  data.indices.push(start, start + 1, start + 2)
}

// Stone walls.
addQuad(0, [[-3, -2.5, 0], [3, -2.5, 0], [3, -2.5, 3.2], [-3, -2.5, 3.2]], [0, -1, 0], [3, 1.6])
addQuad(0, [[3, 2.5, 0], [-3, 2.5, 0], [-3, 2.5, 3.2], [3, 2.5, 3.2]], [0, 1, 0], [3, 1.6])
addQuad(0, [[-3, 2.5, 0], [-3, -2.5, 0], [-3, -2.5, 3.2], [-3, 2.5, 3.2]], [-1, 0, 0], [2.5, 1.6])
addQuad(0, [[3, -2.5, 0], [3, 2.5, 0], [3, 2.5, 3.2], [3, -2.5, 3.2]], [1, 0, 0], [2.5, 1.6])
addTriangle(0, [[-3, -2.5, 3.2], [3, -2.5, 3.2], [0, -2.5, 5]], [0, -1, 0], [[0, 0], [3, 0], [1.5, 0.9]])
addTriangle(0, [[3, 2.5, 3.2], [-3, 2.5, 3.2], [0, 2.5, 5]], [0, 1, 0], [[0, 0], [3, 0], [1.5, 0.9]])

// Tiled gable roof with a small overhang.
const roofNormalX = 1.8 / Math.hypot(3.3, 1.8)
const roofNormalZ = 3.3 / Math.hypot(3.3, 1.8)
addQuad(1, [[-3.3, -2.8, 3.2], [0, -2.8, 5], [0, 2.8, 5], [-3.3, 2.8, 3.2]], [-roofNormalX, 0, roofNormalZ], [2.4, 3.5])
addQuad(1, [[0, 2.8, 5], [0, -2.8, 5], [3.3, -2.8, 3.2], [3.3, 2.8, 3.2]], [roofNormalX, 0, roofNormalZ], [2.4, 3.5])

// Front door.
addQuad(2, [[-0.7, -2.515, 0.02], [0.7, -2.515, 0.02], [0.7, -2.515, 2.35], [-0.7, -2.515, 2.35]], [0, -1, 0], [1, 1])

// Textured windows on all four sides.
for (const [x0, x1] of [[-2.45, -1.25], [1.25, 2.45]]) {
  addQuad(3, [[x0, -2.52, 1.2], [x1, -2.52, 1.2], [x1, -2.52, 2.35], [x0, -2.52, 2.35]], [0, -1, 0])
  addQuad(3, [[x1, 2.52, 1.2], [x0, 2.52, 1.2], [x0, 2.52, 2.35], [x1, 2.52, 2.35]], [0, 1, 0])
}
addQuad(3, [[-3.02, 0.65, 1.2], [-3.02, -0.65, 1.2], [-3.02, -0.65, 2.35], [-3.02, 0.65, 2.35]], [-1, 0, 0])
addQuad(3, [[3.02, -0.65, 1.2], [3.02, 0.65, 1.2], [3.02, 0.65, 2.35], [3.02, -0.65, 2.35]], [1, 0, 0])

const gltf = {
  asset: { version: '2.0', generator: 'Codex textured house 3D Tiles generator' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0, name: 'TexturedHouse_6m_x_5m_x_5m' }],
  meshes: [{ name: 'House', primitives: [] }],
  buffers: [{ byteLength: 0 }],
  bufferViews: [],
  accessors: [],
  samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
  images: [],
  textures: [],
  materials: [
    { name: 'Stone walls', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.9 }, doubleSided: true },
    { name: 'Clay roof tiles', pbrMetallicRoughness: { baseColorTexture: { index: 1 }, metallicFactor: 0, roughnessFactor: 0.82 }, doubleSided: true },
    { name: 'Wood door', pbrMetallicRoughness: { baseColorTexture: { index: 2 }, metallicFactor: 0, roughnessFactor: 0.74 }, doubleSided: true },
    { name: 'Framed glass windows', pbrMetallicRoughness: { baseColorTexture: { index: 3 }, metallicFactor: 0.05, roughnessFactor: 0.28 }, doubleSided: true },
  ],
}

const binaryParts = []
let binaryLength = 0

function appendBinary(buffer, target) {
  const padding = (4 - (binaryLength % 4)) % 4
  if (padding) {
    binaryParts.push(Buffer.alloc(padding))
    binaryLength += padding
  }
  const bufferView = { buffer: 0, byteOffset: binaryLength, byteLength: buffer.length }
  if (target) bufferView.target = target
  const index = gltf.bufferViews.push(bufferView) - 1
  binaryParts.push(buffer)
  binaryLength += buffer.length
  return index
}

function addAccessor(typedArray, type, componentType, target, includeBounds = false) {
  const buffer = Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength)
  const bufferView = appendBinary(buffer, target)
  const componentCount = { SCALAR: 1, VEC2: 2, VEC3: 3 }[type]
  const accessor = { bufferView, componentType, count: typedArray.length / componentCount, type }
  if (includeBounds) {
    accessor.min = Array(componentCount).fill(Number.POSITIVE_INFINITY)
    accessor.max = Array(componentCount).fill(Number.NEGATIVE_INFINITY)
    for (let i = 0; i < typedArray.length; i += componentCount) {
      for (let component = 0; component < componentCount; component += 1) {
        accessor.min[component] = Math.min(accessor.min[component], typedArray[i + component])
        accessor.max[component] = Math.max(accessor.max[component], typedArray[i + component])
      }
    }
  }
  return gltf.accessors.push(accessor) - 1
}

primitiveData.forEach((data, material) => {
  const positionAccessor = addAccessor(new Float32Array(data.positions), 'VEC3', 5126, 34962, true)
  const normalAccessor = addAccessor(new Float32Array(data.normals), 'VEC3', 5126, 34962)
  const uvAccessor = addAccessor(new Float32Array(data.uvs), 'VEC2', 5126, 34962)
  const indexAccessor = addAccessor(new Uint16Array(data.indices), 'SCALAR', 5123, 34963)
  gltf.meshes[0].primitives.push({
    attributes: { POSITION: positionAccessor, NORMAL: normalAccessor, TEXCOORD_0: uvAccessor },
    indices: indexAccessor,
    material,
    mode: 4,
  })
})

textures.forEach((texture, index) => {
  const bufferView = appendBinary(texture)
  gltf.images.push({ name: gltf.materials[index].name, bufferView, mimeType: 'image/png' })
  gltf.textures.push({ sampler: 0, source: index })
})

gltf.buffers[0].byteLength = binaryLength
const binaryChunk = Buffer.concat(binaryParts)
const jsonBuffer = Buffer.from(JSON.stringify(gltf))
const jsonPadding = (4 - (jsonBuffer.length % 4)) % 4
const paddedJson = Buffer.concat([jsonBuffer, Buffer.alloc(jsonPadding, 0x20)])
const binaryPadding = (4 - (binaryChunk.length % 4)) % 4
const paddedBinary = Buffer.concat([binaryChunk, Buffer.alloc(binaryPadding)])
const glbLength = 12 + 8 + paddedJson.length + 8 + paddedBinary.length
const glbHeader = Buffer.alloc(12)
glbHeader.writeUInt32LE(0x46546c67, 0)
glbHeader.writeUInt32LE(2, 4)
glbHeader.writeUInt32LE(glbLength, 8)
const jsonHeader = Buffer.alloc(8)
jsonHeader.writeUInt32LE(paddedJson.length, 0)
jsonHeader.writeUInt32LE(0x4e4f534a, 4)
const binaryHeader = Buffer.alloc(8)
binaryHeader.writeUInt32LE(paddedBinary.length, 0)
binaryHeader.writeUInt32LE(0x004e4942, 4)

function enuTransform(lonDegrees, latDegrees, height) {
  const a = 6378137
  const e2 = 6.69437999014e-3
  const lon = lonDegrees * Math.PI / 180
  const lat = latDegrees * Math.PI / 180
  const sinLon = Math.sin(lon)
  const cosLon = Math.cos(lon)
  const sinLat = Math.sin(lat)
  const cosLat = Math.cos(lat)
  const n = a / Math.sqrt(1 - e2 * sinLat * sinLat)
  const x = (n + height) * cosLat * cosLon
  const y = (n + height) * cosLat * sinLon
  const z = (n * (1 - e2) + height) * sinLat
  return [
    -sinLon, cosLon, 0, 0,
    -sinLat * cosLon, -sinLat * sinLon, cosLat, 0,
    cosLat * cosLon, cosLat * sinLon, sinLat, 0,
    x, y, z, 1,
  ]
}

const tileset = {
  asset: { version: '1.1', gltfUpAxis: 'Z' },
  geometricError: 0,
  root: {
    boundingVolume: {
      box: [0, 0, 2.5, 3.5, 0, 0, 0, 3, 0, 0, 0, 2.6],
    },
    geometricError: 0,
    refine: 'ADD',
    transform: enuTransform(longitude, latitude, baseHeight),
    content: { uri: 'house.glb' },
  },
  extras: {
    name: '5m textured house',
    longitude,
    latitude,
    terrainHeight,
    heightOffset,
    baseHeight,
    dimensionsMeters: { width: 6, depth: 5, height: 5 },
  },
}

fs.mkdirSync(outputDirectory, { recursive: true })
fs.writeFileSync(path.join(outputDirectory, 'house.glb'), Buffer.concat([
  glbHeader,
  jsonHeader,
  paddedJson,
  binaryHeader,
  paddedBinary,
]))
fs.writeFileSync(path.join(outputDirectory, 'tileset.json'), `${JSON.stringify(tileset, null, 2)}\n`)

console.log(`Generated ${path.join(outputDirectory, 'tileset.json')}`)
console.log(`Generated ${path.join(outputDirectory, 'house.glb')} (${glbLength} bytes)`)
