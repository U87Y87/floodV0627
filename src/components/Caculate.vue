<script setup>
import { ref } from 'vue'

const demPath = ref('')
const roughnessPath = ref('')
const breachPath = ref('')
const utmZone = ref('')
const simulationStatus = ref('等待选择模拟输入文件')
const isSimulating = ref(false)

async function chooseFloodFile(kind) {
  simulationStatus.value = '正在打开文件选择窗口...'
  try {
    const response = await fetch('/api/select-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind }),
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error ?? '无法打开文件选择窗口。')
    if (!result.path) {
      simulationStatus.value = '已取消文件选择。'
      return
    }

    const expectedExtension = kind === 'breach' ? '.dat' : '.asc'
    if (!result.path.toLowerCase().endsWith(expectedExtension)) {
      const fileLabel = kind === 'breach' ? '溃口' : kind === 'dem' ? 'DEM' : '糙率'
      throw new Error(`${fileLabel}文件必须是 ${expectedExtension}。`)
    }

    if (kind === 'dem') demPath.value = result.path
    else if (kind === 'roughness') roughnessPath.value = result.path
    else breachPath.value = result.path
    simulationStatus.value = '文件已选择，等待开始模拟。'
  } catch (error) {
    simulationStatus.value = `选择失败：${error.message}`
  }
}

async function downloadZip(url, fallbackName) {
  const response = await fetch(`/api${url}`)
  if (!response.ok) throw new Error(`下载 ${fallbackName} 失败：${await response.text()}`)

  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = fallbackName
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(objectUrl), 2000)
}

async function runFloodSimulation() {
  if (!demPath.value || !roughnessPath.value || !breachPath.value) {
    simulationStatus.value = '请先选择 DEM、糙率与溃口文件。'
    return
  }

  const normalizedUtmZone = String(utmZone.value).trim()
  if (!/^(?:[1-9]|[1-5]\d|60)$/.test(normalizedUtmZone)) {
    simulationStatus.value = '请输入 1-60 之间的整数投影带带号。'
    return
  }

  isSimulating.value = true
  simulationStatus.value = '洪水模拟计算中，请稍候...'
  try {
    const response = await fetch('/api/flood-simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        demPath: demPath.value,
        roughnessPath: roughnessPath.value,
        breachPath: breachPath.value,
        utmZone: normalizedUtmZone,
      }),
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error ?? '模拟失败。')

    simulationStatus.value = '模拟完成，正在下载 TXT 压缩包...'
    await downloadZip(result.txtZipUrl, 'flood_txt.zip')
    simulationStatus.value = 'TXT 下载完成，正在下载 JSON 压缩包...'
    await downloadZip(result.jsonZipUrl, 'flood_json.zip')
    simulationStatus.value = '两个压缩包已下载，正在重启后端服务...'

    if (result.restartUrl) {
      const restartResponse = await fetch(`/api${result.restartUrl}`, { method: 'POST' })
      const restartResult = await restartResponse.json().catch(() => ({}))
      if (!restartResponse.ok) throw new Error(restartResult.error || '后端重启请求失败。')
    }
    simulationStatus.value = '下载完成，后端正在重新启动。'
  } catch (error) {
    simulationStatus.value = `模拟失败：${error.message}`
  } finally {
    isSimulating.value = false
  }
}
</script>

<template>
  <aside class="panel simulation-panel">
    <h1>洪水计算</h1>
    <label>DEM 文件（ASC）</label>
    <div class="folder-choice">
      <button @click="chooseFloodFile('dem')">选择文件</button>
      <span>{{ demPath || '尚未选择' }}</span>
    </div>
    <label>糙率文件（ASC）</label>
    <div class="folder-choice">
      <button @click="chooseFloodFile('roughness')">选择文件</button>
      <span>{{ roughnessPath || '尚未选择' }}</span>
    </div>
    <label>溃口文件（DAT）</label>
    <div class="folder-choice">
      <button @click="chooseFloodFile('breach')">选择文件</button>
      <span>{{ breachPath || '尚未选择' }}</span>
    </div>
    <label for="utm-zone">投影带带号（1-60）</label>
    <input
      id="utm-zone"
      v-model="utmZone"
      class="utm-zone-input"
      type="number"
      min="1"
      max="60"
      step="1"
      placeholder="例如：48"
    >
    <button class="convert-button" :disabled="isSimulating" @click="runFloodSimulation">
      {{ isSimulating ? '正在模拟...' : '开始模拟计算' }}
    </button>
    <p class="status">{{ simulationStatus }}</p>
  </aside>
</template>
