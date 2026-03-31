# OTG AppSuite — A "BYO" Safety System for Lean Organisations

I designed the **On-The-Go (OTG) AppSuite** to solve a specific problem: professional lone worker safety systems are often too expensive or complex for small charities and community organisations.

The OTG AppSuite is not a standard SaaS product. You don't sign up for an account, you don't pay a monthly subscription, and your data doesn't live on our servers. Instead, it is a **self-hosted system engine** that you deploy into your own Google Cloud environment.

Here is a realistic breakdown of what it does and who it is for.

---

## How It Works

The system is serverless. It uses **Google Sheets** as its database and **Google Apps Script** as its backend.

1. **The Worker App:** Staff install a web app (PWA) on their phones. It handles GPS tracking, check-in timers, form reporting, and visit logging. It works offline and syncs when connection is restored.
2. **The Backend:** A script running in your Google Drive receives data, saves photos to your Drive folders, and acts as a watchdog. If a worker misses a check-in, the script triggers a tiered escalation (email, SMS, and push notification).
3. **The Monitor Dashboard:** Supervisors view a live status board on their office PC, showing active workers, battery levels, GPS locations, and alarm states.

---

## Key Capabilities

- **Tiered Escalation:** Sends overdue notification emails at 15, 30, and 45 minutes past the anticipated departure time, followed by a full emergency alert (email + SMS + push notification) at the 60-minute mark if the worker remains unresponsive.
- **High-Risk (Zero Tolerance) Mode:** Workers entering dangerous situations can toggle a mode that skips all overdue warning tiers and escalates directly to emergency the moment the timer expires.
- **Battery Saver / Dim Mode:** When the worker's screen dims automatically, the app enters a power-conserving mode while keeping all safety monitoring, alarm logic, and GPS pulsing active. A swipe-to-wake slider returns the worker to full brightness.
- **Pre-Visit Forms:** Travel visits can require workers to complete a questionnaire before departure, covering vehicle checks, route details, or any other pre-trip requirements your organisation needs.
- **Visit History:** Workers can review their recent visits on-device, grouped by date, providing an at-a-glance personal record without needing server access.
- **Precise Location (what3words):** When configured, emergency alerts display a what3words address (e.g. `///filled.count.soap`) alongside GPS coordinates. The three-word address appears in emergency emails, on the monitor worker tile, and on the worker's alarm screen — particularly useful for locations where a street address is absent or imprecise.
- **Business Intelligence:** It doesn't just log safety; it tracks work. The system generates monthly reports showing visit trends, total hours on-site, and aggregated numeric data (e.g. total mileage driven).
- **AI Integration:** Raw data is stored exactly as typed for legal accuracy, but email notifications use Google Gemini to polish hasty notes into professional English for management updates. The system dynamically selects the best available Gemini model rather than relying on hardcoded model names.

---

## The Litmus Test: Is This Right for You?

This solution is **not** a fit for everyone. Use this checklist to assess suitability.

**✅ You are the ideal user if:**
- **Budget is a primary constraint.** You are a charity, non-profit, or small business that cannot justify $20/user/month fees.
- **You value data sovereignty.** You want to own your data in your own Google Drive, not trust a third-party vendor.
- **You have "one tech-savvy person."** You don't need a developer, but you need someone comfortable copying and pasting code, generating API keys, and managing a Google Sheet.
- **Your fleet is small to medium.** The system works best for teams of 5 to ~50 active workers.

**❌ This is likely NOT for you if:**
- **You need an SLA.** Because you host it, you are the support team. There is no 24/7 helpdesk to call if you break your spreadsheet.
- **You need enterprise integration.** It does not plug into Active Directory, SAP, or complex HR systems out of the box.
- **You have 500+ staff.** Google Sheets has processing limits (quotas) that very large organisations may hit.

---

## ⚠️ Key Safety Limitations

Understand these before deploying.

- **No direct link to emergency services.** When an alarm fires, the system notifies your nominated contacts only. Those contacts must make the judgement call about whether to dial 111 (or your local emergency number). There is no automatic escalation to police, ambulance, or a monitored response centre.
- **The Monitor dashboard requires active supervision.** The audio alarm and full-screen alert only trigger if a supervisor has the Monitor tab open in a browser. If the tab is closed or the computer is locked, that screen is silent. Ensure your organisation has a clear plan for who monitors the dashboard and when.
- **Offline connectivity is safety-critical.** The escalation watchdog runs independently in Google Apps Script — it does not rely on the worker's device being online to send alerts. However, it can only monitor visits it knows about. If a worker starts a visit without a data connection, the visit record is queued locally and will not reach the backend until signal is restored. Until that sync happens, the watchdog has no record of the visit and cannot escalate if the timer expires.

---

## Best-Fit Organisations

Based on its architecture, the OTG AppSuite is well-suited for:

1. **Community care & social services:** Organisations visiting clients in their homes where staff safety is a concern but funding is tight.
2. **Environmental & conservation groups:** Staff working in remote areas who need offline-capable check-in tools and GPS tracking.
3. **Property management & real estate:** Solo agents performing inspections who need a discreet dead man's switch.
4. **Volunteer networks:** Temporary or casual fleets where installing a heavy, paid corporate app is impractical.

---

## Summary

The OTG AppSuite is a **"build your own"** professional safety platform. It trades the convenience of a sign-up button for the power of **ownership, customisation, and zero running costs**. If you are willing to spend a few hours setting it up, you get a safety system that rivals commercial alternatives for free.

---
---

# OTG AppSuite — Technical Reference

**Architecture:** Serverless / Distributed PWA  
**Runtime:** Google V8 Engine (backend) / ES6 Browser (frontend)  
**Licence:** MIT / Open Source "Forever Free"

---

## 1. Architectural Philosophy & Topology

The OTG AppSuite rejects the traditional SaaS model in favour of a **Factory Pattern** deployment. This ensures data sovereignty, zero ongoing licensing costs, and resilience against vendor lock-in.

### 1.1 The Factory Pattern (Instantiation)

The `index.html` (Factory App) acts as a client-side compiler. It does not communicate with a central OTG server.

1. **Template loading:** It holds the raw source code for the Worker and Monitor apps as internal string variables.
2. **Configuration injection:** It accepts user inputs (org name, API keys, timers) and performs a find-and-replace operation on the raw source code using `%%VARIABLE%%` keys.
3. **Cryptographic generation:** It generates a random 9-character alphanumeric `WORKER_KEY` used to secure the handshake between the Worker App and the Google Script.
4. **Bundling:** It uses the `JSZip` library to package the compiled HTML files, `config.json`, `manifest.json`, icon, and service worker into a deployable ZIP archive.

### 1.2 The Config Model

The Worker App HTML (`index.html` in the deployment pack) is a **shared, canonical file** — it is identical across all deployments. No org-specific data is injected into it at build time. All organisation-specific configuration — org name, backend URL, API keys, theming, and timers — lives solely in `config.json`, which is bundled separately by the Factory and fetched by the app at runtime. Worker identity is established during the in-app setup wizard on first run.

This separation means the Worker App HTML can be updated centrally without requiring a full Factory rebuild for each organisation.

### 1.3 Data Topology (The "Thick Client" Model)

Logic is pushed to the client to minimise server costs and latency:

- **Worker App:** Handles GPS tracking, form validation, countdown timers, battery saver logic, and the offline outbox locally.
- **Monitor App:** Handles sorting, filtering, geocoding, and alert rendering locally.
- **Backend:** Acts primarily as a RESTful API endpoint and database interface, only performing heavy lifting for reporting and escalation.

---

## 2. Backend Logic Specification (`Code.gs`)

The backend is hosted on Google Apps Script, exposing a Web App URL (`/exec`).

### 2.1 Concurrency & Locking

Google Sheets is not a transactional database. To prevent race conditions (two workers writing simultaneously causing data overwrites), the system uses `LockService`.

- **Mechanism:** `LockService.getScriptLock()`
- **Timeout:** 10,000 ms (10 seconds).
- **Behaviour:** If the lock cannot be acquired within 10 s, the backend returns a `Server Busy` JSON error. The Worker App detects this and retains the payload in its IndexedDB retry queue.

### 2.2 The "Smart Ledger" Algorithm (`handleWorkerPost`)

The system does not simply append every request as a new row. It attempts to maintain a coherent session for each visit.

**Logic flow:**
1. **Receive payload:** Worker sends Worker Name and Alarm Status.
2. **Scan context:** The script reads the last 50 rows of the `Visits` sheet.
3. **Match session:** It looks for a row where Column C (Worker Name) matches the incoming payload and Column K (Alarm Status) is **not** a closed state (defined by the `CLOSED_VISIT_STATUSES` constant: `DEPARTED`, `USER_SAFE`, `COMPLETED`, `DATA_ENTRY_ONLY`, `NOTICE_ACK`, `PRE_VISIT`).
4. **Decision:**
   - **Match found:** The script **updates** the existing row (timestamp, battery, GPS, notes). This prevents row spam during long visits with multiple updates.
   - **No match:** The script **appends** a new row to the bottom of the sheet.

`handleSafetyResolution()` **must** run before `handleWorkerPost()` — reversing this order causes All Clear resolutions to be suppressed.

### 2.3 Tiered Escalation Watchdog (`checkOverdueVisits`)

This function must be triggered by a time-driven trigger (recommended frequency: 10 minutes).

**State machine:**
- **Input:** Iterates through all active rows in `Visits`.
- **Calculation:** `Diff = Current_Time − Anticipated_Departure_Time`.
- **High-Risk fast path:** If the visit notes contain `[CRITICAL_TIMING]` (written at visit start when the worker activates High-Risk mode), the watchdog skips all overdue tiers and escalates directly to emergency the moment `Diff ≥ 0`.

**Standard trigger levels:**
1. **OVERDUE — 15 min:** Sends an overdue notification email.
2. **OVERDUE — 30 min:** Sends a follow-up overdue notification.
3. **OVERDUE — 45 min:** Sends a final overdue notification.
4. **EMERGENCY — 60 min breach:** Triggers full emergency email + SMS via the configured SMS provider + ntfy push notification to all nominated contacts.

`OVERDUE ALARM` status (sent when a worker's grace period expires on-device) is treated as an immediate alert trigger — the same path as `EMERGENCY`, `PANIC`, and `DURESS`.

### 2.4 Photo Handling & Sub-folders

The system prevents the root "Safety Photos" folder from becoming disorganised.

1. **Decode:** Accepts a Base64 string from the payload.
2. **Locate/create:** Checks if a sub-folder matching the worker name exists inside `PHOTOS_FOLDER_ID`. If not, creates it.
3. **Naming convention:** Saves file as `YYYY-MM-DD_HH-mm_WorkerName_[Type].jpg` to ensure sortability.
4. **Return:** Returns the `drive.google.com/open?id=...` URL to be written to the spreadsheet.

### 2.5 Reverse Geocoding & what3words

**Reverse geocoding (`reverseGeocode_`)** — used for SMS alert bodies. Calls the Nominatim API with the worker's GPS coordinates and returns a human-readable `"Road, Suburb"` string. Falls back to raw `"lat, lng"` if the lookup fails. Email and ntfy alerts are unaffected (they retain the full Google Maps URL).

**what3words (`getW3wAddress_`)** — optional. When `CONFIG.W3W_API_KEY` is set, calls `api.what3words.com/v3/convert-to-3wa` and appends a clickable `what3words:` row below the GPS row in emergency email alerts. Returns `"///word.word.word"` or `null` on failure. Fires once per alert at send time; not cached server-side (alert volume is low enough for free tier charity use).

> **Licensing note:** what3words is free for registered charities and NGOs — select the Free plan at `accounts.what3words.com/select-plan` and then contact what3words to request a charity upgrade. Commercial use requires a paid plan. The `convert-to-3wa` endpoint is not available on the standard free tier without this upgrade.

### 2.6 AI Integration (Gemini / `smartScribe`)

Worker notes are stored raw in the `Visits` sheet to preserve evidentiary integrity. When generating email reports, the backend calls Google Gemini to correct spelling and grammar. This polished text is used only in the email HTML — it is never written back to the spreadsheet.

**Model selection (`getGeminiModel_`):** The backend calls the Gemini ListModels endpoint, filters for `generateContent`-capable models, and selects from a preference list. No model names are hardcoded anywhere, which ensures the backend remains functional as Google deprecates or renames model versions.

---

## 3. Worker App Specification (PWA)

### 3.1 Service Worker & Offline Capability

- **File:** `sw.js` (generated by Factory; identical across all deployments).
- **Strategy:** Cache-first for app assets; network-first for `config.json`.
- **Behaviour:** On first load, the service worker pre-caches `index.html`, `manifest.json`, the icon, and CDN assets. Subsequent loads (even in Aeroplane Mode) serve these files from the Cache Storage API. Cache invalidation is driven by incrementing the `version` field in `config.json` — no app rebuild is needed.
- **Outbox queue:** When offline, POST requests are stored in an **IndexedDB outbox** with idempotency keys to prevent duplicate submissions on retry. A processing loop monitors connectivity and flushes the queue when online.

### 3.2 GPS Tracking & Intervals

The app uses `navigator.geolocation.watchPosition` with `enableHighAccuracy: true`.

**Signal quality UI:**
- Accuracy < 20 m: 3 green bars (good).
- Accuracy < 50 m: 2 amber bars (caution).
- Accuracy > 50 m: 1 red bar (poor — indoors or obstructed).

**Polling intervals:**
- `GPS_MIN_INTERVAL_MS` — 2 minutes (non-travel visits).
- `GPS_MIN_INTERVAL_TRAVEL_MS` — 1 minute (travel mode).
- `GPS_DEFAULT_INTERVAL_MS` — 5 minutes.
- `GPS_MAX_INTERVAL_MS` — 10 minutes.

**Overdue pulse (`arrivedPulseInterval`):** When a worker with `ARRIVED` status becomes overdue, a 5-minute repeating GPS pulse fires to keep the backend's Last Known GPS current even if the worker is not actively using the app.

**Travel distance accuracy:** A speed accumulator (`_speedAccumM`) tracks distance derived from speed readings as a floor value in `getDistance()`. This improves accuracy on routes where GPS crow-flight significantly underestimates actual driving distance. When the floor value wins, the distance type is tagged `+speed-floor`. OpenRouteService (`getOrsVersion_`) is tried first; crow-flight with speed floor is the fallback.

**Battery level** is read via `navigator.getBattery()` and appended to every heartbeat POST.

### 3.3 Battery Saver / Dim Mode

When the device screen dims (after a configurable inactivity period), the app enters battery saver mode. The worker's name, visit timer, and overdue status remain visible on a minimal locked screen.

- **`isBatterySaverActive`** (boolean) is the single source of truth for saver state.
- **Tick rate in saver mode:** `TICK_SAVER = 30,000 ms` (vs. `TICK_NORMAL = 10,000 ms`). Any time-window logic that must fire in saver mode must span more than 30 seconds.
- **Safety logic runs first:** Core safety checks (overdue detection, alarm triggers) execute before the early `return` in `tick()`, ensuring they fire even at the reduced tick rate.
- **Wake:** A swipe-to-wake slider on the locked screen calls `requestFullscreen()` from within the touch event handler (Android Chrome rejects `requestFullscreen()` from `setTimeout` contexts).
- **`WAKE_GRACE_MS = 0`:** There is no grace period after waking; the inactivity countdown restarts immediately. Any touch resets the 10-second (`DIM_DELAY`) countdown.
- **WakeLock API** is acquired on visit start and released on departure to prevent the device from sleeping entirely during active monitoring.

### 3.4 Visit Phase State Machine

Active visits progress through a sequence of phases defined in `VISIT_PHASES`. Transitions are managed by `setVisitPhase()`, which validates moves against `VALID_PHASE_TRANSITIONS` and logs a warning (returning `false`) on any illegal transition. `setVisitPhase()` does not call `saveState()` — callers are responsible for persisting state after a phase change.

The current phase is stored in `state.activeVisit.phase` and read via `getVisitPhase()`.

### 3.5 Travel Mode

Workers initiate travel visits from the home screen, which has three equal-width action buttons: **Add Site**, **Trip**, and **General**.

- **Trip mode:** Tapping **Trip** activates travel mode. Workers then select a named destination tile from their location list. Once a destination is confirmed, the footer expands to show the duration selector and trip options.
- **General mode:** Tapping **General** sets an unnamed destination — used for ad-hoc journeys where no pre-configured site exists. The footer expands on General confirmation without requiring a named tile selection.
- **Footer expansion:** The `#footerExpandable` panel only expands once a destination is confirmed (named tile or General). Tapping Trip alone does not expand it.
- **Footer options (trip mode only):**
  - **Duration selector** — estimated trip time; used by the watchdog to set the anticipated return time.
  - **Skip report** pill (`#chkTravelNoReport`) — suppresses the Travel Report form at trip end for this journey.
  - **Critical timing** pill (`#chkHighRisk`) — activates High-Risk (Zero Tolerance) mode, triggering immediate escalation at timer expiry rather than the standard overdue tiers.
- **GPS during travel:** Uses `GPS_MIN_INTERVAL_TRAVEL_MS` (1 minute), tighter than the 2-minute non-travel minimum. A battery saver GPS HUD (`#saverGpsAccuracyHUD`) is shown during travel when the screen dims.
- **State variables:** `state.isTravelActive` (boolean), `state.isGeneralDest` (boolean), `state.travelNoReport` (boolean). All must be cleared at visit teardown and at `startVisit()`.

### 3.6 Pre-Visit Forms (Travel Mode)

Travel visits can be configured to require a pre-departure questionnaire. The `_travel` sentinel row in the Sites sheet (a row named `_travel` with `TRUE` in column L) is filtered from the location tile grid but is read by `startVisit()` to overlay `preVisitForm: true` onto travel visits. The form uses the same template-driven builder as all other forms.

### 3.7 Travel Report — Trip Endpoint Auto-Fill

When the active template is `Travel Report`, `_injectTripEndpointFields()` prepends two auto-filled fields to `#reportFields` before the form is shown:

- **Trip Start Point** — resolved asynchronously via Nominatim reverse geocode of the worker's GPS fix at trip start. The field displays `"Locating…"` while the lookup is in flight, then polls every 500 ms (up to 30 s) until `state.activeVisit.startAddress` is populated. Falls back to `"Address unavailable"` on timeout.
- **Trip Destination** — composed from the selected site's name and address (`locationName — locationAddress`). Falls back to name-only if the address field is blank.

Both fields use `data-key` attributes and are collected by `submitReport()` alongside all other form answers. Workers can edit either field before submitting if the auto-filled value is incorrect.

### 3.8 Back-Navigation Trap

To prevent workers from accidentally leaving the app mid-visit by pressing the Android back button, `window._armBackTrap()` pushes an `{ otgTrap: true }` history entry as a sentinel. The `popstate` handler re-pushes the sentinel and shows a toast warning if `state.activeVisit` is set. The trap is armed at visit start (`startVisit()`) and on page reload when an active visit is detected (`_initApp()`).

### 3.9 Form Builder Syntax

The app dynamically builds forms based on column headers in the `Templates` sheet using a prefix parser.

**Structure**
- `# Header Name` or `[HEADING] Name` → Large section heading.
- `[NOTE] Text` → Read-only instruction text (not an input).

**Standard inputs**
- Plain text header → Single-line text input.
- `% Question` → Multi-line text area.
- `[DATE] Label` → Date picker.

**Choices**
- `[YESNO] Label` → Yes/No radio buttons.
- `[CHECK] Label` → Simple checkbox.

**Smart inputs**
- `$ Label` or `[NUMBER] Label` → Number input (automatically summed in monthly reports).
- `[PHOTO] Label` → Camera/upload button.
- `[GPS] Label` → Button to capture current coordinates.
- `[SIGN] Label` → Touchscreen signature pad.

**Form timing** is controlled by column AI of the Templates sheet. It determines whether the form is presented at visit start, visit end, or both.

### 3.10 Visit History

Workers can view a log of their recent visits from the app's history screen. `populateVisitHistory()` reads the IndexedDB outbox for `ARRIVED` and `TRAVELLING` records, caps results at 30 entries, and groups them by NZ-locale calendar date.

### 3.11 what3words (Panic Screen)

When `CONFIG.w3wApiKey` is set, `fetchW3wForPanic()` fires on panic activation and on overdue alarm expiry. It fetches the what3words address for `lastGPS` (falling back to `startGPS`) and displays it in emerald green in the `#w3wDisplay` element on the locked alarm screen. This gives emergency contacts a precise three-word location they can relay to response teams. The display is cleared and hidden when `iamSafe()` resets the UI.

### 3.12 Volume Button Panic (Android Only)

Workers can trigger a panic alarm using the hardware volume buttons — useful when operating the touchscreen discreetly is not possible.

**Flow:**
1. Five presses of either volume button within 3 seconds → full-screen confirmation modal (`shakeConfirmModal`) appears.
2. Three more presses within 5 seconds → PANIC alarm fires (same path as the SOS button).

**Key names:** The feature requires Chrome 66+ / W3C key names `'AudioVolumeUp'` / `'AudioVolumeDown'`. The legacy names `'VolumeUp'` / `'VolumeDown'` are kept as a fallback. `keyCode` fallbacks (174/175) have been removed — they were Windows/IE values that Android Chrome never used.

**MediaSession requirement:** Android Chrome only routes hardware volume key events to the page when an active `MediaSession` is registered. `_registerMediaSession()` is called from `initVolumeDetection()` at app start, and re-asserted inside `initAudio()` after `Tone.start()` succeeds (the most reliable moment to claim audio focus on Android). Without a MediaSession, volume button presses are consumed by the OS volume control and never reach the page.

This feature is Android-only and has no effect on iOS.

---

## 4. Monitor App Specification

### 4.1 Communication Protocol (JSONP)

Because Google Apps Script Web Apps do not support CORS for GET requests from third-party domains, the Monitor App uses **JSONP (JSON with Padding)**.

- **Request:** `<script src="SCRIPT_URL?callback=cb_12345">`
- **Response:** The Google Script returns `cb_12345({ ...json_data... })`, which executes immediately as JavaScript in the browser, bypassing CORS restrictions.
- **Timeout:** 25 seconds per JSONP request.

### 4.2 Connection Watchdog

Safety dashboards are dangerous if they freeze without the user knowing.

- **Logic:** The app records the timestamp of the last successful JSONP packet (`lastHeartbeat`).
- **Check:** A local timer runs every 10 seconds.
- **Trigger:** If `Date.now() − lastHeartbeat > 300,000 ms` (5 minutes), a "Connection Lost" overlay covers the screen and an audio warning plays.
- **Important:** Connection failures **never** lock the monitor out. `stopPollingAndLock()` is only reachable via the Sign Out button. Automatic session lockout has been deliberately removed — a supervisor losing connectivity should see an overlay, not lose their session.

### 4.3 Intelligent Sorting

The dashboard grid sorts by urgency score rather than alphabetically:

1. **Score 2000+:** Duress/Panic (always top).
2. **Score 1000+:** Emergency/Overdue Alarm.
3. **Score 500+:** Warning state (overdue but within grace period).
4. **Score 100:** Active/Travelling.
5. **Score 0:** Departed/Safe (filtered out by default).

### 4.4 Geocoding Fallback

When an `ARRIVED` worker's last known GPS is absent or invalid (i.e., `0,0` or `0.0,0.0`), the monitor attempts to resolve their address using the Nominatim reverse geocoding API. Resolved addresses are displayed as amber teardrop-pin map markers. Results are cached in `geocodeCache` (a module-level `Map`) for the duration of the session. `TRAVELLING` workers are never geocoded via this path.

### 4.5 what3words (Worker Tiles)

When `W3W_API_KEY` is configured, each worker tile with a valid GPS fix displays a clickable what3words deep-link after the grid renders. Lookups are performed asynchronously and cached in `w3wCache` (keyed by GPS string) to avoid repeat API calls for the same fix across polling cycles.

### 4.6 Audio Arming

The browser's autoplay policy requires audio to be initialised within a user gesture. `toggleAudioInit()` is called from within the login button's click handler, before any `await`, to satisfy this requirement. This ensures alarm audio fires correctly without any additional user interaction after login.

---

## 5. Database Schema (Google Sheets)

### Tab 1: `Visits` (The Ledger)

The transactional database. One row per visit session (updated in-place while the visit is active).

- **Col A (Timestamp):** ISO 8601. System time of last update.
- **Col B (Date):** YYYY-MM-DD. Used for archiving and monthly reporting.
- **Col C (Worker Name):** The primary key for session matching.
- **Col K (Alarm Status):** The state variable.
  - *Active:* `ARRIVED`, `ON SITE`, `TRAVELLING`, `PRE_VISIT`, `ALARM_GPS_PULSE`
  - *Closed:* `DEPARTED`, `USER_SAFE`, `COMPLETED`, `DATA_ENTRY_ONLY`, `NOTICE_ACK`
  - *Alert:* `OVERDUE`, `OVERDUE ALARM`, `EMERGENCY`, `PANIC`, `DURESS`

  > `ALARM_GPS_PULSE` is a transient status posted every 2 minutes during any active alarm (`_startAlarmGpsPulse()`). It keeps the backend's Last Known GPS current while the worker is in an alarm state. The next worker heartbeat immediately supersedes it. It is excluded from the `CLOSED_VISIT_STATUSES` guard so that open-session matching is not broken during an alarm.
- **Col L (Pre-Visit Form Data):** JSON string of pre-visit questionnaire answers (travel visits).
- **Col O (Last Known GPS):** Format `lat,lng`. Parsed by the Monitor map.
- **Col T (Visit Report Data):** JSON string containing all form answers.
- **Col U (Anticipated Departure):** ISO 8601. Used by the escalation watchdog.

### Tab 2: `Staff`

The worker registry. Controls who can log in, what name appears in records, and where notifications are sent.

- **Col A (Name):** Worker's full name — used as the primary key across the system.
- **Col B (Role):** Display role.
- **Col C (Status):** Current status (maintained by `updateStaffStatus()` on every POST).
- **Col D (Group Membership):** Used for group-based site access control.
- **Col E (Device ID):** Registered device identifier.
- **Col F (Last Vehicle Check):** Date of last vehicle warrant check.
- **Col G (WoF Expiry):** Warrant of Fitness expiry date.
- **Col H (Emergency Ntfy Topic):** Written automatically by the system. Read by `triggerEscalation()` for server-side push notifications. Never stored in Visits rows.
- **Col I (Escalation Ntfy Topic):** As above, for escalation-level contacts.

### Tab 3: `Sites`

Controls the location drop-down in the Worker App. Each row is a deployable site.

- **Col A (Assigned To):** Access control. `ALL` = visible to every worker; a comma-separated list of names = visible only to those workers (case-insensitive match).
- **Col B (Template Name):** Links the site to a form layout in the `Templates` tab.
- **Col C (Company Name):** Organisation or client name.
- **Col D (Site Name):** Display name shown in the worker's location list.
- **Col E (Address):** Physical address.
- **Col F (Contact Name):** On-site contact.
- **Col G (Contact Phone):** On-site contact phone.
- **Col H (Contact Email):** On-site contact email.
- **Col I (Site Notes):** General notes visible to the worker before starting a visit.
- **Col J (Emergency Procedures):** Site-specific emergency procedures.
- **Col K (Risk Level):** Risk classification for this site.
- **Col L (Pre-Visit Form):** `TRUE` activates the pre-visit questionnaire for this site. The `_travel` sentinel row uses this column to flag travel visits.

> **Site ID prefixes:** Personal sites added by workers use the `loc_` prefix; organisation-configured sites use the `site_` prefix.

### Tab 4: `Templates` (Form Definitions)

Defines the questions presented at the start or end of a visit, or for pre-visit forms.

- **Col A (Type):** Template type.
- **Col B (Template Name):** Unique name, referenced by Sites col B.
- **Col C (Assigned To):** Access restriction (same syntax as Sites col A).
- **Col D (Email Recipient):** The specific address that receives the HTML visit report for this form type.
- **Cols E–AH (Questions 1–30):** Field definitions using the Form Builder Syntax (see Section 3.7).
- **Col AI (Form Timing):** Controls whether the form is presented at visit start, visit end, or both.

### Tab 5: `Reporting` (System Index)

- **Purpose:** Maintains a registry of client reporting sheets.
- **Generated by:** The `setupClientReporting()` admin function.
- **Structure:** `Client Name | Sheet ID | Last Updated`.

---

## 6. Business Intelligence Engine

The system includes a longitudinal reporting module to analyse trends over time.

### 6.1 Logic Flow (`runMonthlyStats`)

1. **Input:** Administrator selects a month (e.g. `2025-11`).
2. **Query:** The script fetches all rows from `Visits` where the timestamp falls within that month.
3. **Aggregation:** Groups visits by client (based on location name matching). Parses the Visit Report Data JSON column, identifies any `$` (numeric) fields, and sums their values (e.g. total mileage).
4. **Output:** Locates the specific `Stats - [ClientName]` sheet via the `Reporting` tab index and appends a summary row: `Month | Total Visits | Hours | Summed Metrics`.

---

## 7. Security & Privacy

### 7.1 Data Privacy

- **Legal source of truth:** The `Visits` sheet contains raw, unaltered text entered by the worker. This ensures evidentiary integrity for health and safety audits.
- **Presentation layer:** When generating email reports, the system sends notes to Google Gemini with a prompt to correct spelling and grammar. This polished text is used only in the email HTML — it is never written back to the database.

### 7.2 API Security

- **SMS providers:** Phone numbers are normalised to E.164 format (removing leading zeros, adding country prefix) before dispatch. The active provider is selected per-deployment in the Factory based on region: Twilio (NZ, UK, CA), Kudosity/Burst SMS (AU), Textbelt (US). The dispatcher is `_sendSms_(to, body)`. Credentials are validated by Run System Diagnostics without sending a live SMS.
- **Web App:** The Google Script accepts POST requests from "Anyone", but the first line of processing checks `if (e.parameter.key !== CONFIG.WORKER_KEY) return 403;`. This prevents unauthorised data injection.

---

## 8. Integration Reference

| Service | Purpose | Auth Method | Notes |
| :--- | :--- | :--- | :--- |
| **OpenRouteService** | Calculates driving distance for travel reports | API Key | Version-probed at runtime (`/v2/`, `/v3/`). Falls back to crow-flight + speed floor if unavailable. |
| **Google Gemini** | Proofreads worker notes and summarises reports | API Key | Non-destructive — sheet keeps raw data. Model selected dynamically via ListModels API. |
| **Twilio** | Sends SMS for emergency escalations (NZ, UK, CA) | API Key + Account SID | Recommended for NZ/UK/CA deployments. |
| **Kudosity (Burst SMS)** | Sends SMS for emergency escalations (AU) | API Key | Recommended for AU deployments. Credit balance checked by diagnostics. |
| **Textbelt** | Sends SMS for emergency escalations (US) | API Key | Free tier: 1 SMS/day/IP. NZ routing unreliable — not recommended for NZ deployments. |
| **ntfy** | Push notifications for emergency alerts | Topic URL | Supports self-hosted server for greater privacy. Topics stored in Staff sheet; written on every worker POST. |
| **Healthchecks.io** | Dead man's switch — pings after each watchdog run | Ping URL | Optional. Alerts you if the watchdog stops running (e.g. trigger misconfiguration). |
| **Nominatim** | Reverse geocoding for SMS bodies and monitor map | None (open) | Returns `"Road, Suburb"` for SMS; used as geocoding fallback for ARRIVED workers on monitor. OpenStreetMap data. |
| **what3words** | Precise three-word location addresses | API Key | Optional. Free for registered charities/NGOs (requires plan upgrade via what3words). Appears in emergency emails, monitor tiles, and worker panic screen. |
| **Leaflet.js** | Renders maps in the Monitor App | Open source | Uses OpenStreetMap tiles (free). |
