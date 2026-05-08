<?php
/**
 * OTG AppSuite — ntfy Proxy
 * ============================================================
 * Upload this file to your cPanel hosting (public_html or any
 * subdirectory with a public HTTPS URL).
 *
 * SETUP — three steps:
 *   1. Set PROXY_SECRET below to any long random string
 *      (32+ characters recommended — treat it like a password).
 *   2. Upload this file to your hosting.
 *   3. In the OTG Factory App (Step 1), enter:
 *        ntfy Proxy URL    → https://yoursite.com/proxy_ntfy.php
 *        ntfy Proxy Secret → the same string you set below
 *      Then regenerate and redeploy the backend.
 *
 * VERIFY — visit the proxy URL in a browser. You should receive
 *   "403 Forbidden". This is correct — the secret header is absent.
 *   Run OTG Admin → Run System Diagnostics and check the GAS log
 *   for "ntfy push sent to topic: X (via proxy)".
 *
 * HOW IT WORKS
 *   GAS posts ntfy notifications to this script, passing the topic
 *   name as the last path segment and the shared secret in the
 *   X-Proxy-Secret header. This script verifies the secret, then
 *   forwards the request to ntfy.sh (or your self-hosted server)
 *   from this hosting account's own IP — bypassing ntfy.sh's
 *   block on Google's shared trigger-path IP pool.
 *
 * SELF-HOSTED NTFY
 *   If you run your own ntfy server, change NTFY_SERVER below to
 *   your server's URL (e.g. https://ntfy.yourorg.example.com).
 *   Self-hosted ntfy users generally don't need this proxy at all —
 *   just set the ntfy Server field in the Factory instead.
 *
 * SECURITY NOTES
 *   - This script does not log or store notification content.
 *   - Only the ntfy-specific headers (Title, Priority, Tags) and
 *     the message body are forwarded — no worker data is retained.
 *   - The PROXY_SECRET is never returned to the caller.
 * ============================================================
 */

define('PROXY_SECRET', 'REPLACE_WITH_YOUR_SECRET');  // ← Change this
define('NTFY_SERVER',  'https://ntfy.sh');             // ← Change if self-hosting ntfy

// ============================================================
// — No changes needed below this line —
// ============================================================

// Validate shared secret
$secret = $_SERVER['HTTP_X_PROXY_SECRET'] ?? '';
if ($secret !== PROXY_SECRET || PROXY_SECRET === 'REPLACE_WITH_YOUR_SECRET') {
    http_response_code(403);
    exit('Forbidden');
}

// Extract the topic name from the last path segment of the request URI
$path  = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH);
$topic = basename($path);

if ($topic === '' || $topic === 'proxy_ntfy.php') {
    http_response_code(400);
    exit('Bad Request: no topic');
}

// Read the message body from GAS
$body = file_get_contents('php://input');

// Forward ntfy-specific headers present in the GAS request
$headers = ['Content-Type: text/plain; charset=utf-8'];
foreach (['Title', 'Priority', 'Tags'] as $h) {
    $key = 'HTTP_' . strtoupper(str_replace('-', '_', $h));
    if (!empty($_SERVER[$key])) {
        $headers[] = "$h: {$_SERVER[$key]}";
    }
}

// POST to ntfy
$ch = curl_init(NTFY_SERVER . '/' . $topic);
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => $body,
    CURLOPT_HTTPHEADER     => $headers,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 10,
]);
$response = curl_exec($ch);
$code     = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err      = curl_error($ch);
curl_close($ch);

if ($err) {
    http_response_code(502);
    exit('Proxy error: ' . $err);
}

// Return ntfy's response code and body to GAS so _sendNtfy() can log accurately
http_response_code($code);
echo $response;
