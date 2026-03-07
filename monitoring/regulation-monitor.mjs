import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import cron from 'node-cron'

const rootDir = process.cwd()
const sourcesPath = path.join(rootDir, 'monitoring', 'sources.json')
const statePath = path.join(rootDir, '.strata', 'regulation-monitor-state.json')
const reportsDir = path.join(rootDir, 'reports')

const args = process.argv.slice(2)
const once = args.includes('--once')
const scheduleArgIndex = args.indexOf('--schedule')
const schedule =
  (scheduleArgIndex >= 0 ? args[scheduleArgIndex + 1] : undefined) ||
  process.env.REG_MONITOR_CRON ||
  '0 */6 * * *'

const backendUrl = process.env.STRATA_BACKEND_URL || ''

const nowIso = () => new Date().toISOString()

const stableHash = (value) => createHash('sha256').update(value).digest('hex')

const readJson = async (filePath, fallback) => {
  try {
    const raw = await readFile(filePath, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

const writeJson = async (filePath, payload) => {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8')
}

const sanitize = (text) => text.replace(/\s+/g, ' ').trim()

const extractTitle = (html) => {
  const match = html.match(/<title[^>]*>(.*?)<\/title>/i)
  return match ? sanitize(match[1]) : 'Untitled page'
}

const scoreMateriality = (snapshot) => {
  if (!snapshot.ok) {
    return { severity: 'HIGH', reason: 'Source fetch failed' }
  }

  if (snapshot.changeType === 'unchanged') {
    return { severity: 'NONE', reason: 'No meaningful content change detected' }
  }

  if (snapshot.changeType === 'new') {
    return { severity: 'MEDIUM', reason: 'New source baseline captured' }
  }

  const keywordHits = (snapshot.materialKeywords || []).filter((keyword) =>
    snapshot.normalizedBody.includes(keyword.toLowerCase()),
  )

  if (snapshot.criticality === 'high' || keywordHits.length > 0) {
    return {
      severity: 'HIGH',
      reason:
        keywordHits.length > 0
          ? `Material keywords detected: ${keywordHits.join(', ')}`
          : 'High-criticality source changed',
    }
  }

  if (snapshot.criticality === 'medium') {
    return { severity: 'MEDIUM', reason: 'Medium-criticality source changed' }
  }

  return { severity: 'LOW', reason: 'Low-criticality source changed' }
}

const fetchSource = async (source) => {
  const startedAt = nowIso()
  try {
    const response = await fetch(source.url, {
      headers: {
        'User-Agent': 'strata-regulation-monitor/0.2',
      },
      signal: AbortSignal.timeout(30000),
    })

    const body = await response.text()
    const normalizedBody = sanitize(body)

    return {
      ...source,
      startedAt,
      checkedAt: nowIso(),
      ok: response.ok,
      status: response.status,
      title: extractTitle(body),
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
      hash: stableHash(normalizedBody),
      bodyLength: body.length,
      normalizedBody: normalizedBody.toLowerCase(),
      error: null,
    }
  } catch (error) {
    return {
      ...source,
      startedAt,
      checkedAt: nowIso(),
      ok: false,
      status: null,
      title: null,
      etag: null,
      lastModified: null,
      hash: null,
      bodyLength: 0,
      normalizedBody: '',
      error: error instanceof Error ? error.message : 'Unknown fetch error',
    }
  }
}

const determineChanges = (current, previousState) => {
  const previousById = previousState.sources ?? {}

  return current.map((snapshot) => {
    const previous = previousById[snapshot.id]

    if (!previous) {
      return { ...snapshot, changeType: 'new' }
    }

    if (!snapshot.ok) {
      return { ...snapshot, changeType: 'error' }
    }

    if (snapshot.hash !== previous.hash) {
      return { ...snapshot, changeType: 'changed' }
    }

    return { ...snapshot, changeType: 'unchanged' }
  })
}

const toMarkdownReport = (runAt, evaluated, materialChanges) => {
  const trackedCountries = [...new Set(evaluated.map((item) => item.country))].sort()
  const lines = [
    '# Regulation Monitoring Report',
    '',
    `- Run at: ${runAt}`,
    `- Sources checked: ${evaluated.length}`,
    `- Markets tracked: ${trackedCountries.length}`,
    `- Material changes: ${materialChanges.length}`,
    '',
    '## Tracked markets',
    ...trackedCountries.map((country) => `- ${country}`),
    '',
    '## Material change summary',
  ]

  if (materialChanges.length === 0) {
    lines.push('- No material regulatory changes detected this run.')
  } else {
    for (const item of materialChanges) {
      lines.push(
        `- [${item.country}] ${item.institution}: ${item.changeType.toUpperCase()} · severity=${item.severity} (${item.status ?? 'error'})`,
      )
      lines.push(`  - Materiality reason: ${item.materialityReason}`)
      lines.push(`  - URL: ${item.url}`)
      lines.push(`  - Title: ${item.title ?? 'Unavailable'}`)
      lines.push(`  - Checked at: ${item.checkedAt}`)
      if (item.error) {
        lines.push(`  - Error: ${item.error}`)
      }
    }
  }

  lines.push('', '## Full status')

  for (const item of evaluated) {
    lines.push(
      `- ${item.id}: ok=${item.ok} status=${item.status ?? 'error'} change=${item.changeType} severity=${item.severity}`,
    )
  }

  return `${lines.join('\n')}\n`
}

const persistRunToBackend = async (runAt, evaluated, materialChanges) => {
  if (!backendUrl) {
    return
  }

  try {
    const trackedCountries = [...new Set(evaluated.map((item) => item.country))].sort()

    const response = await fetch(`${backendUrl.replace(/\/$/, '')}/api/monitor-runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runAt,
        trackedCountries,
        totalSources: evaluated.length,
        materialChangeCount: materialChanges.length,
        materialChanges,
      }),
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      console.error(`Backend monitor persistence failed (${response.status})`)
    }
  } catch (error) {
    console.error(
      `Backend monitor persistence error: ${error instanceof Error ? error.message : 'unknown error'}`,
    )
  }
}

const runMonitor = async () => {
  const runAt = nowIso()
  const sources = await readJson(sourcesPath, [])

  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error('No monitoring sources found in monitoring/sources.json')
  }

  const previousState = await readJson(statePath, { lastRunAt: null, sources: {} })
  const snapshots = await Promise.all(sources.map((source) => fetchSource(source)))
  const evaluatedRaw = determineChanges(snapshots, previousState)
  const evaluated = evaluatedRaw.map((item) => {
    const { severity, reason } = scoreMateriality(item)
    return {
      ...item,
      severity,
      materialityReason: reason,
    }
  })

  const materialChanges = evaluated.filter((item) => item.severity === 'HIGH' || item.severity === 'MEDIUM')

  const nextState = {
    lastRunAt: runAt,
    sources: Object.fromEntries(
      evaluated.map((item) => [
        item.id,
        {
          checkedAt: item.checkedAt,
          ok: item.ok,
          status: item.status,
          hash: item.hash,
          title: item.title,
          url: item.url,
          country: item.country,
          institution: item.institution,
          criticality: item.criticality,
        },
      ]),
    ),
  }

  await writeJson(statePath, nextState)

  const reportName = `reg-monitor-${runAt.replace(/[:.]/g, '-')}.md`
  const reportPath = path.join(reportsDir, reportName)
  await mkdir(reportsDir, { recursive: true })
  await writeFile(reportPath, toMarkdownReport(runAt, evaluated, materialChanges), 'utf-8')

  await persistRunToBackend(runAt, evaluated, materialChanges)

  console.log(`Regulation monitor run complete at ${runAt}`)
  console.log(`Report written: ${reportPath}`)
  console.log(`Material changes detected: ${materialChanges.length}`)
}

if (once) {
  runMonitor().catch((error) => {
    console.error(`Regulation monitor failed: ${error.message}`)
    process.exitCode = 1
  })
} else {
  if (!cron.validate(schedule)) {
    console.error(`Invalid cron schedule: ${schedule}`)
    process.exit(1)
  }

  console.log(`Starting regulation monitor daemon on schedule: ${schedule}`)
  runMonitor().catch((error) => {
    console.error(`Initial monitor run failed: ${error.message}`)
  })

  cron.schedule(schedule, () => {
    runMonitor().catch((error) => {
      console.error(`Scheduled monitor run failed: ${error.message}`)
    })
  })
}
