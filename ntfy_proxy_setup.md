# OTG AppSuite - ntfy Proxy: cPanel Deployment Guide

**Who this is for:** The OTG administrator deploying the proxy to their own shared hosting.  
**Why:** ntfy.sh's fail2ban can block Google's trigger-path IP pool, so overdue-escalation ntfy pushes fail. This proxy routes them through your hosting account's clean IP instead.

---

## Already have a proxy? Read this first

The proxy must forward **five** headers: `Title`, `Priority`, `Tags`, **`Click`** and **`Actions`**. Click and Actions carry the tap-to-call and map buttons on contacts' alerts and, when `WORKER_APP_URL` is set in the Settings tab, the tap action on worker phone reminders.

An older proxy forwards only the first three. **Without the change below the buttons are silently dropped.** The alert itself still arrives, so nothing looks broken.

Choose one:

1. **Edit one line** in the live `proxy_ntfy.php` on your hosting. Find
   ```php
   foreach (['Title', 'Priority', 'Tags'] as $h) {
   ```
   and change it to
   ```php
   foreach (['Title', 'Priority', 'Tags', 'Click', 'Actions'] as $h) {
   ```
   Save. No backend redeploy is needed.
2. **Or upload a new file:** in the Factory (Step 1, ntfy section) use **Download Configured proxy_ntfy.php**, which has your secret and server already embedded, and replace the file on your hosting.

Then send a normal test alert (a test contact message from the worker app) and check that the call and map buttons appear on the contact's phone.

---

## What you'll need

- Access to a cPanel hosting account with a public HTTPS URL
- The file `proxy_ntfy.php` (the Factory can generate a ready-configured copy - see Step 1)
- Access to the OTG Factory App to regenerate the backend

---

## Step 1 - Set your proxy secret

**Easiest:** in the Factory (Step 1, ntfy section) click **Download Configured proxy_ntfy.php**. The secret and ntfy server are already in the file, so you can skip to Step 2.

**By hand:** open `proxy_ntfy.php` in a text editor and change this line:

```php
define('PROXY_SECRET', 'REPLACE_WITH_YOUR_SECRET');
```

Replace `REPLACE_WITH_YOUR_SECRET` with a long random string - at least 32 characters. Treat it like a password. Write it down: you will paste it into the Factory in Step 4.

---

## Step 2 - Upload the file to cPanel

1. Log in to your cPanel account.
2. Open **File Manager**.
3. Navigate to `public_html` (or any subdirectory you prefer, e.g. `public_html/otg`).
4. Click **Upload** and select `proxy_ntfy.php`.

The file's public URL will be something like `https://yoursite.com/proxy_ntfy.php` (or `https://yoursite.com/otg/proxy_ntfy.php` in a subdirectory). Note this URL for Step 4.

---

## Step 3 - Verify the file is accessible

Visit the proxy URL in your browser. You should see:

```
403 Forbidden
```

This is correct. The secret header is absent, so the proxy correctly rejects the request. If you see a PHP error or a 404, check the file was uploaded to the right place.

---

## Step 4 - Configure the Factory App

1. Open the OTG Factory App.
2. In **Step 1**, scroll down to the ntfy section.
3. Fill in the two optional fields:
   - **ntfy Proxy URL** - the URL from Step 2
   - **ntfy Proxy Secret** - the string from Step 1
4. Leave the **ntfy Push Notification Server** field as it is (blank = ntfy.sh).

---

## Step 5 - Regenerate and redeploy the backend

1. Click through to the backend generation step and download the new `backend_template.js`.
2. Open your Apps Script project and replace the backend code with the new script.
3. Click **Deploy > Manage deployments**, edit the existing deployment and choose **New version** (or create a new deployment).
4. If the Web App URL changed, update it in the Factory.

---

## Step 6 - Verify the proxy is working

1. In the Apps Script editor, run `checkOverdueVisits()` manually (or the System Diagnostics from the OTG Admin menu).
2. Open **Executions** (or the log) and look for:
   ```
   ntfy push sent to topic: YourTopic (via proxy)
   ```

If you see `ntfy push rejected for topic "X": HTTP 403`, check that the secret in `proxy_ntfy.php` and the Factory field match exactly (no extra spaces).

---

## Step 7 - Live test

Let a visit go overdue (or use a test visit) and confirm a push notification arrives on the contact's phone, with the **Call** and **Map** buttons. Check the log confirms delivery via the proxy.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `403 Forbidden` from proxy in the log | Secret mismatch | Check the secret in `proxy_ntfy.php` matches the Factory field exactly |
| `502 Bad Gateway` in the log | cURL cannot reach ntfy.sh from the hosting | Check the hosting allows outbound cURL; some hosts restrict it |
| `ntfy push failed ... Address unavailable` | Backend still using the old script | Confirm the backend was redeployed after regeneration |
| Alerts arrive but **without call or map buttons** | Proxy still forwards only Title, Priority and Tags | Make the one-line change at the top of this guide, or upload the new file |
| Worker reminders do nothing when tapped | `WORKER_APP_URL` is blank, or the proxy drops Click | Blank is the safe default (the worker opens the app). If you set it, use the full address including `index.html`, and update the proxy |
| Browser shows a PHP error on the proxy URL | PHP version | Hosting PHP must be 7.4 or later |
| `403 Forbidden` in a browser | Expected without the secret header | No action needed |

---

## Notes

- The proxy does not log or store any notification content.
- The `PROXY_SECRET` is embedded in the backend script (not visible to workers).
- If you move the proxy file to a different URL, update the Factory field and redeploy the backend.
- Panic, Duress and Critical Timing alarms are not affected by the blocking problem - they fire from the doPost path, which is not blocked. The proxy fixes the standard overdue tiers (and the worker's phone reminders, which are also sent by the time-based trigger).
