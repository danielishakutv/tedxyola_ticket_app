import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const savedToken = localStorage.getItem('tedx-token') || ''
const savedRole = localStorage.getItem('tedx-role') || 'user'
const ROSTER_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'entry-pending', label: 'Not checked in' },
  { key: 'entry-done', label: 'Checked in' },
  { key: 'multi', label: 'Multi-ticket' },
  { key: 'partial', label: 'Partially in' },
  { key: 'merch-pending', label: 'Merch pending' },
]
const TICKET_OPTIONS = [
  { value: 'Spark', label: 'Spark (General Experience)', price: 5500 },
  { value: 'Ember', label: 'Ember (Premium Experience)', price: 12000 },
  { value: 'Blaze', label: 'Blaze (Exclusive Access)', price: 20000 },
]
const TICKET_PRICES = Object.fromEntries(TICKET_OPTIONS.map((t) => [t.value, t.price]))
const EMPTY_REGISTRATION = { name: '', email: '', phone: '', ticket_type: 'Spark', price: String(TICKET_PRICES.Spark) }
const formatNaira = (amount) => `₦${Number(amount).toLocaleString('en-NG')}`
const ACTION_MESSAGES = {
  'check-in': '✓ Entry check-in saved',
  'check-in-merch': '✓ Merch check-in saved',
  'undo-check-in': '↺ Entry check-in reversed',
  'undo-check-in-merch': '↺ Merch check-in reversed',
}
const savedTheme =
  document.documentElement.getAttribute('data-theme') ||
  localStorage.getItem('tedx-theme') ||
  'dark'

/* ─── Icons (inline SVG helpers) ─────────────────────────────────────────── */

function IconSearch() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

function IconHome() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  )
}

function IconLogout() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  )
}

function IconClose() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function IconUsers() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

function IconCheck() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function IconGift() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 12 20 22 4 22 4 12" />
      <rect x="2" y="7" width="20" height="5" />
      <line x1="12" y1="22" x2="12" y2="7" />
      <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
      <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
    </svg>
  )
}

function IconSun() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4.2" />
      <line x1="12" y1="2" x2="12" y2="4.5" />
      <line x1="12" y1="19.5" x2="12" y2="22" />
      <line x1="2" y1="12" x2="4.5" y2="12" />
      <line x1="19.5" y1="12" x2="22" y2="12" />
      <line x1="4.9" y1="4.9" x2="6.7" y2="6.7" />
      <line x1="17.3" y1="17.3" x2="19.1" y2="19.1" />
      <line x1="4.9" y1="19.1" x2="6.7" y2="17.3" />
      <line x1="17.3" y1="6.7" x2="19.1" y2="4.9" />
    </svg>
  )
}

function IconMoon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  )
}

function IconUndo() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 14 4 9 9 4" />
      <path d="M4 9h11a5 5 0 0 1 0 10h-1" />
    </svg>
  )
}

function IconPlus() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function IconDownload() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

function IconUpload() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  )
}

/* ─── Main App ────────────────────────────────────────────────────────────── */

function App() {
  const [token, setToken] = useState(savedToken)
  const [role, setRole] = useState(savedRole)
  const [theme, setTheme] = useState(savedTheme)
  const [login, setLogin] = useState({ username: 'user', password: '' })
  const [loginError, setLoginError] = useState('')
  const [query, setQuery] = useState('')
  const [guests, setGuests] = useState([])
  const [selectedGuest, setSelectedGuest] = useState(null)
  const [stats, setStats] = useState({ total: 0, checkedIn: 0, seats: 0, merchEligible: 0, merchDone: 0, ticketTypes: [] })
  const [selling, setSelling] = useState(false)
  const [loading, setLoading] = useState(false)
  const [actionStatus, setActionStatus] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [mode, setMode] = useState('search')
  const [rosterFilter, setRosterFilter] = useState('all')
  const [rosterPage, setRosterPage] = useState(1)
  const [roster, setRoster] = useState({ guests: [], total: 0, page: 1, pageCount: 1 })
  const [rosterLoading, setRosterLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState('')
  const [rosterRefresh, setRosterRefresh] = useState(0)
  const importInputRef = useRef(null)
  const [registerOpen, setRegisterOpen] = useState(false)
  const [registration, setRegistration] = useState(EMPTY_REGISTRATION)
  const [registerError, setRegisterError] = useState('')
  const [registerStatus, setRegisterStatus] = useState('')
  const [registerLoading, setRegisterLoading] = useState(false)
  const searchInputRef = useRef(null)

  const isLoggedIn = token.length > 0
  const isAdmin = role === 'admin'

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('tedx-theme', theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'light' ? 'dark' : 'light'))
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('tedx-token')
    localStorage.removeItem('tedx-role')
    setToken('')
    setRole('user')
    setGuests([])
    setQuery('')
    setSelectedGuest(null)
    setLoading(false)
    setMode('search')
    setRosterFilter('all')
    setRosterPage(1)
  }, [])

  const handleAuthError = useCallback(
    (error) => {
      if (error.status === 401) logout()
    },
    [logout],
  )

  useEffect(() => {
    if (isLoggedIn) searchInputRef.current?.focus()
  }, [isLoggedIn])

  useEffect(() => {
    if (!isLoggedIn) return

    const controller = new AbortController()
    const trimmedQuery = query.trim()

    if (trimmedQuery.length === 0) {
      apiFetch('/api/stats', { token, signal: controller.signal })
        .then(setStats)
        .catch((error) => { if (error.name !== 'AbortError') handleAuthError(error) })
      return () => controller.abort()
    }

    apiFetch(`/api/guests/search?q=${encodeURIComponent(trimmedQuery)}`, {
      token,
      signal: controller.signal,
    })
      .then((data) => {
        setGuests(data.guests)
        setStats(data.stats)
      })
      .catch((error) => { if (error.name !== 'AbortError') handleAuthError(error) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })

    return () => controller.abort()
  }, [query, token, isLoggedIn, handleAuthError])

  useEffect(() => {
    if (!isLoggedIn || !isAdmin || mode !== 'roster') return

    const controller = new AbortController()
    apiFetch(`/api/admin/guests?filter=${rosterFilter}&page=${rosterPage}`, {
      token,
      signal: controller.signal,
    })
      .then((data) => {
        setRoster(data)
        setStats(data.stats)
      })
      .catch((error) => { if (error.name !== 'AbortError') handleAuthError(error) })
      .finally(() => { if (!controller.signal.aborted) setRosterLoading(false) })

    return () => controller.abort()
  }, [isLoggedIn, isAdmin, mode, rosterFilter, rosterPage, rosterRefresh, token, handleAuthError])

  const checkedInPercent = useMemo(() => {
    const denom = stats.seats || stats.total
    if (!denom) return 0
    return Math.round((stats.checkedIn / denom) * 100)
  }, [stats])

  function openRoster() {
    setRosterLoading(true)
    setMode('roster')
  }

  function changeRosterFilter(filter) {
    if (filter === rosterFilter) return
    setRosterLoading(true)
    setRosterFilter(filter)
    setRosterPage(1)
  }

  function goToPage(updater) {
    setRosterLoading(true)
    setRosterPage(updater)
  }

  async function exportCsv() {
    setExporting(true)
    try {
      const response = await fetch('/api/admin/export.csv', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) throw new Error('Export failed')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'tedx-guests.csv'
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch {
      /* surfaced via button state reset */
    } finally {
      setExporting(false)
    }
  }

  function pickImportFiles() {
    setImportMsg('')
    importInputRef.current?.click()
  }

  async function handleImportFiles(event) {
    const fileList = Array.from(event.target.files || [])
    event.target.value = '' // allow re-selecting the same files later
    if (fileList.length === 0) return

    setImporting(true)
    setImportMsg('Reading files…')
    try {
      const files = await Promise.all(
        fileList.map(async (file) => ({ name: file.name, content: await file.text() })),
      )
      const data = await apiFetch('/api/admin/import', {
        method: 'POST',
        token,
        body: JSON.stringify({ files }),
      })
      const s = data.summary
      setStats(data.stats)
      setRosterRefresh((n) => n + 1)
      setImportMsg(`✓ ${s.guests} guests (${s.inserted} new, ${s.updated} updated) · ${s.merch.length} with merch · check-ins preserved`)
    } catch (error) {
      setImportMsg(`⚠ ${error.message || 'Import failed'}`)
      handleAuthError(error)
    } finally {
      setImporting(false)
    }
  }

  function openRegister() {
    setRegistration(EMPTY_REGISTRATION)
    setRegisterError('')
    setRegisterStatus('')
    setRegisterOpen(true)
  }

  async function submitRegistration(event) {
    event.preventDefault()
    setRegisterError('')
    setRegisterStatus('')

    const name = registration.name.trim()
    const email = registration.email.trim()
    if (!name) {
      setRegisterError('Name is required')
      return
    }
    if (!email) {
      setRegisterError('Email is required')
      return
    }
    const price = Number(registration.price)
    if (!Number.isFinite(price) || price < 0) {
      setRegisterError('Enter a valid price')
      return
    }

    setRegisterLoading(true)
    try {
      const data = await apiFetch('/api/guests', {
        method: 'POST',
        token,
        body: JSON.stringify({
          name,
          email,
          phone: registration.phone.trim(),
          ticket_type: registration.ticket_type,
          price,
        }),
      })
      setStats(data.stats)
      setRegisterStatus(`✓ ${data.guest.name} registered · code ${data.guest.code}`)
      setRegistration(EMPTY_REGISTRATION)
    } catch (error) {
      setRegisterError(error.message || 'Could not register guest')
      handleAuthError(error)
    } finally {
      setRegisterLoading(false)
    }
  }

  async function handleLogin(event) {
    event.preventDefault()
    setLoginLoading(true)
    setLoginError('')

    try {
      const data = await fetchJson('/api/login', {
        method: 'POST',
        body: JSON.stringify(login),
      })
      const nextRole = data.role || 'user'
      localStorage.setItem('tedx-token', data.token)
      localStorage.setItem('tedx-role', nextRole)
      setToken(data.token)
      setRole(nextRole)
      setLogin({ username: 'user', password: '' })
    } catch (error) {
      setLoginError(error.message || 'Login failed')
    } finally {
      setLoginLoading(false)
    }
  }

  async function selectGuest(guest) {
    setActionStatus('')
    setSelectedGuest(guest)

    try {
      const data = await apiFetch(`/api/guests/${guest.id}`, { token })
      setSelectedGuest(data.guest)
    } catch (error) {
      handleAuthError(error)
    }
  }

  async function updateGuest(action, body) {
    if (!selectedGuest) return
    setActionStatus('Saving…')

    try {
      const data = await apiFetch(`/api/guests/${selectedGuest.id}/${action}`, {
        method: 'POST',
        token,
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      setSelectedGuest(data.guest)
      setStats(data.stats)
      const patchList = (list) => list.map((g) => (g.id === data.guest.id ? data.guest : g))
      setGuests(patchList)
      setRoster((current) => ({ ...current, guests: patchList(current.guests) }))
      setActionStatus(ACTION_MESSAGES[action] || 'Saved')
    } catch (error) {
      setActionStatus(error.message || 'Could not save')
      handleAuthError(error)
    }
  }

  async function sellTicket(ticketType) {
    if (!selectedGuest) return
    setSelling(true)
    setActionStatus('Selling ticket…')
    try {
      const data = await apiFetch(`/api/guests/${selectedGuest.id}/sell-ticket`, {
        method: 'POST',
        token,
        body: JSON.stringify({ ticket_type: ticketType }),
      })
      setSelectedGuest(data.guest)
      setStats(data.stats)
      const patchList = (list) => list.map((g) => (g.id === data.guest.id ? data.guest : g))
      setGuests(patchList)
      setRoster((current) => ({ ...current, guests: patchList(current.guests) }))
      setActionStatus(`✓ ${ticketType} ticket sold (${formatNaira(TICKET_PRICES[ticketType])}) — collect payment, then admit entry`)
    } catch (error) {
      setActionStatus(error.message || 'Could not sell ticket')
      handleAuthError(error)
    } finally {
      setSelling(false)
    }
  }

  function clearHome() {
    setQuery('')
    setGuests([])
    setSelectedGuest(null)
    setActionStatus('')
    setLoading(false)
    setMode('search')
    window.requestAnimationFrame(() => searchInputRef.current?.focus())
  }

  function handleSearchChange(event) {
    const value = event.target.value
    setQuery(value)
    setLoading(value.trim().length > 0)
    if (value.trim().length === 0) setGuests([])
  }

  /* ── Login screen ── */
  if (!isLoggedIn) {
    return (
      <main className="login-shell">
        <section className="login-panel">
          <div className="login-top">
            <div className="brand-mark">TEDx</div>
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
          </div>
          <h1>Registration Desk</h1>
          <p className="login-subtitle">Sign in to manage event check-ins</p>

          <form onSubmit={handleLogin} className="login-form">
            <div className="field">
              <label className="field-label" htmlFor="login-username">Username</label>
              <input
                id="login-username"
                autoComplete="username"
                value={login.username}
                onChange={(e) => setLogin({ ...login, username: e.target.value })}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="login-password">Password</label>
              <input
                id="login-password"
                autoComplete="current-password"
                type="password"
                value={login.password}
                onChange={(e) => setLogin({ ...login, password: e.target.value })}
                autoFocus
              />
            </div>

            {loginError && <p className="error-text">⚠ {loginError}</p>}

            <button className="primary-button" type="submit" disabled={loginLoading} style={{ marginTop: 4 }}>
              {loginLoading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </section>
      </main>
    )
  }

  /* ── Main dashboard ── */
  return (
    <main className="app-shell">
      {/* Top bar */}
      <header className="top-bar">
        <button className="home-button" type="button" onClick={clearHome}>
          <IconHome />
          <span>Home</span>
        </button>

        <div className="event-title">
          <div className="event-title-brand">
            <span className="event-title-logo">TEDx</span>
            <span className="event-title-name">Registration</span>
          </div>
          <span className="event-title-sub">{stats.checkedIn} checked in · {checkedInPercent}% complete</span>
        </div>

        <div className="top-bar-right">
          {isAdmin && <span className="role-badge">Admin</span>}
          <button className="register-cta" type="button" onClick={openRegister}>
            <IconPlus />
            <span>Register</span>
          </button>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          <button className="ghost-button" type="button" onClick={logout}>
            <IconLogout />
            <span>Logout</span>
          </button>
        </div>
      </header>

      {/* Dashboard */}
      <section className="dashboard">
        {/* Search / Roster zone */}
        <div className="search-zone">
          {isAdmin && (
            <div className="admin-toolbar">
              <div className="mode-switch" role="tablist" aria-label="View mode">
                <button
                  className={`mode-switch-btn${mode === 'search' ? ' active' : ''}`}
                  type="button"
                  role="tab"
                  aria-selected={mode === 'search'}
                  onClick={() => setMode('search')}
                >
                  Search
                </button>
                <button
                  className={`mode-switch-btn${mode === 'roster' ? ' active' : ''}`}
                  type="button"
                  role="tab"
                  aria-selected={mode === 'roster'}
                  onClick={openRoster}
                >
                  Roster
                </button>
              </div>
              <div className="admin-toolbar-actions">
                <input
                  ref={importInputRef}
                  type="file"
                  accept=".csv"
                  multiple
                  onChange={handleImportFiles}
                  style={{ display: 'none' }}
                />
                <button
                  className="export-button"
                  type="button"
                  onClick={pickImportFiles}
                  disabled={importing}
                  title="Upload full Selar sales exports to load or update guests (keeps check-ins)"
                >
                  <IconUpload />
                  {importing ? 'Importing…' : 'Import Sales'}
                </button>
                <button
                  className="export-button"
                  type="button"
                  onClick={exportCsv}
                  disabled={exporting}
                >
                  <IconDownload />
                  {exporting ? 'Exporting…' : 'Export CSV'}
                </button>
              </div>
            </div>
          )}
          {isAdmin && importMsg && <p className="import-status">{importMsg}</p>}

          {mode === 'search' ? (
            <>
              <div className="search-heading">
                <h1>Find Guest</h1>
                <div className="progress-badge">
                  <div className="progress-bar-wrap">
                    <div className="progress-bar-fill" style={{ width: `${checkedInPercent}%` }} />
                  </div>
                  <span className="progress-label">{checkedInPercent}% entry</span>
                </div>
              </div>

              <label className="search-label" htmlFor="guest-search">
                Name, code, phone, or ref code
              </label>
              <div className="search-input-wrap">
                <span className="search-icon"><IconSearch /></span>
                <input
                  id="guest-search"
                  ref={searchInputRef}
                  className="search-input"
                  placeholder="Start typing to search…"
                  value={query}
                  onChange={handleSearchChange}
                  autoComplete="off"
                />
                {loading && <div className="search-spinner" aria-label="Searching" />}
              </div>

              <div className="results-header">
                <span className="results-count">
                  {query.trim()
                    ? `${guests.length} result${guests.length === 1 ? '' : 's'}`
                    : 'Ready to search'}
                </span>
              </div>

              <div className="results-list" role="list">
                {guests.map((guest) => (
                  <GuestRow key={guest.id} guest={guest} onSelect={selectGuest} />
                ))}

                {query.trim() && !loading && guests.length === 0 && (
                  <div className="empty-state">
                    <span className="empty-state-icon">🔍</span>
                    <span className="empty-state-text">No guest found for "{query}"</span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="search-heading">
                <h1>Guest Roster</h1>
                <span className="results-count">{roster.total} guests</span>
              </div>

              <div className="filter-chips" role="tablist" aria-label="Roster filter">
                {ROSTER_FILTERS.map((filter) => (
                  <button
                    key={filter.key}
                    className={`filter-chip${rosterFilter === filter.key ? ' active' : ''}`}
                    type="button"
                    role="tab"
                    aria-selected={rosterFilter === filter.key}
                    onClick={() => changeRosterFilter(filter.key)}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>

              <div className="results-list" role="list">
                {roster.guests.map((guest) => (
                  <GuestRow key={guest.id} guest={guest} onSelect={selectGuest} />
                ))}

                {!rosterLoading && roster.guests.length === 0 && (
                  <div className="empty-state">
                    <span className="empty-state-icon">📋</span>
                    <span className="empty-state-text">No guests match this filter</span>
                  </div>
                )}
              </div>

              {roster.pageCount > 1 && (
                <div className="pagination">
                  <button
                    className="page-button"
                    type="button"
                    disabled={roster.page <= 1 || rosterLoading}
                    onClick={() => goToPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </button>
                  <span className="page-info">Page {roster.page} of {roster.pageCount}</span>
                  <button
                    className="page-button"
                    type="button"
                    disabled={roster.page >= roster.pageCount || rosterLoading}
                    onClick={() => goToPage((p) => Math.min(roster.pageCount, p + 1))}
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Stats panel */}
        <aside className="stats-panel" aria-label="Event statistics">
          <span className="stats-title">Event Stats</span>
          <StatBlock
            label="Total Guests"
            value={stats.total}
            iconClass="total"
            icon={<IconUsers />}
          />
          <StatBlock
            label="Guests In"
            value={`${stats.checkedIn} / ${stats.seats}`}
            iconClass="checkin"
            icon={<IconCheck />}
          />
          <StatBlock
            label="Merch Done"
            value={`${stats.merchDone} / ${stats.merchEligible}`}
            iconClass="merch"
            icon={<IconGift />}
          />
          <TicketBreakdown ticketTypes={stats.ticketTypes} />
        </aside>
      </section>

      {/* Guest modal */}
      {selectedGuest && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setSelectedGuest(null)}
        >
          <section
            className="guest-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-guest-name"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button className="close-button" type="button" aria-label="Close" onClick={() => setSelectedGuest(null)}>
              <IconClose />
            </button>

            <div className="modal-scroll">
            <div className="modal-header">
              <span className="modal-eyebrow">Guest Details</span>
              <h2 id="modal-guest-name">{selectedGuest.name}</h2>
              <div className="modal-status">
                {selectedGuest.ticket_type ? (
                  <span className="ticket-pill">{selectedGuest.ticket_type}</span>
                ) : (
                  <span className="ticket-pill none">No ticket</span>
                )}
                <EntryPill guest={selectedGuest} />
                {selectedGuest.merch ? (
                  <span className={`merch-pill${selectedGuest.merch_checked_in ? ' collected' : ''}`}>
                    🎁 Merch {selectedGuest.merch_checked_in ? 'collected' : 'included'}
                  </span>
                ) : (
                  <span className="status-pill">
                    <span className="status-pill-dot" />
                    No merch
                  </span>
                )}
              </div>
              {selectedGuest.quantity > 1 && (
                <p className="multi-ticket-banner">
                  ⚠ {selectedGuest.quantity} tickets on this order — admit each person below as they arrive (they may come separately).
                </p>
              )}
            </div>

            <div className="guest-details">
              <div className="guest-details-item">
                <div className="guest-details-label">Email</div>
                <div className="guest-details-value">{selectedGuest.email}</div>
              </div>
              <div className="guest-details-item">
                <div className="guest-details-label">Phone</div>
                <div className="guest-details-value">{selectedGuest.phone}</div>
              </div>
              <div className="guest-details-item">
                <div className="guest-details-label">Code</div>
                <div className="guest-details-value" style={{ fontFamily: 'monospace' }}>{selectedGuest.code}</div>
              </div>
              <div className="guest-details-item">
                <div className="guest-details-label">Ref Code</div>
                <div className="guest-details-value" style={{ fontFamily: 'monospace' }}>{selectedGuest.ref_code}</div>
              </div>
              <div className="guest-details-item">
                <div className="guest-details-label">Ticket Type</div>
                <div className="guest-details-value">{selectedGuest.ticket_type || '—'}</div>
              </div>
              <div className="guest-details-item">
                <div className="guest-details-label">Tickets</div>
                <div className="guest-details-value">{selectedGuest.quantity || 1}</div>
              </div>
              <div className={`guest-details-item merch-row${selectedGuest.merch ? ' has-merch' : ''}`}>
                <div className="guest-details-label">Merch ordered</div>
                <div className="guest-details-value">
                  {selectedGuest.merch ? (
                    selectedGuest.merch_items?.length ? (
                      <span className="merch-chips">
                        {selectedGuest.merch_items.map((item) => (
                          <span key={item.item} className="merch-chip">
                            {item.item}{item.qty > 1 ? ` ×${item.qty}` : ''}
                          </span>
                        ))}
                      </span>
                    ) : 'Included'
                  ) : 'None'}
                </div>
              </div>
              {isAdmin && (
                <>
                  <div className="guest-details-item">
                    <div className="guest-details-label">Checked In At</div>
                    <div className="guest-details-value">{formatTimestamp(selectedGuest.checked_in_at)}</div>
                  </div>
                  <div className="guest-details-item">
                    <div className="guest-details-label">Merch Collected At</div>
                    <div className="guest-details-value">{formatTimestamp(selectedGuest.merch_checked_in_at)}</div>
                  </div>
                </>
              )}
            </div>

            {selectedGuest.quantity > 1 ? (
              <div className="action-stack">
                <MultiEntryControl
                  guest={selectedGuest}
                  onAdmit={(count, companion) => updateGuest('check-in', { count, companion })}
                />
                <MerchButton guest={selectedGuest} onCheckIn={() => updateGuest('check-in-merch')} />
              </div>
            ) : selectedGuest.ticket_type ? (
              <div className="action-grid">
                <button
                  className={`action-button check-in${selectedGuest.checked_in ? ' done' : ''}`}
                  type="button"
                  disabled={selectedGuest.checked_in}
                  onClick={() => updateGuest('check-in')}
                >
                  <span className="action-button-icon">✓</span>
                  {selectedGuest.checked_in ? 'Checked In' : 'Check-In Entry'}
                </button>
                <MerchButton guest={selectedGuest} onCheckIn={() => updateGuest('check-in-merch')} />
              </div>
            ) : (
              <div className="action-stack">
                <NoTicketEntry selling={selling} onSell={sellTicket} />
                <MerchButton guest={selectedGuest} onCheckIn={() => updateGuest('check-in-merch')} />
              </div>
            )}

            {isAdmin && (selectedGuest.checked_in_count > 0 || selectedGuest.merch_checked_in) && (
              <div className="admin-undo-row">
                <span className="admin-undo-label">Admin · reverse</span>
                {selectedGuest.checked_in_count > 0 && (
                  <button className="undo-button" type="button" onClick={() => updateGuest('undo-check-in')}>
                    <IconUndo /> {selectedGuest.quantity > 1 ? 'Undo last admit' : 'Undo entry'}
                  </button>
                )}
                {selectedGuest.merch_checked_in && (
                  <button className="undo-button" type="button" onClick={() => updateGuest('undo-check-in-merch')}>
                    <IconUndo /> Undo merch
                  </button>
                )}
              </div>
            )}

            {actionStatus && (
              <p className="save-status">{actionStatus}</p>
            )}
            </div>
          </section>
        </div>
      )}

      {/* Registration modal */}
      {registerOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setRegisterOpen(false)}
        >
          <section
            className="guest-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="register-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button className="close-button" type="button" aria-label="Close" onClick={() => setRegisterOpen(false)}>
              <IconClose />
            </button>

            <div className="modal-scroll">
            <div className="modal-header">
              <span className="modal-eyebrow">Quick Register</span>
              <h2 id="register-title">New Guest</h2>
            </div>

            <form className="register-form" onSubmit={submitRegistration}>
              <div className="field">
                <label className="field-label" htmlFor="reg-name">Name</label>
                <input
                  id="reg-name"
                  value={registration.name}
                  onChange={(e) => setRegistration((r) => ({ ...r, name: e.target.value }))}
                  autoFocus
                  autoComplete="off"
                />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="reg-email">Email</label>
                <input
                  id="reg-email"
                  type="email"
                  value={registration.email}
                  onChange={(e) => setRegistration((r) => ({ ...r, email: e.target.value }))}
                  autoComplete="off"
                />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="reg-phone">Phone number</label>
                <input
                  id="reg-phone"
                  value={registration.phone}
                  onChange={(e) => setRegistration((r) => ({ ...r, phone: e.target.value }))}
                  autoComplete="off"
                />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="reg-ticket">Ticket type</label>
                <select
                  id="reg-ticket"
                  className="register-select"
                  value={registration.ticket_type}
                  onChange={(e) => {
                    const ticket_type = e.target.value
                    setRegistration((r) => ({ ...r, ticket_type, price: String(TICKET_PRICES[ticket_type]) }))
                  }}
                >
                  {TICKET_OPTIONS.map((ticket) => (
                    <option key={ticket.value} value={ticket.value}>
                      {ticket.label} — {formatNaira(ticket.price)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="field-label" htmlFor="reg-price">Price (₦)</label>
                <input
                  id="reg-price"
                  type="number"
                  min="0"
                  step="100"
                  inputMode="numeric"
                  value={registration.price}
                  onChange={(e) => setRegistration((r) => ({ ...r, price: e.target.value }))}
                  autoComplete="off"
                />
              </div>

              {registerError && <p className="error-text">⚠ {registerError}</p>}
              {registerStatus && <p className="save-status">{registerStatus}</p>}

              <button className="primary-button" type="submit" disabled={registerLoading} style={{ marginTop: 4 }}>
                {registerLoading ? 'Registering…' : 'Register Guest'}
              </button>
            </form>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

/* ─── Sub-components ─────────────────────────────────────────────────────── */

function ThemeToggle({ theme, onToggle }) {
  const next = theme === 'light' ? 'dark' : 'light'
  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={onToggle}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
    >
      {theme === 'light' ? <IconMoon /> : <IconSun />}
    </button>
  )
}

function GuestRow({ guest, onSelect }) {
  return (
    <button
      className="guest-row"
      type="button"
      role="listitem"
      onClick={() => onSelect(guest)}
    >
      <span className="guest-name">
        {guest.name}
        {guest.quantity > 1 && <span className="qty-badge">×{guest.quantity}</span>}
      </span>
      <span className="guest-meta">
        {guest.code} / {guest.ref_code}
        {guest.ticket_type ? ` · ${guest.ticket_type}` : ''}
      </span>
      <EntryPill guest={guest} />
      {guest.merch && (
        <span className={`merch-pill compact${guest.merch_checked_in ? ' collected' : ''}`} title="Merch included">
          🎁 Merch
        </span>
      )}
    </button>
  )
}

// Entry status that shows "x/N" progress for multi-ticket orders.
function EntryPill({ guest }) {
  const multi = guest.quantity > 1
  const admitted = guest.checked_in_count || 0
  const full = guest.checked_in || (multi && admitted >= guest.quantity)
  const partial = multi && admitted > 0 && !full
  const cls = full ? ' active' : partial ? ' partial' : ''
  return (
    <span className={`status-pill${cls}`}>
      <span className="status-pill-dot" />
      {multi ? `Entry ${admitted}/${guest.quantity}` : `Entry: ${guest.checked_in ? 'YES' : 'NO'}`}
    </span>
  )
}

// Counter-based admission for orders with more than one ticket.
function MultiEntryControl({ guest, onAdmit }) {
  const [companion, setCompanion] = useState('')
  const total = guest.quantity || 1
  const admitted = guest.checked_in_count || 0
  const remaining = Math.max(0, total - admitted)
  const admissions = guest.admissions || []

  function admit(count) {
    onAdmit(count, count === 1 ? companion.trim() : '')
    setCompanion('')
  }

  return (
    <div className="entry-multi">
      <div className={`entry-progress${remaining === 0 ? ' complete' : ''}`}>
        <span className="entry-progress-count">{admitted} / {total}</span>
        <span className="entry-progress-label">
          {remaining === 0 ? 'All admitted ✓' : `${remaining} still to come`}
        </span>
      </div>

      {admissions.length > 0 && (
        <ul className="admit-log">
          {admissions.map((a, i) => (
            <li key={i}>
              <span className="admit-log-name">#{i + 1} · {a.name || 'Guest'}</span>
              <span className="admit-log-time">{formatTimestamp(a.at)}</span>
            </li>
          ))}
        </ul>
      )}

      {remaining > 0 && (
        <>
          <input
            className="companion-input"
            type="text"
            placeholder="Name of person being admitted (optional)"
            value={companion}
            onChange={(e) => setCompanion(e.target.value)}
          />
          <div className="entry-multi-actions">
            <button className="action-button check-in" type="button" onClick={() => admit(1)}>
              <span className="action-button-icon">✓</span>
              Admit 1{remaining > 1 ? ` · ${remaining} left` : ''}
            </button>
            {remaining > 1 && (
              <button className="action-button admit-all" type="button" onClick={() => admit(remaining)}>
                Admit all {remaining}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function MerchButton({ guest, onCheckIn }) {
  return (
    <button
      className={`action-button merch${guest.merch_checked_in ? ' done' : ''}`}
      type="button"
      disabled={!guest.merch || guest.merch_checked_in}
      onClick={onCheckIn}
    >
      <span className="action-button-icon">🎁</span>
      {!guest.merch ? 'No Merch' : guest.merch_checked_in ? 'Merch Done' : 'Check-In Merch'}
    </button>
  )
}

// Shown for merch-only guests (no ticket): entry is disabled, but staff can
// sell a ticket at the gate (pay on the spot), which then enables check-in.
function NoTicketEntry({ selling, onSell }) {
  const [tier, setTier] = useState('Spark')
  return (
    <div className="no-ticket-entry">
      <button className="action-button check-in" type="button" disabled>
        <span className="action-button-icon">✓</span> No ticket — entry disabled
      </button>
      <div className="sell-ticket">
        <span className="sell-ticket-label">Selling a ticket at the gate? Pick a tier, collect payment, then sell:</span>
        <div className="sell-ticket-options">
          {TICKET_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`tier-chip${tier === option.value ? ' active' : ''}`}
              onClick={() => setTier(option.value)}
            >
              {option.value} · {formatNaira(option.price)}
            </button>
          ))}
        </div>
        <button className="action-button sell" type="button" disabled={selling} onClick={() => onSell(tier)}>
          {selling ? 'Selling…' : `Sell ${tier} ticket · ${formatNaira(TICKET_PRICES[tier])}`}
        </button>
      </div>
    </div>
  )
}

function TicketBreakdown({ ticketTypes = [] }) {
  const byTier = Object.fromEntries(ticketTypes.map((t) => [t.tier, t]))
  const none = byTier.None
  return (
    <div className="stats-breakdown">
      <span className="stats-subtitle">Tickets by type</span>
      {['Spark', 'Ember', 'Blaze'].map((name) => (
        <div className="breakdown-row" key={name}>
          <span className={`breakdown-tier tier-${name.toLowerCase()}`}>{name}</span>
          <span className="breakdown-count">{byTier[name]?.tickets || 0}</span>
        </div>
      ))}
      {none?.guests > 0 && (
        <div className="breakdown-row muted">
          <span className="breakdown-tier">No ticket (merch only)</span>
          <span className="breakdown-count">{none.guests}</span>
        </div>
      )}
    </div>
  )
}

function StatBlock({ label, value, icon, iconClass }) {
  return (
    <div className="stat-block">
      <div className="stat-block-left">
        <span className="stat-label">{label}</span>
        <strong className="stat-value">{value}</strong>
      </div>
      <div className={`stat-icon ${iconClass}`} aria-hidden="true">
        {icon}
      </div>
    </div>
  )
}

/* ─── API helpers ─────────────────────────────────────────────────────────── */

function formatTimestamp(value) {
  if (!value) return '—'
  const parsed = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function apiFetch(path, options = {}) {
  const { token, ...requestOptions } = options
  return fetchJson(path, {
    ...requestOptions,
    headers: {
      ...(requestOptions.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  })
}

async function fetchJson(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })

  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    const error = new Error(data.message || 'Request failed')
    error.status = response.status
    throw error
  }

  return data
}

export default App
