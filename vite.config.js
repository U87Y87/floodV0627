import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cesium from 'vite-plugin-cesium'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

function sendJson(response, statusCode, body) {
  // A spawned process can emit both error and close. Only the first result may
  // write to the HTTP response; a second write would otherwise stop Vite.
  if (response.writableEnded || response.destroyed) return
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(body))
}

function meshConversionApi() {
  return {
    name: 'mesh-conversion-api',
    configureServer(server) {
      server.middlewares.use('/api/mesh-index', (request, response, next) => {
        if (request.method !== 'POST') return next()
        let body = ''
        request.setEncoding('utf8')
        request.on('data', (chunk) => { body += chunk })
        request.on('end', () => {
          try {
            const { folder } = JSON.parse(body)
            const indexPath = path.resolve(String(folder), 'index.json')
            const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
            if (!Array.isArray(index.frames) || !index.frames.length) throw new Error('index.json 中没有 frames 索引。')
            const frames = index.frames.map(({ name, index, pointCount, triangleCount, stats }) => ({ name: path.basename(name), index, pointCount, triangleCount, stats }))
            sendJson(response, 200, { folder: path.dirname(indexPath), frames })
          } catch (error) { sendJson(response, 400, { error: `无法读取 index.json：${error.message}` }) }
        })
      })

      server.middlewares.use('/api/mesh-frame', (request, response, next) => {
        if (request.method !== 'GET') return next()
        try {
          const query = new URL(request.url, 'http://localhost').searchParams
          const folder = path.resolve(query.get('folder') ?? '')
          const name = path.basename(query.get('name') ?? '')
          if (!name.endsWith('.mesh.json')) throw new Error('无效的 Mesh 文件名。')
          const filePath = path.resolve(folder, name)
          if (!filePath.startsWith(`${folder}${path.sep}`)) throw new Error('无效的 Mesh 路径。')
          response.statusCode = 200
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.end(fs.readFileSync(filePath))
        } catch (error) { sendJson(response, 404, { error: error.message }) }
      })

      server.middlewares.use('/api/select-folder', (request, response, next) => {
        if (request.method !== 'POST') return next()
        const command = [
          'Add-Type -AssemblyName System.Windows.Forms',
          '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
          "$dialog.Description = '选择文件夹'",
          '$dialog.ShowNewFolderButton = $true',
          'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Write-Output $dialog.SelectedPath }',
        ].join('; ')
        const picker = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', command], { windowsHide: false })
        let selectedPath = ''
        let errors = ''
        picker.stdout.on('data', (chunk) => { selectedPath += chunk.toString() })
        picker.stderr.on('data', (chunk) => { errors += chunk.toString() })
        picker.once('error', (error) => sendJson(response, 500, { error: error.message }))
        picker.on('close', (code) => {
          if (code !== 0) sendJson(response, 500, { error: errors || '无法打开文件夹选择窗口。' })
          else sendJson(response, 200, { path: selectedPath.trim() })
        })
      })

      server.middlewares.use('/api/select-file', (request, response, next) => {
        if (request.method !== 'POST') return next()
        let body = ''
        request.setEncoding('utf8')
        request.on('data', (chunk) => { body += chunk })
        request.on('end', () => {
          const kind = JSON.parse(body || '{}').kind
          const filter = kind === 'breach' ? 'DAT files (*.dat)|*.dat' : 'ASC files (*.asc)|*.asc'
          const command = [
            'Add-Type -AssemblyName System.Windows.Forms',
            '$dialog = New-Object System.Windows.Forms.OpenFileDialog',
            `$dialog.Filter = '${filter}'`,
            '$dialog.Multiselect = $false',
            'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Write-Output $dialog.FileName }',
          ].join('; ')
          const picker = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', command], { windowsHide: false })
          let selectedPath = ''; let errors = ''
          picker.stdout.on('data', (chunk) => { selectedPath += chunk.toString() })
          picker.stderr.on('data', (chunk) => { errors += chunk.toString() })
          picker.once('error', (error) => sendJson(response, 500, { error: error.message }))
          picker.on('close', (code) => sendJson(response, code === 0 ? 200 : 500, code === 0 ? { path: selectedPath.trim() } : { error: errors || '无法打开文件选择窗口。' }))
        })
      })

      server.middlewares.use('/api/flood-simulate', (request, response, next) => {
        if (request.method !== 'POST') return next()
        let body = ''
        request.setEncoding('utf8')
        request.on('data', (chunk) => { body += chunk })
        request.on('end', async () => {
          try {
            const { demPath, roughnessPath, breachPath, utmZone } = JSON.parse(body)
            for (const filePath of [demPath, roughnessPath, breachPath]) if (!filePath || !fs.existsSync(filePath)) throw new Error(`文件不存在：${filePath || '未选择'}`)
            if (path.extname(demPath).toLowerCase() !== '.asc') throw new Error('DEM 文件必须是 .asc。')
            if (path.extname(roughnessPath).toLowerCase() !== '.asc') throw new Error('糙率文件必须是 .asc。')
            if (path.extname(breachPath).toLowerCase() !== '.dat') throw new Error('溃口文件必须是 .dat。')
            const normalizedUtmZone = String(utmZone ?? '').trim()
            if (!/^(?:[1-9]|[1-5]\d|60)$/.test(normalizedUtmZone)) throw new Error('投影带带号必须是 1–60 之间的整数。')
            const form = new FormData()
            form.append('dem', new Blob([fs.readFileSync(demPath)]), 'dem.asc')
            form.append('cao', new Blob([fs.readFileSync(roughnessPath)]), 'cao.asc')
            form.append('river', new Blob([fs.readFileSync(breachPath)]), 'InputRiver.dat')
            form.append('utmZone', normalizedUtmZone)
            // The C++ httplib handler reads utmZone through req.params, which is
            // populated from the URL query string rather than multipart fields.
            const simulation = await fetch(`http://127.0.0.1:18080/upload-all?utmZone=${encodeURIComponent(normalizedUtmZone)}`, { method: 'POST', body: form })
const result = await simulation.json()
if (!simulation.ok) throw new Error(result.error || `模拟服务返回 ${simulation.status}`)
sendJson(response, 200, result)
          } catch (error) { sendJson(response, 500, { error: error.message }) }
        })
      })

      server.middlewares.use('/api/build-mesh', (request, response, next) => {
        if (request.method !== 'POST') return next()
        let body = ''
        request.setEncoding('utf8')
        request.on('data', (chunk) => { body += chunk })
        request.on('error', () => sendJson(response, 400, { error: '无法读取请求内容。' }))
        request.on('end', () => {
          let payload
          try {
            payload = JSON.parse(body)
          } catch {
            sendJson(response, 400, { error: '请求路径格式无效。' })
            return
          }

          const sourceDir = path.resolve(String(payload.sourceDir ?? ''))
          const outputDir = path.resolve(String(payload.outputDir ?? ''))
          if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
            sendJson(response, 400, { error: `JSON 源文件夹不存在：${sourceDir}` })
            return
          }

          fs.mkdirSync(outputDir, { recursive: true })
          const script = path.resolve(process.cwd(), 'src/build-mesh-cache.cjs')
          const task = spawn(process.execPath, [script, sourceDir, outputDir], {
            cwd: process.cwd(),
            env: { ...process.env, MESH_WORKERS: '4' },
            windowsHide: true,
          })
          let output = ''
          task.stdout.on('data', (chunk) => { output += chunk.toString() })
          task.stderr.on('data', (chunk) => { output += chunk.toString() })
          task.once('error', (error) => sendJson(response, 500, { error: error.message }))
          task.on('close', (code) => {
            if (code === 0) sendJson(response, 200, { message: 'Mesh 转换完成。', output })
            else sendJson(response, 500, { error: output || `转换进程退出，代码：${code}` })
          })
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  server: {
  // Allow requests forwarded by ngrok while keeping Vite's host check enabled.
  allowedHosts: ['.ngrok-free.dev'],
  proxy: {
    '/api/upload-flood-files': {
      target: 'http://127.0.0.1:18080',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api\/upload-flood-files/, '/upload-all'),
    },
    '/api/download-txt-zip': {
      target: 'http://127.0.0.1:18080',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api/, ''),
    },
    '/api/download-json-zip': {
      target: 'http://127.0.0.1:18080',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api/, ''),
    },
    '/api/restart-server': {
      target: 'http://127.0.0.1:18080',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api/, ''),
    },
  },
},// Provides Cesium's JSON data, workers, wasm, and image assets instead of
  // allowing Vite's SPA fallback to return index.html for those resources.
  plugins: [vue(), cesium(), meshConversionApi()],
})
