# OTG AppSuite: A "BYO" Safety System for Lean Organisations

I designed the **On-The-Go (OTG) AppSuite** to solve a specific problem: professional Lone Worker safety systems are often too expensive or complex for small charities and community organisations.

The OTG AppSuite is not a standard SaaS product. You don't sign up for an account, you don't pay a monthly subscription, and your data doesn't live on our servers. Instead, it is a **self-hosted system engine** that you deploy into your own Google Cloud environment.

Here is a realistic breakdown of what it does and who it is for.

---

## How It Works

The system is serverless. It uses **Google Sheets** as its database and **Google Apps Script** as its backend.

1. **The Worker App:** Staff install a web app (PWA) on their phones. It handles GPS tracking, check-in timers, and form reporting. It works offline and syncs when connection is restored.
2. **The Backend:** A script running in your Google Drive receives data, saves photos to your Drive folders, and acts as a watchdog. If a worker misses a check-in, the script triggers an escalation (email/SMS).
3. **The Dashboard:** Managers view a live status board on their office PC, showing active workers, battery levels, and locations.

## Key Capabilities

- **Tiered Escalation:** Sends progressive overdue alerts at 15, 30, and 45 minutes, followed by a full emergency email/SMS to managers if the worker remains unresponsive.
- **Zero Tolerance:** Workers entering high-risk situations can toggle a mode that skips overdue warnings and escalates to emergency immediately if the timer expires.
- **Business Intelligence:** It doesn't just log safety; it tracks work. The system generates monthly reports showing visit trends, total hours on-site, and aggregated numeric data (e.g., total mileage).
- **AI Integration:** Raw data is stored exactly as typed for legal accuracy, but email notifications use AI (Google Gemini) to polish hasty notes into professional English for management updates.

---

## The Litmus Test: Is This Right for You?

This solution is **not** a fit for everyone. Use this checklist to assess suitability.

### ✅ You are the ideal user if:

- **Budget is a primary constraint.** You are a charity, non-profit, or small business that cannot justify $20/user/month fees.
- **You value data sovereignty.** You want to own your data in your own Google Drive, not trust a third-party vendor.
- **You have "one tech-savvy person."** You don't need a developer, but you need someone comfortable copying and pasting code, generating API keys, and managing a Google Sheet.
- **Your fleet is small to medium.** The system works best for teams of 5 to ~50 active workers.

### ❌ This is likely NOT for you if:

- **You need an SLA.** Because you host it, you are the support team. There is no 24/7 helpdesk to call if you break your spreadsheet.
- **You need enterprise integration.** It does not plug into Active Directory, SAP, or complex HR systems out of the box.
- **You have 500+ staff.** Google Sheets has processing limits (quotas) that very large organisations might hit.

### ⚠️ Key safety limitations to understand before deploying:

- **No direct link to emergency services.** When an alarm fires, the system notifies your nominated contacts only. Those contacts must make the judgement call about whether to dial 111. There is no automatic escalation to police, ambulance, or a monitored response centre.
- **The Monitor dashboard requires active supervision.** The audio alarm and full-screen alert only trigger if a supervisor has the Monitor tab open in a browser. If the tab is closed or the computer is locked, the alert is silent on that screen. Ensure your organisation has a clear plan for who monitors the dashboard and when.
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

The OTG AppSuite is a **"build your own"** professional safety platform. It trades the convenience of a sign-up button for the power of **ownership, customisation, and zero running costs**. If you are willing to spend 20 minutes setting it up, you get a safety system that rivals commercial alternatives for free.

---
---

# OTG AppSuite — Technical Reference

**Version:** v82 (build-stamped at Factory output time)  
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

The Worker App HTML (`index.html` in the deployment pack) is a **shared, canonical file** that is identical across all deployments. No org-specific data is injected into it at build time. All organisation-specific configuration — org name, backend URL, API keys, theming, and timers — lives solely in `config.json`, which is bundled separately by the Factory and fetched by the app at runtime. Worker identity is established during the in-app setup wizard on first run.

### 1.3 Data Topology (The "Thick Client" Model)

Logic is pushed to the client to minimise server costs and latency:

- **Worker App:** Handles GPS tracking, form validation, countdown timers, and the offline outbox locally.
- **Monitor App:** Handles sorting, filtering, and alert rendering locally.
- **Backend:** Acts primarily as a RESTful API endpoint and database interface, only performing heavy lifting for reporting and escalation.

---

## 2. Backend Logic Specification (`Code.gs`)

The backend is hosted on Google Apps Script, exposing a Web App URL (`/exec`).

### 2.1 Concurrency & Locking

Google Sheets is not a transactional database. To prevent race conditions (two workers writing simultaneously causing data overwrites), the system uses `LockService`.

- **Mechanism:** `LockService.getScriptLock()`
- **Timeout:** 10,000 ms (10 seconds).
- **Behaviour:** If the lock cannot be acquired within 10 s, the backend returns a `Server Busy` JSON error. The Worker App detects this and keeps the payload in its IndexedDB retry queue.

### 2.2 The "Smart Ledger" Algorithm (`handleWorkerPost`)

The system does not simply append every request as a new row. It attempts to maintain a coherent session for each visit.

**Logic flow:**
1. **Receive payload:** Worker sends Worker Name and Alarm Status.
2. **Scan context:** The script reads the last 50 rows of the `Visits` sheet.
3. **Match session:** It looks for a row where Column C (Worker Name) matches the incoming payload and Column K (Alarm Status) is **not** a closed state (`DEPARTED`, `USER_SAFE`, `COMPLETED`, `DATA_ENTRY_ONLY`, `NOTICE_ACK`).
4. **Decision:**
   - **Match found:** The script **updates** the existing row (timestamp, battery, GPS, notes). This prevents row spam during long visits with multiple updates.
   - **No match:** The script **appends** a new row to the bottom of the sheet.

### 2.3 Tiered Escalation Watchdog (`checkOverdueVisits`)

This function must be triggered by a time-driven trigger (recommended frequency: 10 minutes).

**State machine:**
- **Input:** Iterates through all active rows in `Visits`.
- **Calculation:** `Diff = Current_Time − Anticipated_Departure_Time`.
- **Zero Tolerance check:** If the notes field contains `[ZERO_TOLERANCE]`, escalation jumps directly to emergency at the 0-minute mark, bypassing all overdue tiers.

**Trigger levels:**
1. **OVERDUE — 15 min:** Sends an overdue notification email.
2. **OVERDUE — 30 min:** Sends a follow-up overdue notification.
3. **OVERDUE — 45 min:** Sends a final overdue notification.
4. **EMERGENCY — 60 min breach:** Triggers full emergency email + SMS via TextBelt + ntfy push notification.

### 2.4 Photo Handling & Sub-folders

The system prevents the root "Safety Photos" folder from becoming disorganised.

1. **Decode:** Accepts a Base64 string from the payload.
2. **Locate/create:** Checks if a sub-folder matching the worker name exists inside `PHOTOS_FOLDER_ID`. If not, creates it.
3. **Naming convention:** Saves file as `YYYY-MM-DD_HH-mm_WorkerName_[Type].jpg` to ensure sortability.
4. **Return:** Returns the `drive.google.com/open?id=...` URL to be written to the spreadsheet.

---

## 3. Worker App Specification (PWA)

### 3.1 Service Worker & Offline Capability

- **File:** `sw.js` (generated by Factory; identical across all deployments).
- **Strategy:** Cache-first for app assets; network-first for `config.json`.
- **Behaviour:** On first load, the service worker pre-caches `index.html`, `manifest.json`, the icon, and CDN assets. Subsequent loads (even in Airplane Mode) serve these files from the Cache Storage API. Cache invalidation is driven by incrementing the `version` field in `config.json` — no app rebuild is needed.
- **Outbox queue:** When offline, POST requests are stored in an **IndexedDB outbox** with idempotency keys. A processing loop monitors connectivity and flushes the queue when online.

### 3.2 GPS & Battery Watchdogs

- **GPS:** Uses `navigator.geolocation.watchPosition` with `enableHighAccuracy: true`.
  - Accuracy < 20 m: 3 green bars (safe).
  - Accuracy < 50 m: 2 amber bars (caution).
  - Accuracy > 50 m: 1 red bar (unsafe/indoors).
- **Battery:** Uses `navigator.getBattery()` with a `levelchange` event listener. Battery level is appended to every heartbeat sent to the server.

### 3.3 Form Builder Syntax

The app dynamically builds forms based on headers in the `Templates` sheet using a prefix parser.

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

---

## 4. Monitor App Specification

### 4.1 Communication Protocol (JSONP)

Because Google Apps Script Web Apps do not support CORS for GET requests from third-party domains, the Monitor App uses **JSONP (JSON with Padding)**.

- **Request:** `<script src="SCRIPT_URL?callback=cb_12345">`
- **Response:** The Google Script returns `cb_12345({ ...json_data... })`, which executes immediately as JavaScript in the browser, bypassing CORS restrictions.

### 4.2 "Sound of Silence" Watchdog

Safety dashboards are dangerous if they freeze without the user knowing.

- **Logic:** The app records the timestamp of the last successful JSONP packet (`lastHeartbeat`).
- **Check:** A local timer runs every 10 seconds.
- **Trigger:** If `Date.now() − lastHeartbeat > 300,000 ms` (5 minutes), a "Connection Lost" overlay covers the screen and an audio warning plays.

### 4.3 Intelligent Sorting

The dashboard grid sorts by urgency score rather than alphabetically:

1. **Score 2000+:** Duress/Panic (always top).
2. **Score 1000+:** Emergency/overdue.
3. **Score 500+:** Warning state (overdue but within grace period).
4. **Score 100:** Active/travelling.
5. **Score 0:** Departed/safe (filtered out by default).

---

## 5. Database Schema (Google Sheets)

### Tab 1: `Visits` (The Ledger)

The transactional database.

- **Col A (Timestamp):** ISO 8601. System time of entry.
- **Col B (Date):** YYYY-MM-DD. Used for archiving/partitioning.
- **Col C (Worker Name):** The primary key for session matching.
- **Col K (Alarm Status):** The state variable.
  - Active: `ARRIVED`, `ON SITE`, `TRAVELLING`
  - Closed: `DEPARTED`, `USER_SAFE`, `COMPLETED`, `DATA_ENTRY_ONLY`, `NOTICE_ACK`
  - Alert: `OVERDUE`, `EMERGENCY`, `PANIC`, `DURESS`
- **Col O (Last Known GPS):** Format `lat,lon`. Parsed by Monitor map.
- **Col T (Visit Report Data):** A JSON string containing all form answers.
- **Col U (Anticipated Departure):** ISO 8601. Used by the escalation watchdog.

### Tab 2: `Staff`

The worker registry. Controls who can log in and what name appears in records.

### Tab 3: `Sites`

Controls the drop-down location list in the Worker App.

- **Col A (Assigned To):** Access control list.
  - `ALL`: Visible to everyone.
  - `John Doe, Jane Smith`: Visible only to exact matches (case-insensitive).
- **Col B (Template Name):** Links the site to a specific form layout in the `Templates` tab.

### Tab 4: `Templates` (Form Definitions)

Defines the questions asked at start/end of visit.

- **Col D (Email Recipient):** The specific address that receives the HTML report for this form type.
- **Col E onwards:** The question/field definitions (see Form Builder Syntax above).

### Tab 5: `Reporting` (System Index)

Maintains a registry of client reporting sheets.

- **Generated by:** The `setupClientReporting()` admin function.
- **Structure:** `Client Name | Sheet ID | Last Updated`.

---

## 6. Business Intelligence (BI) Engine

The system includes a longitudinal reporting module to analyse trends over time.

### 6.1 Logic Flow (`runMonthlyStats`)

1. **Input:** Administrator inputs a month (e.g., `2025-11`).
2. **Query:** The script fetches all rows from `Visits` where the timestamp falls within that month.
3. **Aggregation:** Groups visits by client (based on location name matching). Parses the Visit Report Data JSON column, identifies any `$` (numeric) fields, and sums their values (e.g., total mileage).
4. **Output:** Locates the specific `Stats - [ClientName]` sheet via the `Reporting` tab index and appends a summary row: `Month | Total Visits | Hours | Summed Metrics`.

---

## 7. Security & Privacy

### 7.1 Data Privacy

- **Legal source of truth:** The `Visits` sheet contains raw, unaltered text entered by the worker. This ensures evidentiary integrity for health & safety audits.
- **Presentation layer:** When generating email reports, the system sends the notes to Google Gemini with a prompt to correct spelling and grammar. This polished text is used only in the email HTML — it is never saved back to the database.

### 7.2 API Security

- **TextBelt:** The backend normalises all phone numbers to E.164 format (removing leading zeros, adding country prefix) and sends the payload as `application/json`.
- **Web App:** The Google Script accepts POST requests from "Anyone", but the first line of processing checks `if (e.parameter.key !== CONFIG.WORKER_KEY) return 403;`. This prevents unauthorised data injection.

---

## 8. Integration Reference

| Service | Purpose | Auth Method | Notes |
| :--- | :--- | :--- | :--- |
| **OpenRouteService** | Calculates driving distance for travel reports | API Key | Falls back to crow-flies distance if key is invalid |
| **Google Gemini** | Proofreads worker notes and summarises reports | API Key | Non-destructive — sheet keeps raw data |
| **TextBelt** | Sends SMS for emergency escalations | API Key | Free tier: 1 SMS/day/IP |
| **ntfy** | Push notifications for emergency alerts | Topic URL | Supports self-hosted server for higher privacy |
| **Healthchecks.io** | Dead man's switch — pings after each watchdog run | Ping URL | Optional; alerts you if the watchdog stops running |
| **Leaflet.js** | Renders maps in the Monitor App | Open source | Uses OpenStreetMap tiles (free) |
