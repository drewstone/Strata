import process from 'node:process'
import { countryProfiles, supportedSectors } from '../src/data/countries.ts'
import { rankCountries } from '../src/lib/scoring.ts'

const backendUrl = (process.env.STRATA_BACKEND_URL || 'http://localhost:8787').replace(/\/$/, '')
const sector = process.env.STRATA_SECTOR || supportedSectors[0]
const strategy = process.env.STRATA_STRATEGY || 'Buyout'

const ranked = rankCountries(countryProfiles, sector, strategy)

const postOne = async (country) => {
  const payload = {
    countryCode: country.code,
    countryName: country.name,
    strategy,
    sector,
    overallScore: country.overallScore,
    recommendation: country.recommendation,
    scenarios: country.scenarios,
    confidence: country.confidence,
    updatedAt: country.lastUpdated,
  }

  const response = await fetch(`${backendUrl}/api/snapshots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  })

  if (!response.ok) {
    throw new Error(`Snapshot write failed (${response.status}) for ${country.code}`)
  }
}

const main = async () => {
  for (const country of ranked) {
    await postOne(country)
  }

  console.log(`Persisted ${ranked.length} score snapshots to ${backendUrl}`)
}

main().catch((error) => {
  console.error(`Snapshot persistence failed: ${error.message}`)
  process.exitCode = 1
})
