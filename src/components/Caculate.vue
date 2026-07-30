<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  initialFiles: {
    type: Object,
    default: () => ({ dem: null, roughness: null, breach: null }),
  },
})

const emit = defineEmits(['files-change'])

const demFile = ref(null)
const roughnessFile = ref(null)
const breachFile = ref(null)
const demInput = ref(null)
const roughnessInput = ref(null)
const breachInput = ref(null)
const utmZone = ref('')
const simulationStatus = ref('等待选择模拟输入文件')
const isSimulating = ref(false)

function currentFiles() {
  return {
    dem: demFile.value,
    roughness: roughnessFile.value,
    breach: breachFile.value,
  }
}

function handleFloodFile(event, kind) {
  const file = event.target.files?.[0] ?? null
  if (kind === 'dem') demFile.value = file
  else if (kind === 'roughness') roughnessFile.value = file
  else breachFile.value = file
  emit('files-change', currentFiles())
  simulationStatus.value = file ? '文件已选择，等待开始模拟。' : '等待选择模拟输入文件'
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
  if (!demFile.value || !roughnessFile.value || !breachFile.value) {
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
    const formData = new FormData()
    formData.append('dem', demFile.value, 'dem.asc')
    formData.append('cao', roughnessFile.value, 'cao.asc')
    formData.append('river', breachFile.value, 'InputRiver.dat')
    const response = await fetch(`/api/upload-flood-files?utmZone=${encodeURIComponent(normalizedUtmZone)}`, {
      method: 'POST',
      body: formData,
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

watch(
  () => props.initialFiles,
  (files) => {
    if (files.dem !== undefined) demFile.value = files.dem
    if (files.roughness !== undefined) roughnessFile.value = files.roughness
    if (files.breach !== undefined) breachFile.value = files.breach
    if (demFile.value && roughnessFile.value && breachFile.value) {
      simulationStatus.value = '三个模拟输入文件已自动填充，等待设置投影带号。'
    }
  },
  { immediate: true },
)
</script>

<template>
  <aside class="panel simulation-panel">
    <h1>洪水计算</h1>
    <label>DEM 文件（ASC）</label>
    <div class="folder-choice">
      <button type="button" @click="demInput?.click()">{{ demFile ? '重新选择' : '选择文件' }}</button>
      <span>{{ demFile?.name || '尚未选择' }}</span>
      <input
        ref="demInput"
        class="simulation-file-input"
        type="file"
        accept=".asc"
        @change="handleFloodFile($event, 'dem')"
      >
    </div>
    <label>糙率文件（ASC）</label>
    <div class="folder-choice">
      <button type="button" @click="roughnessInput?.click()">{{ roughnessFile ? '重新选择' : '选择文件' }}</button>
      <span>{{ roughnessFile?.name || '尚未选择' }}</span>
      <input
        ref="roughnessInput"
        class="simulation-file-input"
        type="file"
        accept=".asc"
        @change="handleFloodFile($event, 'roughness')"
      >
    </div>
    <label>溃口文件（DAT）</label>
    <div class="folder-choice">
      <button type="button" @click="breachInput?.click()">{{ breachFile ? '重新选择' : '选择文件' }}</button>
      <span>{{ breachFile?.name || '尚未选择' }}</span>
      <input
        ref="breachInput"
        class="simulation-file-input"
        type="file"
        accept=".dat"
        @change="handleFloodFile($event, 'breach')"
      >
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
