// Compact, separate building volumes within the six annotated parcels.
// Local-axis tuples are [x, y, width, depth, height] in metres.
export const ANNOTATED_BUILDING_BLOCKS = [
  { lon: 103.54805, lat: 31.44769, type: 'residential', name: '西侧居民区', rotation: 60.2, localOffsets: true,
    footprints: [[-35,25,24,16,14],[5,0,18,15,23],[36,-25,22,17,18]] },
  { lon: 103.54517724, lat: 31.44607547, type: 'residential', name: '滨河建筑区', rotation: 60.2, localOffsets: true,
    footprints: [[-16,26,24,18,16],[16,-26,20,16,25]] },
  { lon: 103.54657, lat: 31.44491, type: 'residential', name: '中部居民区', rotation: 60.2, localOffsets: true,
    footprints: [[-25,0,18,16,29],[22,28,26,18,17],[22,-28,20,15,24]] },
  { lon: 103.54779, lat: 31.44334, type: 'residential', name: '东侧居民区', rotation: 60.2, localOffsets: true,
    footprints: [[-18,34,24,18,18],[14,0,18,15,27],[-16,-34,22,17,22]] },
  { lon: 103.55080972, lat: 31.4435563, type: 'residential', name: '沿路建筑区', rotation: 60.2, localOffsets: true,
    footprints: [[-18,0,18,14,12],[18,1,16,13,18]] },
  { lon: 103.5437753, lat: 31.44226887, type: 'residential', name: '南侧建筑区', rotation: 60.2, localOffsets: true,
    footprints: [[-26,0,22,17,22],[23,28,27,19,14],[23,-28,18,15,27]] },
]
