**OTG AppSuite**
 
Lone Worker Safety Platform
 
**Technical Architecture and Security Overview — For IT Advisors**
 
This document is intended for IT professionals evaluating the OTG AppSuite on behalf of an organisation considering its adoption. It covers the system architecture, hosting model, data flows, security controls, browser and device requirements, known limitations, and relevant considerations for compliance and privacy.
 
# **1. System Architecture Overview**
 
The OTG AppSuite consists of four components. Three are runtime components used in day-to-day operation; one is an administrative tool used only during deployment.
 
| **Worker App (PWA — Android/iOS)** | ⟷ | **Backend (Google Apps Script + Sheets)** |  |
| --- | --- | --- | --- |
| **Monitor App (Browser dashboard)** | → | **Same Backend (read-only endpoint)** |  |
| **App Factory (deploy-time only)** |  | *No runtime role — generates deployment bundles only* |  |
 
## **1.1 Worker App**
 
The Worker App is a Progressive Web Application (PWA). It is a single HTML file containing all application logic and styles, plus a service worker that enables offline operation. There is no native app store involved; workers receive their app as a file and install it by opening it in a browser and adding it to their home screen.
 
The App Factory generates a deployment ZIP for each worker containing the canonical Worker App HTML file and a worker-specific configuration file (config.json). The configuration file contains the worker’s name, their API key (prefixed wk_), the backend endpoint URL, and the organisation’s settings. The Worker App HTML itself is a shared, unmodified file — only the configuration differs between workers. On first open, the worker completes a short setup wizard that establishes their local identity and device registration.
 
Persistent data — including the offline upload outbox, visit state, and site/template data — is stored in IndexedDB and localStorage. The outbox uses IndexedDB with idempotency keys to ensure that queued uploads are retried without duplication after a connectivity gap.
 
## **1.2 Backend**
 
The backend is a Google Apps Script (GAS) web application deployed as a Web App under the organisation’s Google Workspace account. It uses a Google Spreadsheet as its data store. The spreadsheet contains the following tabs:
 
- **Staff:** Worker names, phone numbers, emergency and escalation contacts (including ntfy push notification topics), group membership, registered device IDs, and vehicle compliance dates.
- **Visits:** All visit and travel records, alarm status history, GPS coordinates, report data, and pre-visit form submissions.
- **Sites:** Authorised site locations with address, contact, emergency procedure data, risk level, and pre-visit form flag.
- **Templates:** Form templates defining the questions, field types, timing (pre-visit or post-visit), and audience for each report form.
- **Notices:** Broadcast notices with priority, content, audience, and status.
- **Resources:** Safety documents and reference materials assigned to workers or groups.
- **Archive:** Visits older than the configured retention period (default 30 days) are moved here automatically.
 
- **Settings:** Created and maintained by the backend (see Section 3.8). Holds the switchable behaviour: welfare checks, worker phone reminders and their daily cap, the Audit retention limits, and the optional worker app address.
- **Forms:** One row for each submitted form (pre-visit, closing report, Note to Self), with a Visit ID linking it to its visit. Old rows move to FormsArchive.
- **Procedures History:** Visible, append-only. Before a site's safety information is replaced, the old links are written here (Section 3.9). Nothing is deleted from Drive.
- **Audit:** Hidden debugging trail written by the backend (Section 3.10). It is not a record of events; Visits and Forms are the permanent records.

Display and bookkeeping columns on the Visits sheet: column A is the machine timestamp (UTC), the one to sort and filter on; column B is the local start date and time held as text; AC is a display-only local "Last Update"; Z holds worker-reminder memory; AA and AB hold the escalation memory and the Visit ID; AD and AE hold the welfare check time and its memory; AF holds the server time the phone was last heard from. The Forms sheet has a display-only "Received (local)" column and the Audit has "Time (local)". The Staff sheet's column J "Worker Alert Topic" is made by the backend; clearing the cell resets a topic that has leaked. Phone numbers in Visits are stored as text so a leading zero is never lost. Photos attached to a Note to Self are emailed but not stored in Drive.
The GAS web app exposes a single HTTPS endpoint for all operations. There is no separate hosting infrastructure; it runs entirely on Google’s servers under the organisation’s Workspace account.
 
A set of time-driven triggers runs continuously in the background: an overdue-visit watchdog (checks all active visits and fires escalation alerts), an archiver (moves old records), and a weekly health-report emailer. A Healthchecks.io dead-man’s switch integration monitors the watchdog trigger — if it stops firing for any reason, an external alert is raised.
 
## **1.3 Monitor App**
 
The Monitor App is a browser-based dashboard, also a single HTML file, that polls the backend on a configurable short interval (default 25-second JSONP timeout) to retrieve active worker data. It uses a separate master-level API key to access a read-only aggregation endpoint. It can be run from any device with a browser and does not require installation.
 
The Monitor emits an audible alarm and full-screen overlay when a worker becomes overdue or triggers an alarm. This is contingent on someone actively having the Monitor open in a browser tab — there is no background notification service on the monitor side. The Monitor never auto-locks due to connection failures; only an explicit sign-out ends a monitoring session.
 
Where a worker’s GPS fix is unavailable or invalid, the Monitor falls back to Nominatim reverse geocoding based on the worker’s registered address to place an approximate map marker. Geocode results are cached for the duration of the browser session.
 
The Monitor shows each active visit as a card with the time the phone was last heard from (the server's own clock is used to measure ages, so a supervisor's wrong computer clock cannot make a worker look late), a **Current Status per Visit** panel (one line per visit, not a history; finished visits such as DEPARTED or COMPLETED are never shown as overdue) and a CSV export of that panel. Times are written in 12-hour form (for example 5:34 pm).

**Map tiles.** The Monitor draws its map with Leaflet. By default it uses OpenStreetMap tiles, which need no account or key. An organisation can optionally enter a free **CARTO key** in the App Factory; the Monitor then uses the CARTO Voyager style, and falls back to OpenStreetMap by itself if the key is rejected or tiles keep failing. Tile requests come from the supervisor's browser and carry the map area being viewed and the browser's IP address, not worker names. Both providers' usage policies apply (OpenStreetMap's tile policy expects light, interactive use, which a supervisor dashboard is; attribution is displayed on the map). Without a CARTO key nothing needs to be requested or paid for.

**Resolving an alarm.** When a supervisor resolves an alarm in the Monitor they must say whether the worker **has left** (the visit is closed) or is **still on site** with a new due time of 10, 30 or 60 minutes (the visit stays open and a fresh escalation runs from the new due time). The Monitor turns "still on site" off by itself if the backend is older than the build that supports it. Each new escalation step needs a fresh acknowledgement on the Monitor, and a missed welfare check is a full alarm.
 
## **1.4 App Factory**
 
The App Factory is a standalone HTML file used by administrators to generate worker deployment bundles. It has no backend role and makes no network calls during normal operation. It reads template files, combines them with worker-specific configuration, and produces a downloadable ZIP containing the Worker App HTML, a config.json, and a service worker manifest. It is used only at deployment time and when onboarding new workers.
 
# **2. Authentication and Security Controls**
 
## **2.1 API Key Architecture**
 
The system uses two classes of API key, both stored in configuration rather than being user-visible:
 
| **Key Type** | **Scope and Use** |
| --- | --- |
| **Worker Key** | Unique per worker (format: wk_xxxxx). Grants access to the sync endpoint for that worker’s data only. Cannot access other workers’ records or the monitor endpoint. Stored in the worker’s config.json. |
| **Master Key** | Single key for the organisation. Required for the Monitor App and administrative backend operations. Should be treated as a secret credential and not distributed to workers. |
 
| **Security model note:**** **The worker key is stored in config.json within the worker’s app bundle. Anyone with access to the bundle files can extract it. The security model relies on device binding (see 2.2) to prevent key reuse on another device, not on the key being secret from the holder. |
| --- |
 
## **2.2 Device Binding**
 
Each Worker App registers a device identity on first use. The device ID is a stable pseudorandom identifier derived from browser properties (not a hardware identifier, as those are not accessible from a web app). This ID is written to the Staff sheet during the setup wizard.
 
Every subsequent request to the backend includes the device ID. The backend validates it against the registered ID for that worker. If they do not match, all data requests are denied — the worker sees an ‘Authorised Device’ error. This prevents a copied or forwarded app bundle from being used on a different device. The binding can only be cleared by an administrator editing the Staff sheet directly.
 
| **Limitation:**** **Because the device ID is derived from browser properties rather than hardware, it may change if the worker clears all browser data, reinstalls the operating system, or switches browsers. The fix is straightforward — an admin clears the registered ID in the Staff sheet. Organisations with very high security requirements may prefer a native app solution with hardware-level device binding. |
| --- |
 
## **2.3 Transport Security**
 
All communication between the Worker App and the backend uses HTTPS. The Apps Script endpoint is served under Google’s TLS infrastructure. Google enforces HTTPS on all Apps Script web app URLs — plain HTTP is not possible.
 
## **2.4 Input Validation and Injection Prevention**
 
Worker names submitted to the backend are sanitised before use in spreadsheet operations. The backend checks that names consist only of printable characters and strips anything that could be interpreted as a spreadsheet formula (strings beginning with =, +, -, or @). GPS coordinate fields are validated as numeric pairs before insertion. Form data is stored as plain text values — not evaluated — by the Google Sheets API.
 
## **2.5 PII Redaction**
 
An optional PII redaction feature can be enabled in the backend configuration. When active, worker-submitted notes are scanned for email addresses and phone numbers matching local number patterns before any AI processing occurs. Detected values are replaced with [EMAIL_REDACTED] or [PHONE_REDACTED] tokens before the data leaves the system.
 
## **2.6 Google Account and OAuth Scopes**
 
The backend runs as the Google account that deploys it (the Web App executes as the deploying user). The Factory generates an `appsscript.json` manifest that declares these OAuth scopes: Sheets, Drive, `script.send_mail`, `gmail.send`, `script.external_request`, `script.scriptapp`, `userinfo.email`, and the full Gmail scope `https://mail.google.com/`.
 
The full Gmail scope is needed for one function only: the Privacy Shredder (`cleanupPrivateSentNotes`), which searches the Sent folder for private note-to-self emails and moves them to the trash. Google’s consent screen describes this scope as the ability to read, compose, send and permanently delete all email in the account. The code only acts on threads whose subject is “[PRIVATE] Note to Self”, but the permission is broader than the code.
 
| **Requirement:**** **Run the AppSuite on a dedicated Google account that is used for nothing else. With a dedicated account, the full Gmail scope can only reach system mail (alert and report emails). Do not deploy on a personal mailbox or a shared day-to-day work mailbox. Installations created before this scope was added must add it to their manifest by hand and re-authorise; until they do, the Privacy Shredder fails and the daily Health email flags it. |
| --- |
 
## **2.7 Duress System**
 
Workers configure a secondary duress PIN during setup. This PIN is stored locally within the app’s state (in localStorage) and is never transmitted to the backend. When a worker is in alarm state, tapping any button on the screen triggers a PIN interceptor. Entering the standard PIN clears the alarm normally. Entering the duress PIN sends a silent DURESS alert to the backend while showing only a brief acknowledgement on screen. The alarm overlay changes from amber to purple to indicate duress state internally, but the app continues to operate normally — the interceptor remains armed. This mechanism is entirely client-side; the minimal visual feedback is designed not to alert an aggressor.
 
# **3. Data Flows**
 
## **3.1 Worker to Backend (Outbound)**
 
The Worker App communicates with the backend via HTTPS POST requests. Posts are queued in an IndexedDB outbox with idempotency keys and retried automatically when connectivity is restored. The following actions each generate a POST:
 
- **Visit Start (ARRIVED / TRAVELLING):** Worker name, location, GPS coordinates, anticipated departure time, alarm status, battery level, emergency contact details, and — for travel visits — a pre-visit form flag.
- **Pre-Visit Phase (PRE_VISIT):** Posted when a visit starts in pre-visit form mode, before the main timer begins. Transitions to ARRIVED once the pre-visit form is submitted.
- **Visit End (DEPARTED / COMPLETED):** Same fields plus end GPS, distance travelled, report form data, photo attachments (base64-encoded JPEG), and digital signature (base64-encoded PNG).
- **Alarm Events (PANIC / DURESS / OVERDUE ALARM):** Worker identity, GPS, timestamp, alarm type. The backend immediately sends email, SMS, and push notifications on receipt of these statuses.
- **Alarm GPS Pulse (ALARM_GPS_PULSE):** Posted every two minutes during an active alarm to provide continuous location updates to the backend without requiring a status change event.
- **Arrived GPS Pulse:** Posted every five minutes while a worker is in ARRIVED status and overdue, to maintain location currency.
- **Welfare Check-In:** A single-field POST confirming the worker responded to a welfare check prompt.
- **Notice Acknowledgement:** Worker identity, notice ID, timestamp.
- **Device Registration:** Worker name, device ID.
Photo and signature data are stored to Google Drive via the backend. The backend creates a folder per worker within a configured Drive folder and saves each image with a timestamped filename.
 
## **3.2 Backend to Worker (Sync)**
 
The Worker App requests a sync on startup and after each successful upload. The sync response delivers: authorised site list (filtered by worker/group membership), form templates assigned to the worker (including pre-visit form flag and timing), active notices, notice history, resource library, worker metadata (vehicle WOF expiry, last vehicle check date), what3words API key (if configured), and backend version string. Data received during sync is stored in localStorage and IndexedDB, and the app functions fully offline using this cached data between syncs.
 
## **3.3 Alert Notifications**
 
Alarm events trigger three outbound notification channels from the backend:
 
- **Email:** Sent via the Google Workspace account’s MailApp service to the worker’s emergency contact and escalation contact simultaneously. Emails include worker identity, location, GPS coordinates, a Google Maps link, what3words address (if configured), alarm type, timestamp, and any inline photos.
- **SMS:** Sent via the configured SMS provider to both emergency and escalation contacts. The provider varies by deployment region: Twilio (NZ, UK, CA), Kudosity/Burst SMS (AU), or Textbelt (US). The SMS body uses a Nominatim reverse-geocoded street address where available, falling back to raw GPS coordinates. SMS delivery is subject to the provider’s service availability and carrier routing.
- **Push Notification (ntfy):** If emergency or escalation contacts have an ntfy topic configured in the Staff sheet, a push notification is sent to that topic via the ntfy.sh API. ntfy delivers to the nominated contact’s mobile device via the ntfy app. This channel operates independently of email and SMS and provides an additional fallback if other channels are delayed.
| **⚠️ Important: Alert Destination** Alerts are sent to the organisation’s nominated emergency contacts — not to emergency services. There is no automatic escalation to police, ambulance, or any 24/7 monitoring service. The nominated contact receives the alert and must decide what action to take, including whether to call emergency services. Organisations should ensure that this notification model is appropriate for their risk profile before deployment. **Connectivity dependency:**** **Alarm notifications require an active internet connection on the worker’s device at the time the alarm fires. If the device is offline, the alarm event is queued locally and will be sent when connectivity is restored. There is no real-time offline alerting mechanism. |
| --- |
 
## **3.4 AI Processing**
 
When AI-assisted report writing is enabled, visit report data is transmitted to the Google Gemini API as part of the backend’s post-processing step. The payload includes the raw form field data and any worker notes from the completed form. No worker identity, GPS, or personal contact data is included in this request. The system dynamically selects the most capable available Gemini model from the account’s accessible model list at runtime — no model name is hardcoded. The Gemini API key is stored in the GAS script configuration. Organisations with strict data residency requirements should evaluate whether sending report content to Google’s AI API is compatible with their policies before enabling this feature.
 
## **3.5 Visit Lifecycle State Machine**
 
The worker app manages each visit through a formal state machine. Legal states and transitions are:
 
| **Status / Phase** | **Meaning** |
| --- | --- |
| **PRE_VISIT** | Visit started; worker is completing a mandatory pre-visit form. Timer has not yet started. Backend holds a placeholder row. |
| **ARRIVED** | Worker is on site. Countdown timer active. Overdue checking applies. |
| **TRAVELLING** | Worker is in travel mode. Distance accumulation and travel-specific GPS pulse active. |
| **OVERDUE** | Departure time has passed. Grace period countdown active. Overdue alert sent. |
| **OVERDUE ALARM** | Grace period expired without worker response. Full alarm triggered. Escalation contacts notified. |
| **EMERGENCY** | Critical Timing (High-Risk mode) escalation at timer expiry, or 60-minute standard breach. Full alarm triggered. Both emergency and escalation contacts notified. |
| **DEPARTED / COMPLETED** | Visit ended normally. Report submitted. |
| **PANIC / DURESS** | Emergency event triggered directly by worker. Alarm active. Continuous GPS pulse running. |
 
High-risk visits (those where the site’s Risk Level is set to High) are flagged in the Visits sheet with a [CRITICAL_TIMING] marker. The backend watchdog applies a shorter check interval to these rows.
 
## **3.6 Alert Content and Priority**

Contact alerts say how long the worker is overdue and when they were due, counted from the due time: for example `OVERDUE 15 MIN - Name`, `EMERGENCY - N MIN OVERDUE` for the final automatic alert, `CRITICAL TIMING - ...` with `SECOND ALERT` and `FINAL NOTICE` for Critical Timing visits, and `WELFARE CHECK NOT ANSWERED (3:15 pm) - Name`. Overdue alerts are sent to ntfy at the highest priority (`urgent`), so contacts should allow the ntfy app to override Do Not Disturb. Alerts include a tap-to-call button for the worker's number and a map or site-map button; these use the ntfy `Click` and `Actions` headers, which the proxy in Section 6.5 must forward. A DURESS alert deliberately has no tap-to-call button and tells the contact to listen for a code phrase agreed in advance (the system has no setting for the phrase). After a PIN clear the overdue count restarts from the new due time, and the All Clear goes only to the contacts who were actually alerted. SMS bodies use plain hyphens and no emoji.

## **3.7 Worker Phone Reminders and What the Phone Reports**

The worker may opt in to reminders on their own phone through the same free ntfy app (Settings, Phone alerts). The backend makes an unguessable topic for the worker (Staff column J) on request; it is never sent to the Monitor. Reminders are a courtesy and never replace contact alerts, and they are never sent while an alarm is active (checked when the decision is made and again at the moment of sending). A reminder goes only if the server has not heard from the phone recently: "ends in 5 min" for Critical Timing visits and trips, "check in now - your contact will be alerted in 3 min" for standard visits and trips, and the welfare prompt when welfare checks are on. A daily cap applies (default 100, counting tests). A healthy app therefore sends none.

What the phone reports is deliberately small: a standard visit sends nothing between start and end until the due time passes, then its position at the due time and every 5 minutes; a trip reports its position every 2 minutes; a Critical Timing site visit sends a position-free "still here" signal every 2 minutes for the last 15 minutes only. A locked phone stops reporting, and that silence is what triggers a reminder. The server keeps only the time it last heard from the phone for each visit (Visits column AF), not a log of every contact.

## **3.8 The Settings Tab**

The backend creates a **Settings** sheet and adds any missing keys within the hour (existing values and notes are never changed; a deleted key returns with its default). Values take effect at the next sync. Accepted on/off values are On/Off, yes/no, 1/0 or a checkbox; unreadable values are named in the daily Health email.

| **Key** | **Default** | **Range / meaning** |
| --- | --- | --- |
| `WELFARE_CHECKS` | Off | Server-backed welfare check-ins (Section 3.11). |
| `WELFARE_DEFAULT_MINS` | 60 | Default interval, 5 to 240. |
| `WELFARE_GRACE_MINS` | 2 | Time the worker has to answer, 1 to 10. |
| `WORKER_WARNINGS` | On | Phone reminders to workers. |
| `WORKER_WARNING_DAILY_CAP` | 100 | 0 to 5,000. Contact alarms are never capped. |
| `WORKER_WARN_QUIET_W1_MINS` / `W2_MINS` | 3 / 6 | Silence needed before a reminder, 0 to 30 (0 = always send). |
| `WORKER_APP_URL` | blank | Optional. Leave blank unless tested on the workers' phones; if used, the full address including `index.html`. Some phones open a browser copy instead of the installed app. |
| `AUDIT_KEEP_DAYS` | 7 | 1 to 90. |
| `AUDIT_MAX_ROWS` | 10,000 | 1,000 to 50,000. |

Capacity note: worker reminders use the hosted ntfy.sh service by default, which has an undisclosed anonymous daily limit; the cap exists to stay well inside it. An organisation with many workers should use a paid plan or a self-hosted server (Section 6.4).

## **3.9 Site Safety Information**

A worker can upload site-safety photos from a site's info panel. The upload replaces the Emergency Procedures cell (Sites column J) on every Sites row of that site, after the old links are written to the visible **Procedures History** sheet. The site is matched from the site name sent by the phone, then the form's site and company fields, then the location name; the upload is refused (the form itself is still saved, and the Audit says why) if no site matches, two companies share the name, there is no photo, a photo fails to save, or the history row cannot be written. Drive photos are never deleted, so old links keep working.

## **3.10 Audit Retention**

The Audit sheet is a hidden debugging trail. Each morning, just before the Health email and as its own step, rows older than `AUDIT_KEEP_DAYS` are removed and the sheet is cut to `AUDIT_MAX_ROWS`, whichever limit is reached first; the newest row always stays. The Audit must not be sorted (the oldest rows must stay at the top). Visits and Forms hold the permanent records. An organisation that needs a longer trail should raise the keys or copy the Audit out.

## **3.11 Welfare Checks**

Welfare checks are off by default and switched on in the Settings tab. For a site visit (never a trip) the phone sends the interval at the start; the server arms its own clock (Visits column AD) and the phone prompts "Are you OK?" at each check, counting the next check from the last answer or from a "Check in now" tap. A locked phone cannot prompt, so the server sends a push to the worker's own phone if phone alerts are set up; the phone shows the prompt at once on opening, with the time left. If the worker does not answer within `WELFARE_GRACE_MINS`, the visit becomes overdue from that moment: the main contact is alerted at once with welfare wording, then the normal ladder runs (both contacts at the fourth alert; Critical Timing visits alert both quickly). Answering late, or a PIN clear, sends an All Clear to those alerted and restarts the checks. A check that falls at or after the visit's due time is skipped, and an extend after a skipped check restarts the clock rather than raising a false alert. Without phone alerts a locked phone will miss the check, so the worker app warns about this when welfare checks are on. Switching welfare checks Off does not stop an escalation that has already started.
 
# **4. Offline Capability and Service Worker Caching**
 
The Worker App registers a service worker on first load. The service worker caches the application shell under a cache name that includes a build timestamp (e.g., otg-safety-v81.36-2026-02-18-m5k3x2a). This ensures each new build produces a distinct cache name. When a new build is available, the service worker’s activate event deletes all older caches and the new version is served from cache on next load.
 
| **Availability** | **Category** | **Detail** |
| --- | --- | --- |
| **Always available offline** | Cached app data | All previously synced site data, form templates, resources, and notice history. The active visit session (timer, state, queued uploads in IndexedDB). |
| **Not available offline** | Network-dependent features | New syncs (site list updates, new notices, WOF expiry changes). Alarm notification delivery to emergency contacts. AI report processing. |
| **Queued for later** | Outbox | All upload actions (visit start, end, alarms, form submissions) are stored in IndexedDB with idempotency keys and retried when connectivity resumes. Duplicate suppression prevents double-posting. |
 
| Workers who never open the app while online will not receive updates. There is no mechanism to force an update on a device with no internet access. This is a standard limitation of service worker-based PWAs. |
| --- |
 
# **5. Device and Browser Requirements**
 
| **Requirement** | **Detail** |
| --- | --- |
| **Operating System** | iOS 16.4 or later; Android 9 or later. The app will load on older versions but service worker support and the Screen Wake Lock API may be absent. |
| **Browser** | Chrome (Android/Desktop), Safari (iOS 16.4+), Edge (Chromium). Firefox is not recommended due to inconsistent PWA home screen support. |
| **Screen Wake Lock** | Used to prevent the screen from turning off during active visits. Requires the Screen Wake Lock API (Chrome 84+, Safari 16.4+). Graceful fallback if unavailable. |
| **Device Motion API** | Required for shake-to-alert functionality. Granted automatically on Android; requires explicit user permission on iOS 13+. If denied, shake alerting is silently disabled. |
| **Web Speech API** | Used for voice countdown warnings. Present in Chrome and Safari. Not available in Firefox. Graceful fallback to visual-only if absent. |
| **Geolocation API** | Required for GPS capture and travel monitoring. Requires user permission. If denied, GPS records as 0,0 but the safety system otherwise functions normally. |
| **IndexedDB** | Required for the upload outbox and visit history. Clearing all browser data will purge queued uploads. The service worker handles app caching independently. |
| **localStorage** | Required for sync cache (site list, templates, notices) and app settings. Workers clearing all browser data will lose session state and may need to re-register their device. |
| **Internet Access** | Required for initial setup, syncs, alarm delivery, and AI report processing. Not required for active visit monitoring once the app is loaded and synced. |
 
# **6. Hosting, Infrastructure, and Dependencies**
 
## **6.1 What the Organisation Controls**
 
The organisation’s Google Workspace account owns and controls all data. The spreadsheet, all visit records, photos stored in Drive, and the Apps Script web app are all assets in the organisation’s own Google account. No data is stored on a third-party server operated by the AppSuite developer.
 
## **6.2 External Service Dependencies**
 
| **Service** | **Detail** |
| --- | --- |
| **Google Apps Script** | Backend runtime. Part of Google Workspace — no additional cost. Governed by Google Workspace SLA (99.9% uptime for most tiers). |
| **Google Sheets** | Data store. Part of Google Workspace. Subject to quota limits: 50,000 read/write cells per day on free tier; higher on paid tiers. With typical deployment volumes this limit is not approached. |
| **Google Drive** | Photo and signature storage. Part of Google Workspace. Storage counted against the organisation’s Drive quota. |
| **SMS Provider (Twilio / Kudosity / Textbelt)** | SMS notification delivery. Provider selected per deployment based on region: Twilio (NZ, UK, CA), Kudosity/Burst SMS (AU), Textbelt (US). Pay-per-message pricing varies by provider. The backend fails gracefully if credentials are absent or the service is unavailable — email and push notifications still fire. SMS content (worker name, location, coordinates) transits the provider’s infrastructure; review the applicable privacy policy for your chosen provider. |
| **ntfy (ntfy.sh)** | Push notification delivery. Optional. Notifications are sent server-side from GAS to the ntfy topic URL. The default configuration uses the hosted ntfy.sh service (free tier). A self-hosted ntfy server is recommended for organisations with privacy or reliability requirements — see Section 6.4. If not configured, this channel is silently skipped. |
| **Healthchecks.io** | Dead-man’s switch for the backend watchdog. Optional. If configured, the watchdog posts a heartbeat to a Healthchecks.io check URL on every successful run. If the heartbeat stops (e.g., due to a GAS quota error or deployment issue), Healthchecks.io sends an alert to the configured administrator. If not configured, the watchdog runs silently. |
| **Google Gemini API** | AI report processing. Optional. API key stored in GAS script properties. The system probes the account’s available Gemini models at runtime and selects the most capable one — no model name is hardcoded. Data sent is limited to form report content (no worker PII). Disabled if no API key is configured. |
| **OpenRouteService** | Road distance calculation for mileage tracking. Optional. The system probes for API v2 then v3 at runtime and uses whichever is available. Falls back to haversine straight-line distance if unavailable or if no API key is configured. |
| **Nominatim (OpenStreetMap)** | Reverse geocoding. Used in two places: (1) the backend includes a street-level address in SMS alert bodies; (2) the Monitor App uses Nominatim to place an approximate map marker for workers whose GPS fix is unavailable. No API key required; subject to OpenStreetMap usage policy rate limits. |
| **Map tiles (OpenStreetMap / CARTO)** | Monitor map background. Default: OpenStreetMap tiles, no key. Optional: a free CARTO key (entered in the App Factory) selects CARTO Voyager tiles, with automatic fallback to OpenStreetMap. Requested by the supervisor's browser; see Section 1.3. |
| **what3words API** | Precise location encoding. Optional. If a what3words API key is configured, the backend includes a what3words address in email alert notifications, and the Worker App displays the what3words address on the alarm screen. Not used for SMS (character limit constraints). Disabled if no key is configured. |
 
## **6.3 Google Apps Script Quotas**
 
| **Quota** | **Limit** |
| --- | --- |
| **URL fetch calls / day** | 20,000 (Workspace and free). Each SMS, ntfy, Gemini, ORS, Nominatim, and what3words call is one URL fetch. Normal operation is well within limits. |
| **Email messages / day** | 1,500 (Workspace) / 100 (free). Alert and All Clear notifications count toward this limit. Organisations sending high alert volumes should use a Workspace account. |
| **Script runtime / call** | 6 minutes maximum. No single operation in this system approaches this limit. |
| **Simultaneous executions** | 30. Relevant for very large deployments with many simultaneous alarm events. |
 
## **6.4 Self-Hosted ntfy — Recommendation and Guidance**
 
By default, OTG AppSuite sends push notifications via the public hosted service at ntfy.sh. This requires no setup and is appropriate for evaluation and low-volume deployments. For production use, a self-hosted ntfy server is recommended.
 
**Why self-hosting is preferable**
 
- **Reliability.** Google Apps Script (GAS) sends all outbound HTTP requests from a shared pool of Google-owned IP addresses. These IPs are used across many GAS deployments simultaneously. The ntfy.sh free tier applies per-IP rate limits; under load, these shared IPs can exhaust the free quota and cause push notifications to be silently dropped — even when the organisation's own usage is modest. A self-hosted server has no such shared-IP constraint.
- **Data sovereignty.** Push notification payloads include the worker's name, location name, alarm type, and timestamp. On ntfy.sh, this data transits Binarily's infrastructure and is subject to their privacy policy. Self-hosting keeps this data entirely within infrastructure the organisation controls.
- **Topic privacy.** On ntfy.sh, topics are publicly subscribable by anyone who knows the topic name (topic names function as unguessable tokens rather than access-controlled channels). A self-hosted server can be configured to restrict subscriptions, preventing third parties from monitoring notification traffic even if a topic name is discovered.
**Considerations**
 
- **Cost.** A minimal VPS suitable for ntfy runs at approximately NZ$5–10 per month (Hetzner, DigitalOcean, Vultr, and similar providers offer appropriate entry-level instances). This is the only ongoing cost associated with self-hosting.
- **Maintenance.** ntfy is a mature, actively maintained open-source project. Updates are infrequent and straightforward. The operational overhead is low for an IT professional comfortable with Linux and Docker.
- **Complexity.** The additional component introduces one more dependency to monitor. Healthchecks.io (already used for the GAS watchdog) can be used to monitor ntfy uptime as well.
**Practical setup**
 
ntfy is distributed as a single binary and as a Docker image. A basic deployment on a Debian/Ubuntu VPS requires only:
 
1. Install Docker (standard distribution packages).
2. Run the ntfy container with a persistent volume and HTTPS termination (Caddy or nginx as a reverse proxy handles TLS automatically via Let's Encrypt).
3. Optionally enable authentication to restrict who can publish and subscribe to topics.
4. Paste the server URL (e.g., `https://ntfy.yourorg.example.com`) into the ntfy Server field in Factory Step 1 before generating the deployment.
The ntfy documentation at [docs.ntfy.sh](https://docs.ntfy.sh) covers all installation and configuration options. The self-hosted server is fully compatible with the ntfy mobile app — contacts configure the app to point to the custom server URL instead of ntfy.sh.
 
**No code changes are required** in the OTG AppSuite to use a self-hosted server. The Factory generates the backend with the configured server URL substituted in place of the ntfy.sh default.
 
## **6.5 ntfy Proxy — Optional Workaround for Trigger-Path IP Blocks**
 
Google Apps Script sends all outbound HTTP requests from a shared pool of Google-owned IP addresses. The ntfy.sh free tier applies per-IP rate limits enforced by fail2ban; if other GAS deployments sharing the same IP pool have exhausted the rate limit, ntfy.sh jails those IPs at the firewall level. When this occurs, push notifications sent from the time-based trigger (`checkOverdueVisits()`) fail with `Address unavailable` — a network-level rejection before an HTTP response is received.
 
**Affected path:** Standard overdue escalation tiers (15 / 30 / 45 / 60 min). These fire from the GAS time-based trigger, which uses the affected IP pool.
 
**Unaffected paths:** Panic, Duress, and Critical Timing overdue alarms fire via the `doPost` execution context, which uses a different IP pool that ntfy.sh does not currently jail.
 
**Symptoms:** Contacts receive overdue escalation emails but no push notifications. `runDiagnostics()` (manual execution) shows ntfy delivering successfully. The GAS log shows `ntfy push failed for topic "X": Exception: Address unavailable`.
 
**Solutions (choose one)**
 
| Option | Suitable when | Cost |
|--------|--------------|------|
| **PHP Proxy** (this section) | Admin has existing cPanel/shared hosting | Nil |
| **Self-hosted ntfy** (§6.4) | VPS already planned or privacy is a requirement | ~NZ$5–10/month |
| **ntfy.sh paid plan** | Organisation prefers no self-managed infrastructure | Per ntfy.sh pricing |
 
### PHP Proxy Setup
 
The proxy is a single PHP file deployed to any cPanel shared hosting account. GAS posts ntfy notifications to the proxy URL; the proxy forwards them to ntfy.sh from the hosting account's own clean IP. A shared secret in the request header prevents the proxy endpoint being used by third parties.
 
**Files involved**
 
- `proxy_ntfy.php` — the proxy script, included in the OTG AppSuite repository
- Factory App — two new optional fields: **ntfy Proxy URL** and **ntfy Proxy Secret**
- `backend_template.js` — `_sendNtfy()` routes through the proxy when `CONFIG.NTFY_PROXY_URL` is set
**Deployment steps**
 
1. Open `proxy_ntfy.php` and set `PROXY_SECRET` to a long random string (e.g., 32+ characters). Save the file.
2. Upload `proxy_ntfy.php` to your cPanel hosting via File Manager or FTP. Place it in `public_html` or a subdirectory — anywhere that has a public HTTPS URL.
3. Confirm the file is accessible: visit its URL in a browser. You should receive a `403 Forbidden` response (the secret header is absent — this is correct behaviour).
4. In the OTG Factory App (Step 1), enter the proxy URL (e.g., `https://yoursite.com/proxy_ntfy.php`) in the **ntfy Proxy URL** field, and the same secret string in **ntfy Proxy Secret**.
5. Regenerate and redeploy the backend script in Google Apps Script.
6. Run `checkOverdueVisits()` manually from the Apps Script editor and check the log. You should see `ntfy push sent to topic: X (via proxy)`.
7. Run a live overdue test (let a visit go overdue) to confirm end-to-end delivery to the ntfy app.
**Security notes**
 
- The `PROXY_SECRET` value is stored in the GAS backend as a script property and is not visible to workers or contacts.
- The proxy forwards only the ntfy-specific headers (`Title`, `Priority`, `Tags`, `Click`, `Actions`) and the message body — it does not log or store notification content.
- If the hosting account is on a shared server, the outbound IP may be shared with other websites, though not with GAS deployments. In practice this is sufficient — the fail2ban jailing is specific to Google's IP ranges.
- Organisations with strong data-sovereignty requirements should prefer self-hosted ntfy (§6.4), which keeps notification content entirely within controlled infrastructure.
**Updating the proxy**
 
If the proxy script is updated in a future release, replace the file on your hosting and redeploy the backend. The Factory URL and secret fields do not need to change.
 
**Existing proxies need one change.** Current alerts carry the `Click` and `Actions` headers (tap-to-call and map buttons on contact alerts; the tap action on worker reminders when `WORKER_APP_URL` is set). A proxy that forwards only `Title`, `Priority` and `Tags` silently drops them: the alert still arrives, without the buttons. In the live `proxy_ntfy.php`, change `foreach (['Title', 'Priority', 'Tags'] as $h)` to `foreach (['Title', 'Priority', 'Tags', 'Click', 'Actions'] as $h)`, or upload the new file from the App Factory.
 
## **6.6 Two Organisations on One Web Host**

Two organisations may be served from one web host if each has its own folder. Worker app builds from `__24_` name each organisation's stored data from a hash of the whole backend address (earlier builds used only the last characters, which could collide), move existing data across once on first start, and limit Reset app data and Force App Update's service-worker removal to that organisation. From Factory `index__14_` the service worker names its caches by install folder and, when it updates, deletes only its own older caches. An organisation still on an older service worker can, when it updates, delete the other's cached files, so update both. Caches left by the old naming stay on a phone until the worker taps Force App Update, which still clears every cached file on the host for both organisations (the phone then needs a connection at its next start). The caches hold app files only, never records. A browser tab holding a running visit shows a "browser copy" warning so two copies never run together.
 
# **7. Data Residency and Privacy Considerations**
 
All primary data — visit records, worker profiles, form submissions, photos — resides in the organisation’s Google Workspace account. The following data leaves the organisation’s Google environment:
 
- **SMS notifications:** Worker name, location name, a reverse-geocoded street address (or raw GPS coordinates if geocoding fails), and a timestamped alarm description are sent to the configured SMS provider (Twilio, Kudosity, or Textbelt depending on region). The applicable provider’s privacy policy applies to this data in transit.
- **Push notifications (ntfy):** Worker name, location name, alarm type, and timestamp are sent to the ntfy.sh API (or a self-hosted ntfy server if configured). ntfy’s privacy policy applies unless self-hosted.
- **AI report processing:** Form field data and worker notes are sent to Google’s Gemini API. This is processed under Google’s AI API terms of service, not the organisation’s Workspace agreement. This feature can be disabled by leaving the Gemini API key field blank during setup.
- **Road distance calculations:** GPS coordinates (start and end of journey) are sent to the OpenRouteService API if the road distance feature is enabled. The app falls back to straight-line calculation if this key is absent.
- **Map geocoding (Monitor):** Worker addresses may be sent to the Nominatim API for reverse geocoding when GPS is unavailable. No personal identifiers are included — only GPS coordinates or address strings.
- **what3words encoding:** GPS coordinates at the time of an alarm are sent to the what3words API if configured. No personal identifiers are included.
| Organisations operating under the NZ Privacy Act 2020, GDPR, or similar frameworks should review the above data flows as part of their Privacy Impact Assessment. The AI, SMS, ntfy, what3words, and road distance features are each independently disableable at configuration time. |
| --- |
 
Worker phone numbers, emergency contact details, and GPS coordinates are stored in plain text in the Google Sheet. Access to the Sheet should be restricted to designated administrators. The Master Key (used by the Monitor App) provides read access to all active worker status data and should be treated accordingly.
 
# **8. Stability, Reliability, and Known Limitations**
 
## **8.1 Platform Stability**
 
The Worker App is built on standard web platform APIs (Service Workers, Geolocation, Web Speech, Screen Wake Lock, Device Motion) that are part of the W3C and WHATWG specifications. The main risk factor is that Apple and Google periodically tighten restrictions on background app behaviour — apps running in the background may be suspended to preserve battery life. The app mitigates this through the Screen Wake Lock API and Battery Saver mode.
 
## **8.2 Known Technical Limitations**
 
| **Limitation** | **Detail** |
| --- | --- |
| **No real-time offline alerts** | If the worker’s device has no data connection, alarm notifications cannot be delivered until connectivity is restored. This is inherent to a web app architecture. Organisations requiring guaranteed real-time alerting in zero-coverage environments should supplement with satellite devices. |
| **No link to emergency services** | The system notifies nominated contacts only. There is no automatic escalation to police, ambulance, or any monitoring centre. Contacts must decide whether to call emergency services. |
| **Monitor requires active supervision** | The Monitor’s audio alarm and full-screen overlay only activate if someone has the browser tab open. There is no background or push notification on the supervisor side if the tab is closed. |
| **Device ID stability** | The browser-derived device ID may change on full browser data clear, OS reinstall, or browser switch. This requires an admin to clear and re-register the device. |
| **Background suspension (iOS)** | iOS may suspend the browser tab if the worker switches to another app. The Screen Wake Lock and Battery Saver mode reduce this risk but do not eliminate it. |
| **GPS accuracy** | GPS accuracy is device-dependent and degrades indoors. Continuous GPS tracking during overdue or travel periods depends on the device’s location accuracy. |
| **Spreadsheet row limits** | Google Sheets has a limit of 10 million cells per spreadsheet. At the current column count per visit row, this allows approximately 250,000–330,000 visit records before archiving is needed. The automatic archiving function moves records older than 30 days to an Archive sheet. |
| **No role-based Monitor access** | The Monitor App uses a single Master Key. All Monitor users see all active workers. There is no per-team or per-supervisor filtering in the current implementation. |
| **GAS cold starts** | Apps Script can take 1–3 seconds to respond after a period of inactivity. This does not affect the worker experience materially but can cause the first sync after a long idle period to be slightly slower. |
| **Locked phone** | A locked phone stops all timer-driven reports (positions, heartbeats, welfare prompts). The backend detects the silence and reminds the worker through ntfy if phone alerts are set up, then alerts contacts on schedule. A worker without phone alerts and with welfare checks on will miss a check on a locked phone. |
| **Audit is a short trail** | The Audit sheet keeps 7 days or 10,000 rows by default (Section 3.10); it is for diagnosis, not record keeping. |
| **Tapped reminders** | On some phones (for example Xiaomi HyperOS) a tapped reminder opens a browser copy of the app, not the installed app. `WORKER_APP_URL` is therefore left blank unless tested. |
| **Nominatim rate limits** | The Nominatim API enforces a usage policy requiring no more than one request per second and a valid User-Agent. The Monitor geocoding implementation caches results session-wide and only geocodes ARRIVED workers without valid GPS, keeping request rates well within policy. |
 
## **8.3 Failure Modes**
 
The system is designed to fail safely. The following table summarises significant failure modes and their impact:
 
| **Failure** | **Impact** |
| --- | --- |
| **Backend unreachable** | Worker App functions normally. Uploads queue in IndexedDB and are retried automatically. The countdown timer, GPS tracking, and all local alerts continue unaffected. |
| **SMS delivery failure** | Email and push (ntfy) notifications still fire. The backend catches SMS send errors and logs them without crashing. No retry mechanism for SMS — single-shot attempt per event. |
| **ntfy delivery failure** | Email and SMS notifications still fire. ntfy errors are caught and logged without crashing. No retry. |
| **AI processing failure** | The report is saved with the raw (unpolished) notes. The backend returns the original text if Gemini fails or returns an empty response. |
| **Service worker not supported** | The app loads and functions, but will not work offline and will not auto-update. Requires connectivity for each session. |
| **Screen Wake Lock unavailable** | The app operates normally but the device screen may turn off. Workers should use Battery Saver mode as a fallback. |
| **Healthchecks.io unreachable** | The watchdog continues to run normally. The dead-man’s switch check-in is silently skipped for that cycle. |
| **OpenRouteService unavailable** | Distance calculation falls back to haversine straight-line. Travel report distance field is pre-filled with the fallback value. |
 
# **9. Update and Version Management**
 
The system uses a build-timestamp-based versioning scheme. Each time the administrator generates new Worker App bundles from the App Factory, a unique build timestamp is embedded in the service worker cache name, the displayed App Version in worker settings, and the Backend Version string returned by the backend’s ping endpoint.
 
The App Factory also writes the worker build into `config.json` and shows it under the download buttons; a phone whose app build differs shows an amber "App out of date" banner. When the worker app changes, replace `index.html`, `sw.js` and `config.json` together. The Settings panel also shows the backend build the phone is talking to. Always deploy the backend first: the newer worker apps need a recent backend, and they fall back to messages an older backend understands only where that is safe.
 
When a worker with an older cached version opens the app while online, the browser fetches the new HTML file, the new service worker activates, deletes the old cache, and the updated version is served on next load. Workers do not interact with this process.
 
The backend (Google Apps Script) is updated by the administrator editing and redeploying the GAS project — a separate step from generating new Worker App bundles. The Settings panel in each Worker App shows both the app build date and the backend build date, making it easy to confirm that worker and backend are in sync.
 
# **10. Suitability Assessment**
 
The OTG AppSuite is a pragmatically engineered system that trades some enterprise-grade security controls (hardware device binding, server-side session management, dedicated hosting) for very low deployment cost and zero ongoing infrastructure overhead. For the target audience — small to medium organisations deploying field workers where Google Workspace is already in use — the security and reliability model is appropriate for many situations.
 
| **⚠️ Conduct a Risk Assessment Before Deployment** This system notifies nominated contacts. It does not contact emergency services and does not connect to a 24/7 monitoring service. The suitability of this model depends on the specific risk profile of the work and the environment. Organisations should assess the following before deploying: Can nominated contacts realistically receive and act on alerts during all hours workers are in the field? What is the response time, and is it acceptable given the hazards workers face? What is the mobile data coverage in the areas where workers operate? Are zero-coverage scenarios a realistic possibility, and if so, what backup mechanism is in place? Is the organisation satisfied that a notification-to-contacts model — rather than a direct line to emergency services or a contracted monitoring centre — is appropriate for the risks faced? Has someone been designated to actively monitor the Monitor App dashboard during operating hours? What happens outside those hours? For workers facing serious physical risk, operating in remote or low-coverage areas, or where a guaranteed response time is required, this system may need to be supplemented with additional controls such as satellite communication devices or a contracted 24/7 lone worker monitoring service. |
| --- |
 
## **10.1 Key Evaluation Areas**
 
The main areas to assess against organisational requirements are:
 
- **Alert chain adequacy:** Whether the nominated-contact notification model (email, SMS, push) provides a sufficiently reliable and timely response for the hazards workers face.
- **Data residency:** Whether transmitting report content to the Gemini API, GPS data to the SMS provider and OpenRouteService, alarm events to ntfy, and coordinates to what3words and Nominatim is acceptable under the organisation’s privacy obligations. Each feature is independently disableable.
- **Offline alert risk:** Whether zero-coverage scenarios are a realistic risk for the organisation’s field environments, and whether a backup alerting mechanism is needed.
- **Device management:** Whether the browser-derived device ID provides sufficient binding strength, or whether a stronger device identity mechanism is required.
- **Monitor access control:** Whether all Monitor App users requiring the same level of access is acceptable, or whether per-team filtering needs to be added.
- **Watchdog monitoring:** Whether the Healthchecks.io integration (or an equivalent mechanism) is in place to alert administrators if the backend watchdog stops running.
The system is well-suited for organisations that want a capable, maintainable, and cost-effective lone worker safety solution without the complexity and cost of a dedicated SaaS platform — provided their deployments occur in areas with reasonable mobile data coverage, their nominated contacts are reliably reachable, and their workers use supported iOS or Android devices.
