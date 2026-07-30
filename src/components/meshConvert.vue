<script setup>
import { ref } from 'vue'

const meshSourceDir = ref('')
const meshOutputDir = ref('')
const meshConversionStatus = ref('等待转换')
const isConvertingMesh = ref(false)

async function chooseMeshFolder(target) {
  meshConversionStatus.value = '正在打开文件夹选择窗口...'
  try {
    const response = await fetch('/api/select-folder', { method: 'POST' })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error ?? '无法打开文件夹选择窗口。')
    if (!result.path) {
      meshConversionStatus.value = '已取消文件夹选择。'
      return
    }
    if (target === 'source') meshSourceDir.value = result.path
    else if (target === 'output') meshOutputDir.value = result.path
    meshConversionStatus.value = '文件夹已选择。'
  } catch (error) {
    meshConversionStatus.value = `选择失败：${error.message}`
  }
}

async function convertJsonToMesh() {
  if (!meshSourceDir.value.trim() || !meshOutputDir.value.trim()) {
    meshConversionStatus.value = '请选择 JSON 源文件夹与 Mesh 输出文件夹。'
    return
  }

  isConvertingMesh.value = true
  meshConversionStatus.value = '正在转换，请稍候...'
  try {
    const response = await fetch('/api/build-mesh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceDir: meshSourceDir.value.trim(),
        outputDir: meshOutputDir.value.trim(),
      }),
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error ?? 'Mesh 转换失败。')
    meshConversionStatus.value = result.message
  } catch (error) {
    meshConversionStatus.value = `转换失败：${error.message}`
  } finally {
    isConvertingMesh.value = false
  }
}
</script>

<template>
  <aside class="panel converter-panel">
    <h1>JSON 转 Mesh</h1>
    <p class="hint">批量读取数字命名的 JSON 文件，生成对应的 <code>.mesh.json</code> 和索引文件。</p>
    <label for="mesh-source">JSON 源文件夹</label>
    <div id="mesh-source" class="folder-choice">
      <button @click="chooseMeshFolder('source')">选择文件夹</button>
      <span>{{ meshSourceDir || '尚未选择' }}</span>
    </div>
    <label for="mesh-output">Mesh 输出文件夹</label>
    <div id="mesh-output" class="folder-choice">
      <button @click="chooseMeshFolder('output')">选择文件夹</button>
      <span>{{ meshOutputDir || '尚未选择' }}</span>
    </div>
    <button class="convert-button" :disabled="isConvertingMesh" @click="convertJsonToMesh">
      {{ isConvertingMesh ? '正在转换...' : '开始转换' }}
    </button>
    <p class="status">{{ meshConversionStatus }}</p>
  </aside>
</template>
