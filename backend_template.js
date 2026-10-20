/**
 * OTG APPSUITE - MASTER BACKEND %%BACKEND_VERSION%%
 * FIXED: SOS Map URLs, SMS Payloads, and GAS Environment Stability
 *
 * __38_ (session 76, 16 Oct 2026) - F74-1:
 *   - Audit trail: hidden 'Audit' sheet records every col K write, guard skip,
 *     Critical Timing ladder decision, busy reply, doPost error and human/app
 *     edit (see _audit_ and onEdit at the end of this file).
 *   - Critical Timing ladder memory moved to col AA ('Escalation Memory'), keyed
 *     to the due time and claimed BEFORE alerts send. A stray col K write can no
 *     longer reset the ladder; an extended visit (new due time) gets a fresh one.
 *   - Pending sheet writes are flushed before the script lock is released.
 *
 * __39_ (session 77, 16 Oct 2026) - F75-2:
 *   - archiveOldData() now takes the script lock (waits up to 60 s) BEFORE reading the
 *     Visits sheet. Before, it ran without the lock and rewrote the whole sheet from a
 *     snapshot, so an alarm or ladder write landing mid-run could be silently undone.
 *   - It writes the kept rows over the top of Visits first and clears the leftover rows
 *     after (it used to clear the sheet, then write). Visits is never empty, and a failure
 *     part-way cannot wipe the open and recent rows.
 *   - Lock busy: the run is skipped, logged to Audit, and one retry is scheduled for 1 hour
 *     later (archiveOldDataRetry). If the retry also fails, or the run throws, it sets
 *     ARCHIVE_FAILED, emails the health-report recipient, and the daily health email
 *     carries a banner until it has beena reported.
 *   - Column K is read with String(), so a non-text cell no longer aborts the archive.
 *
 * __40_ (session 77, 16 Oct 2026) - F76-1:
 *   - handleWorkerPost no longer writes a 'no fix' position ("0,0" or "0.0,0.0", which is what the
 *     worker app sends when it has no GPS) into col O / col P. Before, any such post replaced a real
 *     position already held for the visit. New rows still record whatever the first post carries.
 *
 * __41_ (session 80, 17 Oct 2026) - Layer 2 trigger health:
 *   - Each background job (archiveOldData incl. runs that move 0 rows, sendHealthEmail,
 *     geocodeSiteLocations, sendWeeklySummary, cleanupPrivateSentNotes) records its own last success and
 *     last failure in script properties (JOB_<name>_OK / _FAIL). checkOverdueVisits is NOT tracked this way:
 *     it is watched from outside by Healthchecks.io, and no property is written on the minute run.
 *   - The daily Health email gains a Background Jobs table (judged against JOB_CADENCE) and colours the
 *     'Escalation engine last ran' line (amber over 5 min, red over 10 min).
 *   - runDiagnostics: FAILs a trigger whose handler function does not exist (the orphan generateStats case),
 *     reports job heartbeats and engine age, and the archive note now says monthly.
 *   - TEMPLATE_BUILD stamp: in the ping reply, every Audit note, the Health email footer and diagnostics.
 *   - Critical Timing ladder: two audit-only rows after each step's alerts ('ladder:sends-complete' with the
 *     duration, or 'ladder:send-FAILED' if the send threw). They record evidence only and change no behaviour.
 *
 * __42_ (session 82, 18 Oct 2026) - A4 / F80-1 / F80-2 / A7 / F79-1 (deploy WITH worker __14_):
 *   - B1 (A7): the standard 15/30/45/60 ladder keeps its memory in col AA (as Critical Timing does),
 *     claimed before send. Col K is read only for a legacy row with no col AA entry at all; an entry
 *     for a different due time is a fresh ladder (both ladders). triggerEscalation no longer
 *     overwrites PANIC/SOS/DURESS in col K (alerts, col A and the Notes tag unchanged). The Critical
 *     Timing merge and the busy path treat the ladder as started from col K OR col AA.
 *   - B2: a PIN clear (USER_SAFE_CONFIRMED) on a visit row restores TRAVELLING/ARRIVED and leaves the
 *     row OPEN, so the server still escalates at the due time. Outside a visit it closes the row as
 *     before. Notes get a [PIN CLEAR hh:mm:ss] line. One All Clear per clear (idempotency key).
 *     The All Clear guard decides on the worker's latest row only; an open visit row with no alarm
 *     still records the clear and its due time, without an All Clear.
 *   - B3: col U on an existing row only moves later, so a post queued before an extend or a PIN clear
 *     after due cannot put the ladder back on the old due time.
 *   - B4 (F79-1): handleWorkerPost decides on the worker's latest row only. A routine post (GPS pulse,
 *     plain OVERDUE, LOW BATTERY, WELFARE_OK) arriving after the visit closed with that visit's due time
 *     is Audit only (handleWorkerPost:straggler) - no new row.
 *   - Not changed: handleResolvePost (HQ resolve, Monitor only) still closes the visit - follow-up A4-HQ.
 *
 * __43_ (session 87, 20 Oct 2026) - F86-2 / Decision C / F86-7 / F86-8 / D2 (deploy with worker __19_ - no worker change):
 *   - The script lock is RELEASED BEFORE ALERTS ARE SENT. checkOverdueVisits holds it only to read the sheet, claim col AA
 *     and write col A/K/L; doPost holds it only for the sheet work (photo saves stay inside for now). Alerts, All Clears,
 *     form emails and test alerts are queued and sent after release. Session 86: a phone OVERDUE ALARM waited 9,559 ms of
 *     its 10,000 ms limit while the checker sent step 1. Every send-bearing run writes lockHeld to the Audit.
 *   - Overlap guard: two checker runs never overlap (document lock; a CacheService marker where that is not available).
 *     The checker now waits up to 20 s for the script lock instead of skipping the minute when doPost holds it.
 *   - Missed-send net: col AA claims carry the claim time and get '|SENT' once the alerts have gone. A claim still unsent
 *     3 minutes later (the run died between claim and send, or the send threw) is re-sent ONCE ('|RESEND'). A duplicate
 *     beats a miss. Entries written before __43_ (no claim time) are treated as sent and never re-sent.
 *   - doPost registers the idempotency key after the sends; a failed send replies error so the phone retries. A retry of
 *     an event still being sent by another run gets 'Busy' (INFLIGHT marker), not a second round.
 *   - All Clear waits (up to 20 s, without the lock) while the checker is still sending that worker's ladder alerts, so
 *     contacts never get the All Clear before the alarm it clears.
 *   - Decision C: ntfy goes first (then email, then SMS) in triggerAlerts and the All Clear. The reverse geocode now runs
 *     only inside the SMS step (it is used only there) - it used to delay every alert, ntfy included.
 *   - F86-7: every Audit row from a doPost run carries tpl=<Template Name> and wb=<Worker Build> when the post has them.
 *   - F86-8: a distance of 0 is written to col S (a falsy check skipped it).
 *   - D2: an All Clear for a visit that stays open says the visit is still being monitored (email, SMS, ntfy). An All
 *     Clear that closes the visit keeps the old "No further action is required" wording.
 *   - Not in this build: Forms tab (Decision A), HANDOVER_84 items 2 and 8 -> __44_; Private Notes -> __45_.
 *
 * __44_ (session 90, 20 Oct 2026) - F87-4 / HANDOVER_84 items 2 and 8 / Decision A (F87-3) / F88-5a (no worker change):
 *   - F87-4: the All Clear guard decides "were the contacts alerted?" from what was SENT - col AA holds a ladder step
 *     for the row's current due time, or col K holds PANIC/SOS/DURESS/EMERGENCY, a legacy 'OVERDUE - ' tier, or a
 *     Critical Timing OVERDUE ALARM (bridged to the contacts). A plain OVERDUE pulse or a standard OVERDUE ALARM (the
 *     checker owns standard escalation) is no longer taken as "alerted": the clear is recorded, no All Clear is sent.
 *   - Item 8: OVERDUE, LOW BATTERY and WELFARE_OK never write col K on an existing row (Audit 'handleWorkerPost:k-kept').
 *     LOW BATTERY and WELFARE_OK are kept in Notes with the time, so each one stays reportable.
 *   - Decision A / item 2: MID_VISIT_UPDATE and ON SITE form posts (and PROCEDURES_UPDATED / VEHICLE_CHECK_COMPLETED while
 *     a visit is open) go to a 'Forms' tab, one row per form, and never write the trip row. New col AB 'Visit ID' on every
 *     new Visits row (the creating post's idempotency key, or a generated id) links each form to its visit. A form that
 *     arrives after the visit closed no longer opens a stray Visits row. Form email and the Staff vehicle check unchanged.
 *   - F88-5a: 'doPost:sends' is also written for every alarm-family post (PANIC/SOS/DURESS/EMERGENCY, OVERDUE ALARM,
 *     OVERDUE - tiers, ALARM_GPS_PULSE, USER_SAFE / notifySafety, HQ resolve), whatever the lock time.
 *   - Not in this build: F88-1/F88-2/F88-3 (lock hold) and F89-1/F89-2/F89-3 -> __45_.
 *
 * __45_ (session 91, 20 Oct 2026) - F90-1/2/3, Forms ledger, F89-1 to F89-4, HANDOVER_84 item 9 (no worker change):
 *   - F90-1: the monthly archive widens (and lengthens) Archive before writing, so rows wider than the tab no longer
 *     throw. A new tab from Google is 26 columns; Visits is 28. If Sheets refuses (protected tab) nothing moves, Visits
 *     is untouched and the run is flagged (Audit 'archiveOldData:FIT-FAILED').
 *   - F90-2: Archive and FormsArchive get a header row when the job creates them (Visits row 1 / Forms row 1). An
 *     existing Archive tab whose A1 is a date (data in row 1, never had a header) gets one header row inserted above it,
 *     once (Audit 'archiveOldData:header-added'). Blank header cells are filled from Visits row 1 (e.g. 'Visit ID').
 *   - F90-3: Forms rows older than CONFIG.ARCHIVE_DAYS move to a FormsArchive tab in the same job, under the same lock,
 *     write then trim (Audit 'archiveForms' / 'archiveForms:none'). A Forms failure does not undo the Visits archive.
 *   - Forms ledger: every post that carries report data also writes a Forms row - the departure / completion report
 *     ('closing report') and forms posted with no visit running ('record row'). Visits is written exactly as before, so
 *     Travel Report and Monthly Stats do not change. Note to Self never reaches Forms or Visits. A failed ledger write
 *     never fails the post (Audit 'handleWorkerPost:form-ledger-FAILED').
 *   - F89-1: server tiers 1-3 (standard ladder) reach the primary contact only on every channel; the Staff-sheet ntfy
 *     topic no longer adds the escalation contact. Tier 4 and every Critical Timing step still go to both.
 *   - F89-2: the All Clear goes only to the contacts actually alerted for the current due time (primary only after
 *     tiers 1-3; both after tier 4, Critical Timing, PANIC/SOS/DURESS). HQ resolve follows the same rule and sends no
 *     All Clear when nobody was alerted (Audit 'handleResolvePost:no-alarm').
 *   - F89-3: the standard ladder starts at CONFIG.ESCALATION_MINUTES (the phone's grace period, same Factory field),
 *     then every 15 minutes (Russell, Decision 1 = b). 15 gives the old 15/30/45/60. Unreadable or < 1 -> 15, as the
 *     phone does. Status names (OVERDUE - 15MIN ALERT ...) are unchanged; contacts never see them.
 *   - F89-4: a standard OVERDUE ALARM carrying an earlier due time than the row (overtaken by a PIN clear or extend)
 *     no longer writes col K (Audit 'handleWorkerPost:stale-alarm').
 *   - Item 9 / F83-5: numeric-looking ids (execution id, idempotency key, Visit ID) are written as text.
 *
 * DEPLOY CHECKLIST (every deployment): Deploy > Manage deployments > New version. Then open the Apps Script
 * editor, run ONE function from each installed trigger by hand (accept any permission prompt), and confirm
 * the Triggers list shows no failures.
 */

const CONFIG = {
  VERSION: "%%BACKEND_VERSION%%", // Injected by Factory at build time
  MASTER_KEY: "%%SECRET_KEY%%", 
  WORKER_KEY: "%%WORKER_KEY%%", 
  ORS_API_KEY: "%%ORS_API_KEY%%", 
  GEMINI_API_KEY: "%%GEMINI_API_KEY%%", 
  SMS_PROVIDER:       "%%SMS_PROVIDER%%",        // "twilio" | "burst" | "textbelt" | "none"
  TWILIO_ACCOUNT_SID: "%%TWILIO_ACCOUNT_SID%%",  // Twilio: NZ, UK, Canada
  TWILIO_AUTH_TOKEN:  "%%TWILIO_AUTH_TOKEN%%",
  TWILIO_FROM:        "%%TWILIO_FROM%%",           // E.164 number or verified sender ID
  BURST_API_KEY:      "%%BURST_API_KEY%%",         // Burst SMS: Australia
  BURST_API_SECRET:   "%%BURST_API_SECRET%%",
  BURST_FROM:         "%%BURST_FROM%%",            // Up to 11 char sender ID or phone
  TEXTBELT_API_KEY:   "%%TEXTBELT_API_KEY%%",      // Textbelt: US
  PHOTOS_FOLDER_ID: "%%PHOTOS_FOLDER_ID%%", 
  REPORT_TEMPLATE_ID: "",   
  ORG_NAME: "%%ORGANISATION_NAME%%",
  TIMEZONE: "%%TIMEZONE%%", 
  ARCHIVE_DAYS: 30,
  ESCALATION_MINUTES: %%ESCALATION_MINUTES%%,
  ENABLE_REDACTION: %%ENABLE_REDACTION%%,
  VEHICLE_TERM: "%%VEHICLE_TERM%%",
  COUNTRY_CODE: "%%COUNTRY_PREFIX%%", 
  LOCALE: "%%LOCALE%%",
  HEALTH_EMAIL: "%%HEALTH_EMAIL%%",   // Optional: override recipient for daily health email. Leave blank to use script owner.
  HEALTHCHECK_URL: "%%HEALTHCHECK_URL%%",  // Optional: Healthchecks.io ping URL. Pinged after each successful checkOverdueVisits() run.
  NTFY_SERVER: "%%NTFY_SERVER%%",      // ntfy push notification server. Defaults to https://ntfy.sh (hosted). Replace with self-hosted URL for higher privacy.
  NTFY_PROXY_URL:    "%%NTFY_PROXY_URL%%",     // Optional: URL of your PHP ntfy proxy script. Set if trigger-path ntfy pushes are blocked (see IT Advisor Overview §6.5).
  NTFY_PROXY_SECRET: "%%NTFY_PROXY_SECRET%%",  // Optional: shared secret matching PROXY_SECRET in proxy_ntfy.php. Must match exactly.
  W3W_API_KEY: "%%W3W_API_KEY%%"       // Optional: what3words API key. Free for registered charities — see what3words.com/select-plan. Leave blank to disable.
};

// Cached ORS API version — resolved lazily on first use by getOrsVersion_().
// Avoids re-probing on every routing call within the same execution.
let _orsVersion = null;

// __38_ (F74-1): audit trail + Critical Timing ladder memory. Helpers at end of file.
const AUDIT_SHEET_NAME   = 'Audit';
const AUDIT_MAX_ROWS     = 5000;   // trimmed daily by sendHealthEmail()
const LADDER_MEM_COL     = 27;     // col AA. Col Z is reserved for the Stage 1 warned flag.
const LADDER_MEM_HEADER  = 'Escalation Memory';
const LADDER_STATUSES    = ['EMERGENCY - CRITICAL TIMING BREACH',
                            'EMERGENCY - CRITICAL TIMING REPEAT',
                            'EMERGENCY - CRITICAL TIMING FINAL NOTICE'];
const LADDER_STEP_LABELS = ['BREACH', 'REPEAT', 'FINAL NOTICE'];
// __42_ (B1, A7): the standard 15/30/45/60 ladder keeps its memory in col AA too (same format).
const LADDER_STD_STATUSES = ['OVERDUE - 15MIN ALERT', 'OVERDUE - 30MIN ALERT',
                             'OVERDUE - 45MIN ALERT', 'EMERGENCY - 60MIN BREACH'];
const LADDER_STD_LABELS   = ['15MIN', '30MIN', '45MIN', '60MIN'];
const STRAGGLER_STATUSES  = ['ALARM_GPS_PULSE', 'OVERDUE', 'LOW BATTERY', 'WELFARE_OK']; // __42_ B4 (exact match)
// __44_ (HANDOVER_84 item 8): routine statuses never write col K on an existing row (exact match). The ones in
// ROUTINE_NOTE_TAG are written to Notes with the time instead, so every welfare check / low battery stays reportable.
const ROUTINE_NO_K_STATUSES = ['OVERDUE', 'LOW BATTERY', 'WELFARE_OK'];
const ROUTINE_NOTE_TAG      = ['LOW BATTERY', 'WELFARE_OK'];
// __44_ (Decision A, HANDOVER_84 item 2): form records go to the Forms tab and never write the trip row.
const FORM_ALWAYS_STATUSES  = ['MID_VISIT_UPDATE', 'ON SITE'];                     // always a form record
const FORM_IF_OPEN_STATUSES = ['PROCEDURES_UPDATED', 'VEHICLE_CHECK_COMPLETED'];   // a form record only while a visit is open
const FORMS_SHEET_NAME      = 'Forms';
// __45_ (F90-2/F90-3): one header list for the Forms tab and its archive.
const FORMS_HEADERS         = ['Received (UTC)', 'Worker', 'Template', 'Status', 'Visit ID', 'Visits Row (at receipt)', 'Visit Link',
                               'Form Data', 'Notes', 'Distance (km)', 'Signature', 'Photo 1', 'Photo 2', 'Photo 3', 'Photo 4',
                               'Last Known GPS', 'Idempotency Key', 'Worker Build'];
const FORMS_ARCHIVE_SHEET_NAME = 'FormsArchive';
const VISIT_ID_COL          = 28;            // col AB (Z reserved, AA ladder memory)
const VISIT_ID_HEADER       = 'Visit ID';
let _AUDIT_EXEC = null;          // short id shared by every audit row from one execution
let _AUDIT_LOCKWAIT_MS = null;   // doPost only: how long it waited for the script lock
// __43_ (F86-2): sends queued while the script lock is held, run after it is released (doPost only).
let _DEFER = null;               // { sends: [{label, fn}], keys: [idempotency keys to register after the sends] }
let _AUDIT_CTX = '';             // __43_ (F86-7): 'tpl=... wb=...' appended to every audit row of a doPost run
const CHECKER_LOCK_WAIT_MS   = 20000;          // checker waits this long for the script lock (doPost holds it briefly)
const SHORT_LOCK_WAIT_MS     = 10000;          // re-take the lock after sends: mark col AA sent, register keys
const LADDER_RESEND_AFTER_MS = 3 * 60 * 1000;  // a claimed step still unsent after this is re-sent once
const ALLCLEAR_WAIT_MS       = 20000;          // All Clear waits at most this long for in-flight ladder alerts

const sp = PropertiesService.getScriptProperties();
const tid = sp.getProperty('REPORT_TEMPLATE_ID');
if(tid) CONFIG.REPORT_TEMPLATE_ID = tid;

// Derive the correct emergency services number from the configured country code.
// Used in all alert email templates so contacts see the right number for their region.
const EMERGENCY_NUMBER = (function() {
    const map = { '+64': '111', '+61': '000', '+44': '999', '+1': '911' };
    return map[CONFIG.COUNTRY_CODE] || '111';
})();

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🛡️ OTG Admin')
      .addItem('1. Setup Client Reporting', 'setupClientReporting')
      .addItem('2. Run Monthly Stats', 'runMonthlyStats')
      .addItem('3. Run Travel Report', 'generateWorkerTravelReport')
      .addSeparator()
      .addItem('Send Health Email Now', 'sendHealthEmail')
      .addItem('Run System Diagnostics', 'runDiagnostics')
      .addItem('Geocode Site Locations', 'geocodeSiteLocations')
      .addItem('Force Sync Forms', 'getGlobalForms')
      .addToUi();
}

// ==========================================
// 3. WEB HANDLERS (GET/POST)
// ==========================================
function doGet(e) {
  try {
      if(!e || !e.parameter) return sendResponse(e, {status:"error", message:"No Params"});
      const p = e.parameter;
   // NEW: Version Ping for System Info
      if (p.action === 'ping') {
          return sendResponse(e, { status: "success", version: CONFIG.VERSION, build: TEMPLATE_BUILD });
      }
      if (p.action === 'getDistance' && p.start && p.end) {
          const dist = getRouteDistance(p.start, p.end);
          return sendResponse(e, { status: "success", km: dist });
      }
      if (p.action === 'getDistanceWithTrail' && p.trail) {
          const dist = getRouteDistanceWithTrail(p.trail);
          return dist !== null
              ? sendResponse(e, { status: 'success', km: dist, type: 'road-trail' })
              : sendResponse(e, { status: 'error', message: 'ORS waypoint routing failed' });
      }
      if(p.test) return (p.key === CONFIG.MASTER_KEY) ? sendResponse(e, {status:"success"}) : sendResponse(e, {status:"error"});
      if(p.key === CONFIG.MASTER_KEY && !p.action) return sendResponse(e, getDashboardData());
      if(p.action === 'sync') return (p.key === CONFIG.MASTER_KEY || p.key === CONFIG.WORKER_KEY) ? sendResponse(e, getSyncData(p.worker, p.deviceId)) : sendResponse(e, {status:"error"});
      if(p.action === 'getGlobalForms') return sendResponse(e, getGlobalForms());
      if(p.action === 'viewProcedures' && p.siteName) {
          if (p.key !== CONFIG.MASTER_KEY && p.key !== CONFIG.WORKER_KEY) return sendResponse(e, {status:'error'});
          return getEmergencyProceduresViewer(p.siteName, p.companyName || '');
      }
      return sendResponse(e, {status:"error"});
  } catch(err) { return sendResponse(e, {status:"error", message: err.toString()}); }
}

/**
 * PATCHED: Master Entry Point
 * Integrated routing for Site Procedures and Notice Acknowledgments.
 */
function doPost(e) {
  if(!e || !e.parameter) return sendJSON({status:"error"});
  if(e.parameter.key !== CONFIG.MASTER_KEY && e.parameter.key !== CONFIG.WORKER_KEY) return sendJSON({status:"error"});
  const _ep = e.parameter;
  _AUDIT_CTX = _auditCtxFor_(_ep); // __43_ (F86-7): template name + worker build on every audit row of this run
  const _epStatusIn = String(_ep['Alarm Status'] || ''); // __44_: as sent - handleWorkerPost may rewrite it (PIN clear)

  const lock = LockService.getScriptLock();
  const _lockT0 = Date.now();
  if (lock.tryLock(10000)) {
      _AUDIT_LOCKWAIT_MS = Date.now() - _lockT0; // __38_: recorded on every audit row from this run
      // __43_ (F86-2): everything that sends (alerts, All Clear, form email, test alert) is queued while the lock is
      // held and sent after it is released, so another post or the checker never waits for an email to go out.
      _DEFER = { sends: [], keys: [] };
      const _ikey = String(_ep.idempotencyKey || '');
      let reply, threw = false, lockHeldMs = 0, setInflight = false;
      const _h0 = Date.now();
      try {
          if (_ikey && _inflightGet_(_ikey)) {
              // The same event is still being sent by another run (it holds no lock while it sends). Busy makes the
              // phone retry; by then the key is registered and the retry is acked as a duplicate.
              _audit_('doPost:inflight', _ep['Worker Name'], '', '', '', _ep['Alarm Status'], _ikey,
                      'this event is still being sent by another run - replied Busy');
              reply = { status: 'error', message: 'Busy' };
          } else {
              reply = _doPostRoute_(_ep);
          }
      } catch(err) {
          threw = true;
          _audit_('doPost:error', _ep['Worker Name'], '', '', '', _ep['Alarm Status'], _ep.idempotencyKey,
                  err.toString().substring(0, 200));
          reply = {status:"error", message: err.toString()};
      }
      finally {
          if (_ikey && _DEFER && (_DEFER.sends.length || _DEFER.keys.length)) { _inflightSet_(_ikey, true); setInflight = true; }
          // __38_: commit pending sheet writes before the next execution can take the lock.
          try { SpreadsheetApp.flush(); } catch (_) {}
          lockHeldMs = Date.now() - _h0;
          lock.releaseLock();
      }

      // ---- lock released: send ----
      // A throw still sends what was queued before it (an alarm alert queued ahead of a later error must go out),
      // then replies error so the phone retries. A duplicate beats a miss.
      const job = _DEFER; _DEFER = null;
      const res = _runDeferred_(job.sends);
      if (!threw && res.failed === 0 && job.keys.length) {
          // A1: the key is registered only once the sends are done. Under a short lock: IDEM_KEYS_V1 is read-modify-write.
          _withShortLock_('idem-register', function (got) { job.keys.forEach(function (k) { _idemRegisterNow_(k); }); });
      }
      if (setInflight) _inflightSet_(_ikey, false);
      if (job.sends.length || lockHeldMs >= 2000 || _isAlarmFamilyPost_({ action: _ep.action, 'Alarm Status': _epStatusIn })) {   // __44_ (F88-5a): every alarm-family post
          _audit_('doPost:sends', _ep['Worker Name'], '', '', '', _epStatusIn, _ikey,
                  'lockHeld=' + lockHeldMs + 'ms sends=' + job.sends.length + ' ok=' + res.ok + ' failed=' + res.failed +
                  ' sendTime=' + res.ms + 'ms (after lock release)');
      }
      if (!threw && res.failed > 0) reply = { status: 'error', message: 'Alert send failed - please retry' };
      return sendJSON(reply);
  } else {
      // A1 OPTION 2 (session 72): the lock could not be obtained within 10 s.
      // For life-safety alarms, alert the contacts NOW without touching the sheet,
      // then still reply "Busy" so the worker's outbox keeps retrying and the row
      // lands once the lock frees. _busyPathAlert_() never throws.
      _busyPathAlert_(e.parameter);
      _audit_('doPost:BUSY', e.parameter['Worker Name'], '', '', '', e.parameter['Alarm Status'],
              e.parameter.idempotencyKey, 'Script lock not obtained within 10 s - replied Busy (alarm posts alert via busy path)');
      return sendJSON({status:"error", message:"Busy"});
  }
}

/** __43_: doPost routing, run while the script lock is held. Returns the reply object. */
function _doPostRoute_(p) {
    if (p.action === 'resolve') { handleResolvePost(p); return { status: 'success' }; }
    if (p.action === 'registerDevice') return handleRegisterDevice(p);
    if (p.action === 'acknowledgeNotice') return handleNoticeAck(p);   // NEW 3: Notice Acknowledgments
    if (p.action === 'uploadEmergencyProcedures') { updateSiteEmergencyProcedures(p); handleWorkerPost(p); return { status: 'success' }; }
    if (p.action === 'notifySafety') return handleSafetyResolution(p);
    if (p.action === 'broadcast') return handleBroadcast(p);
    handleWorkerPost(p);
    return { status: 'success' };
}

/**
 * __43_ (F86-2): run fn now, or - inside a locked doPost section - queue it to run after the lock is released.
 * Everything that contacts the outside world (MailApp, SMS, ntfy, geocoding) goes through here on the doPost path.
 */
function _sendOrQueue_(label, fn) {
    if (_DEFER) { _DEFER.sends.push({ label: label, fn: fn }); return; }
    fn();
}

/** __43_: run queued sends in order. One that throws never stops the rest. Returns { ok, failed, ms }. */
function _runDeferred_(sends) {
    const res = { ok: 0, failed: 0, ms: 0 };
    (sends || []).forEach(function (s) {
        const t0 = Date.now();
        try { s.fn(); res.ok++; }
        catch (err) {
            res.failed++;
            _audit_('doPost:send-FAILED', '', '', '', '', '', '', s.label + ' threw after ' + (Date.now() - t0) + 'ms: ' +
                    String(err).substring(0, 200));
        }
        res.ms += Date.now() - t0;
    });
    return res;
}

/**
 * __43_: take the script lock briefly after the sends (mark col AA sent, register idempotency keys), then release.
 * fn(got) runs either way; got = false means the lock was not obtained and fn decides what is safe to do.
 */
function _withShortLock_(label, fn) {
    const lock = LockService.getScriptLock();
    let got = false;
    try { got = lock.tryLock(SHORT_LOCK_WAIT_MS); } catch (_) { got = false; }
    try { fn(got); }
    catch (err) { _audit_(label + ':error', '', '', '', '', '', '', String(err).substring(0, 200)); }
    finally {
        if (got) { try { SpreadsheetApp.flush(); } catch (_) {} lock.releaseLock(); }
    }
    if (!got) _audit_(label + ':no-lock', '', '', '', '', '', '', 'script lock not obtained within ' + SHORT_LOCK_WAIT_MS + ' ms');
}

/** __43_: an event whose sends are still running in another execution. CacheService; never throws. */
function _inflightGet_(key) {
    try { return CacheService.getScriptCache().get('INFLIGHT_' + String(key).substring(0, 200)) === '1'; } catch (_) { return false; }
}
function _inflightSet_(key, on) {
    try { CacheService.getScriptCache().put('INFLIGHT_' + String(key).substring(0, 200), on ? '1' : '0', on ? 300 : 1); } catch (_) {}
}

/** __43_ (F86-7): 'tpl=<Template Name> wb=<Worker Build>' for the audit rows of one post ('' when neither is sent). */
function _auditCtxFor_(p) {
    const bits = [];
    const t = String((p && p['Template Name']) || '').trim();
    const wb = String((p && p['Worker Build']) || '').trim();
    if (t) bits.push('tpl=' + t.substring(0, 60));
    if (wb) bits.push('wb=' + wb.substring(0, 30));
    return bits.join(' ');
}

/**
 * A1 OPTION 2 - alert contacts when doPost cannot get the script lock.
 * Applies to PANIC, DURESS and Critical Timing OVERDUE ALARM posts only.
 *
 * Runs WITHOUT the script lock, so it must never write to the sheet or to
 * IDEM_KEYS_V1. Reads only.
 *
 * Dedup: the worker outbox retries a Busy reply every few seconds. Without a
 * guard, every busy retry would re-alert the contacts. A CacheService entry
 * keyed on the idempotency key allows ONE busy-path alert per event. The normal
 * path (handleWorkerPost) still alerts when the row finally saves, so the worst
 * case is two alert rounds per event - accepted by Russell (session 72).
 */
function _busyPathAlert_(p) {
    try {
        if (!p) return;
        const act = (p.action || '').toString();
        const NON_ALERT_ACTIONS = ['resolve', 'registerDevice', 'acknowledgeNotice',
                                   'uploadEmergencyProcedures', 'notifySafety', 'broadcast'];
        if (NON_ALERT_ACTIONS.indexOf(act) > -1) return;

        const status = (p['Alarm Status'] || '').toString().toUpperCase();
        if (status.includes('ALARM_GPS_PULSE')) return;
        const isCriticalOverdue = status.includes('OVERDUE ALARM') && p['Critical Timing'] === 'true';
        const isAlarm = status.includes('PANIC') || status.includes('DURESS') || isCriticalOverdue;
        if (!isAlarm) return;

        // One busy-path alert per event (idempotency key). Put the marker BEFORE
        // sending so a near-simultaneous retry is very unlikely to double up.
        const key = (p.idempotencyKey || '').toString();
        if (key) {
            const cache = CacheService.getScriptCache();
            const cacheKey = 'BUSYALERT_' + key.substring(0, 200);
            if (cache.get(cacheKey)) {
                console.log('[busyPath] Already alerted for ' + key + ' - skipping.');
                return;
            }
            cache.put(cacheKey, '1', 21600); // 6 h, the CacheService maximum
        }

        // Read-only lookup of the worker's open row notes, so triggerAlerts() can
        // detect Critical Timing and travel wording exactly as the normal path does.
        const alertPayload = Object.assign({}, p);
        let visitNotes = '';
        try {
            const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Visits');
            const lastRow = sheet ? sheet.getLastRow() : 0;
            if (lastRow > 1) {
                const startRow = Math.max(2, lastRow - 50);
                // __42_ (B1): read through col AA so the ladder-started check sees the ladder memory.
                const data = sheet.getRange(startRow, 1, lastRow - startRow + 1, _readWidth_(sheet)).getValues();
                for (let i = data.length - 1; i >= 0; i--) {
                    if (data[i][2] === p['Worker Name']) {
                        const st = String(data[i][10]);
                        const closed = st.includes('DEPARTED') || st.includes('COMPLETED') ||
                                       st.includes('DATA_ENTRY_ONLY') || st.includes('USER_SAFE') ||
                                       st.includes('PRE_VISIT');
                        if (!closed) {
                            visitNotes = String(data[i][11] || '');
                            // Critical Timing merge: once due, word it as ladder step 1 (urgent).
                            const due = new Date(data[i][20]);
                            if (isCriticalOverdue && _ladderStartedFor_(st, data[i][LADDER_MEM_COL - 1], data[i][20])) {
                                console.log('[busyPath] Server ladder already alerting - skipping.');
                                return;
                            }
                            if (isCriticalOverdue && !isNaN(due.getTime()) && new Date() >= due) {
                                alertPayload['Alarm Status'] = 'EMERGENCY - CRITICAL TIMING BREACH';
                            }
                        }
                        break;
                    }
                }
            }
        } catch (readErr) { console.warn('[busyPath] Visit notes lookup failed: ' + readErr); }
        if (isCriticalOverdue && !visitNotes.includes('[CRITICAL_TIMING]')) {
            visitNotes = (visitNotes + ' [CRITICAL_TIMING]').trim();
        }
        alertPayload['Visit Notes'] = alertPayload['Visit Notes'] || visitNotes;

        console.warn('[busyPath] Lock busy - alerting contacts directly for ' +
                     (p['Worker Name'] || '?') + ' status=' + status + ' key=' + key);
        triggerAlerts(alertPayload, 'IMMEDIATE');
    } catch (err) {
        console.error('[busyPath] Alert failed: ' + err.toString());
    }
}

// ==========================================
// 4. REPORTING ENGINE (BI LAYER)
// ==========================================

function setupClientReporting() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.prompt("Setup Client Reporting", "Enter exact Client Company Name (as it appears in 'Sites' tab):", ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  
  const clientName = resp.getResponseText().trim();
  if (!clientName) return;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let indexSheet = ss.getSheetByName('Reporting');
  if (!indexSheet) {
      indexSheet = ss.insertSheet('Reporting');
      indexSheet.appendRow(["Client Name", "Report Sheet ID", "Last Updated"]);
      indexSheet.getRange(1,1,1,3).setFontWeight("bold").setBackground("#e2e8f0");
  }

  const newSheetName = `Stats - ${clientName}`;
  let reportSheet = ss.getSheetByName(newSheetName);
  if (reportSheet) { ui.alert("Sheet already exists!"); return; }
  
  reportSheet = ss.insertSheet(newSheetName);
  reportSheet.appendRow(["Month", "Total Visits", "Total Hours", "Avg Duration", "Safety Checks %", "Numeric Sums (Mileage/etc)"]);
  reportSheet.setFrozenRows(1);
  reportSheet.getRange(1,1,1,6).setFontWeight("bold").setBackground("#1e40af").setFontColor("white");

  indexSheet.appendRow([clientName, reportSheet.getSheetId().toString(), new Date()]);
  ui.alert(`✅ Reporting setup for ${clientName}. \n\nYou can now run 'Monthly Stats' to populate this sheet.`);
}

function runMonthlyStats() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.prompt("Run Monthly Stats", "Enter Month (YYYY-MM):", ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  
  const monthStr = resp.getResponseText().trim();
  if (!/^\d{4}-\d{2}$/.test(monthStr)) { ui.alert("Invalid format. Use YYYY-MM."); return; }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const visitsSheet = ss.getSheetByName('Visits');
  const indexSheet = ss.getSheetByName('Reporting');
  
  if (!visitsSheet || !indexSheet) { ui.alert("Missing 'Visits' or 'Reporting' tabs."); return; }

  const data = visitsSheet.getDataRange().getValues();
  const headers = data.shift();
  
  const dateIdx = headers.indexOf("Timestamp");
  const compIdx = headers.indexOf("Location Name"); 
  const reportIdx = headers.indexOf("Visit Report Data");
  
  const start = new Date(monthStr + "-01");
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);

  const stats = {}; 

  data.forEach(row => {
      const d = new Date(row[dateIdx]);
      if (d >= start && d <= end) {
          let client = "Unknown";
          const clientList = indexSheet.getDataRange().getValues().map(r => r[0]);
          const locName = row[compIdx].toString();
          
          const matchedClient = clientList.find(c => locName.includes(c));
          if (matchedClient) client = matchedClient;
          else return; 

          if (!stats[client]) stats[client] = { visits: 0, duration: 0, sums: {} };
          stats[client].visits++;
          
          const jsonStr = row[reportIdx];
          if (jsonStr && jsonStr.startsWith("{")) {
              try {
                  const report = JSON.parse(jsonStr);
                  for (const [k, v] of Object.entries(report)) {
                      const num = parseFloat(v);
                      if (!isNaN(num)) {
                          if (!stats[client].sums[k]) stats[client].sums[k] = 0;
                          stats[client].sums[k] += num;
                      }
                  }
              } catch(e) {}
          }
      }
  });

  const clients = indexSheet.getDataRange().getValues();
  let updatedCount = 0;

  clients.forEach(row => {
      const clientName = row[0];
      const sheetId = row[1];
      if (stats[clientName]) {
          const allSheets = ss.getSheets();
          const targetSheet = allSheets.find(s => s.getSheetId().toString() === sheetId.toString());
          
          if (targetSheet) {
              const s = stats[clientName];
              const sumStr = Object.entries(s.sums).map(([k,v]) => `${k}: ${v}`).join(", ");
              
              targetSheet.appendRow([
                  monthStr,
                  s.visits,
                  (s.visits * 0.5).toFixed(1), 
                  "N/A",
                  "100%",
                  sumStr
              ]);
              updatedCount++;
          }
      }
  });

  ui.alert(`Stats Run Complete. Updated ${updatedCount} client sheets.`);
}

function generateWorkerTravelReport() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const visitsSheet = ss.getSheetByName('Visits');
  if (!visitsSheet) { SpreadsheetApp.getUi().alert("Error: 'Visits' sheet not found."); return; }

  const ui = SpreadsheetApp.getUi();
  const resp = ui.prompt("Run Travel Report", "Enter Month (YYYY-MM):", ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;

  const monthStr = resp.getResponseText().trim();
  if (!/^\d{4}-\d{2}$/.test(monthStr)) { ui.alert("Invalid format. Use YYYY-MM."); return; }

  const reportSheetName = "Travel Report - " + monthStr;
  let reportSheet = ss.getSheetByName(reportSheetName);
  if (reportSheet) ss.deleteSheet(reportSheet);
  reportSheet = ss.insertSheet(reportSheetName);

  const data = visitsSheet.getDataRange().getValues();
  const headers = data.shift();

  const col = {
    worker:   headers.indexOf("Worker Name"),
    arrival:  headers.indexOf("Timestamp"),
    report:   headers.indexOf("Visit Report Data"),
    location: headers.indexOf("Location Name")
  };

  const tz    = Session.getScriptTimeZone();
  const start = new Date(monthStr + "-01T00:00:00");
  const end   = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59);

  // ── Build site name → company lookup from Sites sheet ────────────────────────
  const siteCompanyMap = {};
  const sitesSheet = ss.getSheetByName('Sites');
  if (sitesSheet && sitesSheet.getLastRow() > 1) {
    const sData = sitesSheet.getRange(2, 1, sitesSheet.getLastRow() - 1, 4).getValues();
    sData.forEach(function(r) {
      // Sites sheet: A=Assigned To, B=Template Name, C=Company Name, D=Site Name
      const siteName    = String(r[3] || '').trim();
      const companyName = String(r[2] || '').trim();
      if (siteName) siteCompanyMap[siteName] = companyName;
    });
  }

  // Keys that are promoted to named columns — excluded from extra-fields discovery.
  // Distance keys are matched by regex below so not listed here.
  const SKIP_KEYS = new Set(['trip start point', 'trip destination', 'company name', 'company']);

  // ── Pass 1: filter to Travel Report rows, discover extra field keys ──────────
  const trips      = [];
  const extraKeyOrder = []; // insertion-ordered unique extra keys
  const extraKeySet   = new Set();

  data.forEach(function(row) {
    const d = new Date(row[col.arrival]);
    if (d < start || d > end) return;
    const worker = String(row[col.worker] || '').trim();
    if (!worker) return;

    const raw = row[col.report];
    if (!raw || typeof raw !== 'string' || raw.charAt(0) !== '{') return;

    var json;
    try {
      var _raw = JSON.parse(raw);
      json = {};
      for (var _k in _raw) { json[_k.toLowerCase()] = _raw[_k]; }
    } catch(e) { return; }

    // Travel Report filter: presence of trip endpoint keys (only injected by _injectTripEndpointFields)
    if (!json.hasOwnProperty('trip start point') && !json.hasOwnProperty('trip destination')) return;

    // Extract standard fields
    // Site name comes from the Visits sheet Location Name column (most reliable source).
    var site    = col.location > -1 ? String(row[col.location] || '').trim() : '';
    // Company: look up from Sites sheet using site name; fall back to JSON fields if present.
    var company = (site && siteCompanyMap[site]) ? siteCompanyMap[site]
                : String(json['company name'] || json['company'] || '').trim();
    var from    = String(json['trip start point'] || '').trim();
    var to      = String(json['trip destination']  || '').trim();

    // Distance: first key matching /km|odo|dist/i (excluding endpoint keys)
    var dist = '';
    for (var k in json) {
      if (SKIP_KEYS.has(k)) continue;
      if (/km|odo|dist/i.test(k)) {
        var v = parseFloat(json[k]);
        if (!isNaN(v)) { dist = v; break; }
      }
    }

    // Collect remaining keys as extra columns (stable insertion order)
    for (var ek in json) {
      if (SKIP_KEYS.has(ek)) continue;
      if (/km|odo|dist/i.test(ek)) continue;
      if (!extraKeySet.has(ek)) {
        extraKeySet.add(ek);
        extraKeyOrder.push(ek);
      }
    }

    trips.push({ date: d, worker: worker, site: site, company: company, from: from, to: to, dist: dist, json: json });
  });

  if (trips.length === 0) {
    ui.alert("No Travel Report submissions found for " + monthStr + ".");
    ss.deleteSheet(reportSheet);
    return;
  }

  // Sort chronologically, then alphabetically by worker within the same timestamp
  trips.sort(function(a, b) { return a.date - b.date || a.worker.localeCompare(b.worker); });

  // Sort extra keys alphabetically for consistent column order
  const extraKeys = extraKeyOrder.slice().sort();

  // Title-case helper for column headers
  function toTitleCase(str) {
    return str.replace(/\b\w/g, function(c) { return c.toUpperCase(); });
  }

  // ── Build header row ─────────────────────────────────────────────────────────
  const FIXED_HEADERS = ["Worker Name", "Date", "Site Name", "Company", "From", "To", "Total km"];
  const allHeaders    = FIXED_HEADERS.concat(extraKeys.map(toTitleCase));
  const numCols       = allHeaders.length;

  // Title
  reportSheet.getRange(1, 1).setValue("Travel Report: " + monthStr)
    .setFontWeight("bold").setFontSize(14);

  // Header row
  const headerRange = reportSheet.getRange(2, 1, 1, numCols);
  headerRange.setValues([allHeaders])
    .setFontWeight("bold")
    .setBackground("#e2e8f0")
    .setBorder(false, false, true, false, false, false);

  // ── Data rows ────────────────────────────────────────────────────────────────
  const rows = trips.map(function(t) {
    var dateStr = Utilities.formatDate(t.date, tz, "dd/MM/yyyy HH:mm");
    var fixed   = [t.worker, dateStr, t.site, t.company, t.from, t.to, t.dist !== '' ? t.dist : '-'];
    var extra   = extraKeys.map(function(k) {
      var val = t.json[k];
      if (val === undefined || val === null || val === '') return '';
      if (typeof val === 'boolean') return val ? 'Yes' : 'No';
      return String(val);
    });
    return fixed.concat(extra);
  });

  reportSheet.getRange(3, 1, rows.length, numCols).setValues(rows);

  // ── Totals row ───────────────────────────────────────────────────────────────
  var totalKm = trips.reduce(function(sum, t) {
    return sum + (typeof t.dist === 'number' ? t.dist : 0);
  }, 0);
  var totalsRow = new Array(numCols).fill('');
  totalsRow[0] = 'TOTAL (' + trips.length + ' trip' + (trips.length !== 1 ? 's' : '') + ')';
  totalsRow[6] = totalKm > 0 ? totalKm.toFixed(1) : '-';

  var totalsRange = reportSheet.getRange(3 + rows.length, 1, 1, numCols);
  totalsRange.setValues([totalsRow])
    .setFontWeight("bold")
    .setBorder(true, false, false, false, false, false);

  reportSheet.autoResizeColumns(1, numCols);
  ui.alert("Travel Report generated — " + trips.length + " trip(s) for " + monthStr + ".");
}

// ==========================================
// 5. CORE LOGIC (WORKER/MONITOR)
// ==========================================

/**
 * RE-ENGINEERED: handleResolvePost
 * Logic: Updates the Visit record AND triggers "All Clear" alerts to contacts.
 */
function handleResolvePost(p) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Visits');
    const workerName = p['Worker Name'];
    const lastRow = sheet.getLastRow();
    let rowUpdated = false;
    let _hqAudience = 'none';   // __45_ (F89-2)

    if (lastRow > 1) {
        const startRow = Math.max(2, lastRow - 50); 
        const numRows = lastRow - startRow + 1;
        // A14 (session 72): read through col L - Notes. Reading only A-K made rowData[11]
        // undefined, so the line below wrote the word "undefined" over the visit Notes
        // and erased the [CRITICAL_TIMING] / [START_GPS] tags.
        // __45_ (F89-2): read through col AA so the All Clear audience can be decided from what was sent.
        const data = sheet.getRange(startRow, 1, numRows, _readWidth_(sheet)).getValues();
        for (let i = data.length - 1; i >= 0; i--) {
            const rowData = data[i];
            if (rowData[2] === workerName) {
                const status = String(rowData[10]);
                // Targets active safety alerts
                if (status.includes('EMERGENCY') || status.includes('PANIC') || status.includes('DURESS') || status.includes('OVERDUE')) {
                    const targetRow = startRow + i;
                    _hqAudience = _alertAudience_(rowData);   // __45_ (F89-2): before the row is overwritten
                    sheet.getRange(targetRow, 11).setValue(p['Alarm Status']); 
                    _audit_('handleResolvePost', workerName, targetRow, status, p['Alarm Status'], p['Alarm Status'], p.idempotencyKey, 'alarm resolved');
                    sheet.getRange(targetRow, 12).setValue((String(rowData[11] || '') + "\n" + (p['Notes'] || '')).trim()); 
                    rowUpdated = true;
                    break;
                }
            }
        }

        // NOTE: The second loop that used to close stale ARRIVED rows has been removed.
        // triggerEscalation() now updates the existing row in place (see one-row-per-visit
        // architecture), so there is no orphaned ARRIVED row to sweep up here.
    }
    
    // Fallback: If no active visit is found, log the resolution as a new entry
    if (!rowUpdated) {
        const ts = new Date();
        const dateStr = Utilities.formatDate(ts, CONFIG.TIMEZONE, "yyyy-MM-dd");
        const row = [
            ts.toISOString(), dateStr, workerName, p['Worker Phone Number'], 
            p['Emergency Contact Name'], p['Emergency Contact Number'], p['Emergency Contact Email'], 
            p['Escalation Contact Name'], p['Escalation Contact Number'], p['Escalation Contact Email'], 
            p['Alarm Status'], p['Notes'], p['Location Name'], p['Location Address'], 
            p['Last Known GPS'], p['Timestamp'], p['Battery Level'], "", "", "", "", "", "", "", ""
        ];
        sheet.appendRow(row);
        _audit_('handleResolvePost:new', workerName, sheet.getLastRow(), '', p['Alarm Status'], p['Alarm Status'], p.idempotencyKey, 'no open alarm row - new row appended');
    }

    // NEW: TRIGGER "ALL CLEAR" NOTIFICATIONS
    // This sends the Email and SMS to both emergency contacts immediately.
    // forceNotify=true bypasses the alertWasSent guard (which would wrongly suppress
    // All Clear because handleResolvePost has already updated the row to USER_SAFE).
    // It also skips the internal handleWorkerPost() call — already done above.
    // __45_ (F89-2): an All Clear only to the contacts who were alerted - none when nobody was.
    if (_hqAudience === 'none') {
        _audit_('handleResolvePost:no-alarm', workerName, '', '', '', p['Alarm Status'], p.idempotencyKey,
                'no contact was alerted for this visit - resolved, All Clear not sent');
        return;
    }
    handleSafetyResolution(p, true, _hqAudience);
}
function handleWorkerPost(p) {
    // ── IDEMPOTENCY GUARD ────────────────────────────────────────────────────
    // The IndexedDB outbox on the worker device retries failed deliveries until
    // it receives an HTTP 200. Under no-cors mode the response is always opaque,
    // so the outbox cannot distinguish a genuine failure from a GAS redirect —
    // it retries conservatively. Without a dedup check a single alarm event
    // could produce multiple spreadsheet rows.
    //
    // Strategy: maintain a rolling set of the last 200 seen keys in a single
    // PropertiesService entry (JSON array, ~5 KB — well under the 9 KB limit).
    // Keys are only present when the worker app sends them; legacy payloads
    // without the field are passed through unchanged.
    //
    // A1 (session 72): the key is CHECKED here but only REGISTERED once the work
    // has completed (see _idemRegister_ calls below). If anything throws part-way,
    // doPost replies with an error, the outbox retries, and the retry is processed
    // instead of being discarded. Rare cost: a duplicate row if the throw happens
    // after the row write. A lost alert is never the cost.
    if (p.idempotencyKey && _idemSeen_(p.idempotencyKey)) {
        // Duplicate delivery — ack (doPost returns success) without writing to the sheet.
        console.log('Outbox dedup: discarding duplicate key ' + p.idempotencyKey);
        return;
    }
    // ── END IDEMPOTENCY GUARD ────────────────────────────────────────────────

    // ── TEST_ALERT FAST PATH ─────────────────────────────────────────────────
    // TEST_ALERT must never touch the Visits sheet. Writing it would overwrite the
    // open ARRIVED row's status, stranding the visit and blocking the next real
    // visit from correctly writing its address details.
    if (p['Alarm Status'] && p['Alarm Status'].includes('TEST_ALERT')) {
        const _tp = Object.assign({}, p);
        _sendOrQueue_('test-alert', function () { triggerAlerts(_tp, "TEST"); }); // __43_: after lock release
        _idemRegister_(p.idempotencyKey);
        return;
    }
    // ── END TEST_ALERT FAST PATH ─────────────────────────────────────────────

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName('Visits');
    const workerName = p['Worker Name'];
    const templateName = p['Template Name'] || "";
    const isNoteToSelf = (templateName.trim().toLowerCase() === 'note to self');
    const _statusAsSent = String(p['Alarm Status'] || '');   // __45_ (ledger): before any restore / merge rewrites it

    let p1="", p2="", p3="", p4="", sig="";
    if(p['Photo 1']) p1 = saveImage(p['Photo 1'], workerName);
    if(p['Photo 2']) p2 = saveImage(p['Photo 2'], workerName);
    if(p['Photo 3']) p3 = saveImage(p['Photo 3'], workerName);
    if(p['Photo 4']) p4 = saveImage(p['Photo 4'], workerName);
    if(p['Signature']) sig = saveImage(p['Signature'], workerName, true); 

    const ts = new Date();
    const dateStr = Utilities.formatDate(ts, CONFIG.TIMEZONE, "yyyy-MM-dd");
    let polishedNotes = p['Notes'] || "";
    const hasFormData = p['Visit Report Data'] && p['Visit Report Data'].length > 2;

    let distanceValue = p['Distance'] || ""; 

    if (hasFormData) {
        try {
            const reportObj = JSON.parse(p['Visit Report Data']);
            if (CONFIG.GEMINI_API_KEY && CONFIG.GEMINI_API_KEY.length > 10) {
                polishedNotes = smartScribe(reportObj, templateName, p['Notes']);
            }
            for (let key in reportObj) {
                if (/km|mil|dist|odo/i.test(key)) { 
                    let val = parseFloat(reportObj[key]);
                    if (!isNaN(val)) { distanceValue = val; break; }
                }
            }
        } catch(e) { console.error("Data Parsing Error: " + e); }
    }
    
    let existingVisitNotes = ''; // captured from matched row for use in triggerAlerts
    let _latestClosed = null;    // __42_ B4: the worker's latest row when it is closed
    let criticalBridgeSuppressed = false; // merge: server ladder already alerting for this visit
    let _mergeMark = null;       // __43_: the phone-merged BREACH claim, marked '|SENT' once its alerts have gone
    let _ledgerRow = null, _ledgerNew = false;   // __45_ (ledger): the Visits row this post wrote, and whether it was new
    // __44_ (Decision A / F87-3 / HANDOVER_84 item 2): a form record goes to the Forms tab and never writes the trip row.
    const _formRoute = isNoteToSelf ? null : _formRouteFor_(sheet, workerName, p);
    if (_formRoute) {
        _formsRecord_(ss, sheet, p, _formRoute, polishedNotes, distanceValue, sig, p1, p2, p3, p4);
    } else if (!isNoteToSelf) {
        if(!sheet) {
            sheet = ss.insertSheet('Visits');
            sheet.appendRow(["Timestamp", "Date", "Worker Name", "Worker Phone Number", "Emergency Contact Name", "Emergency Contact Number", "Emergency Contact Email", "Escalation Contact Name", "Escalation Contact Number", "Escalation Contact Email", "Alarm Status", "Notes", "Location Name", "Location Address", "Last Known GPS", "GPS Timestamp", "Battery Level", "Photo 1", "Distance (km)", "Visit Report Data", "Anticipated Departure Time", "Signature", "Photo 2", "Photo 3", "Photo 4"]);
        }
        
        let rowUpdated = false;
        const lastRow = sheet.getLastRow();
        const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
        const distColIdx = headers.indexOf("Distance (km)");

        // CRITICAL: ARRIVED and TRAVELLING always start a fresh row.
        // Never match an existing open row — doing so would contaminate a previous
        // visit's row with data from a new session. handleResolvePost() is responsible
        // for closing all open rows when a worker declares safe; any open row remaining
        // at this point is stale and must not be reused.
        // PRE_VISIT always creates a fresh row — never updates a stale open row.
        // Without this, PRE_VISIT silently overwrites an old abandoned row elsewhere
        // in the sheet and the pre-visit photo never appears at the bottom.
        const isNewVisit = (p['Alarm Status'] === 'ARRIVED' || p['Alarm Status'] === 'TRAVELLING' || p['Alarm Status'] === 'PRE_VISIT');

        if (lastRow > 1 && !isNewVisit) {
            const startRow = Math.max(2, lastRow - 50); 
            const numRows = lastRow - startRow + 1;
            // A14 (session 72): read through col U. Reading only A-K left rowData[11] (Notes)
            // undefined, so alerts never saw [CRITICAL_TIMING] or travel tags - the Critical
            // Timing bridge alert went out as an amber "OVERDUE - MISSED CHECK-IN" at
            // 'high' priority (confirmed on device 13 Oct 2026). Col U = due time (merge below).
            // __42_: read through col AA (ladder memory) for the Critical Timing merge check.
            const data = sheet.getRange(startRow, 1, numRows, _readWidth_(sheet)).getValues(); 
            for (let i = data.length - 1; i >= 0; i--) {
                const rowData = data[i];
                if (rowData[2] === workerName) {
                    const status = String(rowData[10]);
                    // __42_ B4: PRE_VISIT / DATA_ENTRY_ONLY rows are records, not visit rows - look past them.
                    if (status.includes('PRE_VISIT') || status.includes('DATA_ENTRY_ONLY')) continue;
                    // ONE-ROW-PER-VISIT: USER_SAFE_CONFIRMED is treated as open when the
                    // incoming payload is DEPARTED — the worker confirmed safe, then submitted
                    // their report. Both events must land on the same row. For all other
                    // incoming statuses, USER_SAFE_CONFIRMED is treated as closed (prevents
                    // GPS pulses or OVERDUE payloads reopening a resolved row).
                    const incomingIsDeparted = (p['Alarm Status'] || '').includes('DEPARTED');
                    const isClosed = status.includes('DEPARTED') || status.includes('COMPLETED') || status.includes('DATA_ENTRY_ONLY') || status.includes('PRE_VISIT') || (status.includes('USER_SAFE') && !incomingIsDeparted);
                    
                    if (!isClosed) {
                        const targetRow = startRow + i;
                        sheet.getRange(targetRow, 1).setValue(ts.toISOString()); 
                        // Guard col K against downgrades.
                        // HIGH_SEVERITY statuses (EMERGENCY, PANIC, DURESS, OVERDUE ALARM) must
                        // never be overwritten by lower-priority statuses (OVERDUE, ALARM_GPS_PULSE).
                        // triggerEscalation() updates the existing row in place (one-row-per-visit);
                        // subsequent GPS pulses must not clobber the escalation status it wrote.
                        //
                        // A6 (session 72): severity ranking replaces the old LOW_PRIORITY list,
                        // which only blocked OVERDUE and ALARM_GPS_PULSE. Routine posts (LOW BATTERY,
                        // WELFARE_OK, MID_VISIT_UPDATE, ON SITE, VEHICLE_CHECK_COMPLETED,
                        // PROCEDURES_UPDATED, TEST_ALERT, plain OVERDUE) can no longer overwrite an
                        // alarm. Only a clearing status (USER_SAFE*, EXTENDED, DEPARTED, COMPLETED)
                        // or an equal/higher alarm may replace one. Needed now that the worker
                        // outbox can send an alarm ahead of older routine records.
                        //
                        // CRITICAL TIMING MERGE (session 72, Russell): the phone posts OVERDUE ALARM
                        // with Critical Timing at the due time. Once the due time has passed, record it
                        // as ladder step 1 (EMERGENCY - CRITICAL TIMING BREACH) so checkOverdueVisits()
                        // continues with REPEAT at due + 5 and FINAL NOTICE at due + 10 instead of
                        // sending a second step-1 alert a minute later. If the server ladder has already
                        // started (col K holds a CRITICAL TIMING step), this post neither alerts nor
                        // touches col K - otherwise a late phone post would reset the ladder.
                        // Before the due time, a Critical Timing OVERDUE ALARM is a missed welfare
                        // check and is left unchanged.
                        const _origIncoming = String(p['Alarm Status'] || ''); // __38_: as sent, before any merge
                        let _mergedBreachDue = null; // __38_: due time of a phone-merged BREACH (ladder memory)
                        if ((p['Alarm Status'] || '').toUpperCase().includes('OVERDUE ALARM') && p['Critical Timing'] === 'true') {
                            const _rowDue = new Date(rowData[20]);
                            // __42_ (B1): col K CRITICAL TIMING step OR col AA step 1+ for this due time.
                            const _ladderStarted = _ladderStartedFor_(rowData[10], rowData[LADDER_MEM_COL - 1], rowData[20]);
                            if (_ladderStarted) {
                                criticalBridgeSuppressed = true;
                            } else if (!isNaN(_rowDue.getTime()) && ts >= _rowDue) {
                                p['Alarm Status'] = 'EMERGENCY - CRITICAL TIMING BREACH';
                                _mergedBreachDue = _rowDue;
                            }
                        }
                        // __42_ B2: a PIN clear is an event, not an end. USER_SAFE_CONFIRMED on a visit row
                        // (readable due time in col U) restores the visit status and leaves the row OPEN, so
                        // checkOverdueVisits still escalates at the due time if the worker never departs.
                        // Outside a visit (no due time) it closes the row as before.
                        let _pinClearNote = '';
                        if (_origIncoming.toUpperCase().includes('USER_SAFE')) {
                            const _clrDue = new Date(rowData[20]);
                            const _clrTime = Utilities.formatDate(ts, CONFIG.TIMEZONE, 'HH:mm:ss');
                            if (rowData[20] && !isNaN(_clrDue.getTime())) {
                                const _restored = String(rowData[11] || '').includes('Travel to') ? 'TRAVELLING' : 'ARRIVED';
                                p['Alarm Status'] = _restored;
                                _pinClearNote = 'pin-clear: restored to ' + _restored + ', row stays open';
                            } else {
                                _pinClearNote = 'pin-clear: no visit due time - row closed';
                            }
                            polishedNotes = '[PIN CLEAR ' + _clrTime + '] ' + (polishedNotes || 'Worker confirmed safe via PIN entry.');
                        }
                        const _existingStatus = String(rowData[10]).toUpperCase();
                        const _incomingStatus = (p['Alarm Status'] || '').toUpperCase();
                        const _existingRank   = _alarmRank_(_existingStatus);
                        const _existingIsHigh = _existingRank >= 2;
                        const _incomingClears = !!_pinClearNote || ['USER_SAFE', 'EXTENDED', 'DEPARTED', 'COMPLETED'].some(s => _incomingStatus.includes(s));
                        const _incomingIsLow  = !_incomingClears && _alarmRank_(_incomingStatus) < _existingRank;
                        const _isGpsPulse     = _incomingStatus.includes('ALARM_GPS_PULSE');
                        // __45_ (F89-4): a standard OVERDUE ALARM queued before a PIN clear or extend can land after it, carrying
                        // the earlier due time. It alerts nobody (the checker owns standard escalation), so it must not write
                        // col K over the restored status. Critical Timing posts are not affected (alarm lane, in order).
                        const _staleAlarm     = _origIncoming.toUpperCase().includes('OVERDUE ALARM') && p['Critical Timing'] !== 'true' &&
                                                _isEarlierDue_(p['Anticipated Departure Time'], rowData[20]);
                        // __44_ (item 8): OVERDUE / LOW BATTERY / WELFARE_OK never write col K on an existing row.
                        const _isRoutineNoK   = ROUTINE_NO_K_STATUSES.indexOf(_incomingStatus.trim()) > -1;
                        if (ROUTINE_NOTE_TAG.indexOf(_incomingStatus.trim()) > -1) {
                            polishedNotes = '[' + _incomingStatus.trim() + ' ' + Utilities.formatDate(ts, CONFIG.TIMEZONE, 'HH:mm:ss') + '] ' + (polishedNotes || '');
                        }
                        // ALARM_GPS_PULSE must never update col K — it is a location-only update.
                        // Writing ALARM_GPS_PULSE to col K replaces TRAVELLING, causing the monitor's
                        // processWorkers to see an unrecognised status in neither JOURNEY_START_STATUSES
                        // nor JOURNEY_CLOSED_STATUSES — the journey enters limbo and the worker
                        // disappears from the map. All other non-pulse payloads: guard against
                        // HIGH_SEVERITY downgrades only.
                        if (!_isGpsPulse && !_isRoutineNoK && !_staleAlarm && !criticalBridgeSuppressed && !(_existingIsHigh && _incomingIsLow)) {
                            sheet.getRange(targetRow, 11).setValue(p['Alarm Status']);
                            _audit_(_pinClearNote ? 'handleWorkerPost:pin-clear' : 'handleWorkerPost', workerName, targetRow, rowData[10], p['Alarm Status'], _origIncoming, p.idempotencyKey,
                                    _mergedBreachDue ? 'Critical Timing merge: OVERDUE ALARM recorded as BREACH' : _pinClearNote);
                            // __38_: a phone-merged BREACH is ladder step 1 for this due time.
                            if (_mergedBreachDue) {
                                const _cv = _ladderMemClaim_(sheet, targetRow, _mergedBreachDue, 1, 'handleWorkerPost:merge', workerName);
                                if (_cv) _mergeMark = { rowNum: targetRow, worker: workerName, claimVal: _cv };
                            }
                        } else if (!_isGpsPulse) {
                            _audit_(_staleAlarm ? 'handleWorkerPost:stale-alarm' : _isRoutineNoK ? 'handleWorkerPost:k-kept' : 'handleWorkerPost:skip', workerName, targetRow, rowData[10], '', _origIncoming, p.idempotencyKey,
                                    _staleAlarm ? 'standard OVERDUE ALARM for an earlier due time - col K not written (F89-4)'
                                    : _isRoutineNoK ? 'routine status - col K not written (item 8)'
                                    : criticalBridgeSuppressed ? 'Critical Timing ladder already started - col K not written'
                                                             : 'A6 guard - lower-severity status not written over an alarm');
                        }
                        // __43_ (F86-8): 0 km is a real value (a stationary trip). The falsy check used to skip it.
                        if (distanceValue !== '' && distanceValue !== null && distanceValue !== undefined && distColIdx > -1) sheet.getRange(targetRow, distColIdx + 1).setValue(distanceValue);
                        if (polishedNotes && polishedNotes !== rowData[11]) {
                             const oldNotes = sheet.getRange(targetRow, 12).getValue();
                             if (!oldNotes.includes(polishedNotes)) sheet.getRange(targetRow, 12).setValue((oldNotes + "\n" + polishedNotes).trim());
                        }
                        // __40_: ignore a 'no fix' position so it cannot overwrite a real one already in col O.
                        const _gpsIn = (p['Last Known GPS'] || '').toString().replace(/\s+/g, '');
                        if (_gpsIn && _gpsIn !== '0,0' && _gpsIn !== '0.0,0.0') {
                            sheet.getRange(targetRow, 15).setValue(p['Last Known GPS']); // col O: Last Known GPS
                            sheet.getRange(targetRow, 16).setValue(ts.toISOString());    // col P: GPS Timestamp
                        }
                        if (p['Visit Report Data']) sheet.getRange(targetRow, headers.indexOf("Visit Report Data") + 1).setValue(p['Visit Report Data']);
                        const deptCol = headers.indexOf("Anticipated Departure Time");
                        // __42_ B3: on an existing row the due time only moves LATER (extend, PIN clear after due).
                        // A post queued on the phone before the change still carries the old due time; letting it
                        // write col U would put the ladder back on the old due time.
                        if (p['Anticipated Departure Time'] && deptCol > -1) {
                            const _newDue = new Date(p['Anticipated Departure Time']);
                            const _oldDue = new Date(rowData[20]);
                            if (!isNaN(_newDue.getTime()) && !isNaN(_oldDue.getTime()) && rowData[20] && _newDue.getTime() < _oldDue.getTime() - 1000) {
                                _audit_('handleWorkerPost:due-kept', workerName, targetRow, '', '', _origIncoming, p.idempotencyKey,
                                        'post carried an earlier due time ' + _newDue.toISOString() + ' - col U kept at ' + _oldDue.toISOString());
                            } else {
                                sheet.getRange(targetRow, deptCol + 1).setValue(p['Anticipated Departure Time']);
                            }
                        }
                        // Write Drive file links for photos and signature
                        const p1Col  = headers.indexOf("Photo 1");
                        const sigCol = headers.indexOf("Signature");
                        const p2Col  = headers.indexOf("Photo 2");
                        const p3Col  = headers.indexOf("Photo 3");
                        const p4Col  = headers.indexOf("Photo 4");
                        if (p1  && p1Col  > -1) sheet.getRange(targetRow, p1Col  + 1).setValue(p1);
                        if (sig && sigCol > -1) sheet.getRange(targetRow, sigCol + 1).setValue(sig);
                        if (p2  && p2Col  > -1) sheet.getRange(targetRow, p2Col  + 1).setValue(p2);
                        if (p3  && p3Col  > -1) sheet.getRange(targetRow, p3Col  + 1).setValue(p3);
                        if (p4  && p4Col  > -1) sheet.getRange(targetRow, p4Col  + 1).setValue(p4);
                        existingVisitNotes = String(rowData[11] || '');
                        rowUpdated = true;
                        _ledgerRow = targetRow;   // __45_ (ledger)
                        break;
                    }
                    // __42_ B4 (F79-1): only the worker's LATEST row counts. It is closed, so stop here -
                    // never walk back to an older open row (that is how row 74's data could land on a
                    // stale visit). What happens next is decided below (straggler or new row).
                    _latestClosed = { row: startRow + i, status: status, due: rowData[20] };
                    break;
                }
            }
        }

        // __42_ B4: a routine post (GPS pulse, plain OVERDUE...) arriving after the visit closed, carrying
        // that visit's due time, is a straggler: Audit only, no new row. A different or missing due time
        // still creates a row as before (rescue path if the visit-start record was lost).
        if (!rowUpdated && _latestClosed && !hasFormData &&
            STRAGGLER_STATUSES.indexOf(String(p['Alarm Status'] || '').trim().toUpperCase()) > -1 &&
            _sameDue_(p['Anticipated Departure Time'], _latestClosed.due)) {
            _audit_('handleWorkerPost:straggler', workerName, _latestClosed.row, _latestClosed.status, '', p['Alarm Status'], p.idempotencyKey,
                    'latest row is closed and this post carries its due time - no new row');
            _idemRegister_(p.idempotencyKey);
            return;
        }

// Ensure these fallbacks are in your backend script to catch the frontend keys
const emgPhone = p['Emergency Contact Number'] || p['Emergency Contact Phone'] || "";
const escPhone = p['Escalation Contact Number'] || p['Escalation Contact Phone'] || "";

if (!rowUpdated) {
    const row = [
        ts.toISOString(), 
        dateStr, 
        workerName, 
        p['Worker Phone Number'], 
        p['Emergency Contact Name'], 
        emgPhone, // FIXED: Maps frontend 'Phone' to backend 'Number'
        p['Emergency Contact Email'], 
        p['Escalation Contact Name'], 
        escPhone, // FIXED: Maps frontend 'Phone' to backend 'Number'
        p['Escalation Contact Email'], 
        p['Alarm Status'], 
        polishedNotes, 
        p['Location Name'], 
        p['Location Address'], 
        p['Last Known GPS'], 
        p['Timestamp'], 
        p['Battery Level'], 
        p1, 
        distanceValue, 
        p['Visit Report Data'], 
        p['Anticipated Departure Time'], 
        sig, 
        p2, 
        p3, 
        p4
    ];
    sheet.appendRow(row);
    _visitIdSet_(sheet, sheet.getLastRow(), String(p.idempotencyKey || '') || _visitIdNew_(sheet.getLastRow()));   // __44_: col AB
    _audit_('handleWorkerPost:new', workerName, sheet.getLastRow(), '', p['Alarm Status'], p['Alarm Status'], p.idempotencyKey, 'new row');
    _ledgerRow = sheet.getLastRow(); _ledgerNew = true;   // __45_ (ledger)
}
        // __45_ (Forms ledger): every post that carries report data also gets a Forms row, so Forms holds every report
        // (filter by Template). The Visits row above is written exactly as before (Travel Report / Monthly Stats read it).
        if (hasFormData && _ledgerRow) _formsLedger_(ss, sheet, p, _statusAsSent, _ledgerRow, _ledgerNew, polishedNotes, distanceValue, sig, p1, p2, p3, p4);
    }

    updateStaffStatus(p);
    if(hasFormData) {
        try {
            const reportObj = JSON.parse(p['Visit Report Data']);
            const _fp = Object.assign({}, p), _fNotes = polishedNotes;
            _sendOrQueue_('form-email', function () {   // __43_: after lock release
                try { processFormEmail(_fp, reportObj, _fNotes, p1, p2, p3, p4, sig); } catch (e2) { console.error("Email Error: " + e2); }
            });
        } catch(e) { console.error("Email Error: " + e); }
    }

    // OVERDUE ALARM is intentionally excluded here — checkOverdueVisits() is the sole
    // authority for firing escalation alerts (dead-man's switch principle). The worker
    // sending OVERDUE ALARM updates col K for sheet state only; the backend reads that
    // state independently and decides when to escalate.
    if (criticalBridgeSuppressed) {
        console.log('Critical Timing bridge: server ladder already started for ' + workerName + ' - no extra alert.');
    } else if(p['Alarm Status'].includes("EMERGENCY") || p['Alarm Status'].includes("PANIC") || p['Alarm Status'].includes("DURESS")) {
        p['Visit Notes'] = p['Visit Notes'] || existingVisitNotes;
        _queueImmediateAlert_(p, _mergeMark);   // __43_: sent after the lock is released
    } else if (p['Alarm Status'].includes("OVERDUE ALARM") && p['Critical Timing'] === 'true') {
        // Critical timing OVERDUE ALARM — fire ntfy immediately via the doPost execution context,
        // which can reach ntfy.sh. Standard (non-critical) OVERDUE ALARM escalation continues to
        // rely solely on checkOverdueVisits() (dead-man's switch principle preserved).
        // Pass the existing row's visit notes so isCriticalTiming is correctly detected
        // inside triggerAlerts — the worker payload does not carry Visit Notes.
        p['Visit Notes'] = p['Visit Notes'] || existingVisitNotes;
        _queueImmediateAlert_(p, null);         // __43_: sent after the lock is released
    }

    // A1: register the idempotency key only now that the row, emails and alerts are done.
    _idemRegister_(p.idempotencyKey);
}

/**
 * __43_: queue an IMMEDIATE alert (a snapshot of the payload, so later changes to p cannot alter it). When the alert is
 * the phone-merged Critical Timing BREACH, its col AA claim is marked '|SENT' afterwards.
 */
function _queueImmediateAlert_(p, mergeMark) {
    const _ap = Object.assign({}, p);
    _sendOrQueue_('alerts', function () {
        triggerAlerts(_ap, "IMMEDIATE");
        if (mergeMark) _withShortLock_('mark-sent', function (got) {
            if (!got) return; // left unsent: the checker re-sends it after 3 minutes (a duplicate beats a miss)
            const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Visits');
            if (sh) _ladderMarkSent_(sh, mergeMark);
        });
    });
}

/** A1 - has this outbox idempotency key already been fully processed? */
function _idemSeen_(key) {
    if (!key) return false;
    try {
        const seen = JSON.parse(sp.getProperty('IDEM_KEYS_V1') || '[]');
        return seen.includes(key);
    } catch (e) {
        console.warn('IDEM read failed: ' + e);
        return false; // fail open - a duplicate row is better than a dropped event
    }
}

/**
 * A1 - record an idempotency key AFTER the work succeeds. Called inside the
 * doPost script lock only. Rolling window of 100 keys (~5 KB, under the 9 KB limit).
 */
function _idemRegister_(key) {
    if (!key) return;
    if (_DEFER) { _DEFER.keys.push(key); return; } // __43_: doPost registers it after the sends (_idemRegisterNow_)
    _idemRegisterNow_(key);
}

function _idemRegisterNow_(key) {
    if (!key) return;
    try {
        const seen = JSON.parse(sp.getProperty('IDEM_KEYS_V1') || '[]');
        if (seen.includes(key)) return;
        seen.push(key);
        if (seen.length > 100) seen.splice(0, seen.length - 100);
        sp.setProperty('IDEM_KEYS_V1', JSON.stringify(seen));
    } catch (e) { console.warn('IDEM register failed: ' + e); }
}
/**
 * A6 - severity rank of a col K status. 0 = routine. Higher may replace lower.
 * DURESS 5 > PANIC/SOS 4 > EMERGENCY 3 > OVERDUE ALARM / OVERDUE - tiers 2.
 * Plain 'OVERDUE' (worker pulse) and ALARM_GPS_PULSE are routine (0).
 */
function _alarmRank_(statusUpper) {
    const s = (statusUpper || '').toString().toUpperCase();
    if (s.includes('ALARM_GPS_PULSE')) return 0;
    if (s.includes('DURESS')) return 5;
    if (s.includes('PANIC') || s.includes('SOS')) return 4;
    if (s.includes('EMERGENCY')) return 3;
    if (s.includes('OVERDUE ALARM') || s.includes('OVERDUE -')) return 2;
    return 0;
}

function processFormEmail(p, reportObj, polishedNotes, p1, p2, p3, p4, sig) {
    const templateName = p['Template Name'] || "";
    if (!templateName) return;
    
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const tSheet = ss.getSheetByName('Templates');
    const safeTName = templateName.trim().toLowerCase();
    
    let recipientEmail = "";
    
    // Audit Fix: Mandatory Worker Routing for Private Notes
    if (safeTName === 'note to self') {
        recipientEmail = p['Worker Email']; 
    } else if (tSheet) {
        const tData = tSheet.getDataRange().getValues();
        for (let i = 1; i < tData.length; i++) {
            if (tData[i][1] && tData[i][1].toString().trim().toLowerCase() === safeTName) {
                recipientEmail = tData[i][3]; 
                break;
            }
        }
    }
    
    if (!recipientEmail || !recipientEmail.includes('@')) {
        console.warn("No valid recipient found for email routing.");
        return;
    }

    const inlineImages = {};
    const imgTags = [];
    const processImg = (key, cidName, title) => {
        if (p[key] && p[key].length > 100) { 
            const blob = dataURItoBlob(p[key]);
            if (blob) {
                inlineImages[cidName] = blob;
                imgTags.push(`<div style="margin-bottom: 20px;"><p style="font-size:12px;font-weight:bold;">${title}</p><img src="cid:${cidName}" style="max-width:100%;border-radius:8px;"></div>`);
            }
        }
    };

    processImg('Photo 1', 'photo1', 'Attachment 1');
    processImg('Photo 2', 'photo2', 'Attachment 2');
    processImg('Photo 3', 'photo3', 'Attachment 3');
    processImg('Photo 4', 'photo4', 'Attachment 4');
    
    if (p['Signature']) {
        const sigBlob = dataURItoBlob(p['Signature']);
        if (sigBlob) inlineImages['signature'] = sigBlob;
    }

    // GPS map link — validate before using (no 0,0, no near-zero noise)
    let mapHtml = "";
    const rawGps  = (p['Last Known GPS'] || '').toString().trim();
    const gpsParts = rawGps.split(',');
    const gpsLat   = parseFloat(gpsParts[0]);
    const gpsLng   = parseFloat(gpsParts[1]);
    const hasValidGps = gpsParts.length === 2
        && !isNaN(gpsLat) && !isNaN(gpsLng)
        && Math.abs(gpsLat) > 0.001
        && Math.abs(gpsLng) > 0.001
        && Math.abs(gpsLat) <= 90
        && Math.abs(gpsLng) <= 180;
    if (hasValidGps) {
        const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(rawGps)}`;
        mapHtml = `
        <div style="margin-top:20px; padding:15px; background:#f0f7ff; border-radius:8px; border:1px solid #cfe2ff; text-align:center;">
            <p style="margin:0 0 10px 0; font-size:11px; font-weight:800; color:#1e40af; text-transform:uppercase;">📍 Visit Location Intelligence</p>
            <a href="${mapUrl}" style="display:inline-block; padding:12px 24px; background:#1e40af; color:#ffffff; text-decoration:none; border-radius:6px; font-weight:bold;">View Location on Google Maps</a>
        </div>`;
    }

    let subject = (safeTName === 'note to self') ? `[PRIVATE] Note to Self` : `[${templateName}] - ${p['Worker Name']}`;
    let html = `<div style="font-family:Arial,sans-serif;padding:20px;max-width:600px;border:1px solid #eee;border-radius:12px;background-color:#ffffff;color:#333;">
        <h2 style="color:#1e40af;margin-top:0;">${templateName}</h2>
        <p style="color:#666;font-size:12px;">Worker: ${p['Worker Name']} | Sent: ${new Date().toLocaleString()}</p>
        <hr style="border:0;border-top:1px solid #eee;margin:20px 0;">
        
        <div style="background:#f9fafb;padding:15px;border-radius:8px;margin-bottom:20px;border-left:4px solid #1e40af;">
            <p style="white-space:pre-wrap;margin:0;font-size:14px;line-height:1.6;">${polishedNotes}</p>
        </div>
        
        <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
            <tbody>`;
        
    // Skip fields rendered separately (signature, GPS) and raw data-URI blobs
    const skipKeys = new Set(['Signature', 'GPS', 'Last Known GPS', 'Photo 1', 'Photo 2', 'Photo 3', 'Photo 4']);
    for (const [key, value] of Object.entries(reportObj)) {
        if (skipKeys.has(key)) continue;
        if (typeof value === 'string' && value.startsWith('data:')) continue;
        html += `<tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:8px 0;font-size:13px;color:#6b7280;width:40%;">${key}</td><td style="padding:8px 0;font-size:13px;font-weight:600;color:#111827;">${value}</td></tr>`;
    }
    
    html += `</tbody></table>
        ${mapHtml} 
        <div style="margin-top:25px;">${imgTags.join('')}</div>
        ${p['Signature'] ? '<div style="margin-top:20px;padding-top:20px;border-top:1px solid #eee;"><p style="font-size:11px;color:#999;text-transform:uppercase;">Digital Signature</p><img src="cid:signature" style="max-height:80px;"></div>' : ''}
    </div>`;

    MailApp.sendEmail({ to: recipientEmail, subject: subject, htmlBody: html, inlineImages: inlineImages });

    // Privacy Purge for Private Notes
    if (p['autoDelete'] === 'true' && safeTName === 'note to self') {
        const fileUrls = [p1, p2, p3, p4, sig];
        fileUrls.forEach(url => {
            if (url && url.includes('id=')) {
                try { DriveApp.getFileById(url.split('id=')[1]).setTrashed(true); } catch(e) {}
            }
        });
    }
}

function dataURItoBlob(dataURI) {
    try {
        if (!dataURI) return null;
        let contentType = 'image/jpeg';
        let base64Data = dataURI;

        if (dataURI.includes('base64,')) {
            const parts = dataURI.split(',');
            if (parts.length < 2) return null;
            contentType = parts[0].split(':')[1].split(';')[0];
            base64Data = parts[1];
        }

        const byteString = Utilities.base64Decode(base64Data);
        return Utilities.newBlob(byteString, contentType, "image");
    } catch(e) { 
        console.error("Error decoding base64: " + e.toString());
        return null; 
    }
}

function handleRegisterDevice(p) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Staff');
  if (!sheet) return { status: "error", message: "Staff sheet missing" };
  const data = sheet.getDataRange().getValues();
  const workerName = p['Worker Name'];
  const deviceId = p.deviceId;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === workerName) {
      const existingId = (data[i][4] || '').toString().trim();
      // Only allow registration if column E is empty or already matches this device.
      // If a different device ID is bound, an admin must clear column E first.
      if (existingId && existingId !== deviceId) {
        console.warn(`Registration blocked for ${workerName}: bound to a different device.`);
        return { status: "error", message: "This worker is already registered on another device. Ask your administrator to clear the existing registration." };
      }
      sheet.getRange(i + 1, 5).setValue(deviceId);
      return { status: "success", message: "Device successfully bound to " + workerName };
    }
  }
  return { status: "error", message: "Worker not found in Staff registry" };
}

function updateStaffStatus(p) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName('Staff');
    if(!sheet) return;
    const data = sheet.getDataRange().getValues();
    for(let i=1; i<data.length; i++) {
        if(data[i][0] === p['Worker Name']) {
            // Only update column E if it is empty or already matches this device.
            // Prevents visit events from overwriting a legitimately bound device ID.
            const existingId = (data[i][4] || '').toString().trim();
            const incomingId = (p['deviceId'] || '').toString().trim();
            if (!existingId || existingId === incomingId) {
                sheet.getRange(i+1, 5).setValue(incomingId);
            }
            if(p['Template Name'] && p['Template Name'].includes('Vehicle')) {
                sheet.getRange(i+1, 6).setValue(new Date()); 
                try {
                    const rData = JSON.parse(p['Visit Report Data']);
                    const term = CONFIG.VEHICLE_TERM || "WOF";
                    const expKey = Object.keys(rData).find(k => k.includes('Expiry') || k.includes(term) || k.includes('Rego'));
                    if(expKey && rData[expKey]) { sheet.getRange(i+1, 7).setValue(rData[expKey]); }
                } catch(e){}
            }
            // Persist ntfy topics to Staff sheet columns H (8) and I (9) so that
            // server-triggered escalations can push notifications without needing
            // the topics in the Visits row. Only written when present — never blanked.
            const emgNtfy = (p['Emergency Contact Ntfy'] || '').toString().trim();
            const escNtfy = (p['Escalation Contact Ntfy'] || '').toString().trim();
            if (emgNtfy) sheet.getRange(i+1, 8).setValue(emgNtfy);
            if (escNtfy) sheet.getRange(i+1, 9).setValue(escNtfy);
            break;
        }
    }
}

function _cleanPhone(num) {
    if (!num) return null;
    // Strip non-numeric characters
    let n = num.toString().replace(/[^0-9]/g, ''); 
    if (n.length < 5) return null;
    
    // Handle local '0' prefix (e.g., 021 becomes +6421)
    if (n.startsWith('0')) { 
        return (CONFIG.COUNTRY_CODE || "+64") + n.substring(1); 
    }
    
    // Ensure the '+' prefix is present for Textbelt
    return n.startsWith('+') ? n : "+" + n;
}

/**
 * Formats a phone number for human-readable display in emails.
 * Applies the same country-code logic as _cleanPhone(), then adds spacing.
 * Examples: "226854709" → "+64 22 685 4709", "0211234567" → "+64 21 123 4567"
 */
function _formatPhoneDisplay(num) {
    if (!num) return 'Not provided';
    const cleaned = _cleanPhone(num.toString());
    if (!cleaned) return num.toString();
    // +64 XX XXX XXXX  (NZ 8-digit local e.g. mobiles)
    const m = cleaned.match(/^(\+\d{2})(\d{2})(\d{3})(\d{4})$/);
    if (m) return `${m[1]} ${m[2]} ${m[3]} ${m[4]}`;
    // +64 X XXX XXXX  (NZ 7-digit local)
    const m2 = cleaned.match(/^(\+\d{2})(\d{1})(\d{3})(\d{4})$/);
    if (m2) return `${m2[1]} ${m2[2]} ${m2[3]} ${m2[4]}`;
    // Fallback — add a space after the country code at minimum
    return cleaned.replace(/^(\+\d{2})(\d+)$/, '$1 $2');
}

/**
 * Logs Textbelt SMS send results.
 * Always writes to Logger.log (every send, success or failure).
 * Appends a row to the 'SMS Log' sheet only on failure, so failures persist
 * across executions and can be reviewed without catching a live run.
 * Sheet is auto-created with headers on first use.
 */
function _logSmsResult_(to, body, parsed, isNetworkError) {
    const success   = !isNetworkError && parsed && parsed.success === true;
    const status    = isNetworkError  ? 'NETWORK_ERROR'
                    : success         ? 'OK'
                    : 'REJECTED';
    const errorMsg  = isNetworkError  ? (parsed || 'Unknown network error')
                    : (parsed && parsed.error) ? parsed.error
                    : (parsed && parsed.message) ? parsed.message
                    : '';
    const quotaLeft = (parsed && parsed.quotaRemaining !== undefined)
                    ? parsed.quotaRemaining : '';
    const textId    = (parsed && parsed.textId) ? parsed.textId : '';
    const preview   = (body || '').substring(0, 120);

    // Always log full detail to the execution transcript.
    Logger.log('[SMS] to=' + to + ' status=' + status +
               ' textId=' + textId + ' quota=' + quotaLeft + ' error="' + errorMsg +
               '" body="' + preview + '"');

    if (success) return;

    try {
        const ss    = SpreadsheetApp.getActiveSpreadsheet();
        let logSheet = ss.getSheetByName('SMS Log');
        if (!logSheet) {
            logSheet = ss.insertSheet('SMS Log');
            logSheet.appendRow([
                'Timestamp', 'To', 'Status', 'Quota Remaining', 'Text ID', 'Error', 'Message Preview'
            ]);
            logSheet.setFrozenRows(1);
        }
        logSheet.appendRow([
            new Date(), to, status, quotaLeft, textId, errorMsg, preview
        ]);
    } catch (sheetErr) {
        Logger.log('[SMS] Could not write to SMS Log sheet: ' + sheetErr.toString());
    }
}

/**
 * SMS Provider Dispatcher
 * Routes outbound SMS to the configured provider. All results are logged via
 * _logSmsResult_() — successes to Logger.log only; failures also written to the SMS Log sheet.
 * Safe to call even when no provider is configured — logs a skip and returns.
 */
function _sendSms_(to, body) {
    const provider = (CONFIG.SMS_PROVIDER || '').toLowerCase().trim();
    Logger.log('[SMS] Provider="' + provider + '" to=' + to);
    switch (provider) {
        case 'twilio':   _sendViaTwilio_(to, body);   break;
        case 'burst':    _sendViaBurst_(to, body);     break;
        case 'textbelt': _sendViaTextbelt_(to, body);  break;
        default:
            Logger.log('[SMS] No provider configured (SMS_PROVIDER="' + provider + '") — skipping send.');
    }
}

/** Twilio — NZ, UK, Canada */
function _sendViaTwilio_(to, body) {
    const sid = CONFIG.TWILIO_ACCOUNT_SID;
    const url = 'https://api.twilio.com/2010-04-01/Accounts/' + sid + '/Messages.json';
    try {
        const resp = UrlFetchApp.fetch(url, {
            method: 'post',
            headers: { Authorization: 'Basic ' + Utilities.base64Encode(sid + ':' + CONFIG.TWILIO_AUTH_TOKEN) },
            payload: { To: to, From: CONFIG.TWILIO_FROM, Body: body },
            muteHttpExceptions: true
        });
        let parsed = null;
        try { parsed = JSON.parse(resp.getContentText()); } catch(_) {}
        // Twilio success: response contains 'sid' and no 'error_code'.
        const ok = parsed && parsed.sid && !parsed.error_code;
        _logSmsResult_(to, body, {
            success:        ok,
            textId:         parsed && parsed.sid,
            error:          parsed && (parsed.message || parsed.error_message),
            quotaRemaining: ''
        }, false);
    } catch (e) { _logSmsResult_(to, body, e.toString(), true); }
}

/** Kudosity (formerly Burst SMS) — Australia / New Zealand */
function _sendViaBurst_(to, body) {
    try {
        const resp = UrlFetchApp.fetch('https://api.transmitsms.com/send-sms.json', {
            method: 'post',
            headers: {
                Authorization: 'Basic ' + Utilities.base64Encode(CONFIG.BURST_API_KEY + ':' + CONFIG.BURST_API_SECRET)
            },
            payload: { to: to, from: CONFIG.BURST_FROM, message: body },
            muteHttpExceptions: true
        });
        let parsed = null;
        try { parsed = JSON.parse(resp.getContentText()); } catch(_) {}
        // Kudosity (formerly Burst SMS) success: error.code === 0 (legacy) or 'SUCCESS' (current API)
        const ok = parsed && parsed.error && (parsed.error.code === 0 || parsed.error.code === 'SUCCESS');
        _logSmsResult_(to, body, {
            success:        ok,
            textId:         parsed && parsed.message_id,
            error:          parsed && parsed.error && parsed.error.description,
            quotaRemaining: ''
        }, false);
    } catch (e) { _logSmsResult_(to, body, e.toString(), true); }
}

/** Textbelt — US */
function _sendViaTextbelt_(to, body) {
    try {
        const resp = UrlFetchApp.fetch('https://textbelt.com/text', {
            method: 'post',
            payload: { phone: to, message: body, key: CONFIG.TEXTBELT_API_KEY },
            muteHttpExceptions: true
        });
        let parsed = null;
        try { parsed = JSON.parse(resp.getContentText()); } catch(_) {}
        _logSmsResult_(to, body, parsed, false);
    } catch (e) { _logSmsResult_(to, body, e.toString(), true); }
}

/**
 * RE-ENGINEERED: High-Urgency Alert Router
 * Fixes: GPS Variable injection and Dual-Contact SMS Routing.
 */
function triggerAlerts(p, type) {
    // __45_ (F89-1): a standard tier 1-3 alert is for the primary contact only. Blank every escalation channel here,
    // once, so no later step (email list, SMS list, the Staff-sheet ntfy lookup below) can add the escalation contact.
    const _primaryOnly = String((p && p['Contact Scope']) || '') === 'primary';
    if (_primaryOnly) p = Object.assign({}, p, { 'Escalation Contact Number': '', 'Escalation Contact Phone': '',
                                                 'Escalation Contact Email': '', 'Escalation Contact Ntfy': '' });

    // ── GPS HANDLING ────────────────────────────────────────────────────────
    // Guard: treat "0,0" as no fix (it's the worker app fallback when GPS
    // was unavailable, not a real coordinate).
    const rawGPS   = p['Last Known GPS'];
    const hasGPS   = rawGPS && rawGPS.trim() !== '' && rawGPS.trim() !== '0,0';
    // Parse lat/lng for w3w lookup and precise GPS validation.
    const gpsParts    = (rawGPS || '').trim().split(',');
    const gpsLat      = parseFloat(gpsParts[0]);
    const gpsLng      = parseFloat(gpsParts[1]);
    const hasValidGps = gpsParts.length === 2
        && !isNaN(gpsLat) && !isNaN(gpsLng)
        && Math.abs(gpsLat) > 0.001 && Math.abs(gpsLng) > 0.001
        && Math.abs(gpsLat) <= 90   && Math.abs(gpsLng) <= 180;
    // BUG FIX: previous code used $${} which injected a literal '$' into the URL.
    // Correct template literal interpolation is simply ${}.
    const gpsLink  = hasGPS
        ? `https://maps.google.com/?q=${encodeURIComponent(rawGPS.trim())}`
        : null;
    const gpsText  = hasGPS
        ? `<a href="${gpsLink}" style="color:#2563eb;">${rawGPS.trim()}</a>`
        : `Not available — please use the address above to locate the worker.`;
    // __43_ (Decision C): the SMS-only reverse geocode moved into the SMS step below. It used to run here, first,
    // delaying every alert (ntfy included) by a Nominatim round trip.

    // ── STATUS-SPECIFIC MESSAGING ──────────────────────────────────────────
    const status        = (p['Alarm Status'] || '').toUpperCase();
    const workerName    = p['Worker Name']    || 'The worker';
    const workerFirst   = workerName.split(' ')[0];
    const workerPhone    = _formatPhoneDisplay(p['Worker Phone Number']);
    // Clean tel: number (no spaces) for href — used in HTML email links only.
    // Plain text uses workerPhone; ntfy/SMS also use workerPhone (not the link).
    const workerPhoneTel  = _cleanPhone((p['Worker Phone Number'] || '').toString()) || '';
    const workerPhoneLink = workerPhoneTel
        ? `<a href="tel:${workerPhoneTel}" style="color:inherit;font-weight:bold;text-decoration:none;">${workerPhone}</a>`
        : `<strong>${workerPhone}</strong>`;
    const locationName  = p['Location Name']  || 'Unknown location';
    const locationAddr  = p['Location Address'] || '';
    // Format battery: stored as decimal (0.79) — display as percentage (79%)
    const _rawBattery   = p['Battery Level'];
    const _batteryNum   = parseFloat(_rawBattery);
    const battery       = isNaN(_batteryNum) ? (_rawBattery || 'Unknown')
                        : Math.round(_batteryNum <= 1 ? _batteryNum * 100 : _batteryNum) + '%';
    // Suppress internal alert strings that may have leaked into the Notes field
    const _rawNotes     = p['Notes'] || '';
    const notes         = /^Alert:|EMERGENCY|OVERDUE|ALARM|BREACH/i.test(_rawNotes) ? '' : _rawNotes;
    const visitNotes    = p['Visit Notes']    || '';
    // Detect critical timing mode from either status string or original visit Notes tag.
    // The [CRITICAL_TIMING] tag is injected by the worker PWA at visit start and preserved
    // in col L (Notes). visitNotes carries that original row value via triggerEscalation.
    const isCriticalTiming = status.includes('CRITICAL TIMING') || visitNotes.includes('[CRITICAL_TIMING]');

    // Detect travel visit and extract start GPS from [START_GPS:...] tag in visit notes.
    // visitNotes contains the original TRAVELLING row Notes:
    // e.g. "Travel to Wellington Office started. Duration: 60m [CRITICAL_TIMING] [START_GPS:-36.84,174.76]"
    const isTravel       = visitNotes.includes('Travel to');
    const startGPSMatch  = visitNotes.match(/\[START_GPS:([^\]]+)\]/);
    const startGPS       = startGPSMatch ? startGPSMatch[1].trim() : null;
    const travelDestAddr = locationAddr ? ` (${locationAddr})` : '';

    // Three-location block for travel overdue messages.
    // GPS strings are stored as "lat, lng" (with space) — strip for URL use.
    const _gpsUrl = (gps) => gps ? gps.replace(/\s/g, '') : null;
    const currentGPS      = (p['Last Known GPS'] || '').trim();
    const currentGPSTs    = p['GPS Timestamp'] ? Utilities.formatDate(new Date(p['GPS Timestamp']), CONFIG.TIMEZONE, "dd/MM/yyyy HH:mm") : null;
    const startGPSClean   = startGPS   ? _gpsUrl(startGPS)   : null;
    const currentGPSClean = currentGPS ? _gpsUrl(currentGPS) : null;

    // Individual map links — use friendly labels rather than raw coordinates.
    const startMapLink   = startGPSClean
        ? `<a href="https://www.google.com/maps?q=${startGPSClean}" style="color:#93c5fd;">Departure point (map)</a>`
        : null;
    const currentMapLink = currentGPSClean && currentGPSClean !== '0,0'
        ? `<a href="https://www.google.com/maps?q=${currentGPSClean}" style="color:#93c5fd;">Last known position${currentGPSTs ? `, ${currentGPSTs}` : ''} (map)</a>`
        : null;
    const destMapLink    = locationAddr
        ? `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(locationAddr)}" style="color:#93c5fd;">${locationName}${travelDestAddr} (map)</a>`
        : `<strong>${locationName}</strong>`;

    // Combined multi-point Google Maps URL using the ?api=1 format, which reliably
    // renders labelled pins (A = departure, B = last known, C = destination).
    // Falls back gracefully when points are missing.
    const _threePointMapUrl = (() => {
        if (!startGPSClean) return null;
        const waypoint = (currentGPSClean && currentGPSClean !== '0,0') ? currentGPSClean : null;
        const dest     = locationAddr ? encodeURIComponent(locationAddr)
                       : (waypoint ? waypoint : null);
        if (!dest) return null;
        let url = `https://www.google.com/maps/dir/?api=1&origin=${startGPSClean}&destination=${dest}`;
        // Only add waypoint if it's distinct from both origin and destination
        if (waypoint && waypoint !== startGPSClean && waypoint !== dest) {
            url += `&waypoints=${waypoint}`;
        }
        return url;
    })();
    // Label for the map button — reflects how many distinct points are included.
    const _mapBtnLabel = (() => {
        const hasCurrent = currentGPSClean && currentGPSClean !== '0,0';
        const hasDest    = !!(locationAddr);
        if (hasCurrent && hasDest) return '📍 View all three locations on Google Maps →';
        if (hasCurrent || hasDest) return '📍 View route on Google Maps →';
        return '📍 View on Google Maps →';
    })();

    // Three-location HTML block — inserted into travel overdue message bodies.
    // The combined map link uses A/B/C labelled pins: A = departure, B = last known, C = destination.
    const travelLocationBlock = isTravel ? `
        <table style="width:100%;border-collapse:collapse;margin:12px 0;font-size:13px;">
            <tr style="background:#1e293b;">
                <td style="padding:8px 10px;border:1px solid #334155;color:#94a3b8;font-weight:bold;width:38%;">Started at</td>
                <td style="padding:8px 10px;border:1px solid #334155;color:#e2e8f0;">${startMapLink || '<em style="color:#64748b;">Not recorded</em>'}</td>
            </tr>
            <tr style="background:#0f172a;">
                <td style="padding:8px 10px;border:1px solid #334155;color:#94a3b8;font-weight:bold;">Most recent location</td>
                <td style="padding:8px 10px;border:1px solid #334155;color:#e2e8f0;">${currentMapLink || '<em style="color:#64748b;">Not yet reported</em>'}</td>
            </tr>
            <tr style="background:#1e293b;">
                <td style="padding:8px 10px;border:1px solid #334155;color:#94a3b8;font-weight:bold;">Intended destination</td>
                <td style="padding:8px 10px;border:1px solid #334155;color:#e2e8f0;">${destMapLink}</td>
            </tr>
            ${_threePointMapUrl ? `<tr style="background:#0f172a;"><td colspan="2" style="padding:8px 10px;border:1px solid #334155;text-align:center;"><a href="${_threePointMapUrl}" style="color:#38bdf8;font-weight:bold;">${_mapBtnLabel}</a><div style="font-size:11px;color:#64748b;margin-top:4px;">A = Departure &nbsp;·&nbsp; B = Last known &nbsp;·&nbsp; C = Destination</div></td></tr>` : ''}
        </table>` : '';

    const sentAt        = Utilities.formatDate(
                              new Date(), CONFIG.TIMEZONE, "dd/MM/yyyy, HH:mm:ss");

    // Colour, urgency label and action guidance are tailored to each status.
    let   headerColour  = '#dc2626';  // red  — default for alarms
    let   statusLabel   = status;
    let   whatHappened  = '';
    let   actionSteps   = '';
    let   noteToContact = '';
    let   ntfyPriority  = 'high';     // ntfy push priority for this alert type
    let   ntfyTags      = 'rotating_light';  // ntfy emoji tags

    if (status.includes('DURESS')) {
        headerColour  = '#7c3aed';  // purple — covert threat
        statusLabel   = 'DURESS — SILENT ALARM';
        ntfyPriority  = 'urgent';
        ntfyTags      = 'rotating_light,purple_circle';
        whatHappened  = `This worker has activated a <strong>DURESS signal</strong>. This may mean they are under threat and unable to speak freely. <strong>Please treat this as a real emergency.</strong>`;
        actionSteps   = `
            <li>Try to <strong>call or text ${workerFirst}</strong> on ${workerPhoneLink}</li>
            <li>If there is no answer within a few minutes, contact someone at the site and ask them to check on the worker's safety</li>
            <li>If you believe they are in danger, <strong>contact emergency services (${EMERGENCY_NUMBER})</strong></li>
            <li>Once contact is made, ask them to resolve the alert using their safety app or call their Safety Manager</li>`;
        noteToContact = `Before escalating to police, consider that the worker may be unable to speak freely. A silent duress is designed to look like a normal message — do not reveal that you have received this alert if you speak to someone at the scene who could be the threat.`;
    }
    else if (status.includes('PANIC') || status.includes('SOS')) {
        headerColour  = '#dc2626';
        statusLabel   = 'PANIC / SOS — MANUAL ALARM';
        ntfyPriority  = 'urgent';
        ntfyTags      = 'rotating_light,red_circle';
        whatHappened  = `This worker has <strong>manually triggered a SOS panic alarm</strong>. They may be in immediate danger.`;
        actionSteps   = `
            <li>Try to <strong>call ${workerFirst}</strong> on ${workerPhoneLink} immediately</li>
            <li>If there is no answer, contact someone at the site to check on the worker</li>
            <li>If you believe they are in danger, <strong>contact emergency services (${EMERGENCY_NUMBER})</strong></li>
            <li>Once contact is made, ask them to clear the alarm using their app PIN</li>`;
        noteToContact = `This alarm was triggered manually by the worker pressing the SOS button. It should be treated as a genuine alert unless confirmed otherwise.`;
    }
    else if (status.includes('CRITICAL TIMING') || (status.includes('EMERGENCY') && isCriticalTiming)) {
        headerColour  = '#dc2626';
        statusLabel   = isTravel ? 'EMERGENCY — OVERDUE TRAVEL (CRITICAL TIMING)' : 'EMERGENCY — CRITICAL TIMING BREACH';
        ntfyPriority  = 'urgent';
        ntfyTags      = 'rotating_light,red_circle';
        whatHappened  = isTravel
            ? `This worker was <strong>travelling to ${locationName}${travelDestAddr}</strong> and <strong>has not arrived at the scheduled time</strong>. They had activated Critical Timing Mode before departing — this bypasses the normal grace period and triggers an immediate alert. <strong>Please treat this as a genuine emergency.</strong>`
            : `This worker <strong>did not check out at the scheduled time and had activated Critical Timing Mode</strong> before their visit. Critical Timing Mode is used when a worker has specific concern about the importance of timely contact — it bypasses the normal grace period and triggers an immediate alert. <strong>Please treat this as a genuine emergency.</strong>`;
        actionSteps   = isTravel
            ? `<li>Try to <strong>call ${workerFirst}</strong> on ${workerPhoneLink} immediately</li>
            <li>If there is no answer, check whether they have arrived at <strong>${locationName}</strong> — contact someone there if possible</li>
            <li>If unreachable, <strong>contact emergency services (${EMERGENCY_NUMBER})</strong> and provide the departure point and intended destination above</li>`
            : `<li>Try to <strong>call ${workerFirst}</strong> on ${workerPhoneLink} immediately</li>
            <li>If there is no answer, contact someone at the site to check on the worker's welfare</li>
            <li>If unreachable, <strong>contact emergency services (${EMERGENCY_NUMBER})</strong> and provide the location above</li>`;
        noteToContact = isTravel
            ? `This alert was triggered immediately at the worker's scheduled arrival time because they had activated Critical Timing Mode before departing. Treat it with the same urgency as a manual panic alarm.`
            : `This alert was triggered immediately at the worker's scheduled check-out time because they had activated Critical Timing Mode — indicating they had a specific concern about timing. Treat it with the same urgency as a manual panic alarm.`;

        // Critical Timing repeat alerts (sent by checkOverdueVisits at due + 5 and due + 10).
        // statusLabel feeds the email subject, SMS and ntfy title, so it must carry the message alone.
        if (status.includes('CRITICAL TIMING FINAL NOTICE')) {
            statusLabel  = 'FINAL NOTICE — SAFETY STILL UNRESOLVED (CRITICAL TIMING) — NO FURTHER ALERTS';
            whatHappened = `<strong>FINAL NOTICE — ${workerName} is still unaccounted for.</strong> This is the third and final automatic alert. Their safety has not been confirmed. <strong>No further alerts will be sent — please act now.</strong><br><br>` + whatHappened;
        } else if (status.includes('CRITICAL TIMING REPEAT')) {
            statusLabel  = 'SECOND ALERT — ' + statusLabel;
            whatHappened = `<strong>SECOND ALERT — there has still been no contact from ${workerName}.</strong> One final notice will follow if their safety is not confirmed.<br><br>` + whatHappened;
        }
    }
    else if (status.includes('EMERGENCY')) {
        headerColour  = '#dc2626';
        statusLabel   = isTravel ? 'EMERGENCY — OVERDUE TRAVEL' : 'EMERGENCY — SIGNIFICANTLY OVERDUE';
        ntfyPriority  = 'urgent';
        ntfyTags      = 'rotating_light,red_circle';
        whatHappened  = isTravel
            ? `This worker was <strong>travelling to ${locationName}${travelDestAddr}</strong> and is <strong>significantly overdue</strong>. We have not been able to confirm their safety.`
            : `This worker is <strong>significantly overdue</strong> and we have not been able to confirm their safety. Their grace period has expired.`;
        actionSteps   = isTravel
            ? `<li>Try to <strong>call ${workerFirst}</strong> on ${workerPhoneLink} immediately</li>
            <li>Check whether they have arrived at <strong>${locationName}</strong> — contact someone there if possible</li>
            <li>If unreachable after a reasonable effort, <strong>consider contacting emergency services (${EMERGENCY_NUMBER})</strong> and providing the departure point and intended destination above</li>`
            : `<li>Try to <strong>call ${workerFirst}</strong> on ${workerPhoneLink} immediately</li>
            <li>Contact someone at the site to check on the worker's welfare</li>
            <li>If unreachable after a reasonable effort, <strong>consider contacting emergency services (${EMERGENCY_NUMBER})</strong> and providing the location above</li>`;
        noteToContact = isTravel
            ? `Before escalating to police, consider that the worker may still be en route, out of coverage, or have a flat battery. Try calling, texting, and checking with the destination first.`
            : `Before escalating to police, consider that the worker may be out of mobile data coverage, may have closed the app, or may have a flat battery. Try calling, texting, and checking with the site first.`;
    }
    else if (status.includes('OVERDUE') || status.includes('CRITICAL ESCALATION') || status.includes('OVERDUE WARNING')) {
        headerColour  = isCriticalTiming ? '#dc2626' : '#d97706';  // red if critical timing, amber otherwise
        statusLabel   = isTravel
            ? (isCriticalTiming ? 'OVERDUE TRAVEL — CRITICAL TIMING MODE ACTIVE' : 'OVERDUE TRAVEL — NOT YET ARRIVED')
            : (isCriticalTiming ? 'OVERDUE — CRITICAL TIMING MODE ACTIVE' : 'OVERDUE — MISSED CHECK-IN');
        ntfyPriority  = isCriticalTiming ? 'urgent' : 'high';
        ntfyTags      = isCriticalTiming ? 'rotating_light,red_circle' : 'warning,yellow_circle';
        whatHappened  = isTravel
            ? (isCriticalTiming
                ? `This worker was <strong>travelling to ${locationName}${travelDestAddr}</strong> and <strong>has not arrived as scheduled</strong>. They had activated Critical Timing Mode before departing. <strong>Please act on this promptly.</strong>`
                : `This worker was <strong>travelling to ${locationName}${travelDestAddr}</strong> and <strong>has not arrived as scheduled</strong>. They may be delayed, unreachable, or in difficulty.`)
            : (isCriticalTiming
                ? `This worker <strong>has not checked out as scheduled and had activated Critical Timing Mode</strong> before their visit. Critical Timing Mode is used when a worker has specific concern about the importance of timely contact. <strong>Please act on this promptly.</strong>`
                : `This worker <strong>has not checked out as scheduled</strong>. They may be delayed, unreachable, or in difficulty.`);
        actionSteps   = isTravel
            ? `<li>Try to <strong>call or text ${workerFirst}</strong> on ${workerPhoneLink}</li>
            <li>Check whether they have arrived at <strong>${locationName}</strong> — contact someone there if possible</li>
            <li>If they remain unreachable and you have concerns, <strong>contact emergency services (${EMERGENCY_NUMBER})</strong></li>`
            : `<li>Try to <strong>call or text ${workerFirst}</strong> on ${workerPhoneLink}</li>
            <li>If you cannot reach them, contact someone at the site and ask them to check on the worker's safety</li>
            <li>If they remain unreachable and you have concerns, <strong>contact emergency services (${EMERGENCY_NUMBER})</strong></li>`;
        noteToContact = isTravel
            ? (isCriticalTiming
                ? `This worker had activated Critical Timing Mode before departing, indicating a specific concern about timing. Treat this alert with higher urgency than a standard overdue travel notification.`
                : `Before escalating to police, consider that the worker may be running late, out of coverage, or have a flat battery. Try calling, texting, and checking with the destination first.`)
            : (isCriticalTiming
                ? `This worker had activated Critical Timing Mode before their visit, indicating a specific concern about timing. Treat this alert with higher urgency than a standard missed check-in.`
                : `Before escalating to police, consider that the worker may be running late, out of coverage, or have a flat battery. Try calling, texting, and other contact methods first.`);
    }
    else if (status.includes('TEST_ALERT')) {
        headerColour  = '#1d4ed8';  // blue — not a real emergency
        statusLabel   = 'TEST — Safety System Check';
        ntfyPriority  = 'default';
        ntfyTags      = 'test_tube,blue_circle';
        whatHappened  = `This is a <strong>scheduled test</strong> of ${workerName}'s lone worker safety app. <strong>No action is required.</strong>`;
        actionSteps   = `
            <li>No action required — this confirms your emergency contact details are correct and alerts are reaching your inbox</li>
            <li>Please check that this email did not land in your spam folder</li>
            <li>If you did <em>not</em> expect this test, contact ${workerName} on ${workerPhoneLink} to confirm it was sent intentionally</li>`;
        noteToContact = '';
    }
    else {
        // Fallback for any other status (CRITICAL TIMING, LOW BATTERY, etc.)
        whatHappened  = `A safety event has been recorded for this worker. Status: <strong>${status}</strong>.`;
        actionSteps   = `<li>Try to contact <strong>${workerFirst}</strong> on ${workerPhoneLink}</li>
                         <li>If you have concerns about their safety, contact emergency services (${EMERGENCY_NUMBER})</li>`;
        noteToContact = '';
    }

    const headerEmoji = status.includes('TEST_ALERT') ? '🧪' : '🚨';

    // __43_ (Decision C): ntfy FIRST. It is the instant, audible channel; email (about 4 s per contact) and SMS follow.
    // ── NTFY PUSH ROUTING ─────────────────────────────────────────────────
    // Sends an instant push notification to each contact's phone via the ntfy app.
    // Fires in addition to email and SMS — never instead of them. __43_: sent before them.
    // Silently skipped per-contact if no ntfy topic is configured.
    const ntfyMessage = [
        `Worker: ${workerName} · ${workerPhone}`,
        `Site: ${locationName}`,
        locationAddr ? `Address: ${locationAddr}` : '',
        hasGPS ? `GPS: ${gpsLink}` : 'GPS: Not available',
        `Battery: ${battery}`,
        `Sent: ${sentAt}`
    ].filter(Boolean).join('\n');

    // Start with payload values (sent by the worker app from state.worker).
    // Fall back to Staff sheet (col H/I) — the authoritative source — in case the
    // worker's device has stale or empty ntfy config. Matches the All Clear pattern.
    let _alertEmgNtfy = (p['Emergency Contact Ntfy']  || '').toString().trim();
    let _alertEscNtfy = (p['Escalation Contact Ntfy'] || '').toString().trim();
    try {
        const _ss2 = SpreadsheetApp.getActiveSpreadsheet();
        const _staffSheet2 = _ss2.getSheetByName('Staff');
        if (_staffSheet2) {
            const _staffData2 = _staffSheet2.getDataRange().getValues();
            const _wName2 = (p['Worker Name'] || '').toString().trim();
            for (let _j2 = 1; _j2 < _staffData2.length; _j2++) {
                if ((_staffData2[_j2][0] || '').toString().trim() === _wName2) {
                    const _sEmg2 = (_staffData2[_j2][7] || '').toString().trim(); // col H
                    const _sEsc2 = (_staffData2[_j2][8] || '').toString().trim(); // col I
                    if (_sEmg2) _alertEmgNtfy = _sEmg2;
                    if (_sEsc2 && !_primaryOnly) _alertEscNtfy = _sEsc2;   // __45_ (F89-1)
                    break;
                }
            }
        }
    } catch (_e2) { console.warn('Alert ntfy Staff lookup failed: ' + _e2.toString()); }

    const ntfyContacts = [
        { topic: _alertEmgNtfy,  name: p['Emergency Contact Name']  },
        { topic: _alertEscNtfy,  name: p['Escalation Contact Name'] }
    ].filter(c => c.topic && c.topic.trim());

    ntfyContacts.forEach(c => {
        _sendNtfy(c.topic, `${headerEmoji} ${statusLabel} — ${workerName}`, ntfyMessage, ntfyPriority, ntfyTags);
    });

    // ── BUILD HTML EMAIL ───────────────────────────────────────────────────
    // what3words — optional. Only looked up when a valid GPS fix exists.
    const w3wAddress = (hasValidGps && CONFIG.W3W_API_KEY && !CONFIG.W3W_API_KEY.includes('%%'))
        ? getW3wAddress_(gpsLat, gpsLng)
        : null;

    const locationBlock = [
        `<tr><td style="color:#6b7280;padding:4px 12px 4px 0;white-space:nowrap;vertical-align:top">Site:</td><td style="padding:4px 0"><strong>${locationName}</strong></td></tr>`,
        locationAddr ? `<tr><td style="color:#6b7280;padding:4px 12px 4px 0;vertical-align:top">Address:</td><td style="padding:4px 0">${locationAddr}</td></tr>` : '',
        `<tr><td style="color:#6b7280;padding:4px 12px 4px 0;vertical-align:top">GPS:</td><td style="padding:4px 0">${gpsText}</td></tr>`,
        w3wAddress ? `<tr><td style="color:#6b7280;padding:4px 12px 4px 0;vertical-align:top">what3words:</td><td style="padding:4px 0"><a href="https://what3words.com/${w3wAddress.replace('///', '')}" style="color:#2563eb;">${w3wAddress}</a></td></tr>` : ''
    ].filter(Boolean).join('');

    // Build a per-recipient email with the correct salutation.
    // Each recipient gets "Dear [their first name]" rather than a generic greeting.
    // ntfyTopic: if provided, a subscribe deeplink is shown in TEST emails so contacts can opt in to push.
    const buildHtml = (recipientName, ntfyTopic) => {
        const salutation = recipientName
            ? `Dear ${recipientName.split(' ')[0]},`
            : 'Dear Emergency Contact,';
        const ntfyServer = (CONFIG.NTFY_SERVER && !CONFIG.NTFY_SERVER.includes('%%'))
            ? CONFIG.NTFY_SERVER.replace(/\/$/, '')
            : 'https://ntfy.sh';
        // Always shown in TEST_ALERT emails — this is the onboarding moment.
        // Two states: topic already configured (show subscribe button) or not yet set up (show instructions).
        const ntfySubscribeBlock = status.includes('TEST_ALERT')
            ? (ntfyTopic && ntfyTopic.trim()
                ? `<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px 20px;margin:24px 0 0">
                     <p style="margin:0 0 8px;font-size:13px;font-weight:bold;color:#1e40af">📲 Enable Instant Push Notifications</p>
                     <p style="margin:0 0 12px;font-size:13px;color:#374151">Install the free <strong>ntfy app</strong> on your phone and tap the button below to subscribe to <strong>${workerName}'s</strong> safety alerts. You'll receive a push notification the instant an alarm fires — no need to check your email.</p>
                     <a href="${ntfyServer}/${ntfyTopic.trim()}" style="display:inline-block;background:#1d4ed8;color:#fff;font-size:13px;font-weight:bold;padding:10px 20px;border-radius:6px;text-decoration:none">Subscribe to Push Alerts →</a>
                     <p style="margin:10px 0 0;font-size:11px;color:#6b7280">Download ntfy: <a href="https://apps.apple.com/app/ntfy/id1625396347" style="color:#2563eb">iOS App Store</a> · <a href="https://play.google.com/store/apps/details?id=io.heckel.ntfy" style="color:#2563eb">Google Play</a> · <a href="https://ntfy.sh" style="color:#2563eb">Web browser</a></p>
                   </div>`
                : `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px 20px;margin:24px 0 0">
                     <p style="margin:0 0 8px;font-size:13px;font-weight:bold;color:#166534">📲 Optional: Enable Instant Push Notifications</p>
                     <p style="margin:0 0 10px;font-size:13px;color:#374151">As well as this email, you can receive an <strong>instant push notification</strong> on your phone the moment any alarm fires — even on a locked screen, with no delay.</p>
                     <p style="margin:0 0 10px;font-size:13px;color:#374151"><strong>To set this up:</strong></p>
                     <ol style="margin:0 0 12px 20px;padding:0;font-size:13px;color:#374151;line-height:1.8">
                       <li>Download the free <strong>ntfy app</strong> (links below)</li>
                       <li>Open the app and tap <strong>Subscribe to topic</strong></li>
                       <li>Choose a private topic name — anything memorable, e.g. <em>jane-safety-alerts</em></li>
                       <li>Share that topic name with <strong>${workerFirst}</strong> so they can enter it in their safety app</li>
                     </ol>
                     <p style="margin:0 0 4px;font-size:11px;color:#6b7280">Download ntfy: <a href="https://apps.apple.com/app/ntfy/id1625396347" style="color:#16a34a">iOS App Store</a> · <a href="https://play.google.com/store/apps/details?id=io.heckel.ntfy" style="color:#16a34a">Google Play</a> · <a href="https://ntfy.sh" style="color:#16a34a">Web browser</a></p>
                     <p style="margin:4px 0 0;font-size:11px;color:#6b7280">ntfy is free and open source. Topics are private — nobody can find yours unless you share the name.</p>
                   </div>`)
            : '';
        return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

      <!-- Header -->
      <tr><td style="background:${headerColour};color:#fff;padding:24px 28px;border-radius:8px 8px 0 0">
        <div style="font-size:11px;font-weight:bold;letter-spacing:3px;opacity:0.85;text-transform:uppercase;margin-bottom:6px">OTG Lone Worker Safety</div>
        <div style="font-size:22px;font-weight:bold">${headerEmoji} ${statusLabel}</div>
      </td></tr>

      <!-- Body -->
      <tr><td style="background:#fff;padding:28px;border-radius:0 0 8px 8px">

        <p style="margin:0 0 20px">${salutation}</p>
        <p style="margin:0 0 20px">You are receiving this message because you are listed as <strong>${workerName}</strong>'s emergency contact.</p>

        <h2 style="font-size:14px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;color:#374151;border-bottom:1px solid #e5e7eb;padding-bottom:8px;margin:0 0 12px">What Has Happened</h2>
        <p style="margin:0 0 6px">${whatHappened}</p>
        ${notes ? `<p style="margin:8px 0 0;color:#6b7280;font-style:italic">&ldquo;${notes}&rdquo;</p>` : ''}

        <h2 style="font-size:14px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;color:#374151;border-bottom:1px solid #e5e7eb;padding-bottom:8px;margin:24px 0 12px">Worker Details</h2>
        <table cellpadding="0" cellspacing="0">
          <tr><td style="color:#6b7280;padding:4px 12px 4px 0;white-space:nowrap">Name:</td><td style="padding:4px 0"><strong>${workerName}</strong></td></tr>
          <tr><td style="color:#6b7280;padding:4px 12px 4px 0;white-space:nowrap">Phone:</td><td style="padding:4px 0">${workerPhoneLink}</td></tr>
        </table>

        <h2 style="font-size:14px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;color:#374151;border-bottom:1px solid #e5e7eb;padding-bottom:8px;margin:24px 0 12px">${isTravel ? 'Travel Locations' : 'Last Known Location'}</h2>
        ${isTravel ? travelLocationBlock : `<table cellpadding="0" cellspacing="0">${locationBlock}</table>`}

        <h2 style="font-size:14px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;color:#374151;border-bottom:1px solid #e5e7eb;padding-bottom:8px;margin:24px 0 12px">What You Should Do Now</h2>
        <ol style="margin:0 0 0 20px;padding:0;line-height:1.8">${actionSteps}</ol>

        ${noteToContact ? `
        <div style="background:#fef9c3;border-left:4px solid #eab308;padding:14px 16px;margin:24px 0 0;border-radius:0 6px 6px 0">
          <p style="margin:0;font-size:13px;color:#78350f">${noteToContact}</p>
        </div>` : ''}

        ${ntfySubscribeBlock}

        <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0">
        <table cellpadding="0" cellspacing="0" style="font-size:12px;color:#6b7280;width:100%">
          <tr><td style="padding:2px 12px 2px 0;white-space:nowrap">Status:</td><td>${statusLabel}</td></tr>
          <tr><td style="padding:2px 12px 2px 0;white-space:nowrap">Battery:</td><td>${battery}</td></tr>
          <tr><td style="padding:2px 12px 2px 0;white-space:nowrap">Sent at:</td><td>${sentAt}</td></tr>
        </table>

      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
    };

    // ── EMAIL ROUTING ──────────────────────────────────────────────────────
    // Send each contact a personalised email (correct "Dear [Name]" salutation).
    const contactPairs = [
        { email: p['Emergency Contact Email'],   name: p['Emergency Contact Name'],   ntfy: p['Emergency Contact Ntfy']   },
        { email: p['Escalation Contact Email'],  name: p['Escalation Contact Name'],  ntfy: p['Escalation Contact Ntfy']  }
    ].filter(c => c.email && c.email.includes('@'));

    contactPairs.forEach(contact => {
        const subject  = `${headerEmoji} ${statusLabel} — ${workerName}`;
        const htmlBody = buildHtml(contact.name, contact.ntfy);
        try {
            MailApp.sendEmail({ to: contact.email, subject, htmlBody });
        } catch (mailErr) {
            console.error("ALERT EMAIL FAILED: " + mailErr.toString());
            try {
                const failCount = parseInt(sp.getProperty('DAILY_FAIL_COUNT') || '0', 10);
                sp.setProperty('DAILY_FAIL_COUNT', String(failCount + 1));
                sp.setProperty('LAST_FAIL_DETAIL',
                    `${new Date().toISOString()} | Worker: ${workerName} | ${mailErr.toString().substring(0, 200)}`);
            } catch (propErr) { console.error("Could not write fail counter: " + propErr.toString()); }
        }
    });

    // ── SMS ROUTING ────────────────────────────────────────────────────────
    if (CONFIG.SMS_PROVIDER && CONFIG.SMS_PROVIDER !== 'none' && !CONFIG.SMS_PROVIDER.includes('%%')) {
        const numbers = [
            p['Emergency Contact Number'] || p['Emergency Contact Phone'],
            p['Escalation Contact Number'] || p['Escalation Contact Phone']
        ].map(n => _cleanPhone(n)).filter(n => n);

        // SMS must not contain URLs (Textbelt rejects them). Reverse-geocode the
        // coordinates to a short address instead. Falls back to raw lat,lng if
        // Nominatim is unavailable. Email and ntfy retain the full gpsLink above.
        // __43_: computed here, only when an SMS is actually going out.
        const gpsSmsTxt = (hasGPS && numbers.length)
            ? `Location: ${reverseGeocode_(rawGPS.trim())}`
            : `Location: Not available`;
        const smsBody = `🚨 ALERT: ${statusLabel}\nWorker: ${workerName}\nSite: ${locationName}\nPhone: ${workerPhone}\n${gpsSmsTxt}`;
        Logger.log('[SMS] Preparing to send. Body: "' + smsBody + '"');
        numbers.forEach(num => { try { _sendSms_(num, smsBody); } catch(e) { _logSmsResult_(num, smsBody, e.toString(), true); } });
    }

}

/**
 * REVERSE GEOCODE HELPER
 * Converts a "lat,lng" coordinate string to a short human-readable address
 * (road + suburb) using the Nominatim OSM API.
 *
 * Returns a formatted address string on success, or the raw "lat, lng"
 * coordinate string on any failure (network error, no result, missing fields).
 *
/**
 * getW3wAddress_ — converts a GPS coordinate pair to a what3words address.
 *
 * Requires CONFIG.W3W_API_KEY to be set (Business or charity plan).
 * The Free plan does not support coordinate conversion — this function
 * returns null silently if the key is absent or the API call fails.
 *
 * @param  {number} lat
 * @param  {number} lng
 * @return {string|null}  e.g. "///filled.count.soap", or null on failure/no key
 */
function getW3wAddress_(lat, lng) {
    try {
        const key = CONFIG.W3W_API_KEY;
        if (!key || key.includes('%%') || key.length < 8) return null;
        const url = `https://api.what3words.com/v3/convert-to-3wa?coordinates=${lat},${lng}&key=${encodeURIComponent(key)}`;
        const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
        if (resp.getResponseCode() !== 200) return null;
        const json = JSON.parse(resp.getContentText());
        return json.words ? `///${json.words}` : null;
    } catch (e) {
        console.warn('getW3wAddress_ failed: ' + e.message);
        return null;
    }
}

/**
 * Used to produce SMS-safe location text — no URLs, no map links.
 *
 * @param  {string} rawGPS  - Coordinate string in "lat,lng" format
 * @return {string}         - "Road Name, Suburb" or "lat, lng" fallback
 */
function reverseGeocode_(rawGPS) {
    try {
        const parts = rawGPS.trim().split(',');
        if (parts.length < 2) return rawGPS.trim();
        const lat = parts[0].trim();
        const lng = parts[1].trim();

        const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`;
        const response = UrlFetchApp.fetch(url, {
            headers: { 'User-Agent': 'OTG-AppSuite/1.0 (lone-worker-safety)' },
            muteHttpExceptions: true
        });

        if (response.getResponseCode() !== 200) return `${lat}, ${lng}`;

        const data = JSON.parse(response.getContentText());
        if (!data || !data.address) return `${lat}, ${lng}`;

        const addr   = data.address;
        const road   = addr.road || addr.pedestrian || addr.footway || '';
        // NZ suburb structures vary — try each in order of specificity
        const suburb = addr.suburb || addr.quarter || addr.village
                     || addr.town  || addr.city_district || '';

        if (!road && !suburb) return `${lat}, ${lng}`;
        if (!road)   return suburb;
        if (!suburb) return road;
        return `${road}, ${suburb}`;

    } catch (e) {
        console.error('reverseGeocode_ failed: ' + e.message);
        // Fall back to raw coordinates so the SMS still contains location info
        return rawGPS.trim();
    }
}

/**
 * NTFY PUSH NOTIFICATION HELPER
 * Posts a push notification to a contact's ntfy topic.
 * The ntfy app on their phone receives it instantly, bypassing email latency.
 *
 * @param {string} topic    - The contact's private ntfy topic string (e.g. "alice-safety-7x9k2")
 * @param {string} title    - Notification title (shown in bold on lock screen)
 * @param {string} message  - Notification body text
 * @param {string} priority - ntfy priority: "min","low","default","high","urgent"
 * @param {string} tags     - Comma-separated ntfy emoji tags (e.g. "rotating_light,red_circle")
 *
 * Silently skipped if topic is blank or NTFY_SERVER is not configured.
 * All errors are caught — a failed push must never prevent email/SMS from sending.
 */
function _sendNtfy(topic, title, message, priority, tags) {
    if (!topic || topic.trim() === '') return;
    const server = (CONFIG.NTFY_SERVER && !CONFIG.NTFY_SERVER.includes('%%'))
        ? CONFIG.NTFY_SERVER.replace(/\/$/, '')
        : 'https://ntfy.sh';

    // Proxy routing: if NTFY_PROXY_URL is configured, route through the PHP proxy
    // (which has a clean IP not subject to ntfy.sh fail2ban on the trigger path).
    // Self-hosted ntfy users set NTFY_SERVER instead and leave these blank.
    const proxyUrl    = (CONFIG.NTFY_PROXY_URL    && !CONFIG.NTFY_PROXY_URL.includes('%%'))
        ? CONFIG.NTFY_PROXY_URL.replace(/\/$/, '')    : '';
    const proxySecret = (CONFIG.NTFY_PROXY_SECRET && !CONFIG.NTFY_PROXY_SECRET.includes('%%'))
        ? CONFIG.NTFY_PROXY_SECRET : '';

    const fetchUrl     = proxyUrl ? `${proxyUrl}/${topic.trim()}` : `${server}/${topic.trim()}`;
    const extraHeaders = (proxyUrl && proxySecret) ? { 'X-Proxy-Secret': proxySecret } : {};

    const via = proxyUrl ? 'proxy' : 'direct';
    try {
        const response = UrlFetchApp.fetch(fetchUrl, {
            method: 'post',
            headers: {
                'Title':    title,
                'Priority': priority || 'default',
                'Tags':     tags    || 'bell',
                ...extraHeaders
            },
            payload:            message,
            muteHttpExceptions: true
        });
        const code = response.getResponseCode();
        if (code >= 200 && code < 300) {
            console.log(`ntfy push sent to topic: ${topic}${proxyUrl ? ' (via proxy)' : ''}`);
            return { ok: true,  code, via };
        } else {
            console.warn(`ntfy push rejected for topic "${topic}": HTTP ${code}`);
            return { ok: false, code, via };
        }
    } catch (e) {
        console.error(`ntfy push failed for topic "${topic}": ${e.toString()}`);
        return { ok: false, code: null, via, error: e.toString() };
    }
}


/**
 * DEAD-MAN'S SWITCH PING
 * Fires a silent HTTP GET to the Healthchecks.io check URL after every
 * successful checkOverdueVisits() run. If Healthchecks.io doesn't receive
 * a ping within the configured grace window (~35 min), it emails the admin
 * to report that the escalation engine has gone silent.
 *
 * Skipped silently if HEALTHCHECK_URL is blank or not yet configured.
 * All errors are caught — a failed ping must never crash the escalation engine.
 */
function _pingHealthcheck() {
    const url = CONFIG.HEALTHCHECK_URL;
    if (!url || url.includes('%%') || url.length < 10) return;
    try {
        UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true });
        console.log('Healthcheck ping sent.');
    } catch (e) {
        console.warn('Healthcheck ping failed (non-critical): ' + e.toString());
    }
}

function checkOverdueVisits() {
    // __43_ (F86-2): two locks, two jobs.
    //  1. Overlap guard (document lock, or a CacheService marker): two minute-runs never overlap while a slow send is
    //     still going. tryLock(0) - skip, never queue. Before __43_ the SCRIPT lock did this job, so a checker run was
    //     also skipped whenever a doPost held it.
    //  2. The script lock (shared with doPost) is held only to read the sheet, claim col AA and write col A/K/L.
    //     Alerts go out after it is released. Session 86: holding it through the step 1 send (about 9 s, two contacts)
    //     made a phone OVERDUE ALARM wait 9,559 ms of its 10,000 ms limit.
    const guard = _checkerGuardAcquire_();
    if (!guard) { console.log('[checkOverdueVisits] Skipped - another checker run is still going.'); return; }
    try {
        const lock = LockService.getScriptLock();
        const _w0 = Date.now();
        let got = false;
        try { got = lock.tryLock(CHECKER_LOCK_WAIT_MS); } catch (_) { got = false; }
        const lockWaitMs = Date.now() - _w0;
        if (!got) {
            _audit_('checker:lock-busy', '', '', '', '', '', '', 'script lock not obtained within ' + CHECKER_LOCK_WAIT_MS +
                    ' ms - run skipped, the next minute retries');
            return;
        }
        const sends = [];
        let completed = false, lockHeldMs = 0;
        const _h0 = Date.now();
        try {
            completed = _checkOverdueLocked_(sends);
            _ladderSendingFlags_(sends, true); // All Clears for these workers wait until the alerts have gone
        } finally {
            // __38_: commit pending sheet writes before the next execution can take the lock.
            try { SpreadsheetApp.flush(); } catch (_) {}
            lockHeldMs = Date.now() - _h0;
            lock.releaseLock();
        }
        // ---- lock released: send ----
        _runLadderSends_(sends);
        if (sends.length) {
            _audit_('checker:lock', '', '', '', '', '', '', 'lockWait=' + lockWaitMs + 'ms lockHeld=' + lockHeldMs + 'ms sends=' +
                    sends.length + ' (sent after lock release) guard=' + guard.kind);
        }
        // Ping dead-man's switch — confirms the escalation engine ran to completion.
        // Only fires here (after the loop) so a crash or early return leaves Healthchecks
        // without a ping, which it correctly interprets as a system failure.
        if (completed) _pingHealthcheck();
    } finally {
        _checkerGuardRelease_(guard);
    }
}

/**
 * __43_: the checker's decisions, run while the script lock is held. Claims and sheet writes happen here; the alerts
 * are pushed onto `sends` and go out after the lock is released (_runLadderSends_). Returns false on an early return
 * (no Visits sheet), true when the loop ran.
 */
function _checkOverdueLocked_(sends) {
    // Record successful trigger execution time for health email reporting
    try { sp.setProperty('LAST_TRIGGER_TIME', new Date().toISOString()); } catch(e) {}

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Visits');
    if(!sheet) return false;
    const data = sheet.getDataRange().getValues();
    const now = new Date();
    const latest = {};
    
    for(let i=1; i<data.length; i++) {
        const row = data[i];
        const name = row[2]; 
        if(!latest[name] || new Date(row[0]) > latest[name].time) {
            latest[name] = { r: i+1, time: new Date(row[0]), rowData: row };
        }
    }
    
    Object.keys(latest).forEach(worker => {
        try {
            const entry = latest[worker].rowData;
            const status = String(entry[10]); 
            const dueTimeStr = entry[20]; 
            const isClosed = status.includes("DEPARTED") || status.includes("COMPLETED") || status.includes("DATA_ENTRY_ONLY") || status.includes("USER_SAFE");
            
            if(!isClosed && dueTimeStr) {
                const due = new Date(dueTimeStr);
                // A12 (session 72): an unreadable due time used to give NaN and silently never
                // escalate. Record it so the daily health email reports it.
                if (isNaN(due.getTime())) {
                    console.error('[checkOverdueVisits] Unreadable due time for ' + worker + ': ' + dueTimeStr);
                    try { sp.setProperty('LAST_DUE_PARSE_ERROR', new Date().toISOString() + ' | ' + worker + ' | col U = "' + String(dueTimeStr).substring(0, 60) + '"'); } catch (_) {}
                    return;
                }
                const diffMins = (now - due) / 60000; 
                // A12: String() - Sheets may store Notes as a number or date, and .includes()
                // on those threw, skipping this worker every minute.
                const isCritical = String(entry[11] || '').includes("[CRITICAL_TIMING]");

                // 1. CRITICAL TIMING: own three-step ladder, both contacts every step.
                //    Step 1 at due, step 2 at due + 5, step 3 (final notice) at due + 10,
                //    then no further server alerts. Steps advance by what col K shows has
                //    already been sent, so a late or skipped trigger still sends them in
                //    order, one per run. Critical rows ALWAYS return here and never enter
                //    the standard 15/30/45/60 ladder (A2 fix - the 30/45 tiers used to
                //    overwrite col K and re-fire this alert every minute).
                if (isCritical) {
                    if (diffMins >= 0) {
                        // __38_ (F74-1): the ladder's memory lives in col AA, keyed to the due time.
                        // On 15 Oct col K went FINAL NOTICE -> REPEAT with no backend writer (proven
                        // from cell edit history) and FINAL NOTICE was sent twice, because the ladder
                        // took its step from col K. Col AA is authoritative once it holds an entry for
                        // THIS due time; col K is used only when it does not (rows open before __38_
                        // was deployed). A new due time (visit extended, A11) starts a fresh ladder.
                        const rowNum  = latest[worker].r;
                        const dueIso  = due.toISOString();
                        const memRaw  = String(entry[LADDER_MEM_COL - 1] || '');
                        // __42_ (B1): col K is a fallback ONLY for a legacy row with no col AA entry at all.
                        // A col AA entry for a different due time means a fresh ladder (step 0) - before,
                        // it fell back to col K, which could hold an older due time's step.
                        const mem     = _ladderMemInfo_(memRaw, dueIso);
                        const memStep = mem.same ? Math.min(mem.step, 3) : 0;
                        const kStep   = _ladderStepFromStatus_(status);
                        const sent    = mem.has ? memStep : kStep;
                        let next = 0;
                        if (sent === 0) {
                            if (mem.has) next = 1;                                 // __42_: fresh ladder for this due time
                            else if (!status.includes("EMERGENCY")) next = 1;      // legacy row: unchanged step 1 rule
                        } else if (sent === 1) {
                            if (diffMins >= 5) next = 2;
                        } else if (sent === 2) {
                            if (diffMins >= 10) next = 3;
                        }
                        // __42_: no mismatch noise while col K holds PANIC/DURESS (B1 leaves it there on purpose).
                        const mismatch = memStep > 0 && kStep !== memStep && _alarmRank_(status) < 4;
                        if (next || mismatch || sent < 3) {
                            _audit_('ladder', worker, rowNum, status, next ? LADDER_STATUSES[next - 1] : '', '', '',
                                    'diff=' + diffMins.toFixed(1) + 'm AA="' + memRaw + '" sent=' + sent + (mem.has ? '' : ' (legacy: from col K)') +
                                    (next ? ' -> sending step ' + next : ' -> nothing due') +
                                    (mismatch ? ' | MISMATCH: col K step ' + kStep + ' vs col AA step ' + memStep : ''));
                        }
                        if (next) {
                            // Claim before send: record the step BEFORE alerting so a repeat run cannot
                            // resend it. A failed claim never blocks the alert (a duplicate beats a miss).
                            const claimVal = _ladderMemClaim_(sheet, rowNum, due, next, 'ladder', worker);
                            // __43_: col A/K/L written now (under the lock); the alerts go out after release.
                            sends.push({ src: 'ladder', worker: worker, rowNum: rowNum, step: next, status: LADDER_STATUSES[next - 1],
                                         claimVal: claimVal, job: _escalationWrite_(sheet, entry, LADDER_STATUSES[next - 1], true, rowNum) });
                        } else if (_ladderResendDue_(mem, now.getTime())) {
                            // __43_: this step was claimed 3+ minutes ago and its alerts never confirmed sent (the run died
                            // or the send threw). Send it again, once. No sheet writes besides the new claim.
                            const rs = Math.min(mem.step, 3);
                            _audit_('ladder:resend', worker, rowNum, status, LADDER_STATUSES[rs - 1], '', '',
                                    'step ' + rs + ' claimed at ' + new Date(mem.claimMs).toISOString() + ' was never marked sent - re-sending once');
                            const claimVal = _ladderMemClaim_(sheet, rowNum, due, rs, 'ladder', worker, null, true);
                            sends.push({ src: 'ladder', worker: worker, rowNum: rowNum, step: rs, status: LADDER_STATUSES[rs - 1], resend: true,
                                         claimVal: claimVal, job: _escalationPayload_(sheet, entry, LADDER_STATUSES[rs - 1], true) });
                        }
                    }
                    return;
                }

                // 2. STANDARD: 15/30/45/60 min escalations
                // __42_ (B1, A7): the ladder's memory is col AA, keyed to the due time and claimed before
                // the alert is sent - the same rule as Critical Timing. Before, it was col K, so a PIN clear
                // or any status written over the tier text re-sent a tier, and the tier text overwrote
                // PANIC/DURESS. Col K is read only for a legacy row with NO col AA entry at all; a col AA
                // entry for a different due time (extended, or a PIN clear after due) is a fresh ladder.
                // The tier windows are unchanged: one tier per window, the one matching the time overdue.
                {
                    const rowNum  = latest[worker].r;
                    const dueIso  = due.toISOString();
                    const memRaw  = String(entry[LADDER_MEM_COL - 1] || '');
                    const mem     = _ladderMemInfo_(memRaw, dueIso);
                    const sent    = mem.has ? (mem.same ? mem.step : 0) : _ladderStepFromStdStatus_(status);
                    // __45_ (F89-3, Decision 1 = b): tier 1 at the grace period (CONFIG.ESCALATION_MINUTES, the same Factory
                    // field the phone uses), then every 15 minutes. A 15-minute grace gives the old 15/30/45/60.
                    const _g      = _graceMinutes_();
                    const target  = diffMins >= _g + 45 ? 4 : diffMins >= _g + 30 ? 3 : diffMins >= _g + 15 ? 2 : diffMins >= _g ? 1 : 0;
                    if (target > sent) {
                        _audit_('ladder-std', worker, rowNum, status, LADDER_STD_STATUSES[target - 1], '', '',
                                'diff=' + diffMins.toFixed(1) + 'm AA="' + memRaw + '" sent=' + sent +
                                (mem.has ? '' : ' (legacy: from col K)') + ' -> sending step ' + target);
                        const claimVal = _ladderMemClaim_(sheet, rowNum, due, target, 'ladder-std', worker, LADDER_STD_LABELS);
                        // __43_: sheet written now; the alert goes out after the lock is released.
                        sends.push({ src: 'ladder-std', worker: worker, rowNum: rowNum, step: target, status: LADDER_STD_STATUSES[target - 1],
                                     claimVal: claimVal, job: _escalationWrite_(sheet, entry, LADDER_STD_STATUSES[target - 1], target === 4, rowNum) });
                    } else if (target >= 1 && target === sent && _ladderResendDue_(mem, now.getTime())) {
                        // __43_: claimed 3+ minutes ago, never confirmed sent - re-send once.
                        const rs = mem.step;
                        _audit_('ladder-std:resend', worker, rowNum, status, LADDER_STD_STATUSES[rs - 1], '', '',
                                'step ' + rs + ' claimed at ' + new Date(mem.claimMs).toISOString() + ' was never marked sent - re-sending once');
                        const claimVal = _ladderMemClaim_(sheet, rowNum, due, rs, 'ladder-std', worker, LADDER_STD_LABELS, true);
                        sends.push({ src: 'ladder-std', worker: worker, rowNum: rowNum, step: rs, status: LADDER_STD_STATUSES[rs - 1], resend: true,
                                     claimVal: claimVal, job: _escalationPayload_(sheet, entry, LADDER_STD_STATUSES[rs - 1], rs === 4) });
                    }
                }
            }
        } catch (err) { console.error(`Escalation Error: ${err.toString()}`); }
    });
    return true;
}

/**
 * __43_: send the ladder alerts queued by _checkOverdueLocked_, with the script lock released. Each send is timed and
 * audited; those that returned are marked '|SENT' in col AA under one short lock. A send that throws is left unmarked
 * and the next runs re-send it once after LADDER_RESEND_AFTER_MS (a duplicate beats a miss).
 */
function _runLadderSends_(sends) {
    if (!sends || !sends.length) return;
    const done = [];
    sends.forEach(function (s) {
        const t0 = Date.now();
        try {
            triggerAlerts(s.job.payload, s.job.type);
            done.push(s);
            _audit_(s.src + ':sends-complete', s.worker, s.rowNum, '', s.status, '', '',
                    'step ' + s.step + (s.resend ? ' (re-send)' : '') + ' alerts returned after ' + (Date.now() - t0) + 'ms (lock released)' +
                    (s.job.payload && s.job.payload['Contact Scope'] === 'primary' ? ' - primary contact only' : ''));   // __45_ (F89-1)
        } catch (err) {
            _audit_(s.src + ':send-FAILED', s.worker, s.rowNum, '', s.status, '', '',
                    'step ' + s.step + ' threw after ' + (Date.now() - t0) + 'ms: ' + String(err).substring(0, 200) +
                    ' - left unmarked, re-sent once after ' + (LADDER_RESEND_AFTER_MS / 60000) + ' min');
        }
    });
    if (done.length) {
        _withShortLock_('ladder:mark-sent', function (got) {
            if (!got) return; // unmarked: re-sent once later (a duplicate beats a miss)
            const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Visits');
            if (sh) done.forEach(function (s) { _ladderMarkSent_(sh, s); });
        });
    }
    _ladderSendingFlags_(sends, false);
}

/** __43_: per-worker "ladder alerts in flight" flag (CacheService, 2 min). All Clear waits while it is set. */
function _ladderSendingFlags_(sends, on) {
    try {
        const cache = CacheService.getScriptCache();
        const seen = {};
        (sends || []).forEach(function (s) {
            if (seen[s.worker]) return;
            seen[s.worker] = 1;
            cache.put(_sendingKey_(s.worker), on ? '1' : '0', on ? 120 : 1);
        });
    } catch (_) {}
}
function _sendingKey_(worker) { return 'SENDING_' + String(worker || '').substring(0, 200); }

/**
 * __43_: one checker run at a time. Document lock where Apps Script provides one; otherwise a CacheService marker
 * (2-minute expiry, not atomic - col AA claims still stop a duplicate step). Returns null when another run holds it.
 */
function _checkerGuardAcquire_() {
    try {
        const dl = LockService.getDocumentLock();
        if (dl) return dl.tryLock(0) ? { kind: 'doc', lock: dl } : null;
    } catch (_) {}
    try {
        const c = CacheService.getScriptCache();
        if (c.get('CHECKER_RUNNING') === '1') return null;
        c.put('CHECKER_RUNNING', '1', 120);
        return { kind: 'cache', cache: c };
    } catch (_) {}
    return { kind: 'none' };
}
function _checkerGuardRelease_(g) {
    if (!g) return;
    try {
        if (g.kind === 'doc') g.lock.releaseLock();
        else if (g.kind === 'cache') g.cache.put('CHECKER_RUNNING', '0', 1);
    } catch (_) {}
}

/**
 * OBSERVABILITY HEALTH EMAIL
 * Run on a daily time-based trigger (e.g. 07:00 each morning).
 * Also available from the OTG Admin menu for manual execution.
 *
 * Reports:
 *   - Visit count in the last 24 hours
 *   - Escalation alerts dispatched in the last 24 hours
 *   - Failed alert emails (tracked via PropertiesService DAILY_FAIL_COUNT)
 *   - Timestamp of the last successful checkOverdueVisits() trigger run
 *   - Any workers with an open visit older than 24 hours (likely a missed departure)
 */
function sendHealthEmail() { _jobRun_('sendHealthEmail', _sendHealthEmailImpl_); }

function _sendHealthEmailImpl_() {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const tz = CONFIG.TIMEZONE || 'UTC';
    const fmtTime = d => Utilities.formatDate(new Date(d), tz, "dd MMM yyyy HH:mm z");

    // --- 1. Read Visits sheet ---
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Visits');

    let visitCount = 0;
    let escalationCount = 0;
    const stalledVisits = []; // Open visits that started > 24h ago

    const ESCALATION_STATUSES = ['OVERDUE', 'EMERGENCY', 'PANIC', 'SOS', 'DURESS'];
    const CLOSED_STATUSES     = ['DEPARTED', 'COMPLETED', 'DATA_ENTRY_ONLY', 'USER_SAFE'];

    if (sheet && sheet.getLastRow() > 1) {
        const data = sheet.getDataRange().getValues();
        // Track the most recent row per worker to detect stalled open visits
        const latestRowPerWorker = {};

        for (let i = 1; i < data.length; i++) {
            const row       = data[i];
            const rowTime   = new Date(row[0]);   // col A: Timestamp
            const worker    = String(row[2]);      // col C: Worker Name
            const status    = String(row[10]);     // col K: Alarm Status

            // Count visits and escalations in the last 24h
            if (rowTime > oneDayAgo) {
                visitCount++;
                if (ESCALATION_STATUSES.some(s => status.toUpperCase().includes(s))) {
                    escalationCount++;
                }
            }

            // Track the latest row per worker for stall detection
            if (!latestRowPerWorker[worker] || rowTime > latestRowPerWorker[worker].time) {
                latestRowPerWorker[worker] = { time: rowTime, status: status, location: String(row[12]) };
            }
        }

        // Flag workers whose latest row is open and older than 24h
        Object.keys(latestRowPerWorker).forEach(worker => {
            const entry = latestRowPerWorker[worker];
            const isClosed = CLOSED_STATUSES.some(s => entry.status.toUpperCase().includes(s));
            if (!isClosed && entry.time < oneDayAgo) {
                stalledVisits.push({
                    worker:   worker,
                    since:    fmtTime(entry.time),
                    status:   entry.status,
                    location: entry.location
                });
            }
        });
    }

    // --- 2. Read PropertiesService counters ---
    const failCount      = parseInt(sp.getProperty('DAILY_FAIL_COUNT') || '0', 10);
    const lastFailDetail = sp.getProperty('LAST_FAIL_DETAIL') || 'None';
    // __41_: the escalation engine line is judged, not just printed (amber over 5 min, red over 10 min).
    const _eng = _engineAge_(now);
    let lastTriggerStr;
    if (_eng.level === 'NEVER') {
        lastTriggerStr = '<strong style="color:#c0392b">Never recorded — is the 1-minute trigger set up?</strong>';
    } else {
        const _engColour = _eng.level === 'OK' ? '#27ae60' : _eng.level === 'WARN' ? '#e67e22' : '#c0392b';
        lastTriggerStr = fmtTime(_eng.time) + ' <strong style="color:' + _engColour + '">(' + _jobAgeText_(_eng.ageMin / 60) + ' ago' +
                         (_eng.level === 'STALE' ? ' - ESCALATION MAY HAVE STOPPED' : '') + ')</strong>';
    }

    // __41_: Background Jobs table. This job shows only if its previous run failed or went stale (an email
    // arriving at all is the proof it ran).
    const _jobList = _jobStatuses_(now).filter(j => j.fn !== 'sendHealthEmail' || j.status === 'FAILED' || j.status === 'STALE');
    const _jobBad  = _jobList.filter(j => j.status === 'STALE' || j.status === 'FAILED' || j.status === 'NEVER');
    const _jobColour = { OK: '#27ae60', WAITING: '#888', STALE: '#c0392b', FAILED: '#c0392b', NEVER: '#c0392b' };
    const _jobRowsHtml = _jobList.map(j =>
        '<tr><td style="padding:8px 12px;border-top:1px solid #eee;vertical-align:top">' + _escHtml(j.label) +
        '<br><em style="font-size:11px;color:#888">' + _escHtml(j.every) + '</em></td>' +
        '<td style="padding:8px 12px;border-top:1px solid #eee;vertical-align:top"><strong style="color:' + _jobColour[j.status] + '">' + j.status + '</strong></td>' +
        '<td style="padding:8px 12px;border-top:1px solid #eee;font-size:13px">' + _escHtml(_jobDescribe_(j, tz)) + '</td></tr>').join('');
    const _jobSectionHtml =
        '<h3 style="margin:20px 0 12px;font-size:15px;color:#1e3a5f">Background Jobs</h3>' +
        '<table style="border-collapse:collapse;width:100%;background:#fff;border-radius:4px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)">' +
        '<tr style="background:#e8edf3"><th style="text-align:left;padding:10px 12px;font-size:13px">Job</th><th style="text-align:left;padding:10px 12px;font-size:13px">Status</th><th style="text-align:left;padding:10px 12px;font-size:13px">Detail</th></tr>' +
        _jobRowsHtml + '</table>' +
        (_jobBad.length > 0
            ? '<div style="background:#fdf3f3;border-left:4px solid #c0392b;padding:12px 16px;margin-top:12px;border-radius:0 4px 4px 0"><strong style="color:#c0392b">&#9888; ' +
              _jobBad.length + ' background job(s) need attention.</strong> Alerts to contacts are not affected by these jobs, but something that should be running is not. Check Apps Script &gt; Triggers and Executions.</div>'
            : '');
    const _healthProblems = _jobBad.length > 0 || _eng.level === 'STALE' || _eng.level === 'NEVER';

    // --- 3. Build HTML email ---
    const statusColour = (val, bad) => `color:${val > 0 && bad ? '#c0392b' : val > 0 ? '#e67e22' : '#27ae60'}`;

    const stalledRows = stalledVisits.length === 0
        ? '<tr><td colspan="4" style="color:#27ae60;padding:8px 12px">None — all visits closed within 24 hours ✓</td></tr>'
        : stalledVisits.map(v =>
            `<tr>
               <td style="padding:8px 12px">${v.worker}</td>
               <td style="padding:8px 12px">${v.since}</td>
               <td style="padding:8px 12px">${v.status}</td>
               <td style="padding:8px 12px">${v.location}</td>
             </tr>`
          ).join('');

    const html = `
<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#1a1a1a">
  <div style="background:#1e3a5f;padding:20px 24px;border-radius:6px 6px 0 0">
    <h2 style="margin:0;color:#fff;font-size:18px">🛡️ OTG Daily Health Report — ${CONFIG.ORG_NAME}</h2>
    <p style="margin:4px 0 0;color:#adc8e8;font-size:13px">Generated ${fmtTime(now)}</p>
  </div>

  <div style="background:#f4f6f9;padding:20px 24px">

    <h3 style="margin:0 0 12px;font-size:15px;color:#1e3a5f">Last 24 Hours — Activity Summary</h3>
    <table style="border-collapse:collapse;width:100%;background:#fff;border-radius:4px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)">
      <tr style="background:#e8edf3">
        <th style="text-align:left;padding:10px 12px;font-size:13px">Metric</th>
        <th style="text-align:left;padding:10px 12px;font-size:13px">Value</th>
      </tr>
      <tr>
        <td style="padding:10px 12px;border-top:1px solid #eee">Worker visits logged</td>
        <td style="padding:10px 12px;border-top:1px solid #eee"><strong>${visitCount}</strong></td>
      </tr>
      <tr>
        <td style="padding:10px 12px;border-top:1px solid #eee">Escalation alerts dispatched</td>
        <td style="padding:10px 12px;border-top:1px solid #eee"><strong style="${statusColour(escalationCount, false)}">${escalationCount}</strong></td>
      </tr>
      <tr>
        <td style="padding:10px 12px;border-top:1px solid #eee">Failed alert emails <em style="font-size:11px;color:#888">(since last report)</em></td>
        <td style="padding:10px 12px;border-top:1px solid #eee"><strong style="${statusColour(failCount, true)}">${failCount}</strong>
          ${failCount > 0 ? `<br><span style="font-size:11px;color:#888">Last: ${lastFailDetail}</span>` : ''}
        </td>
      </tr>
      <tr>
        <td style="padding:10px 12px;border-top:1px solid #eee">Escalation engine last ran</td>
        <td style="padding:10px 12px;border-top:1px solid #eee">${lastTriggerStr}</td>
      </tr>
    </table>

    ${_jobSectionHtml}

    <h3 style="margin:20px 0 12px;font-size:15px;color:#1e3a5f">Open Visits Older Than 24 Hours <em style="font-weight:normal;font-size:13px;color:#888">(likely missed departures)</em></h3>
    <table style="border-collapse:collapse;width:100%;background:#fff;border-radius:4px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)">
      <tr style="background:#e8edf3">
        <th style="text-align:left;padding:10px 12px;font-size:13px">Worker</th>
        <th style="text-align:left;padding:10px 12px;font-size:13px">Open Since</th>
        <th style="text-align:left;padding:10px 12px;font-size:13px">Last Status</th>
        <th style="text-align:left;padding:10px 12px;font-size:13px">Location</th>
      </tr>
      ${stalledRows}
    </table>

    ${failCount > 0 ? `
    <div style="background:#fdf3f3;border-left:4px solid #c0392b;padding:12px 16px;margin-top:16px;border-radius:0 4px 4px 0">
      <strong style="color:#c0392b">⚠ Alert email failures detected.</strong>
      Check Apps Script &gt; Executions log for full stack traces.
    </div>` : ''}

    ${sp.getProperty('LAST_DUE_PARSE_ERROR') ? `
    <div style="background:#fdf3f3;border-left:4px solid #c0392b;padding:12px 16px;margin-top:16px;border-radius:0 4px 4px 0">
      <strong style="color:#c0392b">⚠ A visit had an unreadable due time and could NOT be escalated.</strong>
      Check column U of the Visits sheet. Last seen: ${sp.getProperty('LAST_DUE_PARSE_ERROR')}
    </div>` : ''}

    ${sp.getProperty('ARCHIVE_FAILED') ? `
    <div style="background:#fdf3f3;border-left:4px solid #c0392b;padding:12px 16px;margin-top:16px;border-radius:0 4px 4px 0">
      <strong style="color:#c0392b">\u26a0 The monthly archive of old Visits rows did not run.</strong>
      Alerts are not affected; old rows stay in Visits until it runs. Last seen: ${sp.getProperty('ARCHIVE_FAILED')}
    </div>` : ''}

    ${stalledVisits.length > 0 ? `
    <div style="background:#fef9ec;border-left:4px solid #e67e22;padding:12px 16px;margin-top:16px;border-radius:0 4px 4px 0">
      <strong style="color:#e67e22">⚠ ${stalledVisits.length} worker(s) have open visits older than 24 hours.</strong>
      These may represent missed departures or a visit the worker forgot to close. Follow up manually.
    </div>` : ''}

  </div>
  <div style="background:#e8edf3;padding:10px 24px;border-radius:0 0 6px 6px;font-size:11px;color:#888">
    OTG AppSuite ${CONFIG.VERSION} (${TEMPLATE_BUILD}) — this report was sent by <em>sendHealthEmail()</em>. To unsubscribe, remove the daily trigger from Apps Script.
  </div>
</div>`;

    // --- 4. Send ---
    const recipient = (CONFIG.HEALTH_EMAIL && CONFIG.HEALTH_EMAIL.includes('@'))
        ? CONFIG.HEALTH_EMAIL
        : Session.getEffectiveUser().getEmail();

    const subject = `${stalledVisits.length > 0 || failCount > 0 || _healthProblems ? '⚠️' : '✅'} OTG Health Report — ${CONFIG.ORG_NAME} — ${Utilities.formatDate(now, tz, "dd MMM yyyy")}`;

    MailApp.sendEmail({ to: recipient, subject: subject, htmlBody: html });

    // --- 5. Reset daily fail counter now that it's been reported ---
    sp.setProperty('DAILY_FAIL_COUNT', '0');
    sp.deleteProperty('LAST_FAIL_DETAIL');
    sp.deleteProperty('LAST_DUE_PARSE_ERROR'); // A12: reported - clear until it recurs
    sp.deleteProperty('ARCHIVE_FAILED'); // __39_: reported - clear until it recurs
    _auditTrim_(); // __38_: keep the Audit sheet to the last AUDIT_MAX_ROWS rows

    console.log(`Health email sent to ${recipient}. Visits: ${visitCount}, Escalations: ${escalationCount}, Fails: ${failCount}, Stalled: ${stalledVisits.length}`);
}

/**
 * SYSTEM DIAGNOSTICS
 * Checks all integrations, configuration, sheets, and triggers.
 * Run from: OTG Admin menu → Run System Diagnostics, or manually in the Apps Script editor.
 * Output: Logger (visible in editor) + HTML email to the configured health email address.
 *
 * ntfy test: posts to a derived diagnostics topic — subscribe to it once in the ntfy app
 * to verify push delivery end-to-end. Topic format: [org-slug]-otg-diag
 */

// ==========================================
// SITE GPS GEOCODING
// ==========================================

/**
 * Geocodes site addresses from the Sites sheet and stores resolved coordinates
 * in column M ("Site GPS") for use by the monitor dashboard map.
 *
 * - Skips rows that already have a value in column M (including "FAILED").
 * - Writes "lat,lng" on success, "FAILED" if Nominatim cannot resolve the address.
 * - Sleeps 1.1 seconds between calls to respect Nominatim's rate limit policy.
 * - Creates the "Site GPS" column header in row 1 if absent.
 * - Safe to run repeatedly — only processes unresolved rows.
 *
 * Triggered: weekly time-based trigger (recommended: Sunday early morning).
 * Can also be run manually from OTG Admin → Geocode Site Locations,
 * or is called automatically at the start of runDiagnostics().
 *
 * Returns a summary object { attempted, resolved, failed, skipped } for use
 * by runDiagnostics().
 */
function geocodeSiteLocations() {
    return _jobRun_('geocodeSiteLocations', _geocodeSiteLocationsImpl_, function (r) {
        return r ? (r.attempted + ' attempted, ' + r.resolved + ' resolved, ' + r.failed + ' failed') : '';
    });
}

function _geocodeSiteLocationsImpl_() {
    const ss         = SpreadsheetApp.getActiveSpreadsheet();
    const siteSheet  = ss.getSheetByName('Sites');
    const summary    = { attempted: 0, resolved: 0, failed: 0, skipped: 0 };

    if (!siteSheet || siteSheet.getLastRow() < 2) return summary;

    const lastRow   = siteSheet.getLastRow();
    const lastCol   = Math.max(siteSheet.getLastColumn(), 13); // ensure we read at least col M
    const allData   = siteSheet.getRange(1, 1, lastRow, lastCol).getValues();

    // ── Ensure column M header exists ─────────────────────────────────────
    const GPS_COL   = 13; // 1-based column M
    const GPS_IDX   = 12; // 0-based index
    if (!allData[0][GPS_IDX] || allData[0][GPS_IDX].toString().trim() === '') {
        siteSheet.getRange(1, GPS_COL).setValue('Site GPS');
    }

    // ── Process each site row ─────────────────────────────────────────────
    // Sites sheet: A=Assigned To, B=Template, C=Company, D=Site Name, E=Address
    const ADDRESS_IDX = 4; // 0-based column E

    for (let i = 1; i < allData.length; i++) {
        const existing = allData[i][GPS_IDX] ? allData[i][GPS_IDX].toString().trim() : '';
        if (existing !== '') {
            // Already resolved or previously failed — skip
            summary.skipped++;
            continue;
        }

        const address = allData[i][ADDRESS_IDX] ? allData[i][ADDRESS_IDX].toString().trim() : '';
        if (!address) {
            // No address to geocode
            summary.skipped++;
            continue;
        }

        summary.attempted++;

        try {
            const url  = 'https://nominatim.openstreetmap.org/search?q=' +
                         encodeURIComponent(address) +
                         '&format=json&limit=1';
            const resp = UrlFetchApp.fetch(url, {
                method:            'get',
                muteHttpExceptions: true,
                headers:           { 'User-Agent': 'OTG-AppSuite/1.0 (lone-worker-safety)' }
            });

            if (resp.getResponseCode() === 200) {
                const data = JSON.parse(resp.getContentText());
                if (data && data.length > 0) {
                    const coords = parseFloat(data[0].lat).toFixed(6) + ',' +
                                   parseFloat(data[0].lon).toFixed(6);
                    siteSheet.getRange(i + 1, GPS_COL).setValue(coords);
                    summary.resolved++;
                    Logger.log('[geocodeSiteLocations] Resolved "' + address + '" → ' + coords);
                } else {
                    siteSheet.getRange(i + 1, GPS_COL).setValue('FAILED');
                    summary.failed++;
                    Logger.log('[geocodeSiteLocations] No result for "' + address + '" — wrote FAILED');
                }
            } else {
                siteSheet.getRange(i + 1, GPS_COL).setValue('FAILED');
                summary.failed++;
                Logger.log('[geocodeSiteLocations] HTTP ' + resp.getResponseCode() +
                           ' for "' + address + '" — wrote FAILED');
            }
        } catch (e) {
            siteSheet.getRange(i + 1, GPS_COL).setValue('FAILED');
            summary.failed++;
            Logger.log('[geocodeSiteLocations] Exception for "' + address + '": ' + e.toString());
        }

        // Respect Nominatim's 1 request/second rate limit
        if (i < allData.length - 1) Utilities.sleep(1100);
    }

    Logger.log('[geocodeSiteLocations] Done — attempted: ' + summary.attempted +
               ', resolved: ' + summary.resolved +
               ', failed: ' + summary.failed +
               ', skipped (already set): ' + summary.skipped);
    return summary;
}

function runDiagnostics() {
    const results = [];
    const tz  = CONFIG.TIMEZONE || 'UTC';
    const now = new Date();

    // ── 0. GEOCODE SITE LOCATIONS (run first so the Sites check below is current) ──
    Logger.log('── GEOCODING SITE LOCATIONS ──');
    const _geocodeSummary = geocodeSiteLocations();

    // ── Helper — record a result and log it immediately ───────────────────
    const check = (category, name, status, detail) => {
        results.push({ category, name, status, detail });
        const icon = { PASS: '✅', WARN: '⚠️', FAIL: '❌', SKIP: '⏭️' }[status] || '?';
        Logger.log(`${icon} [${category}] ${name}: ${detail}`);
    };

    // ── 1. CONFIG INJECTION ───────────────────────────────────────────────
    Logger.log('── CONFIG INJECTION ──');
    const uninjected = Object.keys(CONFIG).filter(k => String(CONFIG[k]).includes('%%'));
    if (uninjected.length === 0) {
        check('Config', 'Variable injection', 'PASS', 'All CONFIG variables are correctly injected.');
    } else {
        check('Config', 'Variable injection', 'FAIL',
            'Un-injected placeholders found: ' + uninjected.join(', ') +
            '. Re-deploy from the Factory or set these values manually.');
    }

    // __41_: which template file is this? CONFIG.VERSION is injected by the Factory and can differ.
    check('Config', 'Template build', 'PASS', TEMPLATE_BUILD + ' (Factory version ' + CONFIG.VERSION + ').');

    // ── 2. REQUIRED SHEETS ────────────────────────────────────────────────
    Logger.log('── SHEETS ──');
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    ['Staff', 'Visits', 'Sites', 'Templates'].forEach(name => {
        try {
            const s = ss.getSheetByName(name);
            if (s) {
                check('Sheets', '"' + name + '" exists', 'PASS',
                    'Found. Rows: ' + Math.max(0, s.getLastRow() - 1) + ' (excluding header).');
            } else {
                check('Sheets', '"' + name + '" exists', 'FAIL',
                    'Sheet not found. ' + (name === 'Visits'
                        ? 'Will be created automatically on first worker post.'
                        : 'Must be created manually before workers can use the system.'));
            }
        } catch(e) { check('Sheets', '"' + name + '" exists', 'FAIL', e.toString()); }
    });

    // Staff: at least one active worker
    try {
        const staffSheet = ss.getSheetByName('Staff');
        if (staffSheet && staffSheet.getLastRow() > 1) {
            const staffData = staffSheet.getDataRange().getValues();
            const active = staffData.slice(1).filter(r =>
                (r[0] || '').toString().trim() &&
                (r[2] || '').toString().trim().toLowerCase() !== 'inactive'
            );
            check('Sheets', 'Staff — Active workers', active.length > 0 ? 'PASS' : 'WARN',
                active.length > 0
                    ? active.length + ' active worker(s) found.'
                    : 'No active workers found. Workers with Status = "Inactive" cannot sync.');
        }
    } catch(e) { check('Sheets', 'Staff — Active workers', 'FAIL', e.toString()); }

    // ── Sites GPS — check for FAILED geocode entries ───────────────────────
    try {
        const siteSheet = ss.getSheetByName('Sites');
        if (siteSheet && siteSheet.getLastRow() > 1) {
            const sData     = siteSheet.getRange(2, 1, siteSheet.getLastRow() - 1, 13).getValues();
            const failedSites = sData
                .filter(r => (r[12] || '').toString().trim() === 'FAILED' && (r[3] || '').toString().trim())
                .map(r => r[3].toString().trim());  // column D = Site Name
            const missSites = sData
                .filter(r => (r[12] || '').toString().trim() === '' && (r[3] || '').toString().trim() && (r[4] || '').toString().trim())
                .map(r => r[3].toString().trim());

            if (failedSites.length > 0) {
                check('Sites', 'GPS geocoding', 'WARN',
                    failedSites.length + ' site(s) could not be geocoded — address may be incorrect or too vague. ' +
                    'Check address details in the Sites sheet for: ' + failedSites.join(', ') + '. ' +
                    'Clear the "FAILED" value in column M to retry on the next geocode run.');
            } else if (missSites.length > 0) {
                check('Sites', 'GPS geocoding', 'WARN',
                    missSites.length + ' site(s) have no GPS coordinates yet. ' +
                    'Run OTG Admin → Geocode Site Locations to resolve them now, ' +
                    'or they will be resolved on the next weekly trigger run.');
            } else if (_geocodeSummary.resolved > 0) {
                check('Sites', 'GPS geocoding', 'PASS',
                    'All sites geocoded. ' + _geocodeSummary.resolved + ' new coordinate(s) resolved this run.');
            } else {
                check('Sites', 'GPS geocoding', 'PASS',
                    'All sites with addresses have stored GPS coordinates.');
            }
        }
    } catch(e) { check('Sites', 'GPS geocoding', 'FAIL', e.toString()); }

    // ── 3. PHOTOS FOLDER ──────────────────────────────────────────────────
    Logger.log('── PHOTOS FOLDER ──');
    const folderId = CONFIG.PHOTOS_FOLDER_ID;
    if (!folderId || folderId.includes('%%') || folderId.length < 10) {
        check('Storage', 'Photos folder', 'WARN',
            'PHOTOS_FOLDER_ID not configured. Visit report photos will not be saved to Drive.');
    } else {
        try {
            const folder = DriveApp.getFolderById(folderId);
            const testFile = folder.createFile(
                '_otg_diag_test.txt',
                'OTG diagnostic write test — safe to delete.',
                MimeType.PLAIN_TEXT
            );
            testFile.setTrashed(true);
            check('Storage', 'Photos folder', 'PASS',
                'Accessible and writable. Folder name: "' + folder.getName() + '".');
        } catch(e) {
            check('Storage', 'Photos folder', 'FAIL',
                'Folder inaccessible or not writable: ' + e.toString());
        }
    }

    // ── 4. MAILAPP QUOTA ──────────────────────────────────────────────────
    Logger.log('── EMAIL ──');
    try {
        const quota = MailApp.getRemainingDailyQuota();
        const status = quota > 50 ? 'PASS' : quota > 10 ? 'WARN' : 'FAIL';
        check('Email', 'Daily send quota', status,
            quota + ' emails remaining today. ' +
            '(Free Google accounts: 100/day; Workspace accounts: 1,500/day.) ' +
            (quota <= 10 ? 'Critically low — alarm emails may not send.' : ''));
    } catch(e) { check('Email', 'Daily send quota', 'FAIL', e.toString()); }

    // ── 5. SMS PROVIDER ───────────────────────────────────────────────────
    Logger.log('── SMS PROVIDER ──');
    const smsProvider = (CONFIG.SMS_PROVIDER || '').toLowerCase().trim();
    if (!smsProvider || smsProvider === 'none' || smsProvider.includes('%%')) {
        check('SMS', 'Provider', 'SKIP', 'SMS_PROVIDER not configured. SMS notifications are disabled.');
    } else if (smsProvider === 'twilio') {
        const sid = CONFIG.TWILIO_ACCOUNT_SID;
        if (!sid || sid.includes('%%')) {
            check('SMS', 'Twilio', 'FAIL', 'TWILIO_ACCOUNT_SID not configured.');
        } else {
            try {
                const resp = UrlFetchApp.fetch(
                    'https://api.twilio.com/2010-04-01/Accounts/' + sid + '.json',
                    { method: 'get',
                      headers: { Authorization: 'Basic ' + Utilities.base64Encode(sid + ':' + CONFIG.TWILIO_AUTH_TOKEN) },
                      muteHttpExceptions: true }
                );
                const code = resp.getResponseCode();
                const parsed = JSON.parse(resp.getContentText());
                if (code === 200) {
                    check('SMS', 'Twilio', 'PASS',
                        'Account verified. Status: ' + parsed.status + '. From number: ' + CONFIG.TWILIO_FROM);
                } else {
                    check('SMS', 'Twilio', 'FAIL',
                        'HTTP ' + code + ': ' + (parsed.message || resp.getContentText().substring(0, 200)));
                }
            } catch(e) { check('SMS', 'Twilio', 'FAIL', 'Request failed: ' + e.toString()); }
        }
    } else if (smsProvider === 'burst') {
        const key = CONFIG.BURST_API_KEY;
        if (!key || key.includes('%%')) {
            check('SMS', 'Kudosity', 'FAIL', 'BURST_API_KEY not configured.');
        } else {
            try {
                const resp = UrlFetchApp.fetch('https://api.transmitsms.com/get-balance.json', {
                    method: 'get',
                    headers: { Authorization: 'Basic ' + Utilities.base64Encode(key + ':' + CONFIG.BURST_API_SECRET) },
                    muteHttpExceptions: true
                });
                const code = resp.getResponseCode();
                const parsed = JSON.parse(resp.getContentText());
                if (code === 200 && parsed.balance !== undefined) {
                    const bal = parsed.balance;
                    const status = bal > 1 ? 'PASS' : bal > 0 ? 'WARN' : 'FAIL';
                    check('SMS', 'Kudosity', status,
                        'Account verified. Balance: $' + bal +
                        (bal === 0 ? ' Top-up required — SMS will fail until credits are purchased.' : '') +
                        (bal > 0 && bal <= 1 ? ' Running low — consider topping up.' : '') +
                        '. From: ' + CONFIG.BURST_FROM);
                } else {
                    check('SMS', 'Kudosity', 'FAIL',
                        'HTTP ' + code + ': ' + resp.getContentText().substring(0, 200));
                }
            } catch(e) { check('SMS', 'Burst SMS', 'FAIL', 'Request failed: ' + e.toString()); }
        }
    } else if (smsProvider === 'textbelt') {
        const textbeltKey = CONFIG.TEXTBELT_API_KEY;
        if (!textbeltKey || textbeltKey.includes('%%') || textbeltKey.length < 5) {
            check('SMS', 'Textbelt', 'FAIL', 'TEXTBELT_API_KEY not configured.');
        } else {
            try {
                const resp = UrlFetchApp.fetch(
                    'https://textbelt.com/quota/' + encodeURIComponent(textbeltKey),
                    { method: 'get', muteHttpExceptions: true }
                );
                const code = resp.getResponseCode();
                const body = JSON.parse(resp.getContentText());
                if (code === 200 && body.success) {
                    const remaining = body.quotaRemaining;
                    const status = remaining > 10 ? 'PASS' : remaining > 0 ? 'WARN' : 'FAIL';
                    check('SMS', 'Textbelt quota', status,
                        'Key valid. Credits remaining: ' + remaining + '.' +
                        (remaining === 0 ? ' Top-up required — SMS will fail until credits are purchased.' : '') +
                        (remaining <= 10 && remaining > 0 ? ' Running low — consider topping up.' : ''));
                } else {
                    check('SMS', 'Textbelt quota', 'FAIL',
                        'Unexpected response (HTTP ' + code + '): ' +
                        resp.getContentText().substring(0, 200));
                }
            } catch(e) { check('SMS', 'Textbelt quota', 'FAIL', 'Request failed: ' + e.toString()); }
        }
    } else {
        check('SMS', 'Provider', 'FAIL', 'Unknown SMS_PROVIDER value: "' + smsProvider + '". Expected: twilio, burst, or textbelt.');
    }

    // ── 6. NTFY PUSH ──────────────────────────────────────────────────────
    Logger.log('── NTFY PUSH ──');
    const orgSlug = (CONFIG.ORG_NAME || 'otg')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 24);
    const diagTopic = orgSlug + '-otg-diag';
    const _ntfyProxyConfigured = (CONFIG.NTFY_PROXY_URL && !CONFIG.NTFY_PROXY_URL.includes('%%'));
    const ntfyServer = _ntfyProxyConfigured
        ? CONFIG.NTFY_PROXY_URL.replace(/\/$/, '')
        : (CONFIG.NTFY_SERVER && !CONFIG.NTFY_SERVER.includes('%%'))
            ? CONFIG.NTFY_SERVER.replace(/\/$/, '')
            : 'https://ntfy.sh';
    const ntfyRouteLabel = _ntfyProxyConfigured
        ? 'via proxy (' + ntfyServer + ')'
        : 'on ' + ntfyServer;
    // Route through _sendNtfy() so the proxy is used when configured — the same
    // path that real alerts take. Previous versions called UrlFetchApp.fetch() directly,
    // bypassing the proxy and giving a misleading result.
    const ntfyResult = _sendNtfy(
        diagTopic,
        '🔧 OTG Diagnostics Test',
        'OTG system diagnostic ran at ' +
            Utilities.formatDate(now, tz, 'dd MMM yyyy HH:mm z') +
            '. If you received this, ntfy push notifications are working correctly.' +
            ' Topic: ' + diagTopic,
        'default',
        'test_tube'
    );
    if (ntfyResult && ntfyResult.ok) {
        check('ntfy Push', 'Diagnostic send', 'PASS',
            'Message posted to topic "' + diagTopic + '" (HTTP ' + ntfyResult.code + ')' +
            (ntfyResult.via === 'proxy' ? ' via proxy' : ' direct') +
            '. Subscribe to this topic in the ntfy app to confirm end-to-end delivery.');
    } else if (ntfyResult && ntfyResult.code) {
        check('ntfy Push', 'Diagnostic send', 'FAIL',
            'Server returned HTTP ' + ntfyResult.code +
            (ntfyResult.via === 'proxy' ? ' (via proxy)' : ' (direct)') + '.');
    } else {
        check('ntfy Push', 'Diagnostic send', 'FAIL',
            'Request failed' + (ntfyResult && ntfyResult.via === 'proxy' ? ' (via proxy)' : '') +
            ': ' + (ntfyResult && ntfyResult.error ? ntfyResult.error : 'unknown error'));
    }

    // ── 7. HEALTHCHECKS.IO ────────────────────────────────────────────────
    Logger.log('── HEALTHCHECKS.IO ──');
    const hcUrl = CONFIG.HEALTHCHECK_URL;
    if (!hcUrl || hcUrl.includes('%%') || hcUrl.length < 10) {
        check('Dead-Man Switch', 'Healthchecks.io', 'SKIP',
            'HEALTHCHECK_URL not configured. Dead-man switch monitoring is disabled. ' +
            'Register a check at healthchecks.io and paste the ping URL into the Factory.');
    } else {
        try {
            const resp = UrlFetchApp.fetch(hcUrl, { method: 'get', muteHttpExceptions: true });
            const code = resp.getResponseCode();
            if (code === 200) {
                check('Dead-Man Switch', 'Healthchecks.io ping', 'PASS',
                    'Ping accepted (HTTP 200). This proves only that the URL is valid. The real test is that the Healthchecks dashboard shows a ping every minute.');
            } else {
                check('Dead-Man Switch', 'Healthchecks.io ping', 'WARN',
                    'Unexpected HTTP ' + code + '. Verify the ping URL is correct in CONFIG.');
            }
        } catch(e) {
            check('Dead-Man Switch', 'Healthchecks.io ping', 'FAIL', 'Request failed: ' + e.toString());
        }
    }

    // ── 8. GEMINI API ─────────────────────────────────────────────────────
    Logger.log('── GEMINI API ──');
    const geminiKey = CONFIG.GEMINI_API_KEY;
    if (!geminiKey || geminiKey.includes('%%') || geminiKey.length < 10) {
        check('AI Scribe', 'Gemini API key', 'SKIP',
            'GEMINI_API_KEY not configured. Smart Scribe (AI visit note polishing) is disabled.');
    } else {
        try {
            const model = getGeminiModel_(geminiKey);
            if (!model) {
                check('AI Scribe', 'Gemini API key', 'FAIL',
                    'Could not resolve an available Gemini model. Key may be invalid, or the Generative Language API is not enabled for this project.');
            } else {
                const resp = UrlFetchApp.fetch(
                    'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + geminiKey,
                    {
                        method: 'post',
                        contentType: 'application/json',
                        payload: JSON.stringify({ contents: [{ parts: [{ text: 'Reply with the single word: OK' }] }] }),
                        muteHttpExceptions: true
                    }
                );
                const code = resp.getResponseCode();
                if (code === 200) {
                    check('AI Scribe', 'Gemini API key', 'PASS', 'Key valid — using model: ' + model + '.');
                } else if (code === 403) {
                    check('AI Scribe', 'Gemini API key', 'FAIL',
                        'HTTP 403 — key invalid, or Generative Language API not enabled for this Google Cloud project.');
                } else if (code === 429) {
                    check('AI Scribe', 'Gemini API key', 'WARN',
                        'HTTP 429 — rate limit hit during diagnostic. Key is likely valid but quota is exhausted. Model resolved: ' + model + '.');
                } else {
                    check('AI Scribe', 'Gemini API key', 'WARN',
                        'HTTP ' + code + ': ' + resp.getContentText().substring(0, 200));
                }
            }
        } catch(e) { check('AI Scribe', 'Gemini API key', 'FAIL', 'Request failed: ' + e.toString()); }
    }

    // ── 9. ORS ROUTING API ────────────────────────────────────────────────
    Logger.log('── ORS ROUTING API ──');
    const orsKey = CONFIG.ORS_API_KEY;
    if (!orsKey || orsKey.includes('%%') || orsKey.length < 10) {
        check('Routing', 'ORS API key', 'SKIP',
            'ORS_API_KEY not configured. Road-distance calculations are disabled.');
    } else {
        try {
            // Minimal geocode call — no directions quota consumed
            const resp = UrlFetchApp.fetch(
                'https://api.openrouteservice.org/geocode/search?api_key=' + orsKey +
                '&text=Wellington+New+Zealand&size=1',
                { method: 'get', muteHttpExceptions: true }
            );
            const code = resp.getResponseCode();
            if (code === 200) {
                const v = getOrsVersion_(orsKey);
                const vNote = v ? ' Directions API: ' + v + '.' : ' Note: could not resolve directions API version.';
                check('Routing', 'ORS API key', 'PASS', 'Key valid — API is responding.' + vNote);
            } else if (code === 403) {
                check('Routing', 'ORS API key', 'FAIL',
                    'HTTP 403 — key invalid or daily quota exhausted.');
            } else if (code === 429) {
                check('Routing', 'ORS API key', 'WARN',
                    'HTTP 429 — rate limited during diagnostic. Key is likely valid.');
            } else {
                check('Routing', 'ORS API key', 'WARN',
                    'HTTP ' + code + ': ' + resp.getContentText().substring(0, 200));
            }
        } catch(e) { check('Routing', 'ORS API key', 'FAIL', 'Request failed: ' + e.toString()); }
    }

    // ── 10. TRIGGERS ──────────────────────────────────────────────────────
    Logger.log('── TRIGGERS ──');
    const RECOMMENDED = [
        {
            fn:       'checkOverdueVisits',
            label:    'Escalation engine',
            required: true,
            note:     'REQUIRED — must run every 10 minutes or less. ' +
                      'Workers will NOT be escalated if this trigger is missing.'
        },
        {
            fn:       'sendHealthEmail',
            label:    'Daily health email',
            required: false,
            note:     'Recommended — run once daily for admin visibility of system health.'
        },
        {
            fn:       'archiveOldData',
            label:    'Visit archiver',
            required: false,
            note:     'Recommended — run monthly to keep the Visits sheet performant.'
        },
        {
            fn:       'geocodeSiteLocations',
            label:    'Site GPS geocoder',
            required: false,
            note:     'Recommended — run weekly to resolve site addresses to GPS coordinates for the monitor map. ' +
                      'Can also be triggered manually from OTG Admin → Geocode Site Locations.'
        }
    ];

    try {
        const triggers    = ScriptApp.getProjectTriggers();
        const installedFns = triggers.map(t => t.getHandlerFunction());

        if (triggers.length === 0) {
            check('Triggers', 'Installed triggers', 'FAIL',
                'No triggers found. The escalation engine will not run automatically — ' +
                'workers will NOT be monitored for overdue visits.');
        } else {
            triggers.forEach(t => {
                const isTimeBased = t.getTriggerSource() === ScriptApp.TriggerSource.CLOCK;
                const _hn = t.getHandlerFunction();
                // __41_: installed is not enough - the function it calls must exist (orphan trigger, e.g. generateStats).
                if (_fnExists_(_hn) === false) {
                    check('Triggers', '"' + _hn + '"', 'FAIL',
                        'Trigger is installed but the function "' + _hn + '" does not exist in this script, so it fails every time it fires. Delete this trigger (Triggers, three dots, Delete).');
                } else {
                    check('Triggers', '"' + _hn + '"', 'PASS',
                        (isTimeBased ? 'Time-based trigger installed.' : 'Trigger installed (source: ' + t.getTriggerSource() + ').'));
                }
            });
        }

        // Flag any recommended triggers that are missing
        RECOMMENDED.forEach(rec => {
            if (!installedFns.includes(rec.fn)) {
                check('Triggers', '"' + rec.fn + '" — ' + rec.label,
                    rec.required ? 'FAIL' : 'WARN',
                    'Not installed. ' + rec.note);
            }
        });

    } catch(e) {
        const msg = e.toString();
        if (msg.includes('Script') && (msg.includes('permission') || msg.includes('scope') || msg.includes('not have'))) {
            check('Triggers', 'Trigger inspection', 'WARN',
                'Permission denied reading project triggers. Run the script once from the Apps Script editor under your own account to grant the required OAuth scope, then re-run diagnostics.');
        } else {
            check('Triggers', 'Trigger inspection', 'FAIL',
                'Could not read project triggers: ' + msg);
        }
    }

    // ── 11. JOB HEARTBEATS (__41_) ────────────────────────────────────────
    Logger.log('── JOB HEARTBEATS ──');
    try {
        const _eng2 = _engineAge_(now);
        check('Triggers', 'Escalation engine last ran',
            _eng2.level === 'OK' ? 'PASS' : _eng2.level === 'WARN' ? 'WARN' : 'FAIL',
            _eng2.level === 'NEVER'
                ? 'No run has ever been recorded. The 1-minute checkOverdueVisits trigger is missing or has never completed.'
                : 'Last run ' + _jobAgeText_(_eng2.ageMin / 60) + ' ago' +
                  (_eng2.level === 'STALE' ? '. More than 10 minutes: escalation may have stopped. Check Triggers and Executions now.' : '.'));
        _jobStatuses_(now).forEach(j => {
            const st = j.status === 'OK' ? 'PASS' : j.status === 'WAITING' ? 'SKIP' : j.status === 'NEVER' ? 'WARN' : 'FAIL';
            check('Jobs', j.label + ' (' + j.every + ')', st, _jobDescribe_(j, tz));
        });
    } catch (e) { check('Jobs', 'Job heartbeats', 'WARN', 'Could not read job heartbeats: ' + e.toString()); }

    // ── SUMMARY ───────────────────────────────────────────────────────────
    const passCount = results.filter(r => r.status === 'PASS').length;
    const warnCount = results.filter(r => r.status === 'WARN').length;
    const failCount = results.filter(r => r.status === 'FAIL').length;
    const skipCount = results.filter(r => r.status === 'SKIP').length;

    Logger.log('── SUMMARY ──');
    Logger.log('✅ PASS: ' + passCount + '  ⚠️ WARN: ' + warnCount +
               '  ❌ FAIL: ' + failCount + '  ⏭️ SKIP (not configured): ' + skipCount);

    // ── BUILD EMAIL ───────────────────────────────────────────────────────
    const statusIcon  = s => ({ PASS: '✅', WARN: '⚠️', FAIL: '❌', SKIP: '⏭️' }[s] || '?');
    const statusColor = s => ({ PASS: '#27ae60', WARN: '#e67e22', FAIL: '#c0392b', SKIP: '#888' }[s]);
    const rowBg       = s => ({ PASS: '#f9fffa', WARN: '#fef9ec', FAIL: '#fdf3f3', SKIP: '#f8f8f8' }[s]);

    const tableRows = results.map(r =>
        '<tr style="background:' + rowBg(r.status) + ';border-top:1px solid #eee">' +
        '<td style="padding:8px 12px;font-size:12px;color:#666;white-space:nowrap">' + r.category + '</td>' +
        '<td style="padding:8px 12px;font-size:12px;font-weight:bold;white-space:nowrap">' + r.name + '</td>' +
        '<td style="padding:8px 12px;font-size:12px;font-weight:bold;color:' + statusColor(r.status) + ';white-space:nowrap">' + statusIcon(r.status) + ' ' + r.status + '</td>' +
        '<td style="padding:8px 12px;font-size:12px;color:#333">' + r.detail + '</td>' +
        '</tr>'
    ).join('');

    const overallStatus = failCount > 0 ? 'ISSUES FOUND' : warnCount > 0 ? 'WARNINGS' : 'ALL CLEAR';
    const overallIcon   = failCount > 0 ? '❌' : warnCount > 0 ? '⚠️' : '✅';
    const headerColour  = failCount > 0 ? '#c0392b' : warnCount > 0 ? '#c07d00' : '#1e3a5f';

    const html =
'<div style="font-family:Arial,sans-serif;max-width:760px;margin:0 auto;color:#1a1a1a">' +
'<div style="background:' + headerColour + ';padding:20px 24px;border-radius:6px 6px 0 0">' +
'<h2 style="margin:0;color:#fff;font-size:18px">🔧 OTG System Diagnostics — ' + CONFIG.ORG_NAME + '</h2>' +
'<p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px">' +
'Run ' + Utilities.formatDate(now, tz, 'dd MMM yyyy HH:mm z') +
' &nbsp;·&nbsp; ' + overallIcon + ' ' + overallStatus + '</p>' +
'</div>' +
'<div style="background:#f4f6f9;padding:20px 24px">' +
'<div style="background:#fff;border-radius:4px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)">' +
'<table style="border-collapse:collapse;width:100%">' +
'<tr style="background:#e8edf3">' +
'<th style="text-align:left;padding:10px 12px;font-size:12px;color:#555">Category</th>' +
'<th style="text-align:left;padding:10px 12px;font-size:12px;color:#555">Check</th>' +
'<th style="text-align:left;padding:10px 12px;font-size:12px;color:#555">Status</th>' +
'<th style="text-align:left;padding:10px 12px;font-size:12px;color:#555">Detail</th>' +
'</tr>' +
tableRows +
'<tr style="background:#e8edf3">' +
'<td colspan="4" style="padding:10px 12px;font-size:12px;color:#555">' +
'<strong>Summary:</strong> ' + passCount + ' passed &nbsp;·&nbsp; ' +
warnCount + ' warnings &nbsp;·&nbsp; ' +
failCount + ' failed &nbsp;·&nbsp; ' +
skipCount + ' skipped (not configured)' +
'</td></tr>' +
'</table></div>' +
'<p style="margin:14px 0 0;font-size:12px;color:#666">' +
'ℹ️ An ntfy test notification was posted to topic <strong>' + diagTopic + '</strong> ' + ntfyRouteLabel + '. ' +
'Subscribe to this topic in the ntfy app to verify push delivery end-to-end. ' +
'You only need to subscribe once.' +
'</p>' +
'</div>' +
'<div style="background:#e8edf3;padding:10px 24px;border-radius:0 0 6px 6px;font-size:11px;color:#888">' +
'OTG AppSuite ' + CONFIG.VERSION + ' — run <em>runDiagnostics()</em> from the OTG Admin menu or Apps Script editor at any time.' +
'</div></div>';

    const recipient = (CONFIG.HEALTH_EMAIL && CONFIG.HEALTH_EMAIL.includes('@'))
        ? CONFIG.HEALTH_EMAIL
        : Session.getEffectiveUser().getEmail();

    try {
        MailApp.sendEmail({
            to:       recipient,
            subject:  overallIcon + ' OTG Diagnostics — ' + overallStatus + ' — ' + CONFIG.ORG_NAME,
            htmlBody: html
        });
        Logger.log('Diagnostic email sent to: ' + recipient);
    } catch(e) {
        Logger.log('Could not send diagnostic email: ' + e.toString());
    }
}


function getDashboardData() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Visits');
    const staffSheet = ss.getSheetByName('Staff');
    if(!sheet) return {workers: []};
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return {workers: []}; 
    const startRow = Math.max(2, lastRow - 500); 
    const data = sheet.getRange(startRow, 1, lastRow - startRow + 1, 25).getValues();
    const headers = ["Timestamp", "Date", "Worker Name", "Worker Phone Number", "Emergency Contact Name", "Emergency Contact Number", "Emergency Contact Email", "Escalation Contact Name", "Escalation Contact Number", "Escalation Contact Email", "Alarm Status", "Notes", "Location Name", "Location Address", "Last Known GPS", "GPS Timestamp", "Battery Level", "Photo 1", "Distance (km)", "Visit Report Data", "Anticipated Departure Time", "Signature", "Photo 2", "Photo 3", "Photo 4"];
    // Phone number columns (indices 3, 5, 8) must be coerced to strings.
    // Google Sheets getValues() returns numeric cells as JS numbers, silently
    // dropping any leading zero (e.g. 021234567 → 21234567). Stringifying here
    // ensures the JSON payload preserves the raw digit sequence so the monitor
    // can recover the correct local format.
    const PHONE_INDICES = new Set([3, 5, 8]);
    const workers = data.map(r => {
        let obj = {};
        headers.forEach((h, i) => {
            obj[h] = PHONE_INDICES.has(i) ? String(r[i] || '') : r[i];
        });
        return obj;
    });
    if(staffSheet) {
        const sData = staffSheet.getDataRange().getValues();
        workers.forEach(w => { for(let i=1; i<sData.length; i++) { if(sData[i][0] === w['Worker Name']) { w['WOFExpiry'] = sData[i][6]; } } });
    }

    // ── Attach resolved site GPS from Sites sheet column M ─────────────────
    // Provides the monitor map with stored coordinates for named-site visits
    // where the worker GPS is 0,0 (workers at fixed sites don't send live GPS).
    try {
        const siteSheet = ss.getSheetByName('Sites');
        if (siteSheet && siteSheet.getLastRow() > 1) {
            const sData      = siteSheet.getRange(2, 1, siteSheet.getLastRow() - 1, 13).getValues();
            const siteGpsMap = {};
            sData.forEach(r => {
                const name = (r[3] || '').toString().trim();   // column D — Site Name
                const gps  = (r[12] || '').toString().trim();  // column M — Site GPS
                if (name && gps && gps !== 'FAILED') siteGpsMap[name] = gps;
            });
            workers.forEach(w => {
                const siteName = (w['Location Name'] || '').toString().trim();
                if (siteName && siteGpsMap[siteName]) w['Site GPS'] = siteGpsMap[siteName];
            });
        }
    } catch(e) {
        Logger.log('[getDashboardData] Could not attach site GPS: ' + e.toString());
    }

    return {workers: workers, escalation_limit: CONFIG.ESCALATION_MINUTES};
}

function getGlobalForms() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const tSheet = ss.getSheetByName('Templates');
    if(!tSheet) return [];
    const tData = tSheet.getDataRange().getValues();
    const forms = [];
    for(let i=1; i<tData.length; i++) {
        const row = tData[i];
        if(row[2] === "ALL") {
            const questions = [];
            for(let q=4; q<34; q++) { if(row[q]) questions.push(row[q]); }
            forms.push({name: row[1], questions: questions});
        }
    }
    return forms;
}

function saveImage(b64, workerName, isSignature) {
    if(!b64 || !CONFIG.PHOTOS_FOLDER_ID) return "";
    try {
        const blob = dataURItoBlob(b64);
        if (!blob) return "";

        const mainFolder = DriveApp.getFolderById(CONFIG.PHOTOS_FOLDER_ID);
        let targetFolder = mainFolder;
        if (workerName && workerName.length > 2) {
            const folders = mainFolder.getFoldersByName(workerName);
            if (folders.hasNext()) { targetFolder = folders.next(); } 
            else { targetFolder = mainFolder.createFolder(workerName); }
        }
        const now = new Date();
        const timeStr = Utilities.formatDate(now, CONFIG.TIMEZONE, "yyyy-MM-dd_HH-mm");
        const safeName = (workerName || "Unknown").replace(/[^a-zA-Z0-9]/g, ''); 
        const type = isSignature ? "Signature" : "Photo";
        const fileName = `${timeStr}_${safeName}_${type}_${Math.floor(Math.random()*100)}.jpg`;
        blob.setName(fileName); 
        
        const file = targetFolder.createFile(blob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        return file.getUrl();
    } catch(e) { return "Error saving photo: " + e.toString(); }
}

/**
 * Resolves the best available Gemini model that supports generateContent.
 * Calls the ListModels endpoint so the system automatically adapts when
 * Google retires or adds models — no hardcoded model names to maintain.
 * Returns a model ID string (e.g. "gemini-2.0-flash") or null on failure.
 */
function getGeminiModel_(apiKey) {
    try {
        const resp = UrlFetchApp.fetch(
            'https://generativelanguage.googleapis.com/v1beta/models?key=' + apiKey,
            { method: 'get', muteHttpExceptions: true }
        );
        if (resp.getResponseCode() !== 200) return null;
        const models = JSON.parse(resp.getContentText()).models || [];

        // Collect models that support generateContent
        const capable = models
            .filter(m => m.supportedGenerationMethods &&
                         m.supportedGenerationMethods.includes('generateContent'))
            .map(m => m.name.replace('models/', '')); // e.g. "gemini-2.0-flash"

        // Preference order — first match wins
        const preferred = [
            'gemini-2.0-flash',
            'gemini-2.0-flash-lite',
            'gemini-1.5-flash',
            'gemini-1.5-flash-8b',
            'gemini-1.5-pro',
        ];
        for (const p of preferred) {
            if (capable.includes(p)) return p;
        }
        // Fall back to any flash model, then any pro model
        const flash = capable.find(m => m.includes('flash'));
        if (flash) return flash;
        const pro = capable.find(m => m.includes('pro'));
        if (pro) return pro;
        return capable[0] || null; // Last resort: whatever is available
    } catch(e) {
        return null;
    }
}

function smartScribe(data, type, notes) {
    if(!CONFIG.GEMINI_API_KEY) return notes;
    let safeNotes = notes || "";
    let safeData = JSON.stringify(data || {});
    
    if(CONFIG.ENABLE_REDACTION) {
        const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
        safeNotes = safeNotes.replace(emailRegex, "[EMAIL_REDACTED]");
        const phoneRegex = /\b(\+?6[14][\s-]?|0)[289][0-9][\s-]?[0-9]{3}[\s-]?[0-9]{3,4}\b/g;
        safeNotes = safeNotes.replace(phoneRegex, "[PHONE_REDACTED]");
    }

    // THE MASTER EDITOR PROMPT (Universal for all Work Documents)
    const prompt = `You are the Lead Administrator for ${CONFIG.ORG_NAME}. 
    Task: Convert the provided raw field data and informal notes into a formal, structured professional report.
    Format: Professional work documentation.
    Language: Use formal ${CONFIG.LOCALE} English (e.g., if en-NZ, use 'authorised' instead of 'authorized').
    Context: This is a "${type}" report.
    Style: Clear, objective, and professional. 
    Constraint: Correct all grammar/spelling. Do NOT invent new facts. Maintain technical specificities.
    
    RAW DATA: ${safeData}
    FIELD NOTES: "${safeNotes}"
    
    Output only the polished, professional report text.`;
    
    try {
        const model = getGeminiModel_(CONFIG.GEMINI_API_KEY);
        if (!model) return notes;
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${CONFIG.GEMINI_API_KEY}`;
        const payload = { contents: [{ parts: [{ text: prompt }] }] };
        const options = { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true };
        const response = UrlFetchApp.fetch(url, options);
        const json = JSON.parse(response.getContentText());
        
        if (json.candidates && json.candidates.length > 0) {
            const aiText = json.candidates[0].content.parts[0].text.trim();
            if (aiText.length < 5 || aiText.includes("I cannot")) return notes;
            return aiText;
        } else { return notes; }
    } catch (e) { return notes; }
}

function sendJSON(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Monthly archive: moves closed Visits rows older than CONFIG.ARCHIVE_DAYS to the Archive sheet.
 * __39_ (F75-2): runs under the script lock, writes kept rows before trimming, retries once.
 * archiveOldData() is the monthly trigger; archiveOldDataRetry() is the one-off 1-hour retry.
 */
const ARCHIVE_LOCK_WAIT_MS   = 60000;
const ARCHIVE_RETRY_DELAY_MS = 60 * 60 * 1000;

function archiveOldData()      { _archiveAttempt_(false); }
function archiveOldDataRetry() { _archiveAttempt_(true);  }

function _archiveAttempt_(isRetry) {
    if (isRetry) _archiveDeleteRetryTriggers_(); // the one-off retry trigger has done its job
    const lock = LockService.getScriptLock();
    let got = false;
    try { got = lock.tryLock(ARCHIVE_LOCK_WAIT_MS); } catch (e) { got = false; }
    if (!got) {
        _jobMark_('archiveOldData', false, 'script lock not obtained within 60 s' + (isRetry ? ' (retry)' : ' - retry scheduled'));
        _archiveLockFailed_(isRetry);
        return;
    }
    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const sheet = ss.getSheetByName('Visits');
        if (!sheet) { _jobMark_('archiveOldData', false, 'Visits sheet not found'); return; }
        const today = new Date();
        const cutoff = new Date(today.setDate(today.getDate() - CONFIG.ARCHIVE_DAYS));
        const v = _archiveVisits_(ss, sheet, cutoff);   // throws on a failure after rows were written (flagged below)
        // __45_ (F90-3): Forms by age, same job, same lock. A Forms failure never undoes the Visits archive.
        let f = null, fErr = null;
        try { f = _archiveForms_(ss, cutoff); } catch (e2) { fErr = e2; }
        const vNote = v.note || (v.moved + ' row(s) archived, ' + v.kept + ' kept');
        if (fErr) {
            _jobMark_('archiveOldData', false, vNote + '; Forms archive failed: ' + String(fErr).substring(0, 100));
            _archiveFlag_('The Forms archive failed: ' + String(fErr).substring(0, 200) + '. Visits: ' + vNote +
                          '. Check the Forms and FormsArchive sheets before running it again - rows may already be in FormsArchive.');
            return;
        }
        _jobMark_('archiveOldData', !v.fitFailed, vNote + '; ' + f.moved + ' form(s) archived, ' + f.kept + ' kept');
    } catch (err) {
        _jobMark_('archiveOldData', false, 'run failed: ' + String(err).substring(0, 150));
        _archiveFlag_('The archive run failed: ' + String(err).substring(0, 200) + '. Check the Audit and Archive sheets before running it again - rows may already be in Archive.');
        throw err;
    } finally {
        // flush before release, as in doPost and checkOverdueVisits
        try { SpreadsheetApp.flush(); } catch (_) {}
        lock.releaseLock();
    }
}

/**
 * __45_: the Visits half of the archive (was inline in _archiveAttempt_). Closed rows older than cutoff move to Archive.
 * F90-1: Archive is widened and lengthened BEFORE anything is written; if Sheets refuses, nothing moves, Visits is untouched
 * and the run is flagged. F90-2: header row on create; a tab with data in row 1 (A1 a date) gets one header row above it.
 * Returns { moved, kept, note?, fitFailed? }. Throws only after rows may have been written (the caller flags it).
 */
function _archiveVisits_(ss, sheet, cutoff) {
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { moved: 0, kept: 0, note: 'Visits has no data rows - nothing to archive' };
    const keep = [data[0]];
    const move = [];
    for (let i = 1; i < data.length; i++) {
        const st = String(data[i][10]); // __39_: Sheets may hold a non-text value in col K
        if (new Date(data[i][0]) < cutoff && (st.includes('DEPARTED') || st.includes('SAFE') || st.includes('COMPLETED'))) { move.push(data[i]); } else { keep.push(data[i]); }
    }
    const width = data[0].length;
    let archive;
    // Everything that can be refused (create, widen, header, lengthen) happens before the first row is written.
    try {
        archive = ss.getSheetByName('Archive');
        const created = !archive;
        if (created) archive = ss.insertSheet('Archive');
        _sheetFitCols_(archive, width);
        _archiveHeader_(archive, data[0], created);
        if (move.length) _sheetFitRows_(archive, archive.getLastRow() + move.length);
    } catch (e) {
        const msg = 'Archive tab could not be prepared (' + String(e).substring(0, 150) + ') - nothing moved, Visits unchanged';
        _audit_('archiveOldData:FIT-FAILED', '', '', '', '', '', '', msg);
        _archiveFlag_('The archive did not run: ' + msg + '. Unprotect the Archive tab or widen it to ' + width + ' columns, then run archiveOldData again.');
        return { moved: 0, kept: keep.length - 1, fitFailed: true, note: 'nothing moved - Archive tab could not be prepared' };
    }
    if (move.length > 0) {
        archive.getRange(archive.getLastRow() + 1, 1, move.length, width).setValues(move);
        // __39_: kept rows are written over the top of Visits FIRST, then the leftover rows
        // below them are cleared. The sheet is never empty, and a failure between the two
        // calls leaves duplicates (recoverable) instead of a wiped sheet.
        sheet.getRange(1, 1, keep.length, keep[0].length).setValues(keep);
        if (data.length > keep.length) {
            sheet.getRange(keep.length + 1, 1, data.length - keep.length, keep[0].length).clearContent();
        }
        _audit_('archiveOldData', '', '', '', '', '', '', 'Visits sheet rewritten (write then trim): ' + move.length + ' row(s) archived, ' + (keep.length - 1) + ' kept');
    } else {
        // __41_: a run that moves nothing must still leave a trace (it used to look like a run that never happened).
        _audit_('archiveOldData:none', '', '', '', '', '', '', 'run complete: 0 row(s) eligible, ' + (keep.length - 1) + ' kept');
    }
    return { moved: move.length, kept: keep.length - 1 };
}

/**
 * __45_ (F90-2): make sure Archive row 1 is the Visits header. New or empty tab: write it. A1 = 'Timestamp': fill any
 * blank header cells (e.g. 'Visit ID' on a tab that pre-dates col AB). A1 a date (data in row 1, no header ever): insert
 * one row above it, once. Anything else in A1: leave it and audit.
 */
function _archiveHeader_(archive, header, created) {
    const width = header.length;
    if (created || archive.getLastRow() === 0) {
        archive.getRange(1, 1, 1, width).setValues([header]);
        try { archive.setFrozenRows(1); } catch (_) {}
        return;
    }
    const row1 = archive.getRange(1, 1, 1, width).getValues()[0];
    const a1 = row1[0];
    if (String(a1).trim() === 'Timestamp') {
        let changed = false;
        const merged = row1.map(function (v, c) {
            if (String(v === null || v === undefined ? '' : v).trim() === '' && String(header[c] || '').trim() !== '') { changed = true; return header[c]; }
            return v;
        });
        if (changed) {
            archive.getRange(1, 1, 1, width).setValues([merged]);
            _audit_('archiveOldData:header-filled', '', '', '', '', '', '', 'blank Archive header cells filled from Visits row 1');
        }
        return;
    }
    if (_looksLikeDate_(a1)) {
        archive.insertRowsBefore(1, 1);
        archive.getRange(1, 1, 1, width).setValues([header]);
        try { archive.setFrozenRows(1); } catch (_) {}
        _audit_('archiveOldData:header-added', '', '', '', '', '', '', 'Archive row 1 was data (A1 = ' + String(a1).substring(0, 40) +
                ') - Visits header row inserted above it (one-off)');
        return;
    }
    _audit_('archiveOldData:header-unknown', '', '', '', '', '', '', 'Archive A1 is neither the header nor a date ("' +
            String(a1).substring(0, 40) + '") - left as it is; rows appended below');
}

/** __45_ (F90-3): Forms rows older than cutoff move to FormsArchive (header on create). Write then trim. Throws on failure. */
function _archiveForms_(ss, cutoff) {
    const fsh = ss.getSheetByName(FORMS_SHEET_NAME);
    if (!fsh || fsh.getLastRow() <= 1) {
        _audit_('archiveForms:none', '', '', '', '', '', '', 'run complete: no Forms rows');
        return { moved: 0, kept: 0 };
    }
    const data = fsh.getDataRange().getValues();
    const keep = [data[0]];
    const move = [];
    for (let i = 1; i < data.length; i++) {
        const t = new Date(data[i][0]);
        if (!isNaN(t.getTime()) && t < cutoff) move.push(data[i]); else keep.push(data[i]);
    }
    if (!move.length) {
        _audit_('archiveForms:none', '', '', '', '', '', '', 'run complete: 0 form(s) eligible, ' + (keep.length - 1) + ' kept');
        return { moved: 0, kept: keep.length - 1 };
    }
    const width = data[0].length;
    let fa = ss.getSheetByName(FORMS_ARCHIVE_SHEET_NAME);
    const created = !fa;
    if (created) fa = ss.insertSheet(FORMS_ARCHIVE_SHEET_NAME);
    _sheetFitCols_(fa, width);
    if (created || fa.getLastRow() === 0) {
        fa.getRange(1, 1, 1, width).setValues([data[0]]);
        try { fa.setFrozenRows(1); } catch (_) {}
    }
    _sheetFitRows_(fa, fa.getLastRow() + move.length);
    fa.getRange(fa.getLastRow() + 1, 1, move.length, width).setValues(move);
    // Same safety order as Visits: kept rows written over the top first, then the leftover rows cleared.
    fsh.getRange(1, 1, keep.length, width).setValues(keep);
    if (data.length > keep.length) fsh.getRange(keep.length + 1, 1, data.length - keep.length, width).clearContent();
    _audit_('archiveForms', '', '', '', '', '', '', 'Forms sheet rewritten (write then trim): ' + move.length + ' form(s) archived, ' + (keep.length - 1) + ' kept');
    return { moved: move.length, kept: keep.length - 1 };
}

/** __45_ (F90-1): widen / lengthen a sheet so a write of that size is inside its dimensions (Sheets throws otherwise). */
function _sheetFitCols_(sh, width) {
    const m = sh.getMaxColumns();
    if (m < width) sh.insertColumnsAfter(m, width - m);
}
function _sheetFitRows_(sh, lastRowNeeded) {
    const m = sh.getMaxRows();
    if (m < lastRowNeeded) sh.insertRowsAfter(m, lastRowNeeded - m);
}

/** __45_ (F90-2): a Sheets date value, or a string that starts with an ISO date and parses. */
function _looksLikeDate_(v) {
    if (Object.prototype.toString.call(v) === '[object Date]') return !isNaN(v.getTime());
    const s = String(v === null || v === undefined ? '' : v).trim();
    return /^\d{4}-\d{2}-\d{2}/.test(s) && !isNaN(new Date(s).getTime());
}

/** Lock not obtained: first time schedule one retry in 1 hour; a failed retry flags. */
function _archiveLockFailed_(isRetry) {
    if (isRetry) {
        _archiveFlag_('The retry also could not get the script lock (waited 60 s). The monthly archive did not run. It will run at the next monthly trigger, or run archiveOldData by hand.');
        return;
    }
    _audit_('archiveOldData:LOCK-BUSY', '', '', '', '', '', '', 'Script lock not obtained within 60 s - archive skipped, retry scheduled in 1 hour');
    try {
        _archiveDeleteRetryTriggers_(); // never leave two retries queued
        ScriptApp.newTrigger('archiveOldDataRetry').timeBased().after(ARCHIVE_RETRY_DELAY_MS).create();
    } catch (e) {
        _archiveFlag_('The script lock was busy and the 1-hour retry could not be scheduled: ' + String(e).substring(0, 200) + '. The monthly archive did not run.');
    }
}

function _archiveDeleteRetryTriggers_() {
    try {
        ScriptApp.getProjectTriggers().forEach(function(t) {
            if (t.getHandlerFunction() === 'archiveOldDataRetry') ScriptApp.deleteTrigger(t);
        });
    } catch (e) { console.warn('[archive] could not clear retry triggers: ' + e); }
}

/** Record, audit and email an archive failure. The daily health email carries it until reported. Never throws. */
function _archiveFlag_(msg) {
    try { sp.setProperty('ARCHIVE_FAILED', new Date().toISOString() + ' | ' + String(msg).substring(0, 400)); } catch (_) {}
    _audit_('archiveOldData:FLAG', '', '', '', '', '', '', msg);
    try {
        const recipient = (CONFIG.HEALTH_EMAIL && CONFIG.HEALTH_EMAIL.includes('@'))
            ? CONFIG.HEALTH_EMAIL
            : Session.getEffectiveUser().getEmail();
        MailApp.sendEmail({
            to: recipient,
            subject: '\u26a0\ufe0f OTG monthly archive did not run - ' + CONFIG.ORG_NAME,
            htmlBody: '<p>' + _escHtml(String(msg)) + '</p><p>The Visits sheet is still in service and alerts are not affected. Old rows stay in Visits until the archive runs.</p>'
        });
    } catch (e) { console.warn('[archive] flag email failed: ' + e); }
}

function sendWeeklySummary() { _jobRun_('sendWeeklySummary', _sendWeeklySummaryImpl_); }

function _sendWeeklySummaryImpl_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Visits');
  if(!sheet) return { __jobSkip: 'Visits sheet not found' };
  const data = sheet.getDataRange().getValues();
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  let count = 0, distance = 0, alerts = 0;
  for(let i=1; i<data.length; i++) {
    const rowTime = new Date(data[i][0]);
    if(rowTime > oneWeekAgo) {
      count++;
      if(data[i][18]) distance += Number(data[i][18]);
      if(data[i][10].toString().includes("EMERGENCY")) alerts++;
    }
  }
  const html = `<h2>Weekly Safety Report</h2><p><strong>Period:</strong> Last 7 Days</p><table border="1" cellpadding="10" style="border-collapse:collapse;"><tr><td><strong>Total Visits</strong></td><td>${count}</td></tr><tr><td><strong>Distance Traveled</strong></td><td>${distance.toFixed(2)} km</td></tr><tr><td><strong>Safety Alerts</strong></td><td style="color:${alerts>0?'red':'green'}">${alerts}</td></tr></table><p><em>Generated by OTG AppSuite</em></p>`;
  MailApp.sendEmail({to: Session.getEffectiveUser().getEmail(), subject: "Weekly Safety Summary", htmlBody: html});
}

function sendResponse(e, data) {
    const json = JSON.stringify(data);
    if (e && e.parameter && e.parameter.callback) {
        return ContentService.createTextOutput(`${e.parameter.callback}(${json})`)
            .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ContentService.createTextOutput(json)
        .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Resolves the current ORS API version by trying known versions in order.
 * Caches the result in _orsVersion for the lifetime of the execution.
 * Returns a version string (e.g. "v2") or null if no version responds.
 */
function getOrsVersion_(apiKey) {
    if (_orsVersion) return _orsVersion;
    const versions = ['v2', 'v3'];
    for (const v of versions) {
        try {
            const resp = UrlFetchApp.fetch(
                `https://api.openrouteservice.org/${v}/directions/driving-car?api_key=${apiKey}&start=174.776,-41.286&end=174.777,-41.287`,
                { method: 'get', muteHttpExceptions: true }
            );
            const code = resp.getResponseCode();
            // 200 = success; 400 = bad params but endpoint exists; 401/403 = auth issue but endpoint exists
            if (code !== 404 && code !== 410) {
                _orsVersion = v;
                return v;
            }
        } catch(e) { /* try next version */ }
    }
    return null;
}

// SECURE ORS PROXY (Fixes API Key Leakage)
function getRouteDistance(start, end) {
  if (!CONFIG.ORS_API_KEY || CONFIG.ORS_API_KEY.length < 5) return null;
  
  try {
    // Reverse coordinates for ORS requirements (lon,lat)
    const p1 = start.split(',').reverse().join(',');
    const p2 = end.split(',').reverse().join(',');

    const v = getOrsVersion_(CONFIG.ORS_API_KEY);
    if (!v) return null;
    const url = `https://api.openrouteservice.org/${v}/directions/driving-car?api_key=${CONFIG.ORS_API_KEY}&start=${p1}&end=${p2}`;
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    
    if (response.getResponseCode() === 200) {
      const json = JSON.parse(response.getContentText());
      const meters = json.features[0].properties.segments[0].distance;
      return (meters / 1000).toFixed(2); // Return km
    }
  } catch (e) {
    console.warn("ORS Proxy Error: " + e.toString());
  }
  return null;
}

/**
 * ORS WAYPOINT ROUTING
 * Accepts a pipe-delimited breadcrumb trail ("lat,lng|lat,lng|...") collected
 * by the worker app during a travel session. Decimates to ≤25 points (well
 * within the ORS free-tier limit), then POST-routes through all of them.
 *
 * This gives road-accurate distance along the path actually driven, rather than
 * the theoretical A→B route that getRouteDistance() returns.
 *
 * ORS POST endpoint returns json.routes[0].summary.distance in metres.
 * Note: ORS expects coordinates as [longitude, latitude] — opposite of our
 * internal convention of "lat,lng".
 */
function getRouteDistanceWithTrail(trailStr) {
    if (!CONFIG.ORS_API_KEY || CONFIG.ORS_API_KEY.length < 5) return null;

    // Parse "lat,lng|lat,lng|..." into ORS-format [lng, lat] pairs
    const points = trailStr.split('|').map(seg => {
        const parts = seg.split(',');
        const lat = parseFloat(parts[0]);
        const lng = parseFloat(parts[1]);
        return (!isNaN(lat) && !isNaN(lng)) ? [lng, lat] : null;
    }).filter(Boolean);

    if (points.length < 2) return null;

    const coords = _decimateTrail(points, 40); // ORS free tier supports 50; 40 gives accuracy headroom

    try {
        const v = getOrsVersion_(CONFIG.ORS_API_KEY);
        if (!v) return null;
        const response = UrlFetchApp.fetch(
            `https://api.openrouteservice.org/${v}/directions/driving-car`,
            {
                method: 'post',
                contentType: 'application/json; charset=utf-8',
                headers: { 'Authorization': CONFIG.ORS_API_KEY },
                payload: JSON.stringify({ coordinates: coords }),
                muteHttpExceptions: true
            }
        );

        if (response.getResponseCode() === 200) {
            const json = JSON.parse(response.getContentText());
            const metres = json.routes[0].summary.distance;
            return (metres / 1000).toFixed(2);
        }
        console.warn('ORS waypoint HTTP ' + response.getResponseCode() + ': ' + response.getContentText().substring(0, 200));
    } catch (e) {
        console.warn('ORS Waypoints Error: ' + e.toString());
    }
    return null;
}

/**
 * Decimates a coordinate array to at most maxPoints by uniform sampling,
 * always preserving the first and last points (trip start and end).
 */
function _decimateTrail(points, maxPoints) {
    if (points.length <= maxPoints) return points;
    const result = [points[0]];
    const step = (points.length - 1) / (maxPoints - 1);
    for (let i = 1; i < maxPoints - 1; i++) {
        result.push(points[Math.round(i * step)]);
    }
    result.push(points[points.length - 1]);
    return result;
}

/**
 * PRIVACY SWEEP: Automatically moves private 'Note to Self' sent emails to the trash.
 * This should be set to run on a time-based trigger (e.g., every hour).
 */
function cleanupPrivateSentNotes() {
  try {
    // Search only in the Sent folder for the specific private subject line
    const threads = GmailApp.search('label:sent subject:"[PRIVATE] Note to Self"');
    
    if (threads.length > 0) {
      for (let i = 0; i < threads.length; i++) {
        threads[i].moveToTrash();
      }
      console.log(`Privacy Sweep: Moved ${threads.length} private threads to trash.`);
    }
    _jobMark_('cleanupPrivateSentNotes', true, threads.length + ' thread(s) trashed');
  } catch (e) {
    console.warn("Privacy Sweep Error: " + e.toString());
    _jobMark_('cleanupPrivateSentNotes', false, e.toString());
  }
}

/**
 * REFINED: getSyncData with Unified Targeting
 * Logic: Pulls worker groups and applies a single Targeting Engine to filter all data.
 */
function getSyncData(workerName, deviceId) {
    // 1. THE TARGETING ENGINE (Defined once at the top)
    const isAuthorised = (targetStr, name, groups) => {
        const allowed = (targetStr || "").toString().toLowerCase().split(',').map(s => s.trim());
        if (allowed.includes("all")) return true;
        if (allowed.includes(name)) return true;
        
        const myGroups = groups.split(',').map(s => s.trim()).filter(g => g !== "");
        return myGroups.some(g => allowed.includes(g));
    };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const stSheet = ss.getSheetByName('Staff');
    const wNameSafe = (workerName || "").toString().toLowerCase().trim();
    
    if (!stSheet) return {status: "error", message: "Staff sheet missing."};
    
    const stData = stSheet.getDataRange().getValues();
    let workerFound = false;
    let workerGroups = ""; 
    let meta = {};

    // 2. Identify Worker & Their Groups
    for (let i = 1; i < stData.length; i++) {
        if ((stData[i][0] || "").toString().toLowerCase().trim() === wNameSafe) {
            // Column C (index 2) is 'Status' — block Inactive workers at the gate.
            const staffStatus = (stData[i][2] || '').toString().trim().toLowerCase();
            if (staffStatus === 'inactive') return {status: "error", message: "Access Denied."};
            workerFound = true;
            // Column D (Index 3) is 'Group Membership'
            workerGroups = (stData[i][3] || "").toString().toLowerCase(); 
            meta.lastVehCheck = stData[i][5];
            meta.wofExpiry = stData[i][6];
            break; 
        }
    }

    if (!workerFound) return {status: "error", message: "Access Denied."};

    // 3. Filter Sites
    const sites = [];
    const siteSheet = ss.getSheetByName('Sites');
    if (siteSheet) {
        const sData = siteSheet.getDataRange().getValues();
        for (let i = 1; i < sData.length; i++) {
            if (isAuthorised(sData[i][0], wNameSafe, workerGroups)) {
                sites.push({ 
                    template: sData[i][1], company: sData[i][2], siteName: sData[i][3], 
                    address: sData[i][4], contactName: sData[i][5], 
                    contactPhone: sData[i][6], contactEmail: sData[i][7], 
                    notes: sData[i][8], emergencyProcedures: sData[i][9],
                    riskLevel: sData[i][10] || '',  // Column K — Low / Medium / High / Critical
                    preVisitForm: sData[i][11] === true || sData[i][11] === 'TRUE' || sData[i][11] === 'true'  // Column L
                });
            }
        }
    }
    
    // 4. Filter Templates (Forms)
    const forms = [];
    const cachedTemplates = {};
    const tSheet = ss.getSheetByName('Templates');
    if (tSheet) {
        const tData = tSheet.getDataRange().getValues();
        for (let i = 1; i < tData.length; i++) {
            if (isAuthorised(tData[i][2], wNameSafe, workerGroups)) {
                const questions = [];
                for (let q = 4; q < 34; q++) { if (tData[i][q]) questions.push(tData[i][q]); }
                // Col A (type) is read and passed through but not acted on by the worker or backend.
                // Originally intended to distinguish REPORT (submitted at visit conclusion) from
                // FORM (standalone, via the Forms Library). That distinction collapsed because REPORT
                // templates also need to appear in the Forms Library for retrospective gap-filling
                // (e.g. a visit or trip that wasn't recorded at the time). Both types now follow the
                // same rendering and submission path. The column is retained for admin readability only.
                forms.push({name: tData[i][1], type: tData[i][0], questions: questions, formTiming: (tData[i][34] || '').toString().trim().toLowerCase()});
                cachedTemplates[tData[i][1]] = questions;
            }
        }
    }

// 5. Filter Notices (History)
    const noticeHistory = [];
    const noticeSheet = ss.getSheetByName('Notices');
    if (noticeSheet) {
        const nData = noticeSheet.getDataRange().getValues();
        for (let i = nData.length - 1; i > 0 && noticeHistory.length < 10; i--) {
            if (nData[i][6] === 'Active' && isAuthorised(nData[i][7], wNameSafe, workerGroups)) {
                noticeHistory.push({
                    id: nData[i][1], priority: nData[i][2], title: nData[i][3], 
                    content: nData[i][4], date: nData[i][0]
                });
            }
        }
        meta.noticeHistory = noticeHistory; 
        if (noticeHistory.length > 0) meta.activeNotice = noticeHistory[0];
    }
  
// 6. Filter Resources
    const resources = [];
    const resSheet = ss.getSheetByName('Resources');
    if (resSheet) {
        const rData = resSheet.getDataRange().getValues();
        for (let i = 1; i < rData.length; i++) {
            if (isAuthorised(rData[i][4], wNameSafe, workerGroups)) {
                resources.push({
                    category: rData[i][0], title: rData[i][1], 
                    type: rData[i][2], url: rData[i][3]
                });
            }
        }
        meta.resources = resources;
    }
    
    return {sites, forms, cachedTemplates, meta, version: CONFIG.VERSION};
}
/**
 * FIX: Handle broadcast messages from Monitor App.
 * Writes a new row to the Notices sheet so every worker receives it on next sync.
 */
function handleBroadcast(p) {
    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        let sheet = ss.getSheetByName('Notices');
        if (!sheet) {
            sheet = ss.insertSheet('Notices');
            sheet.appendRow(['Date', 'ID', 'Priority', 'Title', 'Content', 'Sender', 'Status', 'Target', 'Acknowledged By']);
        }
        const id  = 'BC-' + Date.now().toString(36).toUpperCase();
        const row = [
            new Date(),
            id,
            p.priority  || 'Standard',
            'Broadcast from HQ',
            p.message   || '',
            p.source    || 'Monitor',
            'Active',
            'ALL',
            ''
        ];
        sheet.appendRow(row);
        return { status: 'success', id: id };
    } catch(err) {
        console.error('handleBroadcast error: ' + err);
        return { status: 'error', message: err.toString() };
    }
}

/**
 * BACKEND logic: Specifically updates the 'Sites' tab
 */
function updateSiteEmergencyProcedures(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const siteSheet = ss.getSheetByName("Sites");
  if (!siteSheet) return { status: 'error', message: 'Sites tab not found' };

  const data = siteSheet.getDataRange().getValues();
  const headers = data[0];
  
  // 1. Identify "Emergency Procedures" column
  let colIdx = headers.indexOf("Emergency Procedures");
  if (colIdx === -1) {
    colIdx = headers.length;
    siteSheet.getRange(1, colIdx + 1).setValue("Emergency Procedures");
  }

  // 2. Locate the specific site row
  let targetRow = -1;
  const siteCol = headers.indexOf("Site Name");
  const compCol = headers.indexOf("Company Name");

  for (let i = 1; i < data.length; i++) {
    if (data[i][siteCol] === payload.siteName && data[i][compCol] === payload.companyName) {
      targetRow = i + 1;
      break;
    }
  }

  if (targetRow === -1) return { status: 'error', message: 'Site match failed' };

  // 3. Process Photos & Generate Links
  const photoUrls = [];
  const folder = DriveApp.getFolderById(CONFIG.PHOTOS_FOLDER_ID);
  
  (payload.photos || []).forEach((base64, idx) => {
    const blob = Utilities.newBlob(Utilities.base64Decode(base64.split(",")[1]), "image/jpeg", `EP_${payload.siteName}_${idx}.jpg`);
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    photoUrls.push(file.getUrl());
  });

  // 4. Update the Sites cell
  siteSheet.getRange(targetRow, colIdx + 1).setValue(photoUrls.join(", "));
  return { status: 'success', links: photoUrls };
}

/**
 * MISSION-CRITICAL: Notice Acknowledgment Logger
 * Appends worker name to Column I of the Notices tab.
 */
function handleNoticeAck(p) {
    const ss       = SpreadsheetApp.getActiveSpreadsheet();
    const noticesSheet = ss.getSheetByName('Notices');
    const noticeId = p.noticeId;
    const worker   = p['Worker Name'];

    if (!noticesSheet) return { status: "error", message: "Notices tab missing" };

    // 1. Update the Notices sheet Acknowledged By column (col I, index 8)
    const noticeData = noticesSheet.getDataRange().getValues();
    let noticeLabel  = noticeId; // fallback identifier for the audit note
    for (let i = 1; i < noticeData.length; i++) {
        if (noticeData[i][1] === noticeId) {
            // Col A (index 0) holds the notice title if present
            if (noticeData[i][0]) noticeLabel = String(noticeData[i][0]);
            let currentAcks = noticeData[i][8]
                ? noticeData[i][8].toString().split(',').map(s => s.trim())
                : [];
            if (!currentAcks.includes(worker)) {
                currentAcks.push(worker);
                noticesSheet.getRange(i + 1, 9).setValue(currentAcks.join(', '));
            }
            break;
        }
    }

    // 2. Append an audit note to the current open visit row in the Visits sheet.
    // Deliberately does NOT call handleWorkerPost() and does NOT touch col K
    // (Alarm Status). A broadcast acknowledgement is not a visit lifecycle event —
    // writing NOTICE_ACK to col K caused checkOverdueVisits() to treat the visit
    // as closed and stop escalation while the worker was still overdue.
    try {
        const visitsSheet = ss.getSheetByName('Visits');
        if (visitsSheet && visitsSheet.getLastRow() > 1) {
            const vData = visitsSheet.getDataRange().getValues();
            const CLOSED_PREFIXES = ['DEPARTED', 'COMPLETED', 'DATA_ENTRY_ONLY', 'USER_SAFE', 'PRE_VISIT'];
            // Walk rows in reverse — most recent open visit for this worker
            for (let r = vData.length - 1; r >= 1; r--) {
                if (vData[r][2] === worker) { // col C (index 2) = Worker Name
                    const st       = String(vData[r][10]); // col K (index 10) = Alarm Status
                    const isClosed = CLOSED_PREFIXES.some(pfx => st.includes(pfx));
                    if (!isClosed) {
                        const existing = vData[r][11] ? String(vData[r][11]) : ''; // col L = Notes
                        visitsSheet.getRange(r + 1, 12).setValue(
                            existing + ` [NOTICE_ACK: ${noticeLabel}]`
                        );
                        break;
                    }
                }
            }
        }
    } catch (e) {
        // Non-fatal — the Notices sheet update above already succeeded
        Logger.log('handleNoticeAck: visit note append failed: ' + e.message);
    }

    return { status: "success" };
}

/**
 * HELPER: Unified Escalation Handler
 * Logic: Appends row and routes to Primary (isDual=false) or Both (isDual=true).
 */
function triggerEscalation(sheet, entry, newStatus, isDual, rowNum) {
    // __43_: kept for compatibility (no caller in this file). The checker uses _escalationWrite_ and sends the
    // alerts itself after releasing the script lock.
    const job = _escalationWrite_(sheet, entry, newStatus, isDual, rowNum);
    _sendOrQueue_('escalation', function () { triggerAlerts(job.payload, job.type); });
}

/** __43_: the sheet half of an escalation step (col A, K, L). Returns the alert job { payload, type } - not sent here. */
function _escalationWrite_(sheet, entry, newStatus, isDual, rowNum) {
    // ONE-ROW-PER-VISIT: Update the existing row in place rather than appending a new one.
    // rowNum is the 1-based sheet row index passed from checkOverdueVisits() via latest[worker].r.
    // This ensures every visit lifecycle event (ARRIVED → EMERGENCY → USER_SAFE_CONFIRMED → DEPARTED)
    // lands on a single row, making the sheet audit log clean and preventing handleWorkerPost()
    // from losing the row context when the worker submits their report post-alarm resolution.
    const escalationTs = new Date().toISOString();
    const updatedNotes = (entry[11] || '') + ` [AUTO-${newStatus}]`;
    sheet.getRange(rowNum, 1).setValue(escalationTs);   // col A: Timestamp
    // __42_ (B1, A7): never overwrite PANIC/SOS/DURESS (rank 4+) in col K. The ladder's memory is in
    // col AA, so col K no longer needs the tier text. Col A, the Notes tag and the alerts are unchanged.
    if (_alarmRank_(String(entry[10] || '')) >= 4) {
        sheet.getRange(rowNum, 12).setValue(updatedNotes);   // col L: Notes
        _audit_('triggerEscalation:k-kept', entry[2], rowNum, entry[10], '', newStatus, '',
                'col K holds PANIC/DURESS - not overwritten; col A and L written - alerts follow');
    } else {
        sheet.getRange(rowNum, 11).setValue(newStatus);      // col K: Alarm Status
        sheet.getRange(rowNum, 12).setValue(updatedNotes);   // col L: Notes
        _audit_('triggerEscalation', entry[2], rowNum, entry[10], newStatus, '', '', 'escalation step written (col A, K, L) - alerts follow');
    }
    return _escalationPayload_(sheet, entry, newStatus, isDual);
}

/** __43_: build the alert job for an escalation step from the Visits row (and Staff ntfy topics). No writes. */
function _escalationPayload_(sheet, entry, newStatus, isDual) {
    // Look up ntfy topics from the Staff sheet — they are not stored in Visits rows.
    // Silently degrades to empty strings if the sheet is missing or the row isn't found.
    let emgNtfy = '', escNtfy = '';
    try {
        const staffSheet = sheet.getParent().getSheetByName('Staff');
        if (staffSheet) {
            const staffData = staffSheet.getDataRange().getValues();
            for (let j = 1; j < staffData.length; j++) {
                if (staffData[j][0] === entry[2]) {
                    emgNtfy = (staffData[j][7] || '').toString().trim(); // Column H
                    escNtfy = (staffData[j][8] || '').toString().trim(); // Column I
                    break;
                }
            }
        }
    } catch (e) { console.error('ntfy Staff lookup failed: ' + e.toString()); }

    const payload = {
        'Worker Name':               entry[2],
        'Worker Phone Number':       entry[3],
        'Emergency Contact Name':    entry[4],
        'Emergency Contact Number':  entry[5],
        'Emergency Contact Email':   entry[6],
        'Emergency Contact Ntfy':    emgNtfy,
        'Escalation Contact Name':   entry[7],
        'Escalation Contact Number': isDual ? entry[8] : "",
        'Escalation Contact Email':  isDual ? entry[9] : "",
        'Escalation Contact Ntfy':   isDual ? escNtfy : "",
        'Contact Scope':             isDual ? 'both' : 'primary',   // __45_ (F89-1): read by triggerAlerts
        'Alarm Status':              newStatus,
        'Notes':                     `Alert: Worker is ${newStatus}.`,
        'Visit Notes':               String(entry[11] || ''),
        'Location Name':             entry[12],
        'Location Address':          entry[13],
        'Last Known GPS':            entry[14],
        'GPS Timestamp':             entry[15] || '',
        'Battery Level':             entry[16]
    };
    return { payload: payload, type: isDual ? "CRITICAL ESCALATION" : "OVERDUE WARNING" };
}

/**
 * NEW: handleSafetyResolution
 * Logic: Notifies both contacts that the emergency has ended.
 */
function handleSafetyResolution(p, forceNotify, forceScope) {
    let _stillMonitored = false; // __43_ (D2): the clear leaves an open visit row - the visit is still monitored
    let _audience = forceNotify ? (forceScope || 'both') : 'none';   // __45_ (F89-2): who gets the All Clear
    // GUARD: Scan the sheet BEFORE handleWorkerPost runs, because handleWorkerPost
    // will overwrite the open alarm row's status to USER_SAFE_CONFIRMED — after which
    // the scan would hit the 'SAFE' break condition and incorrectly return alertWasSent=false,
    // suppressing All Clear every time.
    //
    // forceNotify=true bypasses this guard entirely and skips the handleWorkerPost() call.
    // Used by handleResolvePost() which has already updated the sheet row before calling here —
    // so the guard would always find USER_SAFE (not an alarm) and wrongly suppress All Clear.
    if (!forceNotify) {
        // __42_ B2: one All Clear per clear. The outbox retries until it reads "success", so the same
        // clear can arrive twice; handleWorkerPost already discards the duplicate row write, and now the
        // All Clear is not sent a second time either.
        if (p.idempotencyKey && _idemSeen_(p.idempotencyKey)) {
            _audit_('handleSafetyResolution:duplicate', p['Worker Name'], '', '', '', p['Alarm Status'], p.idempotencyKey,
                    'clear already processed - no second All Clear');
            return { status: 'success', duplicate: true };
        }
        const workerNameCheck = (p['Worker Name'] || '').toString().trim();
        let alertWasSent = false;
        let latestOpenVisit = false;   // __42_: latest row is an open visit row (has a due time)
        try {
            const ss = SpreadsheetApp.getActiveSpreadsheet();
            const sheet = ss.getSheetByName('Visits');
            if (sheet) {
                const data = sheet.getDataRange().getValues();
                // __44_ (F87-4): "alerted" is decided by _contactsAlerted_ (what was sent), not by words in col K.
                // __42_ B2/B4: decide on the worker's LATEST row only. A PIN clear now leaves the visit
                // row open as ARRIVED/TRAVELLING, so walking back past it could find an older visit's
                // alarm and send a wrong All Clear. PRE_VISIT / DATA_ENTRY_ONLY records are skipped.
                for (let i = data.length - 1; i > 0; i--) {
                    if ((data[i][2] || '').toString().trim() === workerNameCheck) {
                        const rowStatus = (data[i][10] || '').toString().toUpperCase();
                        if (rowStatus.includes('PRE_VISIT') || rowStatus.includes('DATA_ENTRY_ONLY')) continue;
                        _audience = _alertAudience_(data[i]);            // __45_ (F89-2): who was alerted
                        if (_audience !== 'none') alertWasSent = true;
                        const closed = rowStatus.includes('DEPARTED') || rowStatus.includes('COMPLETED') || rowStatus.includes('SAFE');
                        const due = new Date(data[i][20]);
                        latestOpenVisit = !closed && !!data[i][20] && !isNaN(due.getTime());
                        break;
                    }
                }
            }
        } catch(e) { console.warn('All Clear guard: ' + e); }

        if (!alertWasSent) {
            // __42_ B3: no alarm reached the server (e.g. the clear overtook a standard OVERDUE ALARM still
            // queued on the phone), so no All Clear - but an open visit row still records the clear and
            // takes the new due time from the post, so the server and phone agree on when to alarm.
            if (latestOpenVisit) {
                handleWorkerPost(p);
                _audit_('handleSafetyResolution:no-alarm', p['Worker Name'], '', '', '', p['Alarm Status'], p.idempotencyKey,
                        'latest row is an open visit with no alarm - clear recorded, All Clear not sent');
            }
            console.log('All Clear suppressed — no alarm was sent for ' + (p['Worker Name'] || ''));
            return { status: 'success', allClearSuppressed: true };
        }

        // 1. Update the Visit Record for the audit trail (after the guard, so the scan sees clean data).
        // Skipped when forceNotify=true because handleResolvePost() has already done this.
        // __42_ B2: a PIN clear on an open visit row (has a due time) restores it and leaves it open.
        _stillMonitored = latestOpenVisit;
        handleWorkerPost(p);
    }

    // __43_ (F86-2): the All Clear goes out after the script lock is released (doPost path).
    const _acP = Object.assign({}, p), _acOpen = _stillMonitored, _acScope = _audience;
    _sendOrQueue_('allclear', function () { _sendAllClear_(_acP, _acOpen, _acScope); });
    return { status: "success" };
}

/**
 * __43_: All Clear to both contacts - ntfy first (Decision C), then email, then SMS. Waits (without the lock, up to
 * ALLCLEAR_WAIT_MS) while the checker is still sending this worker's ladder alerts, so it never arrives first.
 * stillMonitored (D2): the visit stays open, so the wording says contacts will be alerted again if needed.
 */
function _sendAllClear_(p, stillMonitored, scope) {
    _allClearWaitForLadder_(p['Worker Name']);
    // __45_ (F89-2): only the contacts who were alerted get the All Clear. 'primary' = standard tiers 1-3 only.
    const _acPrimaryOnly = scope === 'primary';
    if (_acPrimaryOnly) p = Object.assign({}, p, { 'Escalation Contact Number': '', 'Escalation Contact Phone': '',
                                                   'Escalation Contact Email': '', 'Escalation Contact Ntfy': '' });
    _audit_('allclear:sent', p['Worker Name'], '', '', '', p['Alarm Status'], p.idempotencyKey,
            'All Clear to ' + (_acPrimaryOnly ? 'the primary contact only (only they were alerted)' : 'both contacts'));

    // 2. Draft the Resolution Messages
    const subject    = `✅ ALL CLEAR — ${p['Worker Name']} is safe`;
    const workerName = p['Worker Name'] || 'The worker';
    const workerPhone = _formatPhoneDisplay(p['Worker Phone Number']);
    const resolvedAt  = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "dd/MM/yyyy, HH:mm:ss");
    const workerPhoneTel2  = _cleanPhone((p['Worker Phone Number'] || '').toString()) || '';
    const workerPhoneLink2 = workerPhoneTel2
        ? `<a href="tel:${workerPhoneTel2}" style="color:inherit;font-weight:bold;text-decoration:none;">${workerPhone}</a>`
        : `<strong>${workerPhone}</strong>`;

    const buildAllClearHtml = (recipientName) => {
        const salutation = recipientName ? `Dear ${recipientName.split(' ')[0]},` : 'Dear Emergency Contact,';
        return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
      <tr><td style="background:#16a34a;color:#fff;padding:24px 28px;border-radius:8px 8px 0 0">
        <div style="font-size:11px;font-weight:bold;letter-spacing:3px;opacity:0.85;text-transform:uppercase;margin-bottom:6px">OTG Lone Worker Safety</div>
        <div style="font-size:22px;font-weight:bold">✅ ALL CLEAR — Worker is Safe</div>
      </td></tr>
      <tr><td style="background:#fff;padding:28px;border-radius:0 0 8px 8px">
        <p style="margin:0 0 20px">${salutation}</p>
        <p style="margin:0 0 20px"><strong>${workerName}</strong> has confirmed they are safe. The previous safety alert is now resolved. ${stillMonitored
            ? '<strong>Their visit is still being monitored, and you will be alerted again if they do not check in on time.</strong>'
            : '<strong>No further action is required.</strong>'}</p>
        <table cellpadding="0" cellspacing="0" style="font-size:13px;color:#374151">
          <tr><td style="color:#6b7280;padding:4px 12px 4px 0;white-space:nowrap">Worker:</td><td>${workerName}</td></tr>
          <tr><td style="color:#6b7280;padding:4px 12px 4px 0;white-space:nowrap">Phone:</td><td>${workerPhoneLink2}</td></tr>
          <tr><td style="color:#6b7280;padding:4px 12px 4px 0;white-space:nowrap">Location:</td><td>${p['Location Name'] || 'Unknown'}</td></tr>
          <tr><td style="color:#6b7280;padding:4px 12px 4px 0;white-space:nowrap">Cleared at:</td><td>${resolvedAt}</td></tr>
        </table>
        <p style="margin:20px 0 0;font-size:13px;color:#6b7280">If you have any concerns, please contact the worker directly on ${workerPhoneLink2}.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
    };

    // 5. ntfy push — All Clear notification to both contacts (__43_, Decision C: sent first)
    // Prefer Staff sheet topics (col H/I) — the same source used by triggerEscalation.
    // This is more reliable than the payload fields, which can be blank if state.worker
    // was partially restored on the worker device. Fall back to payload values if the
    // Staff lookup fails or returns empty strings.
    let allClearEmgNtfy = (p['Emergency Contact Ntfy'] || '').toString().trim();
    let allClearEscNtfy = (p['Escalation Contact Ntfy'] || '').toString().trim();
    try {
        const _ss = SpreadsheetApp.getActiveSpreadsheet();
        const _staffSheet = _ss.getSheetByName('Staff');
        if (_staffSheet) {
            const _staffData = _staffSheet.getDataRange().getValues();
            const _workerName = (p['Worker Name'] || '').toString().trim();
            for (let _j = 1; _j < _staffData.length; _j++) {
                if ((_staffData[_j][0] || '').toString().trim() === _workerName) {
                    const _sEmg = (_staffData[_j][7] || '').toString().trim(); // col H
                    const _sEsc = (_staffData[_j][8] || '').toString().trim(); // col I
                    if (_sEmg) allClearEmgNtfy = _sEmg;
                    if (_sEsc && !_acPrimaryOnly) allClearEscNtfy = _sEsc;   // __45_ (F89-2)
                    break;
                }
            }
        }
    } catch (_e) { console.warn('All Clear ntfy Staff lookup failed: ' + _e.toString()); }

    const allClearMsg = [
        `Worker: ${p['Worker Name'] || 'Unknown'} · ${p['Worker Phone Number'] || ''}`,
        `Location: ${p['Location Name'] || 'Unknown'}`,
        `Cleared: ${resolvedAt}`,
        stillMonitored ? 'Their visit is still being monitored - you will be alerted again if they do not check in on time.' : ''  // __43_ D2
    ].filter(Boolean).join('\n');

    [allClearEmgNtfy, allClearEscNtfy]
        .filter(t => t && t.trim())
        .forEach(topic => {
            _sendNtfy(topic, `✅ ALL CLEAR — ${p['Worker Name'] || 'Worker'} is safe`, allClearMsg, 'default', 'white_check_mark,green_circle');
        });

    // 3. Dual-Contact Email — personalised salutation per recipient
    const contactPairs = [
        { email: p['Emergency Contact Email'],  name: p['Emergency Contact Name']  },
        { email: p['Escalation Contact Email'], name: p['Escalation Contact Name'] }
    ].filter(c => c.email && c.email.includes('@'));

    contactPairs.forEach(contact => {
        try {
            MailApp.sendEmail({ to: contact.email, subject, htmlBody: buildAllClearHtml(contact.name) });
        } catch (e) { console.error("All Clear email failed: " + e.toString()); }
    });
    
    // 4. Dual-Contact SMS
    if (CONFIG.SMS_PROVIDER && CONFIG.SMS_PROVIDER !== 'none' && !CONFIG.SMS_PROVIDER.includes('%%')) {
        const numbers = [
            p['Emergency Contact Number'] || p['Emergency Contact Phone'],
            p['Escalation Contact Number'] || p['Escalation Contact Phone']
        ].map(n => _cleanPhone(n)).filter(n => n);
        const allClearBody = `${subject}. Alert resolved.` + (stillMonitored ? ' Visit still being monitored.' : ''); // __43_ D2
        numbers.forEach(num => { try { _sendSms_(num, allClearBody); } catch(e) { _logSmsResult_(num, allClearBody, e.toString(), true); } });
    }


    return { status: "success" };
}

/** __43_: wait (no lock held) while the checker's ladder alerts for this worker are still going out. Never throws. */
function _allClearWaitForLadder_(worker) {
    let cache;
    try { cache = CacheService.getScriptCache(); } catch (_) { return; }
    const k = _sendingKey_(worker);
    const t0 = Date.now();
    let n = 0, still = false;
    try {
        while (cache.get(k) === '1' && n < Math.ceil(ALLCLEAR_WAIT_MS / 500) && Date.now() - t0 < ALLCLEAR_WAIT_MS) {
            Utilities.sleep(500); n++;
        }
        still = cache.get(k) === '1';
    } catch (_) {}
    if (n > 0) _audit_('allclear:waited', worker, '', '', '', '', '', 'waited ' + (Date.now() - t0) +
                       'ms for the ladder alerts to finish' + (still ? ' - still sending, All Clear sent anyway' : ''));
}

/**
 * Serves a self-contained HTML page showing emergency procedure photos for a site.
 * Photos are fetched via DriveApp (no sign-in required from the viewer's side)
 * and embedded as base64 <img> tags. Returned as HtmlOutput via doGet.
 */
function getEmergencyProceduresViewer(siteName, companyName) {
    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const siteSheet = ss.getSheetByName('Sites');
        if (!siteSheet) return HtmlService.createHtmlOutput('<p>Sites tab not found.</p>');

        const data = siteSheet.getDataRange().getValues();
        const headers = data[0];
        const siteCol = headers.indexOf('Site Name');
        const compCol = headers.indexOf('Company Name');
        const procCol = headers.indexOf('Emergency Procedures');
        if (procCol === -1) return HtmlService.createHtmlOutput('<p>No Emergency Procedures column.</p>');

        let linksStr = '';
        for (let i = 1; i < data.length; i++) {
            const siteMatch = (data[i][siteCol] || '').toString().trim() === siteName.trim();
            const compMatch = !companyName || (data[i][compCol] || '').toString().trim() === companyName.trim();
            if (siteMatch && compMatch) {
                linksStr = (data[i][procCol] || '').toString().trim();
                break;
            }
        }

        if (!linksStr) return HtmlService.createHtmlOutput('<p style="font-family:sans-serif;color:#fff;background:#111;padding:24px">No procedures found for this site.</p>');

        const urls = linksStr.split(',').map(u => u.trim()).filter(u => u);
        const images = urls.map((url, idx) => {
            try {
                // Extract Drive file ID from URL — handles /file/d/ID/view and open?id=ID forms
                const match = url.match(/\/d\/([-\w]+)/) || url.match(/[?&]id=([-\w]+)/);
                if (!match) return `<p class="err">Photo ${idx + 1}: unrecognised URL format.</p>`;
                const blob = DriveApp.getFileById(match[1]).getBlob();
                const b64  = Utilities.base64Encode(blob.getBytes());
                const mime = blob.getContentType() || 'image/jpeg';
                return `<img src="data:${mime};base64,${b64}" alt="Procedure photo ${idx + 1}">`;
            } catch(e) {
                return `<p class="err">Photo ${idx + 1} could not be loaded: ${e.message}</p>`;
            }
        }).join('\n');

        const displayName = _escHtml(companyName ? companyName + ' — ' + siteName : siteName);

        const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Emergency Procedures</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #111; color: #fff; font-family: -apple-system, sans-serif; padding: 16px; }
    header { margin-bottom: 20px; }
    header h1 { font-size: 13px; font-weight: 900; text-transform: uppercase;
                letter-spacing: 3px; color: #ef4444; margin-bottom: 4px; }
    header p  { font-size: 14px; color: #d1d5db; font-weight: 600; }
    .photos img { width: 100%; display: block; border-radius: 10px;
                  margin-bottom: 14px; box-shadow: 0 2px 12px #0008; }
    .err { color: #f87171; font-size: 13px; padding: 8px 0; }
    footer { margin-top: 24px; font-size: 11px; color: #4b5563; text-align: center; }
  </style>
</head>
<body>
  <header>
    <h1>🛡️ Emergency Procedures</h1>
    <p>${displayName}</p>
  </header>
  <div class="photos">
    ${images}
  </div>
  <footer>OTG AppSuite &mdash; Site Safety Documentation</footer>
</body>
</html>`;

        return HtmlService.createHtmlOutput(html)
            .setTitle('Emergency Procedures')
            .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);

    } catch(err) {
        return HtmlService.createHtmlOutput('<p style="font-family:sans-serif;padding:24px;color:#f87171">Error: ' + err.toString() + '</p>');
    }
}

/** Minimal HTML-escape for values inserted into GAS HtmlOutput strings. */
function _escHtml(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
// ==========================================
// __38_ AUDIT TRAIL + CRITICAL TIMING LADDER MEMORY (session 76, F74-1)
// ==========================================

/** Short id shared by every audit row written by one execution. */
function _auditExecId_() {
    if (!_AUDIT_EXEC) {
        try { _AUDIT_EXEC = Utilities.getUuid().substring(0, 8); }
        catch (_) { _AUDIT_EXEC = String(Date.now()).slice(-8); }
    }
    return _AUDIT_EXEC;
}

/**
 * Append one row to the hidden 'Audit' sheet (created on first use).
 * NEVER throws - a logging failure must never block a sheet write or an alert.
 */
function _audit_(source, worker, row, kBefore, kAfter, incoming, key, note) {
    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        let sh = ss.getSheetByName(AUDIT_SHEET_NAME);
        if (!sh) {
            sh = ss.insertSheet(AUDIT_SHEET_NAME);
            sh.appendRow(['Time (UTC)', 'Execution', 'Source', 'Worker', 'Visits Row', 'Col K Before',
                          'Col K After', 'Incoming Status', 'Idempotency Key', 'Note']);
            sh.setFrozenRows(1);
            try { sh.hideSheet(); } catch (_) {}
        }
        let n = String(note || '');
        if (_AUDIT_LOCKWAIT_MS !== null) n = (n ? n + ' | ' : '') + 'lockWait=' + _AUDIT_LOCKWAIT_MS + 'ms';
        if (_AUDIT_CTX) n = (n ? n + ' | ' : '') + _AUDIT_CTX;   // __43_ (F86-7)
        n = (n ? n + ' | ' : '') + 'build=' + TEMPLATE_BUILD;   // __41_: shows which template wrote the row
        sh.appendRow([
            new Date().toISOString(), _txt_(_auditExecId_()), String(source || ''), String(worker || ''),
            row || '', kBefore == null ? '' : String(kBefore), kAfter == null ? '' : String(kAfter),
            String(incoming || ''), _txt_(String(key || '')), n   // __45_ (item 9 / F83-5): ids stay text
        ]);
    } catch (e) {
        try { console.warn('[audit] write failed: ' + e); } catch (_) {}
    }
}

/** Keep the Audit sheet to the last AUDIT_MAX_ROWS rows. Called daily by sendHealthEmail(). */
function _auditTrim_() {
    try {
        const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(AUDIT_SHEET_NAME);
        if (!sh) return;
        const extra = sh.getLastRow() - 1 - AUDIT_MAX_ROWS;
        if (extra > 0) sh.deleteRows(2, extra);
    } catch (e) { console.warn('[audit] trim failed: ' + e); }
}

/** Critical Timing ladder step shown in a col K status: 0 none, 1 BREACH, 2 REPEAT, 3 FINAL NOTICE. */
function _ladderStepFromStatus_(status) {
    const s = String(status || '').toUpperCase();
    if (s.includes('CRITICAL TIMING FINAL NOTICE')) return 3;
    if (s.includes('CRITICAL TIMING REPEAT'))       return 2;
    if (s.includes('CRITICAL TIMING BREACH'))       return 1;
    return 0;
}

/**
 * Ladder step recorded in col AA for THIS due time, or 0.
 * Col AA format: "<due ISO>|<step>|<label>", e.g. "2026-10-15T03:16:30.000Z|3|FINAL NOTICE".
 * An entry for a different due time (the visit was extended) counts as 0.
 */
function _ladderMemRead_(raw, dueIso) {
    return _ladderMemInfo_(raw, dueIso).step;
}

/**
 * __42_ (B1): what col AA holds. has = any entry at all (a legacy row has none);
 * same = the entry is for THIS due time; step = 1-4 when same, else 0.
 */
function _ladderMemInfo_(raw, dueIso) {
    const s = String(raw || '').trim();
    if (!s) return { has: false, same: false, step: 0, claimMs: null, sent: true, resend: false };
    const parts = s.split('|');
    const same = parts.length >= 2 && parts[0] === dueIso;
    const n = same ? parseInt(parts[1], 10) : 0;
    // __43_: optional fields after the label - claim time (ISO), then 'RESEND' and/or 'SENT'. An entry with no claim
    // time was written before __43_: treated as sent, never re-sent.
    const cms = parts.length >= 4 ? new Date(parts[3]).getTime() : NaN;
    const claimMs = isNaN(cms) ? null : cms;
    const tags = parts.slice(4);
    return { has: true, same: same, step: (n >= 1 && n <= 4) ? n : 0, claimMs: claimMs,
             sent: claimMs === null || tags.indexOf('SENT') > -1, resend: tags.indexOf('RESEND') > -1 };
}

/** __43_: should this claimed step be re-sent? Only once, only 3+ minutes after an unconfirmed claim for this due time. */
function _ladderResendDue_(mem, nowMs) {
    return !!(mem && mem.same && mem.step >= 1 && !mem.sent && !mem.resend && mem.claimMs !== null &&
              nowMs - mem.claimMs >= LADDER_RESEND_AFTER_MS);
}

/**
 * __43_: mark a claim '|SENT' once its alerts have gone. Call with the script lock held. Writes only if the row still
 * belongs to the worker and col AA still holds exactly the value this run claimed (the archive can move rows; a newer
 * claim must not be marked by an older send).
 */
function _ladderMarkSent_(sheet, s) {
    try {
        if (!s || !s.claimVal || !s.rowNum) return false;
        const w = String(sheet.getRange(s.rowNum, 3).getValue() || '');
        const cur = String(sheet.getRange(s.rowNum, LADDER_MEM_COL).getValue() || '');
        if (w !== String(s.worker) || cur !== s.claimVal) {
            _audit_('ladder:mark-skipped', s.worker, s.rowNum, '', '', '', '', 'col AA changed since the claim ("' + cur + '") - not marked');
            return false;
        }
        sheet.getRange(s.rowNum, LADDER_MEM_COL).setValue(cur + '|SENT');
        return true;
    } catch (e) {
        _audit_('ladder:mark-FAILED', s && s.worker, s && s.rowNum, '', '', '', '', String(e).substring(0, 200));
        return false;
    }
}

/** __42_ (B1): standard ladder step shown in a legacy col K: 0 none, 1 15MIN ... 4 60MIN/EMERGENCY. */
function _ladderStepFromStdStatus_(status) {
    const s = String(status || '').toUpperCase();
    if (s.includes('60MIN') || s.includes('EMERGENCY')) return 4;
    if (s.includes('45MIN')) return 3;
    if (s.includes('30MIN')) return 2;
    if (s.includes('15MIN')) return 1;
    return 0;
}

/**
 * __42_ (B1): has the Critical Timing ladder started for this row's due time?
 * True if col K shows a CRITICAL TIMING step OR col AA holds step 1+ for this due time.
 * (Col K alone stops being enough once it can be restored or hold PANIC/DURESS.)
 */
function _ladderStartedFor_(colK, colAA, dueRaw) {
    if (String(colK || '').toUpperCase().includes('CRITICAL TIMING')) return true;
    const due = new Date(dueRaw);
    if (!dueRaw || isNaN(due.getTime())) return false;
    const mem = _ladderMemInfo_(colAA, due.toISOString());
    return mem.same && mem.step >= 1;
}

/** __42_ B4: do two due-time values name the same moment (within 1 s)? Empty or unreadable = no. */
function _sameDue_(a, b) {
    if (!a || !b) return false;
    const x = new Date(a), y = new Date(b);
    if (isNaN(x.getTime()) || isNaN(y.getTime())) return false;
    return Math.abs(x.getTime() - y.getTime()) <= 1000;
}

/** __42_: how many columns to read so col AA is included, without reading past the sheet edge. */
function _readWidth_(sheet) {
    let max = LADDER_MEM_COL;
    try { max = sheet.getMaxColumns(); } catch (_) {}
    return Math.max(21, Math.min(LADDER_MEM_COL, max));
}

/**
 * Claim a ladder step in col AA BEFORE its alerts are sent, then flush so the
 * claim is committed even if the alert sends run long. Never throws: a failed
 * claim is logged and the caller still sends (a duplicate beats a missed alert).
 */
function _ladderMemClaim_(sheet, rowNum, dueDate, step, source, worker, labels, isResend) {
    try {
        const d = (dueDate instanceof Date) ? dueDate : new Date(dueDate);
        if (isNaN(d.getTime())) throw new Error('unreadable due time');
        const hdr = sheet.getRange(1, LADDER_MEM_COL);
        if (!String(hdr.getValue() || '').trim()) hdr.setValue(LADDER_MEM_HEADER);
        const _lbl = (labels || LADDER_STEP_LABELS)[step - 1] || ('STEP ' + step);   // __42_: per ladder type
        // __43_: + claim time (and RESEND on a re-send); '|SENT' is appended once the alerts have gone.
        const val = d.toISOString() + '|' + step + '|' + _lbl + '|' + new Date().toISOString() + (isResend ? '|RESEND' : '');
        sheet.getRange(rowNum, LADDER_MEM_COL).setValue(val);
        SpreadsheetApp.flush();
        _audit_(source + ':claim', worker, rowNum, '', '', '', '', 'col AA = ' + val);
        return val;
    } catch (e) {
        _audit_(source + ':claim-FAILED', worker, rowNum, '', '', '', '',
                String(e).substring(0, 200) + ' - alert still sent');
        return '';
    }
}

/**
 * Simple trigger: records edits to col K (Alarm Status) and col AA (Escalation
 * Memory) on the Visits sheet made in the Sheets UI or app. Google fires simple
 * onEdit triggers ONLY for user edits - never for edits made by this script - so
 * any row logged here was NOT written by the backend.
 */
function onEdit(e) {
    try {
        if (!e || !e.range) return;
        const sh = e.range.getSheet();
        if (sh.getName() !== 'Visits') return;
        const c1 = e.range.getColumn();
        const c2 = e.range.getLastColumn();
        const touchesK  = 11 >= c1 && 11 <= c2;
        const touchesAA = LADDER_MEM_COL >= c1 && LADDER_MEM_COL <= c2;
        if (!touchesK && !touchesAA) return;
        const single = e.range.getNumRows() === 1 && c1 === c2;
        const row = e.range.getRow();
        let worker = '';
        try { worker = String(sh.getRange(row, 3).getValue() || ''); } catch (_) {}
        let who = '';
        try { who = (e.user && e.user.getEmail) ? e.user.getEmail() : ''; } catch (_) {}
        _audit_('onEdit (NOT the backend)', worker, row,
                single ? (e.oldValue === undefined ? '(blank or unknown)' : e.oldValue) : '(multi-cell edit)',
                single ? (e.value === undefined ? '(blank or unknown)' : e.value) : '(multi-cell edit)',
                '', '', 'range ' + e.range.getA1Notation() + (who ? ' by ' + who : ''));
    } catch (_) { /* must never interfere with editing */ }
}

// ==========================================
// __41_ JOB HEARTBEATS, BUILD STAMP AND TRIGGER HEALTH (session 80, Layer 2)
// ==========================================
// Why: a trigger that stops, or a job that quietly does nothing, looked identical to a healthy one.
// Each background job now records its own last success and last failure in script properties
// (NOT the Executions log: reading that from inside the script needs the Apps Script API and a
// new OAuth scope, which is exactly what blocked the archive). The daily Health email judges
// each job against how often it should succeed. checkOverdueVisits() is NOT tracked here: it is
// watched from outside by Healthchecks.io (Layer 1), and no property is written on the minute run.

/** Stamp of the template file itself (CONFIG.VERSION is injected by the Factory and can differ). */
const TEMPLATE_BUILD = 'backend__45_';

/**
 * How often each background job should succeed. maxHours is how late counts as STALE.
 * Google does not let a script read a trigger's schedule, so these are set here: if an
 * installation runs a job on a different schedule, change the number for that job.
 */
const JOB_CADENCE = {
    cleanupPrivateSentNotes: { label: 'Private note sweep',    every: 'hourly',  maxHours: 3 },
    sendHealthEmail:         { label: 'Daily health email',    every: 'daily',   maxHours: 26 },
    geocodeSiteLocations:    { label: 'Site GPS geocoder',     every: 'weekly',  maxHours: 8 * 24 },
    sendWeeklySummary:       { label: 'Weekly safety summary', every: 'weekly',  maxHours: 8 * 24 },
    archiveOldData:          { label: 'Visit archiver',        every: 'monthly', maxHours: 32 * 24 }
};

/** Record one job outcome. Value is "<ISO time>|<detail>". Never throws. */
function _jobMark_(name, ok, detail) {
    try {
        const d = String(detail == null ? '' : detail).replace(/\|/g, '/').substring(0, 200);
        const nowIso = new Date().toISOString();
        if (!sp.getProperty('JOB_TRACKING_SINCE')) sp.setProperty('JOB_TRACKING_SINCE', nowIso + '|');
        sp.setProperty('JOB_' + name + (ok ? '_OK' : '_FAIL'), nowIso + '|' + d);
    } catch (e) {
        try { console.warn('[job] could not record ' + name + ': ' + e); } catch (_) {}
    }
}

/**
 * Run a job and record the outcome. A throw is recorded, then re-thrown, so Google's own
 * failure emails (Layer 3) still fire exactly as before. fn may return { __jobSkip: 'reason' }
 * (the run did not happen: recorded as a failure) or { __jobNote: 'text' }; noteFn(result)
 * can supply the note instead. The result is passed back unchanged.
 */
function _jobRun_(name, fn, noteFn) {
    let r;
    try {
        r = fn();
    } catch (e) {
        _jobMark_(name, false, (e && e.message) ? e.message : e);
        throw e;
    }
    if (r && r.__jobSkip) { _jobMark_(name, false, r.__jobSkip); return r; }
    let note = '';
    try { note = noteFn ? noteFn(r) : ((r && r.__jobNote) || ''); } catch (_) {}
    _jobMark_(name, true, note);
    return r;
}

/** Split a stored "<ISO>|<detail>" value. Returns null when absent or unreadable. */
function _jobParse_(raw) {
    if (!raw) return null;
    const s = String(raw);
    const i = s.indexOf('|');
    const iso = i < 0 ? s : s.substring(0, i);
    const t = new Date(iso);
    if (isNaN(t.getTime())) return null;
    return { time: t, detail: i < 0 ? '' : s.substring(i + 1) };
}

/**
 * Judge every tracked job. Returns [{ fn, label, every, status, ageHours, lastOk, lastFail, note }].
 * status: OK | STALE | NEVER | FAILED | WAITING (tracking began less than one cadence ago).
 * FAILED = the most recent run failed or did not happen, and it is newer than the last success.
 */
function _jobStatuses_(now) {
    let since = _jobParse_(sp.getProperty('JOB_TRACKING_SINCE'));
    if (!since) {
        try { sp.setProperty('JOB_TRACKING_SINCE', now.toISOString() + '|'); } catch (_) {}
        since = { time: now, detail: '' };
    }
    return Object.keys(JOB_CADENCE).map(function (fn) {
        const c    = JOB_CADENCE[fn];
        const ok   = _jobParse_(sp.getProperty('JOB_' + fn + '_OK'));
        const fail = _jobParse_(sp.getProperty('JOB_' + fn + '_FAIL'));
        const ageHours = ok ? (now - ok.time) / 3600000 : null;
        let status;
        if (fail && (!ok || fail.time >= ok.time)) status = 'FAILED';   // a tie counts as failed (the alarming answer)
        else if (ok && ageHours <= c.maxHours)     status = 'OK';
        else if (ok)                               status = 'STALE';
        else if ((now - since.time) / 3600000 <= c.maxHours) status = 'WAITING';
        else                                       status = 'NEVER';
        return { fn: fn, label: c.label, every: c.every, status: status, ageHours: ageHours,
                 lastOk: ok, lastFail: fail, note: ok ? ok.detail : '' };
    });
}

/** Human wording for an age in hours, e.g. "5 min", "3.2 h", "4 days". */
function _jobAgeText_(h) {
    if (h == null) return '';
    if (h < 1)  return Math.max(0, Math.round(h * 60)) + ' min';
    if (h < 48) return (Math.round(h * 10) / 10) + ' h';
    return Math.round(h / 24) + ' days';
}

/** One diagnostics-style line for a job status (used by the Health email and runDiagnostics). */
function _jobDescribe_(j, tz) {
    const fmt = function (d) { return Utilities.formatDate(d, tz, 'dd MMM HH:mm'); };
    switch (j.status) {
        case 'OK':
            return 'Last success ' + fmt(j.lastOk.time) + ' (' + _jobAgeText_(j.ageHours) + ' ago)' +
                   (j.note ? ' - ' + j.note : '');
        case 'STALE':
            return 'NO SUCCESS for ' + _jobAgeText_(j.ageHours) + ' (last ' + fmt(j.lastOk.time) +
                   '). Expected ' + j.every + '. Check the Triggers list and the Executions log.';
        case 'FAILED':
            return 'LAST RUN FAILED ' + fmt(j.lastFail.time) + ': ' + (j.lastFail.detail || 'no detail') +
                   (j.lastOk ? ' (last success ' + fmt(j.lastOk.time) + ')' : ' (no success recorded yet)');
        case 'NEVER':
            return 'NO SUCCESS recorded since tracking began. Expected ' + j.every +
                   '. Is the trigger installed? Run the function once by hand.';
        default:
            return 'Waiting for the first run since tracking began (expected ' + j.every + ').';
    }
}

/**
 * Does a top-level function with this name exist in the script? Returns true / false, or
 * null when this runtime cannot tell (so a limit of the check is never reported as a fault).
 */
function _fnExists_(name) {
    try {
        const g = (typeof globalThis !== 'undefined') ? globalThis : this;
        if (!g) return null;
        // Self-test: a function we know exists must be found, or the check is not trustworthy here.
        if (typeof g['_fnExists_'] !== 'function') return null;
        return typeof g[name] === 'function';
    } catch (e) { return null; }
}

/**
 * Age of the last escalation-engine (checkOverdueVisits) run, from LAST_TRIGGER_TIME.
 * Returns { ageMin, level } where level is 'OK' (<= 5 min), 'WARN' (<= 10 min), 'STALE' (> 10 min)
 * or 'NEVER'. Reads one property; writes nothing.
 */
function _engineAge_(now) {
    const raw = sp.getProperty('LAST_TRIGGER_TIME');
    const t = raw ? new Date(raw) : null;
    if (!t || isNaN(t.getTime())) return { ageMin: null, level: 'NEVER', time: null };
    const ageMin = (now - t) / 60000;
    return { ageMin: ageMin, time: t, level: ageMin <= 5 ? 'OK' : ageMin <= 10 ? 'WARN' : 'STALE' };
}

// ==========================================
// __44_ ALL CLEAR GUARD, FORMS TAB, VISIT ID, LOGGING (session 90)
// ==========================================

/**
 * F87-4: were this row's contacts actually alerted? A Visits row (array, col A = index 0).
 * Yes when col AA holds a ladder step for the row's CURRENT due time (standard or Critical, claimed before send),
 * or col K holds PANIC/SOS/DURESS/EMERGENCY (doPost alerts at once; EMERGENCY is a ladder step or the bridge),
 * a legacy 'OVERDUE - ' tier (pre-__42_ rows), or an OVERDUE ALARM on a Critical Timing row (bridged to the contacts).
 * A plain OVERDUE pulse or a standard OVERDUE ALARM alerts nobody (the checker owns standard escalation).
 */
function _contactsAlerted_(row) { return _alertAudience_(row) !== 'none'; }

/**
 * __45_ (F89-2): WHO was alerted for this row's current due time - 'none', 'primary' or 'both'. Same evidence as
 * _contactsAlerted_ (what was sent), plus which ladder sent it. Standard tiers 1-3 (col AA label 15MIN/30MIN/45MIN, or a
 * legacy 'OVERDUE - ' tier in col K) reach the primary contact only; tier 4, every Critical Timing step, the Critical
 * bridge and PANIC/SOS/DURESS/EMERGENCY reach both. The widest audience wins.
 */
function _alertAudience_(row) {
    if (!row) return 'none';
    const st = String(row[10] || '').toUpperCase();
    if (_alarmRank_(st) >= 3) return 'both';
    if (st.includes('OVERDUE ALARM') && String(row[11] || '').includes('[CRITICAL_TIMING]')) return 'both';
    let aud = st.includes('OVERDUE - ') ? 'primary' : 'none';
    const dueRaw = row[20];
    const due = new Date(dueRaw);
    if (dueRaw && !isNaN(due.getTime())) {
        const raw = String(row[LADDER_MEM_COL - 1] || '');
        const mem = _ladderMemInfo_(raw, due.toISOString());
        if (mem.same && mem.step >= 1) {
            const isStd = LADDER_STD_LABELS.indexOf(String(raw.split('|')[2] || '').trim()) > -1;
            if (!isStd || mem.step >= 4) return 'both';
            aud = 'primary';
        }
    }
    return aud;
}

/** __45_ (F89-3): the grace period in minutes, read as the phone reads it (parseInt, < 1 or unreadable -> 15). */
function _graceMinutes_() {
    const n = parseInt(String(CONFIG.ESCALATION_MINUTES), 10);
    return (n >= 1) ? n : 15;
}

/** __45_ (F89-4): true when due time a is more than 1 s earlier than due time b (both readable). */
function _isEarlierDue_(a, b) {
    if (!a || !b) return false;
    const x = new Date(a), y = new Date(b);
    if (isNaN(x.getTime()) || isNaN(y.getTime())) return false;
    return x.getTime() < y.getTime() - 1000;
}

/** __45_ (item 9 / F83-5): Sheets turns a numeric-looking string (12345678, 1234e567) into a number; an apostrophe keeps it text. */
function _txt_(v) {
    const s = String(v == null ? '' : v);
    return /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s.trim()) ? "'" + s : s;
}

/** F88-5a: posts whose doPost:sends row is always written (alarm family). Routine posts are not (log volume). */
function _isAlarmFamilyPost_(p) {
    if (!p) return false;
    if (p.action === 'notifySafety' || p.action === 'resolve') return true;
    const s = String(p['Alarm Status'] || '').toUpperCase();
    return s.includes('ALARM_GPS_PULSE') || s.includes('USER_SAFE') || _alarmRank_(s) >= 2;
}

/**
 * Decision A / item 2: is this post a form record for the Forms tab? Returns null (normal Visits path) or
 * { status, rowNum, link } where rowNum is the Visits row it belongs to (null = unlinked).
 * Read-only. Looks at the worker's latest row only (PRE_VISIT / DATA_ENTRY_ONLY records skipped), as handleWorkerPost does.
 */
function _formRouteFor_(sheet, workerName, p) {
    const st = String((p && p['Alarm Status']) || '').trim().toUpperCase();
    const always = FORM_ALWAYS_STATUSES.indexOf(st) > -1;
    const ifOpen = FORM_IF_OPEN_STATUSES.indexOf(st) > -1;
    if (!always && !ifOpen) return null;
    let latest = null;
    try {
        const lastRow = sheet ? sheet.getLastRow() : 0;
        if (lastRow > 1) {
            const startRow = Math.max(2, lastRow - 50);
            const data = sheet.getRange(startRow, 1, lastRow - startRow + 1, 21).getValues();
            for (let i = data.length - 1; i >= 0; i--) {
                if (data[i][2] !== workerName) continue;
                const s = String(data[i][10]);
                if (s.includes('PRE_VISIT') || s.includes('DATA_ENTRY_ONLY')) continue;
                const closed = s.includes('DEPARTED') || s.includes('COMPLETED') || s.includes('USER_SAFE');
                latest = { rowNum: startRow + i, open: !closed, due: data[i][20] };
                break;
            }
        }
    } catch (e) { console.warn('[forms] latest-row lookup failed: ' + e); }
    if (ifOpen && !(latest && latest.open)) return null;   // no visit running: the record row in Visits, as before
    if (latest && latest.open) return { status: st, rowNum: latest.rowNum, link: 'open visit' };
    if (latest && _sameDue_(p['Anticipated Departure Time'], latest.due)) return { status: st, rowNum: latest.rowNum, link: 'closed visit (same due time)' };
    return { status: st, rowNum: null, link: 'none' };
}

/** Decision A: append one Forms row. Never writes the trip row (except a missing Visit ID in col AB). */
function _formsRecord_(ss, sheet, p, route, notes, distance, sig, p1, p2, p3, p4, ledger) {
    const workerName = p['Worker Name'];
    const visitId = (route.rowNum && sheet) ? _visitIdGet_(sheet, route.rowNum, true) : '';
    const fsh = _formsSheet_(ss);   // __45_: shared with the archive (header on create)
    fsh.appendRow([new Date().toISOString(), workerName, p['Template Name'] || '', route.status, _txt_(visitId), route.rowNum || '', route.link,
                   p['Visit Report Data'] || '', notes || '', (distance === '' || distance === null || distance === undefined) ? '' : distance,
                   sig || '', p1 || '', p2 || '', p3 || '', p4 || '', p['Last Known GPS'] || '', _txt_(p.idempotencyKey || ''), p['Worker Build'] || '']);
    _audit_(ledger ? 'handleWorkerPost:form-ledger' : 'handleWorkerPost:form', workerName, route.rowNum || '', '', '', p['Alarm Status'], p.idempotencyKey,
            (ledger ? 'report also recorded in Forms tab row ' : 'form recorded in Forms tab row ') + fsh.getLastRow() + ' (' + route.link +
            (visitId ? ', Visit ID ' + visitId : '') + ')' + (ledger ? ' - Visits row written as before' : ' - trip row not written'));
}

/** __45_: the Forms tab, created with its header row if missing. */
function _formsSheet_(ss) {
    let fsh = ss.getSheetByName(FORMS_SHEET_NAME);
    if (!fsh) {
        fsh = ss.insertSheet(FORMS_SHEET_NAME);
        fsh.appendRow(FORMS_HEADERS.slice());
        try { fsh.setFrozenRows(1); } catch (_) {}
    }
    return fsh;
}

/**
 * __45_ (Forms ledger): a post with report data that wrote a Visits row also gets a Forms row. Visit Link says what it
 * is: 'closing report' (departure / completion), 'record row' (a new row - no visit was running), else 'visit row'.
 * Never throws: a failed ledger write is audited and the post still succeeds (the Visits row already holds the report).
 */
function _formsLedger_(ss, sheet, p, statusAsSent, rowNum, isNewRow, notes, distance, sig, p1, p2, p3, p4) {
    try {
        const st = String(statusAsSent || '').trim().toUpperCase();
        const link = isNewRow ? 'record row' : (st.includes('DEPARTED') || st === 'COMPLETED') ? 'closing report' : 'visit row';
        _formsRecord_(ss, sheet, p, { status: st, rowNum: rowNum, link: link }, notes, distance, sig, p1, p2, p3, p4, true);
    } catch (e) {
        _audit_('handleWorkerPost:form-ledger-FAILED', p['Worker Name'], rowNum || '', '', '', p['Alarm Status'], p.idempotencyKey,
                'report not copied to Forms (the Visits row holds it): ' + String(e).substring(0, 200));
    }
}

/** Visit ID of a Visits row (col AB). backfill = give a pre-__44_ row an id now. Never throws; '' when unavailable. */
function _visitIdGet_(sheet, rowNum, backfill) {
    let id = '';
    try { if (sheet.getMaxColumns() >= VISIT_ID_COL) id = String(sheet.getRange(rowNum, VISIT_ID_COL).getValue() || '').trim(); } catch (_) { id = ''; }
    if (!id && backfill) { id = _visitIdNew_(rowNum); if (!_visitIdSet_(sheet, rowNum, id)) id = ''; }
    return id;
}
function _visitIdNew_(rowNum) { return 'V-' + Date.now().toString(36) + '-' + rowNum; }

/** Write a Visit ID to col AB (adds the column and its header if missing). Never throws; false if it could not. */
function _visitIdSet_(sheet, rowNum, id) {
    try {
        if (!id || !rowNum) return false;
        if (sheet.getMaxColumns() < VISIT_ID_COL) {
            sheet.insertColumnsAfter(sheet.getMaxColumns(), VISIT_ID_COL - sheet.getMaxColumns());
        }
        const hdr = sheet.getRange(1, VISIT_ID_COL);
        if (!String(hdr.getValue() || '').trim()) hdr.setValue(VISIT_ID_HEADER);
        sheet.getRange(rowNum, VISIT_ID_COL).setValue(_txt_(String(id)));   // __45_ (F83-5): text even if numeric
        return true;
    } catch (e) {
        _audit_('visitId:FAILED', '', rowNum, '', '', '', '', String(e).substring(0, 200));
        return false;
    }
}
