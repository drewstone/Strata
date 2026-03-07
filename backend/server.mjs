import express from 'express'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const app = express()
app.use(express.json({ limit: '1mb' }))

const rootDir = process.cwd()
const dbPath = path.join(rootDir, '.strata', 'backend-store.json')
const port = Number(process.env.STRATA_BACKEND_PORT || 8787)

const readStore = async () => {
  try {
    const raw = await readFile(dbPath, 'utf-8')
    const parsed = JSON.parse(raw)
    return {
      scoreSnapshots: Array.isArray(parsed.scoreSnapshots) ? parsed.scoreSnapshots : [],
      monitorRuns: Array.isArray(parsed.monitorRuns) ? parsed.monitorRuns : [],
    }
  } catch {
    return {
      scoreSnapshots: [],
      monitorRuns: [],
    }
  }
}

const writeStore = async (store) => {
  await mkdir(path.dirname(dbPath), { recursive: true })
  await writeFile(dbPath, `${JSON.stringify(store, null, 2)}\n`, 'utf-8')
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'strata-backend', timestamp: new Date().toISOString() })
})

app.get('/api/snapshots', async (req, res) => {
  const store = await readStore()
  const country = req.query.country ? String(req.query.country).toUpperCase() : null
  const snapshots = country
    ? store.scoreSnapshots.filter((item) => item.countryCode === country)
    : store.scoreSnapshots
  res.json({ count: snapshots.length, snapshots })
})

app.post('/api/snapshots', async (req, res) => {
  const payload = req.body
  if (!payload || typeof payload !== 'object') {
    res.status(400).json({ error: 'Payload must be a JSON object.' })
    return
  }

  const store = await readStore()
  const entry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: new Date().toISOString(),
    ...payload,
  }

  store.scoreSnapshots.push(entry)
  await writeStore(store)

  res.status(201).json(entry)
})

app.get('/api/monitor-runs', async (_req, res) => {
  const store = await readStore()
  res.json({ count: store.monitorRuns.length, monitorRuns: store.monitorRuns })
})

app.post('/api/monitor-runs', async (req, res) => {
  const payload = req.body
  if (!payload || typeof payload !== 'object') {
    res.status(400).json({ error: 'Payload must be a JSON object.' })
    return
  }

  const store = await readStore()
  const entry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: new Date().toISOString(),
    ...payload,
  }

  store.monitorRuns.push(entry)
  await writeStore(store)

  res.status(201).json(entry)
})

app.listen(port, () => {
  console.log(`Strata backend listening on http://localhost:${port}`)
})
