# OTG AppSuite — ntfy Proxy: cPanel Deployment Guide

**Who this is for:** The OTG administrator (Russell) deploying the proxy to their own shared hosting.  
**Why:** ntfy.sh's fail2ban is blocking Google's trigger-path IP pool, so overdue-escalation ntfy pushes are failing. This proxy routes them through your hosting account's clean IP instead.

---

## What you'll need

- Access to a cPanel hosting account with a public HTTPS URL
- The file `proxy_ntfy.php` from the OTG AppSuite
- Access to the OTG Factory App to regenerate the backend

---

## Step 1 — Set your proxy secret

Open `proxy_ntfy.php` in a text editor and change this line:

```php
define('PROXY_SECRET', 'REPLACE_WITH_YOUR_SECRET');
```

Replace `REPLACE_WITH_YOUR_SECRET` with a long random string — at least 32 characters. Treat it like a password. Example:

```
mP9#xKv2!qLn7RtZ4dYe8cWj3FhA1sGu
```

Write this string down — you'll need to paste it into the Factory App in Step 4.

---

## Step 2 — Upload the file to cPanel

1. Log in to your cPanel account.
2. Open **File Manager**.
3. Navigate to `public_html` (or any subdirectory you prefer, e.g. `public_html/otg`).
4. Click **Upload** and select `proxy_ntfy.php`.

The file's public URL will be something like:
- `https://yoursite.com/proxy_ntfy.php`  
- or `https://yoursite.com/otg/proxy_ntfy.php` if you put it in a subdirectory

Note this URL — you'll need it in Step 4.

---

## Step 3 — Verify the file is accessible

Visit the proxy URL in your browser. You should see:

```
403 Forbidden
```

This is correct. The secret header is absent, so the proxy is correctly rejecting unauthenticated requests. If you see a PHP error or a 404, check the file was uploaded to the right location.

---

## Step 4 — Configure the Factory App

1. Open the OTG Factory App.
2. In **Step 1**, scroll down to the ntfy section.
3. Fill in the two new optional fields:
   - **ntfy Proxy URL** → the URL from Step 2 (e.g. `https://yoursite.com/proxy_ntfy.php`)
   - **ntfy Proxy Secret** → the string you set in `proxy_ntfy.php` in Step 1
4. Leave the **ntfy Push Notification Server** field as-is (blank = ntfy.sh).

---

## Step 5 — Regenerate and redeploy the backend

1. Click through to the backend generation step and download the new `backend_template.js`.
2. Open your GAS project in Google Apps Script.
3. Replace the contents of `Code.gs` (or your backend file) with the new script.
4. Click **Deploy → Manage Deployments → New Deployment** (or update the existing deployment).
5. Copy the new Web App URL if it changed, and update it in the Factory if prompted.

---

## Step 6 — Verify the proxy is working

1. In the GAS editor, run `checkOverdueVisits()` manually (or `runDiagnostics()`).
2. Open **View → Logs** (or Stackdriver).
3. Look for:
   ```
   ntfy push sent to topic: YourTopic (via proxy)
   ```
   
If you see that, the proxy is routing correctly.

If you see `ntfy push rejected for topic "X": HTTP 403`, double-check that the secret in `proxy_ntfy.php` and the Factory field match exactly (no extra spaces).

---

## Step 7 — Live test

Let a visit go overdue (or use the test visit workflow) and confirm a push notification arrives on the relevant device. Check the GAS log confirms delivery via proxy.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `403 Forbidden` from proxy in GAS log | Secret mismatch | Check secret in `proxy_ntfy.php` matches Factory field exactly |
| `502 Bad Gateway` in GAS log | cURL can't reach ntfy.sh from hosting | Check hosting allows outbound cURL; some hosts restrict it |
| `ntfy push failed ... Address unavailable` | Backend still using old script | Confirm backend was redeployed after regeneration |
| Browser shows PHP error on proxy URL | PHP version issue | Hosting PHP must be 7.4 or later; check cPanel PHP settings |
| `403 Forbidden` in browser | Correct — this is expected without the secret header | No action needed |

---

## Notes

- The proxy script does not log or store any notification content.
- The `PROXY_SECRET` is embedded in the backend GAS script (not visible to workers).
- If you later move the proxy file to a different URL, update the Factory field and redeploy the backend.
- Panic, Duress, and Critical Timing alarms are not affected by this issue — they fire via the doPost path, which is not blocked. The proxy fixes standard overdue escalation tiers only.
