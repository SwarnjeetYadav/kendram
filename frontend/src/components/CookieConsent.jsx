import { useEffect, useState } from 'react'

const CONSENT_KEY = 'anvaya_cookie_consent_v1'

function enableAnalytics() {
  const measurementId = import.meta.env.VITE_GA_MEASUREMENT_ID
  if (!measurementId || document.querySelector('[data-anvaya-analytics]')) return
  const script = document.createElement('script')
  script.async = true
  script.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(measurementId)
  script.dataset.anvayaAnalytics = 'true'
  document.head.appendChild(script)
  window.dataLayer = window.dataLayer || []
  window.gtag = function gtag() { window.dataLayer.push(arguments) }
  window.gtag('js', new Date())
  window.gtag('config', measurementId, { anonymize_ip: true })
}

export default function CookieConsent() {
  const [visible, setVisible] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [analytics, setAnalytics] = useState(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(CONSENT_KEY)
      if (!saved) setVisible(true)
      else {
        const consent = JSON.parse(saved)
        if (consent.analytics === true) enableAnalytics()
      }
    } catch {
      setVisible(true)
    }
  }, [])

  const save = (allowAnalytics) => {
    const consent = { necessary: true, analytics: allowAnalytics, savedAt: new Date().toISOString() }
    try { localStorage.setItem(CONSENT_KEY, JSON.stringify(consent)) } catch { /* Storage may be disabled. */ }
    if (allowAnalytics) enableAnalytics()
    setVisible(false)
    setShowSettings(false)
  }

  if (!visible) return null

  return (
    <aside className="cookie-consent" aria-label="Cookie preferences" role="region">
      <div className="cookie-consent-copy">
        <strong>Your privacy matters</strong>
        <p>We use essential browser storage to keep the workspace working. Optional analytics are off unless you allow them. Read our <a href="/privacy-policy">Privacy Policy</a>.</p>
        {showSettings ? (
          <label className="cookie-analytics-option">
            <input type="checkbox" checked={analytics} onChange={(event) => setAnalytics(event.target.checked)} />
            Allow anonymous usage analytics
          </label>
        ) : null}
      </div>
      <div className="cookie-consent-actions">
        <button type="button" className="cookie-secondary" onClick={() => save(false)}>Reject optional</button>
        <button type="button" className="cookie-secondary" onClick={() => setShowSettings((value) => !value)}>{showSettings ? 'Hide settings' : 'Preferences'}</button>
        {showSettings
          ? <button type="button" className="cookie-primary" onClick={() => save(analytics)}>Save choices</button>
          : <button type="button" className="cookie-primary" onClick={() => save(true)}>Accept all</button>}
      </div>
    </aside>
  )
}
