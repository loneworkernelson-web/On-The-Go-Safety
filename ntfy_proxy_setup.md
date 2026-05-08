# OTG AppSuite — ntfy Proxy: cPanel Deployment Guide

**Who this is for:** The OTG administrator (Russell) deploying the proxy to their own shared hosting.  
**Why:** ntfy.sh's fail2ban is blocking Google's trigger-path IP pool, so overdue-escalation ntfy pushes are failing. This proxy routes them through your hosting account's clean IP instead.

---

## What you'll need

- Access to a cPanel hosting account with a public HTTPS URL
- The OTG Factory App (to download a pre-configured `proxy_ntfy.php` and regenerate the backend)

---

## Step 1 — Download a pre-configured proxy_ntfy.php from the Factory

1. Open the OTG Factory App (Step 1).
2. Confirm your **Master Key** is populated (it should already be saved from your original deployment).
3. Scroll to the **ntfy Push Notification Server** section.
4. The **ntfy Proxy Secret** field will auto-populate with your Master Key — this is correct and requires no change unless you want a separate secret.
5. Click **⬇ Download Configured proxy_ntfy.php**.

The downloaded file has your proxy secret and ntfy server already embedded. No manual editing is required.

> **If you need a different secret:** Clear the Proxy Secret field and type your preferred value before downloading. Make sure the same value is in the Proxy Secret field when you regenerate the backend in Step 4.

---

## Step 2 — Upload the file to cPanel

1. Log in to your cPanel account.
2. Open **File Manager**.
3. Navigate to `public_html` (or any subdirectory you prefer, e.g. `public_html/otg`).
4. Click **Upload** and select the `proxy_ntfy.php` you downloaded.

The file's public URL will be something like:
- `https://yoursite.com/proxy_ntfy.php`
- or `https://yoursite.com/otg/proxy_ntfy.php` if you put it in a subdirectory

Note this URL — you'll need it in Step 3.

---

## Step 3 — Verify the file is accessible

Visit the proxy URL in your browser. You should see:

```
403 Forbidden
```

This is correct. The secret header is absent, so the proxy is correctly rejecting unauthenticated requests. If you see a PHP error or a 404, check the file was uploaded to the right location.

---

## Step 4 — Configure the Factory App and regenerate the backend

1. In the Factory App (Step 1), scroll to the ntfy section.
2. Enter the proxy URL from Step 2 in the **ntfy Proxy URL** field.
3. Confirm the **ntfy Proxy Secret** field still shows the value used when downloading the PHP file.
4. Proceed to the backend generation step and download the new `backend_template.js`.
5. Open your GAS project in Google Apps Script.
6. Replace the contents of `Code.gs` with the new script.
7. Deploy: **Deploy → Manage Deployments → New Deployment** (or update the existing deployment).

---

## Step 5 — Verify the proxy is working

1. In the GAS editor, run `runDiagnostics()` manually.
2. Open **View → Logs**.
3. Look for:
   ```
   ntfy push sent to topic: YourTopic (via proxy)
   ```

If you see `ntfy push rejected for topic "X": HTTP 403`, the secret in the backend doesn't match the PHP file. Re-download the PHP from the Factory, re-upload it, and redeploy the backend.

---

## Step 6 — Live test

Let a visit go overdue and confirm a push notification arrives on the relevant device. Check the GAS log confirms delivery via proxy.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `403 Forbidden` from proxy in GAS log | Secret mismatch between PHP file and backend | Re-download PHP from Factory, re-upload, redeploy backend |
| `502 Bad Gateway` in GAS log | cURL can't reach ntfy.sh from hosting | Check hosting allows outbound cURL; some hosts restrict it |
| `ntfy push failed ... Address unavailable` | Backend still using old (pre-proxy) script | Confirm backend was redeployed after regeneration |
| PHP error on proxy URL | PHP version issue | Hosting PHP must be 7.4+; check cPanel PHP settings |
| `403 Forbidden` in browser | Correct — expected without the secret header | No action needed |

---

## Notes

- The proxy script does not log or store any notification content.
- The proxy secret is embedded in the backend GAS script and is not visible to workers or contacts.
- Panic, Duress, and Critical Timing alarms are unaffected — they fire via the doPost path, which is not blocked. The proxy fixes standard overdue escalation tiers only.
- If you later move the proxy file to a different URL, update the Proxy URL field in the Factory, regenerate, and redeploy the backend.
