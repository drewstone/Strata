import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import PDFDocument from 'pdfkit'
import { countryProfiles, supportedSectors } from '../src/data/countries.ts'
import { rankCountries } from '../src/lib/scoring.ts'

const args = process.argv.slice(2)
const argValue = (flag, fallback) => {
  const idx = args.indexOf(flag)
  return idx >= 0 ? args[idx + 1] : fallback
}

const sector = argValue('--sector', supportedSectors[0])
const strategy = argValue('--strategy', 'Buyout')
const countryCode = argValue('--country', 'US').toUpperCase()

const ranked = rankCountries(countryProfiles, sector, strategy)
const country = ranked.find((item) => item.code === countryCode)

if (!country) {
  console.error(`Country ${countryCode} not found.`)
  process.exit(1)
}

const now = new Date().toISOString()
const reportSlug = `memo-${country.code}-${now.replace(/[:.]/g, '-')}`
const reportsDir = path.join(process.cwd(), 'reports')
const markdownPath = path.join(reportsDir, `${reportSlug}.md`)
const pdfPath = path.join(reportsDir, `${reportSlug}.pdf`)

const memo = `# Expansion Memo: ${country.name}\n\n- Generated at: ${now}\n- Strategy: ${strategy}\n- Sector: ${sector}\n- Overall Score: ${country.overallScore}\n- Recommendation: ${country.recommendation}\n\n## Scenario View\n- Base: ${country.scenarios.base}\n- Upside: ${country.scenarios.upside}\n- Downside: ${country.scenarios.downside}\n\n## Factor Summary\n- Economic strength: ${country.factors.economicStrength}\n- Regulatory complexity: ${country.factors.regulatoryComplexity}\n- Tax/tariff friction: ${country.factors.taxTariffFriction}\n- Geopolitical risk: ${country.factors.geopoliticalRisk}\n- Deal execution risk: ${country.factors.dealExecutionRisk}\n\n## Analyst Notes\n${country.notes}\n\n## Source Citations\n${country.sources.map((source) => `- [${source.label}](${source.url}) (checked ${source.lastChecked})`).join('\n')}\n`

await mkdir(reportsDir, { recursive: true })
await writeFile(markdownPath, memo, 'utf-8')

const doc = new PDFDocument({ margin: 40 })
const chunks = []
doc.on('data', (chunk) => chunks.push(chunk))
const done = new Promise((resolve) => doc.on('end', resolve))

doc.fontSize(18).text(`Expansion Memo: ${country.name}`)
doc.moveDown()
doc.fontSize(11).text(`Generated at: ${now}`)
doc.text(`Strategy: ${strategy}`)
doc.text(`Sector: ${sector}`)
doc.text(`Overall Score: ${country.overallScore}`)
doc.text(`Recommendation: ${country.recommendation}`)
doc.moveDown()
doc.text(`Scenario (Base/Upside/Downside): ${country.scenarios.base}/${country.scenarios.upside}/${country.scenarios.downside}`)
doc.moveDown()
doc.text('Factor Summary')
doc.text(`Economic strength: ${country.factors.economicStrength}`)
doc.text(`Regulatory complexity: ${country.factors.regulatoryComplexity}`)
doc.text(`Tax/tariff friction: ${country.factors.taxTariffFriction}`)
doc.text(`Geopolitical risk: ${country.factors.geopoliticalRisk}`)
doc.text(`Deal execution risk: ${country.factors.dealExecutionRisk}`)
doc.moveDown()
doc.text('Analyst Notes')
doc.text(country.notes)
doc.moveDown()
doc.text('Sources')
for (const source of country.sources) {
  doc.text(`- ${source.label} (${source.url})`)
}
doc.end()

await done
await writeFile(pdfPath, Buffer.concat(chunks))

console.log(`Memo markdown: ${markdownPath}`)
console.log(`Memo PDF: ${pdfPath}`)
