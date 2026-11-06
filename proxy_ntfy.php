<?php
/**
 * OTG AppSuite — ntfy Proxy  (proxy_ntfy__3_, for backend __60_ or later; works with older backends too)
 * ============================================================
 * Upload this file to your cPanel hosting (public_html or any
 * subdirectory with a public HTTPS URL), named proxy_ntfy.php.
 *
 * UPDATING FROM AN EARLIER proxy_ntfy.php
 *   Copy the two define(...) lines (PROXY_SECRET and NTFY_SERVER)
 *   from your current file into this one, then upload it over the
 *   old file. Nothing else changes - the backend and the phones
 *   keep working throughout.
 *
 * SETUP — three steps (new installation):
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
 *   1. Pushes: GAS posts ntfy notifications to this script, passing
 *      the topic name as the last path segment and the shared secret
 *      in the X-Proxy-Secret header. This script verifies the secret,
 *      then forwards the request to ntfy.sh (or your self-hosted
 *      server) from this hosting account's own IP — bypassing
 *      ntfy.sh's block on Google's shared trigger-path IP pool.
 *   2. 3-word locations (new in __3_, backend __60_): just before an
 *      alarm push, the backend asks this script for the what3words
 *      3-word address of the worker's GPS fix (?w3w=lat,lng). This
 *      script asks what3words and GIVES UP AFTER 3 SECONDS, so an
 *      alarm push is never held up longer than that. Google's own
 *      scripts cannot set a time limit on a web request - this is
 *      why the limit lives here. Only api.what3words.com is ever
 *      called; the coordinates and the key are checked first.
 *
 * SELF-HOSTED NTFY
 *   If you run your own ntfy server, change NTFY_SERVER below to
 *   your server's URL (e.g. https://ntfy.yourorg.example.com).
 *
 * SECURITY NOTES
 *   - This script does not log or store notification content,
 *     coordinates or keys.
 *   - Only the ntfy-specific headers (Title, Priority, Tags, Click,
 *     Actions) and the message body are forwarded.
 *   - Only a caller holding the PROXY_SECRET can send a push or ask
 *     for a 3-word address. The secret is never returned.
 * ============================================================
 */
 
define('PROXY_SECRET', 'REPLACE_WITH_YOUR_SECRET');  // ← Change this (or copy the line from your current file)
define('NTFY_SERVER',  'https://ntfy.sh');             // ← Change if self-hosting ntfy
 
// ============================================================
// — No changes needed below this line —
// ============================================================
if (!defined('W3W_API'))        define('W3W_API', 'https://api.what3words.com/v3/convert-to-3wa');
if (!defined('W3W_TIMEOUT_MS')) define('W3W_TIMEOUT_MS', 3000);   // Russell, 5 Nov 2026: wait at most 3 seconds
 
// Validate shared secret
$secret = $_SERVER['HTTP_X_PROXY_SECRET'] ?? '';
if ($secret !== PROXY_SECRET || PROXY_SECRET === 'REPLACE_WITH_YOUR_SECRET') {
    http_response_code(403);
    exit('Forbidden');
}
 
// __3_: what3words lookup for the backend, capped at W3W_TIMEOUT_MS. Always answers JSON {words, error, ms}.
if (isset($_GET['w3w'])) {
    header('Content-Type: application/json; charset=utf-8');
    $coords = (string)$_GET['w3w'];
    $key    = (string)($_SERVER['HTTP_X_W3W_KEY'] ?? '');
    if (!preg_match('/^-?\d{1,2}(\.\d{1,8})?,-?\d{1,3}(\.\d{1,8})?$/', $coords) || !preg_match('/^[A-Za-z0-9]{8,64}$/', $key)) {
        http_response_code(400);
        echo json_encode(['words' => null, 'error' => 'bad request', 'ms' => 0]);
        exit;
    }
    $t0 = microtime(true);
    $ch = curl_init(W3W_API . '?coordinates=' . rawurlencode($coords) . '&key=' . rawurlencode($key));
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER    => true,
        CURLOPT_NOSIGNAL          => true,              // needed for millisecond time limits on some hosts
        CURLOPT_CONNECTTIMEOUT_MS => min(2000, W3W_TIMEOUT_MS),
        CURLOPT_TIMEOUT_MS        => W3W_TIMEOUT_MS,
        CURLOPT_FOLLOWLOCATION    => false,
    ]);
    $resp  = curl_exec($ch);
    $code  = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $errno = curl_errno($ch);
    curl_close($ch);
    $ms = (int)round((microtime(true) - $t0) * 1000);
    if ($errno) {
        echo json_encode(['words' => null, 'error' => ($errno === 28 ? 'timeout' : 'curl ' . $errno), 'ms' => $ms]);
        exit;
    }
    $j = json_decode((string)$resp, true);
    $w = (is_array($j) && isset($j['words']) && is_string($j['words'])) ? $j['words'] : null;
    echo json_encode(['words' => $w, 'error' => ($w ? null : 'what3words HTTP ' . $code), 'ms' => $ms]);
    exit;
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
// (Click and Actions added for tap-to-call; older callers that do not send them are unaffected)
$headers = ['Content-Type: text/plain; charset=utf-8'];
foreach (['Title', 'Priority', 'Tags', 'Click', 'Actions'] as $h) {
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
 
