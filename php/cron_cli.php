<?php
// CLI cron dispatcher — e.g.: php cron_cli.php notification_runner send
// PHP CLI does not populate $_GET or $_SERVER['REQUEST_METHOD'], which the
// scheduled endpoints gate on; this wrapper sets both before requiring them.
if (php_sapi_name() !== 'cli') { http_response_code(403); exit('CLI only'); }
$endpoint = $argv[1] ?? '';
$action   = $argv[2] ?? '';
if (!in_array($endpoint, ['notification_runner', 'alerts', 'backup'], true)) { exit("bad endpoint\n"); }
if (!preg_match('/^[a-z_]+$/', $action)) { exit("bad action\n"); }
$_SERVER['REQUEST_METHOD'] = 'GET';
$_GET['action'] = $action;
require __DIR__ . '/' . $endpoint . '.php';
