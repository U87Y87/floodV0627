<script setup>
import { nextTick, ref } from 'vue'

const emit = defineEmits(['navigate', 'tif-file'])

const question = ref('')
const isThinking = ref(false)
const messagesEl = ref(null)
const dataFileInput = ref(null)
let messageId = 2

const quickQuestions = [
  '如何处理 TIFF 地形数据？',
  '我想进行洪水模拟',
  '怎样查看永川案例？',
]

const agents = [
  { name: '调度智能体', role: '任务理解', icon: '调', status: 'online' },
  { name: '数据智能体', role: '数据预处理', icon: '数', status: 'ready' },
  { name: '模拟智能体', role: '洪水计算', icon: '模', status: 'ready' },
  { name: '场景智能体', role: '地图交互', icon: '景', status: 'ready' },
]

const messages = ref([
  {
    id: 1,
    role: 'assistant',
    agent: '调度智能体',
    content: '你好，我是灾害链智能助手。请描述你想完成的任务，我会协调专业智能体并推荐合适的系统工具。',
    tools: [],
  },
])

const toolRules = [
  {
    keywords: ['tif', 'tiff', 'asc', '格式', '转换', '粗糙度', '行列', '预处理', '数据'],
    agent: '数据智能体',
    reply: '建议先使用“数据处理”。它提供 TIFF/ASC 格式转换、粗糙度计算、ASC 行列号获取和地形绘制，适合作为模拟前的数据准备步骤。',
    tools: [
      { id: 'data', name: '数据处理', detail: '格式转换 · 粗糙度 · 行列号' },
    ],
  },
  {
    keywords: ['洪水', '模拟', '水深', '淹没', '计算', '边界'],
    agent: '模拟智能体',
    reply: '这项任务适合使用“洪水模拟”。请先准备地形、入流和边界条件；若原始文件尚未处理，可先进入“数据处理”完成格式与粗糙度准备。',
    tools: [
      { id: 'caculate', name: '洪水模拟', detail: '模型参数 · 边界条件 · 求解' },
      { id: 'data', name: '数据处理', detail: '模拟前数据准备' },
    ],
  },
  {
    keywords: ['网格', '格网', 'mesh', '网格化'],
    agent: '数据智能体',
    reply: '建议使用“格网转换”，将输入数据转换为系统可渲染或可计算的网格格式。转换完成后可进入“可视化”检查结果。',
    tools: [
      { id: 'mesh', name: '格网转换', detail: '网格生成 · 格式整理' },
      { id: 'render', name: '可视化', detail: '检查转换结果' },
    ],
  },
  {
    keywords: ['可视化', '渲染', '地图', '地形', '三维', '切片', '场景'],
    agent: '场景智能体',
    reply: '建议使用“可视化”在三维地图中检查结果。地形可通过顶部“开启地形”切换，外部地图数据可通过“加载切片”导入。',
    tools: [
      { id: 'render', name: '可视化', detail: '三维渲染 · 动态展示' },
      { id: 'top-tools', name: '顶部地图工具', detail: '开启地形 · 加载切片' },
    ],
  },
  {
    keywords: ['案例', '永川', '示例', '演示', '监测'],
    agent: '场景智能体',
    reply: '建议打开“案例展示”，加载永川案例并查看逐帧洪水动画、最大水深与淹没面积的动态变化。',
    tools: [
      { id: 'sample', name: '案例展示', detail: '永川案例 · 动态监测' },
    ],
  },
]

function scrollToLatest() {
  nextTick(() => {
    if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight
  })
}

function buildAnswer(text) {
  const normalized = text.toLowerCase()
  const matched = toolRules
    .map((rule) => ({
      ...rule,
      score: rule.keywords.reduce((score, keyword) => score + (normalized.includes(keyword) ? 1 : 0), 0),
    }))
    .sort((a, b) => b.score - a.score)[0]

  if (matched?.score > 0) return matched

  return {
    agent: '调度智能体',
    reply: '我可以根据任务为你推荐“数据处理、洪水模拟、格网转换、可视化、案例展示”等工具。请补充输入数据类型、期望结果或当前步骤，我会给出更准确的操作路径。',
    tools: [
      { id: 'data', name: '数据处理', detail: '准备基础数据' },
      { id: 'caculate', name: '洪水模拟', detail: '执行模型计算' },
    ],
  }
}

async function sendQuestion(preset) {
  const text = (preset ?? question.value).trim()
  if (!text || isThinking.value) return

  messages.value.push({
    id: messageId++,
    role: 'user',
    content: text,
    tools: [],
  })
  question.value = ''
  isThinking.value = true
  scrollToLatest()

  await new Promise((resolve) => window.setTimeout(resolve, 420))
  const answer = buildAnswer(text)
  messages.value.push({
    id: messageId++,
    role: 'assistant',
    agent: answer.agent,
    content: answer.reply,
    tools: answer.tools,
  })
  isThinking.value = false
  scrollToLatest()
}

function openTool(tool) {
  if (tool.id === 'top-tools') return
  emit('navigate', tool.id)
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function addValidationMessage(content, valid = false) {
  messages.value.push({
    id: messageId++,
    role: 'assistant',
    agent: '数据智能体',
    content,
    tools: valid ? [{ id: 'data', name: '格式转换', detail: '文件已载入，等待用户点击转换' }] : [],
  })
  scrollToLatest()
}

async function hasTiffSignature(file) {
  const bytes = new Uint8Array(await file.slice(0, 4).arrayBuffer())
  const littleEndian = bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00
  const bigEndian = bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a
  return littleEndian || bigEndian
}

async function handleDataFile(event) {
  const file = event.target.files?.[0]
  if (!file) return

  const isTif = /\.tiff?$/i.test(file.name)
  const isEmpty = file.size === 0
  messages.value.push({
    id: messageId++,
    role: 'user',
    content: `检验数据文件：${file.name}（${formatFileSize(file.size)}）`,
    tools: [],
  })

  if (!isTif) {
    addValidationMessage('数据检验未通过：当前自动传递仅支持 TIF/TIFF 文件。请重新选择地形栅格数据。')
    event.target.value = ''
    return
  }

  if (isEmpty) {
    addValidationMessage('数据检验未通过：该 TIFF 文件内容为空，请检查源文件后重新选择。')
    event.target.value = ''
    return
  }

  try {
    if (!await hasTiffSignature(file)) {
      addValidationMessage('数据检验未通过：文件扩展名为 TIFF，但文件头不是有效的 TIFF 格式，请检查文件是否损坏或被错误重命名。')
      event.target.value = ''
      return
    }
  } catch {
    addValidationMessage('数据检验失败：浏览器无法读取该文件，请检查文件权限后重试。')
    event.target.value = ''
    return
  }

  addValidationMessage(`数据检验通过：扩展名与 TIFF 文件头均有效，已识别地形数据“${file.name}”。正在打开“数据处理 → 格式转换”并载入文件，转换操作仍由你确认执行。`, true)
  window.setTimeout(() => emit('tif-file', file), 260)
}
</script>

<template>
  <aside class="agent-panel" aria-label="多智能体助手">
    <header class="agent-header">
      <div class="agent-brand-icon" aria-hidden="true">
        <span></span>
        <span></span>
        <span></span>
      </div>
      <div>
        <span class="agent-eyebrow">MULTI-AGENT COPILOT</span>
        <h1>智能体助手</h1>
      </div>
      <span class="agent-online"><i></i>在线</span>
    </header>

    <section class="agent-roster" aria-label="智能体工作组">
      <div class="roster-heading">
        <span>协作智能体</span>
        <small>4 个智能体已就绪</small>
      </div>
      <div class="agent-list">
        <div v-for="agent in agents" :key="agent.name" class="agent-member">
          <span class="member-icon">{{ agent.icon }}</span>
          <span class="member-info">
            <strong>{{ agent.name }}</strong>
            <small>{{ agent.role }}</small>
          </span>
          <i :class="agent.status"></i>
        </div>
      </div>
    </section>

    <section class="data-validation">
      <div>
        <span class="validation-icon" aria-hidden="true">检</span>
        <span>
          <strong>数据检验与分发</strong>
          <small>支持 TIF / TIFF 地形数据</small>
        </span>
      </div>
      <button type="button" @click="dataFileInput?.click()">选择数据</button>
      <input
        ref="dataFileInput"
        type="file"
        accept=".tif,.tiff,image/tiff"
        aria-label="选择需要检验的 TIFF 数据"
        @change="handleDataFile"
      >
    </section>

    <section ref="messagesEl" class="chat-messages" aria-live="polite">
      <article
        v-for="message in messages"
        :key="message.id"
        class="chat-message"
        :class="message.role"
      >
        <div v-if="message.role === 'assistant'" class="message-agent">
          <span>AI</span>
          {{ message.agent }}
        </div>
        <p>{{ message.content }}</p>
        <div v-if="message.tools.length" class="recommended-tools">
          <button
            v-for="tool in message.tools"
            :key="tool.id"
            type="button"
            :disabled="tool.id === 'top-tools'"
            @click="openTool(tool)"
          >
            <span class="tool-arrow">→</span>
            <span>
              <strong>{{ tool.name }}</strong>
              <small>{{ tool.detail }}</small>
            </span>
          </button>
        </div>
      </article>

      <div v-if="isThinking" class="thinking" aria-label="智能体正在分析">
        <span></span><span></span><span></span>
        正在分析任务并匹配工具
      </div>
    </section>

    <div v-if="messages.length === 1" class="quick-questions">
      <span>你可以这样问</span>
      <button
        v-for="item in quickQuestions"
        :key="item"
        type="button"
        @click="sendQuestion(item)"
      >
        {{ item }}
      </button>
    </div>

    <form class="chat-composer" @submit.prevent="sendQuestion()">
      <textarea
        v-model="question"
        rows="2"
        maxlength="300"
        aria-label="向智能体提问"
        placeholder="描述任务，智能体将为你推荐工具…"
        @keydown.enter.exact.prevent="sendQuestion()"
      ></textarea>
      <div class="composer-footer">
        <small>Enter 发送 · Shift + Enter 换行</small>
        <button type="submit" :disabled="!question.trim() || isThinking" aria-label="发送问题">
          <span>发送</span>
          <i>↑</i>
        </button>
      </div>
    </form>
  </aside>
</template>

<style scoped>
.agent-panel {
  position: fixed;
  z-index: 22;
  top: calc(var(--topbar-height) + 18px);
  right: 20px;
  display: flex;
  width: min(410px, calc(100vw - var(--sidebar-width) - 40px));
  height: calc(100vh - var(--topbar-height) - 36px);
  max-height: 760px;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgba(85, 215, 238, 0.28);
  border-radius: 16px;
  color: #e9f5ff;
  background: linear-gradient(165deg, rgba(17, 34, 52, 0.98), rgba(7, 19, 32, 0.98));
  box-shadow: 0 24px 65px rgba(0, 0, 0, 0.48), inset 0 1px rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(20px);
}

.agent-header {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 12px;
  padding: 18px 18px 15px;
  border-bottom: 1px solid rgba(148, 181, 211, 0.14);
  background: linear-gradient(100deg, rgba(33, 185, 216, 0.13), transparent 70%);
}

.agent-brand-icon {
  position: relative;
  display: grid;
  width: 42px;
  height: 42px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid rgba(85, 215, 238, 0.42);
  border-radius: 12px;
  background: rgba(33, 185, 216, 0.11);
  box-shadow: inset 0 0 18px rgba(33, 185, 216, 0.08);
}

.agent-brand-icon span {
  position: absolute;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #55d7ee;
  box-shadow: 0 0 8px rgba(85, 215, 238, 0.72);
}

.agent-brand-icon span:nth-child(1) { transform: translate(-9px, 6px); }
.agent-brand-icon span:nth-child(2) { transform: translate(0, -8px); }
.agent-brand-icon span:nth-child(3) { transform: translate(9px, 6px); }

.agent-brand-icon::before,
.agent-brand-icon::after {
  position: absolute;
  width: 13px;
  height: 1px;
  background: rgba(85, 215, 238, 0.7);
  content: "";
}

.agent-brand-icon::before { transform: translate(-5px, 0) rotate(-55deg); }
.agent-brand-icon::after { transform: translate(5px, 0) rotate(55deg); }

.agent-header > div:nth-child(2) {
  min-width: 0;
  flex: 1;
}

.agent-eyebrow {
  display: block;
  color: #55d7ee;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.17em;
}

.agent-header h1 {
  margin: 3px 0 0;
  font-size: 20px;
}

.agent-online {
  display: flex;
  align-items: center;
  gap: 5px;
  color: #7f9aae;
  font-size: 10px;
}

.agent-online i,
.agent-member > i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #38d996;
  box-shadow: 0 0 8px rgba(56, 217, 150, 0.7);
}

.agent-roster {
  flex: 0 0 auto;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(148, 181, 211, 0.1);
}

.data-validation {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: 10px 14px 0;
  padding: 10px;
  border: 1px solid rgba(85, 215, 238, 0.2);
  border-radius: 10px;
  background: linear-gradient(110deg, rgba(33, 185, 216, 0.1), rgba(33, 185, 216, 0.025));
}

.data-validation > div {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.validation-icon {
  display: grid;
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid rgba(85, 215, 238, 0.32);
  border-radius: 8px;
  color: #55d7ee;
  background: rgba(33, 185, 216, 0.1);
  font-size: 10px;
  font-weight: 700;
}

.data-validation > div > span:last-child {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.data-validation strong {
  color: #cce0e9;
  font-size: 10px;
}

.data-validation small {
  color: #638096;
  font-size: 8px;
}

.data-validation button {
  flex: 0 0 auto;
  padding: 7px 9px;
  border: 1px solid rgba(85, 215, 238, 0.35);
  border-radius: 7px;
  color: #dff9fd;
  background: rgba(33, 185, 216, 0.12);
  font-size: 9px;
}

.data-validation button:hover {
  border-color: #55d7ee;
  background: rgba(33, 185, 216, 0.2);
}

.data-validation input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.roster-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 9px;
}

.roster-heading span {
  color: #b9cedc;
  font-size: 11px;
  font-weight: 600;
}

.roster-heading small {
  color: #617f94;
  font-size: 9px;
}

.agent-list {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}

.agent-member {
  position: relative;
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 3px 7px;
  border: 1px solid rgba(148, 181, 211, 0.1);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.025);
  text-align: center;
}

.member-icon {
  display: grid;
  width: 25px;
  height: 25px;
  place-items: center;
  border: 1px solid rgba(85, 215, 238, 0.28);
  border-radius: 7px;
  color: #55d7ee;
  background: rgba(33, 185, 216, 0.08);
  font-size: 10px;
  font-weight: 700;
}

.member-info {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.member-info strong {
  overflow: hidden;
  color: #c8dae5;
  font-size: 9px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.member-info small {
  overflow: hidden;
  color: #637e91;
  font-size: 8px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-member > i {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 4px;
  height: 4px;
}

.chat-messages {
  display: flex;
  min-height: 120px;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  overflow-y: auto;
  scrollbar-color: rgba(85, 215, 238, 0.3) transparent;
  scrollbar-width: thin;
}

.chat-message {
  max-width: 91%;
}

.chat-message.assistant { align-self: flex-start; }
.chat-message.user { align-self: flex-end; }

.message-agent {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 5px 3px;
  color: #6f91a7;
  font-size: 9px;
}

.message-agent span {
  display: grid;
  width: 18px;
  height: 18px;
  place-items: center;
  border: 1px solid rgba(85, 215, 238, 0.28);
  border-radius: 6px;
  color: #55d7ee;
  background: rgba(33, 185, 216, 0.1);
  font-size: 7px;
  font-weight: 800;
}

.chat-message p {
  margin: 0;
  padding: 11px 13px;
  border: 1px solid rgba(148, 181, 211, 0.12);
  border-radius: 4px 12px 12px;
  color: #bfd2df;
  background: rgba(25, 48, 69, 0.72);
  font-size: 12px;
  line-height: 1.65;
}

.chat-message.user p {
  border-color: rgba(85, 215, 238, 0.25);
  border-radius: 12px 4px 12px 12px;
  color: #ecfbff;
  background: linear-gradient(135deg, rgba(25, 134, 166, 0.78), rgba(20, 94, 130, 0.8));
}

.recommended-tools {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 7px;
}

.recommended-tools button {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid rgba(85, 215, 238, 0.18);
  border-radius: 8px;
  color: #d9f6fb;
  background: rgba(33, 185, 216, 0.07);
  text-align: left;
  transition: border-color 0.2s, background 0.2s, transform 0.2s;
}

.recommended-tools button:hover:not(:disabled) {
  border-color: rgba(85, 215, 238, 0.55);
  background: rgba(33, 185, 216, 0.14);
  transform: translateX(2px);
}

.recommended-tools button:disabled {
  cursor: default;
  opacity: 0.72;
}

.tool-arrow { color: #55d7ee; }

.recommended-tools button > span:last-child {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.recommended-tools strong { font-size: 11px; }
.recommended-tools small { color: #7392a6; font-size: 9px; }

.thinking {
  display: flex;
  align-items: center;
  gap: 4px;
  color: #6f91a7;
  font-size: 10px;
}

.thinking span {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #55d7ee;
  animation: agent-thinking 1s infinite ease-in-out;
}

.thinking span:nth-child(2) { animation-delay: 0.12s; }
.thinking span:nth-child(3) { margin-right: 4px; animation-delay: 0.24s; }

@keyframes agent-thinking {
  0%, 60%, 100% { opacity: 0.35; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-3px); }
}

.quick-questions {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 16px 12px;
}

.quick-questions > span {
  width: 100%;
  color: #637f93;
  font-size: 9px;
}

.quick-questions button {
  padding: 6px 9px;
  border: 1px solid rgba(148, 181, 211, 0.14);
  border-radius: 20px;
  color: #8eacbe;
  background: rgba(255, 255, 255, 0.025);
  font-size: 9px;
  transition: color 0.2s, border-color 0.2s;
}

.quick-questions button:hover {
  border-color: rgba(85, 215, 238, 0.42);
  color: #d9f7fb;
}

.chat-composer {
  flex: 0 0 auto;
  margin: 0 14px 14px;
  padding: 10px 11px 8px;
  border: 1px solid rgba(85, 215, 238, 0.22);
  border-radius: 11px;
  background: rgba(4, 14, 25, 0.76);
  transition: border-color 0.2s, box-shadow 0.2s;
}

.chat-composer:focus-within {
  border-color: rgba(85, 215, 238, 0.58);
  box-shadow: 0 0 0 3px rgba(33, 185, 216, 0.08);
}

.chat-composer textarea {
  display: block;
  width: 100%;
  min-height: 42px;
  resize: none;
  border: 0;
  outline: 0;
  color: #e8f5fc;
  background: transparent;
  font: inherit;
  font-size: 12px;
  line-height: 1.5;
}

.chat-composer textarea::placeholder { color: #567187; }

.composer-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.composer-footer small {
  color: #4e6a7e;
  font-size: 8px;
}

.composer-footer button {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 7px 6px 10px;
  border: 1px solid rgba(85, 215, 238, 0.4);
  border-radius: 7px;
  color: #06131d;
  background: linear-gradient(135deg, #55d7ee, #20a6cf);
  font-size: 10px;
  font-weight: 700;
}

.composer-footer button:disabled {
  cursor: not-allowed;
  filter: saturate(0.25);
  opacity: 0.45;
}

.composer-footer button i {
  display: grid;
  width: 17px;
  height: 17px;
  place-items: center;
  border-radius: 5px;
  background: rgba(5, 28, 40, 0.14);
  font-style: normal;
}

@media (max-height: 760px) {
  .agent-panel { top: calc(var(--topbar-height) + 10px); height: calc(100vh - var(--topbar-height) - 20px); }
  .agent-roster { display: none; }
}

@media (max-width: 720px) {
  .agent-panel {
    right: 10px;
    width: calc(100vw - var(--sidebar-width) - 20px);
  }
}
</style>
