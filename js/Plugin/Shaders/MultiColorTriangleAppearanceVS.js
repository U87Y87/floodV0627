(function () {
  "use strict";

  window.MultiColorTriangleAppearanceVS = [
    "attribute vec3 position3DHigh;",
    "attribute vec3 position3DLow;",
    "attribute vec3 normal;",
    "attribute vec4 color;",
    "attribute float batchId;",
    "",
    "varying vec3 v_positionEC;",
    "varying vec3 v_normalEC;",
    "varying vec4 v_color;",
    "",
    "void main()",
    "{",
    "    vec4 p = czm_computePosition();",
    "    v_positionEC = (czm_modelViewRelativeToEye * p).xyz;",
    "    v_normalEC = czm_normal * normal;",
    "    v_color = color;",
    "    gl_Position = czm_modelViewProjectionRelativeToEye * p;",
    "}",
  ].join("\n");
})();
