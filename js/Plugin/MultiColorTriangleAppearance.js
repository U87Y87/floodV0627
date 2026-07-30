(function () {
  "use strict";

  const defineProperties = Cesium.defineProperties || Object.defineProperties;

  function defaultValue(value, fallback) {
    return value === undefined || value === null ? fallback : value;
  }

  function MultiColorTriangleAppearance(options) {
    options = defaultValue(options, {});

    const translucent = defaultValue(options.translucent, true);
    const closed = false;

    this.material = undefined;
    this.translucent = translucent;
    this._vertexShaderSource = defaultValue(
      options.vertexShaderSource,
      window.MultiColorTriangleAppearanceVS,
    );
    this._fragmentShaderSource = defaultValue(
      options.fragmentShaderSource,
      window.MultiColorTriangleAppearanceFS,
    );
    this._renderState = Cesium.Appearance.getDefaultRenderState(
      translucent,
      closed,
      options.renderState,
    );
    this._closed = closed;
    this._vertexFormat = MultiColorTriangleAppearance.VERTEX_FORMAT;
  }

  defineProperties(MultiColorTriangleAppearance.prototype, {
    vertexShaderSource: {
      get() {
        return this._vertexShaderSource;
      },
    },
    fragmentShaderSource: {
      get() {
        return this._fragmentShaderSource;
      },
    },
    renderState: {
      get() {
        return this._renderState;
      },
    },
    closed: {
      get() {
        return this._closed;
      },
    },
    vertexFormat: {
      get() {
        return this._vertexFormat;
      },
    },
  });

  MultiColorTriangleAppearance.VERTEX_FORMAT =
    Cesium.VertexFormat.POSITION_AND_COLOR;
  MultiColorTriangleAppearance.prototype.getFragmentShaderSource = function () {
    return this.fragmentShaderSource;
  };
  MultiColorTriangleAppearance.prototype.isTranslucent = function () {
    return this.translucent;
  };
  MultiColorTriangleAppearance.prototype.getRenderState = function () {
    return this.renderState;
  };

  window.MultiColorTriangleAppearance = MultiColorTriangleAppearance;
  Cesium.MultiColorTriangleAppearance = MultiColorTriangleAppearance;
})();
