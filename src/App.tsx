import { useMemo, useState } from 'react'
import './App.css'
import { countryProfiles, supportedSectors, type FactorKey } from './data/countries'
import { rankCountries, strategyWeights, type ScoredCountry, type Strategy } from './lib/scoring'

const strategies: Strategy[] = ['Buyout', 'Growth', 'Low-Risk Entry']

const factorLabel = (key: FactorKey): string =>
  key.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase())

const badgeClass = (recommendation: ScoredCountry['recommendation']): string => {
  if (recommendation === 'Go') {
    return 'badge badge-go'
  }

  if (recommendation === 'Watchlist') {
    return 'badge badge-watch'
  }

  return 'badge badge-avoid'
}

function App() {
  const [sector, setSector] = useState<string>(supportedSectors[0])
  const [strategy, setStrategy] = useState<Strategy>('Buyout')
  const [expandedCountryCode, setExpandedCountryCode] = useState<string | null>('US')

  const ranked = useMemo(
    () => rankCountries(countryProfiles, sector, strategy),
    [sector, strategy],
  )

  const trackedCountries = ranked.length

  return (
    <main className="app-shell">
      <header className="hero">
        <p className="eyebrow">Strata Intelligence</p>
        <h1>PE Expansion Radar</h1>
        <p>
          Decision support for PE and corporate development teams evaluating country expansion
          exposure across macro, regulatory, tax, and geopolitical dimensions.
        </p>
      </header>

      <section className="controls">
        <label>
          Deal strategy
          <select value={strategy} onChange={(event) => setStrategy(event.target.value as Strategy)}>
            {strategies.map((choice) => (
              <option key={choice} value={choice}>
                {choice}
              </option>
            ))}
          </select>
        </label>

        <label>
          Sector focus
          <select value={sector} onChange={(event) => setSector(event.target.value)}>
            {supportedSectors.map((choice) => (
              <option key={choice} value={choice}>
                {choice}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="grid-header">
        <h3>Country ranking ({trackedCountries} markets)</h3>
        <p>
          Overall score = 35% sector fit + 65% weighted risk-adjusted country factors for{' '}
          <strong>{strategy}</strong>
        </p>
      </section>

      <section className="country-grid">
        {ranked.map((profile) => {
          const expanded = expandedCountryCode === profile.code

          return (
            <article key={profile.code} className="country-card">
              <div className="top-row">
                <div>
                  <p className="country-code">{profile.code}</p>
                  <h4>{profile.name}</h4>
                  <p className="region">{profile.region}</p>
                </div>
                <div className="score-stack">
                  <p className="score">{profile.overallScore}</p>
                  <p className={badgeClass(profile.recommendation)}>{profile.recommendation}</p>
                </div>
              </div>

              <div className="factor-block">
                <p>Sector fit: {profile.sectorScore}</p>
                <p>Weighted country factors: {profile.weightedFactorScore}</p>
              </div>

              <ul>
                {strategyWeights[strategy].map((factor) => {
                  const raw = profile.factors[factor.key]
                  const directional = factor.invert ? 100 - raw : raw

                  return (
                    <li key={factor.key}>
                      {factorLabel(factor.key)}: {raw} (model impact: {directional}, weight{' '}
                      {(factor.weight * 100).toFixed(0)}%)
                    </li>
                  )
                })}
              </ul>

              <p className="summary">{profile.notes}</p>
              <p className="meta">
                Confidence {Math.round(profile.confidence * 100)}% · Updated {profile.lastUpdated}
              </p>

              <button
                className="detail-toggle"
                type="button"
                onClick={() => setExpandedCountryCode(expanded ? null : profile.code)}
              >
                {expanded ? 'Hide details' : 'View details'}
              </button>

              {expanded ? (
                <div className="detail-panel">
                  <p className="detail-title">Scenario scores</p>
                  <p>Base: {profile.scenarios.base}</p>
                  <p>Upside: {profile.scenarios.upside}</p>
                  <p>Downside: {profile.scenarios.downside}</p>
                  <p className="detail-title">Factor citations</p>
                  {Object.entries(profile.factorCitations).map(([factor, citations]) => (
                    <div key={factor} className="citation-group">
                      <p>{factorLabel(factor as FactorKey)}</p>
                      <ul>
                        {citations.map((citation) => (
                          <li key={`${factor}-${citation.url}`}>
                            <a href={citation.url} target="_blank" rel="noreferrer">
                              {citation.label}
                            </a>{' '}
                            (checked {citation.lastChecked})
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : null}
            </article>
          )
        })}
      </section>
    </main>
  )
}

export default App
