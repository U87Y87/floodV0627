(function () {
  "use strict";

  const DEFAULT_COLOR_RAMP = [
    [216, 196, 138],
    [188, 152, 86],
    [156, 111, 58],
    [118, 76, 42],
    [82, 49, 31],
    [59, 36, 24],
  ];

  function pointKey(lon, lat) {
    return `${Number(lon).toFixed(9)},${Number(lat).toFixed(9)}`;
  }

  function getTerrainHeight(terrainHeights, lon, lat) {
    if (!terrainHeights) {
      return 0;
    }

    if (typeof terrainHeights === "function") {
      return terrainHeights(lon, lat) || 0;
    }

    return terrainHeights.get(pointKey(lon, lat)) || 0;
  }

  function hexToRgb(color) {
    const normalized = color.replace("#", "");
    const value = Number.parseInt(
      normalized.length === 3
        ? normalized
            .split("")
            .map((char) => char + char)
            .join("")
        : normalized,
      16,
    );

    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }

  function normalizeColorRamp(colorRamp) {
    if (!Array.isArray(colorRamp) || !colorRamp.length) {
      return DEFAULT_COLOR_RAMP;
    }

    return colorRamp.map((color) =>
      Array.isArray(color) ? color : hexToRgb(String(color)),
    );
  }

  function getColorBytes(value, minValue, maxValue, alpha, colorRamp) {
    const range = Math.max(maxValue - minValue, 0.0001);
    const t = Cesium.Math.clamp((value - minValue) / range, 0, 1);
    const scaled = t * (colorRamp.length - 1);
    const lowerIndex = Math.floor(scaled);
    const upperIndex = Math.min(lowerIndex + 1, colorRamp.length - 1);
    const localT = scaled - lowerIndex;
    const lower = colorRamp[lowerIndex];
    const upper = colorRamp[upperIndex];

    return [
      Math.round(Cesium.Math.lerp(lower[0], upper[0], localT)),
      Math.round(Cesium.Math.lerp(lower[1], upper[1], localT)),
      Math.round(Cesium.Math.lerp(lower[2], upper[2], localT)),
      Math.round(Cesium.Math.clamp(alpha, 0, 1) * 255),
    ];
  }

  function createTriangleMeshPrimitive(options) {
    const mesh = options.mesh;
    const stats = options.stats;
    const terrainHeights = options.terrainHeights;
    const terrainScale = options.terrainScale || 1;
    const heightScale = options.heightScale ?? 0.65;
    const surfaceOffset = options.surfaceOffset ?? 1.2;
    const alpha = options.alpha ?? 0.86;
    const colorRamp = normalizeColorRamp(options.colorRamp);
    const vertexCount = mesh.values.length;
    const packedPositions = new Float64Array(vertexCount * 3);
    const colors = new Uint8Array(vertexCount * 4);

    for (let index = 0; index < vertexCount; index += 1) {
      const lon = mesh.positions[index * 2];
      const lat = mesh.positions[index * 2 + 1];
      const value = mesh.values[index];
      const height =
        getTerrainHeight(terrainHeights, lon, lat) * terrainScale +
        value * heightScale +
        surfaceOffset;
      const cartesian = Cesium.Cartesian3.fromDegrees(lon, lat, height);
      const color = getColorBytes(
        value,
        stats.minValue,
        stats.maxValue,
        alpha,
        colorRamp,
      );

      Cesium.Cartesian3.pack(cartesian, packedPositions, index * 3);
      colors.set(color, index * 4);
    }

    const indices = Cesium.IndexDatatype.createTypedArray(
      vertexCount,
      mesh.triangles.length,
    );

    for (let index = 0; index < mesh.triangles.length; index += 3) {
      indices[index] = mesh.triangles[index + 2];
      indices[index + 1] = mesh.triangles[index + 1];
      indices[index + 2] = mesh.triangles[index];
    }

    const attributes = new Cesium.GeometryAttributes({
      position: new Cesium.GeometryAttribute({
        componentDatatype: Cesium.ComponentDatatype.DOUBLE,
        componentsPerAttribute: 3,
        values: packedPositions,
      }),
      color: new Cesium.GeometryAttribute({
        componentDatatype: Cesium.ComponentDatatype.UNSIGNED_BYTE,
        normalize: true,
        componentsPerAttribute: 4,
        values: colors,
      }),
    });

    let geometry = new Cesium.Geometry({
      attributes,
      indices,
      primitiveType: Cesium.PrimitiveType.TRIANGLES,
      boundingSphere: Cesium.BoundingSphere.fromVertices(packedPositions),
    });

    geometry = Cesium.GeometryPipeline.computeNormal(geometry);

    const meshInstance = new Cesium.GeometryInstance({
      geometry,
      id: options.id || "debris-triangle-mesh",
      colorsPerVertex: true,
    });

    return new Cesium.Primitive({
      geometryInstances: meshInstance,
      appearance: new Cesium.PerInstanceColorAppearance({
        flat: false,
        faceForward: true,
        translucent: alpha < 1,
        renderState: {
          depthTest: {
            enabled: true,
            func: Cesium.DepthFunction.LESS_OR_EQUAL,
          },
          depthMask: alpha >= 1,
        },
      }),
      asynchronous: false,
      show: true,
    });
  }

  window.DrawTriangleMesh = createTriangleMeshPrimitive;
  window.DrawTriangleMesh.createPrimitive = createTriangleMeshPrimitive;
})();
