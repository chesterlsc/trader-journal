<?php
declare(strict_types=1);

session_start();
header('Content-Type: application/json; charset=utf-8');

$action = isset($_GET['action']) ? (string) $_GET['action'] : 'load';
$dataDir = __DIR__ . DIRECTORY_SEPARATOR . 'data';
$accountsDir = $dataDir . DIRECTORY_SEPARATOR . 'accounts';
$usersFile = $dataDir . DIRECTORY_SEPARATOR . 'users.json';

$defaults = [
    'settings' => [
        'journalName' => 'Chester',
        'startingBalance' => 10000,
        'balanceOverride' => 0,
        'dailyMaxLoss' => 300,
        'weeklyMaxLoss' => 1000,
        'riskPerTrade' => 1,
        'equityGoal' => 15000,
    ],
    'trades' => [],
    'reflections' => [],
    'replayNotes' => new stdClass(),
];

ensureDirectory($dataDir);
ensureDirectory($accountsDir);
ensureUsersFile($usersFile);

if ($action === 'session') {
    $username = currentUsername();
    respond(200, [
        'ok' => true,
        'authenticated' => $username !== null,
        'username' => $username,
    ]);
}

if ($action === 'register') {
    requireMethod('POST');
    [$username, $password] = readCredentials();

    $users = readUsers($usersFile);
    if (isset($users[$username])) {
        respond(409, ['ok' => false, 'error' => 'Username already exists.']);
    }

    $hash = password_hash($password, PASSWORD_DEFAULT);
    if ($hash === false) {
        respond(500, ['ok' => false, 'error' => 'Failed to secure password.']);
    }

    $users[$username] = [
        'passwordHash' => $hash,
        'createdAt' => date(DATE_ATOM),
    ];

    writeJsonFile($usersFile, $users, 'Failed to save user account.');

    $dataFile = userDataFile($accountsDir, $username);
    if (!file_exists($dataFile)) {
        writeJsonFile($dataFile, $defaults, 'Failed to initialize user journal.');
    }

    $_SESSION['username'] = $username;

    respond(200, ['ok' => true, 'username' => $username]);
}

if ($action === 'login') {
    requireMethod('POST');
    [$username, $password] = readCredentials();

    $users = readUsers($usersFile);
    $account = $users[$username] ?? null;

    if (!is_array($account) || !isset($account['passwordHash']) || !is_string($account['passwordHash'])) {
        respond(401, ['ok' => false, 'error' => 'Invalid username or password.']);
    }

    if (!password_verify($password, $account['passwordHash'])) {
        respond(401, ['ok' => false, 'error' => 'Invalid username or password.']);
    }

    $_SESSION['username'] = $username;

    $dataFile = userDataFile($accountsDir, $username);
    if (!file_exists($dataFile)) {
        writeJsonFile($dataFile, $defaults, 'Failed to initialize user journal.');
    }

    respond(200, ['ok' => true, 'username' => $username]);
}

if ($action === 'logout') {
    requireMethod('POST');

    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'], (bool) $params['secure'], (bool) $params['httponly']);
    }
    session_destroy();

    respond(200, ['ok' => true]);
}

if ($action === 'save') {
    requireMethod('POST');
    $username = requireAuth();

    $decoded = readJsonBody();

    $payload = [
        'updatedAt' => date(DATE_ATOM),
        'settings' => sanitizeSettings($decoded['settings'] ?? []),
        'trades' => sanitizeArray($decoded['trades'] ?? []),
        'reflections' => sanitizeArray($decoded['reflections'] ?? []),
        'replayNotes' => sanitizeObject($decoded['replayNotes'] ?? []),
    ];

    $dataFile = userDataFile($accountsDir, $username);
    writeJsonFile($dataFile, $payload, 'Failed to write journal data.');

    respond(200, ['ok' => true, 'message' => 'Journal data saved.', 'updatedAt' => $payload['updatedAt']]);
}

if ($action === 'load') {
    $username = requireAuth();
    $dataFile = userDataFile($accountsDir, $username);

    if (!file_exists($dataFile)) {
        respond(200, ['ok' => true, 'data' => $defaults]);
    }

    $content = file_get_contents($dataFile);
    if ($content === false) {
        respond(500, ['ok' => false, 'error' => 'Failed to read journal data file.']);
    }

    $decoded = json_decode($content, true);
    if (!is_array($decoded)) {
        respond(500, ['ok' => false, 'error' => 'Stored JSON is invalid.']);
    }

    $data = [
        'settings' => sanitizeSettings($decoded['settings'] ?? []),
        'trades' => sanitizeArray($decoded['trades'] ?? []),
        'reflections' => sanitizeArray($decoded['reflections'] ?? []),
        'replayNotes' => sanitizeObject($decoded['replayNotes'] ?? []),
    ];

    respond(200, ['ok' => true, 'data' => $data]);
}

respond(400, ['ok' => false, 'error' => 'Unknown action.']);

function currentUsername(): ?string
{
    $value = $_SESSION['username'] ?? null;
    return is_string($value) && $value !== '' ? $value : null;
}

function requireAuth(): string
{
    $username = currentUsername();
    if ($username === null) {
        respond(401, ['ok' => false, 'error' => 'Not authenticated. Please login first.']);
    }

    return $username;
}

function requireMethod(string $method): void
{
    if ($_SERVER['REQUEST_METHOD'] !== $method) {
        respond(405, ['ok' => false, 'error' => sprintf('Use %s for this action.', $method)]);
    }
}

function readCredentials(): array
{
    $decoded = readJsonBody();
    $usernameRaw = isset($decoded['username']) ? strtolower(trim((string) $decoded['username'])) : '';
    $password = isset($decoded['password']) ? (string) $decoded['password'] : '';

    if (!preg_match('/^[a-z0-9._-]{3,32}$/', $usernameRaw)) {
        respond(422, ['ok' => false, 'error' => 'Username must be 3-32 chars: letters, numbers, dot, underscore, dash.']);
    }

    if (strlen($password) < 8) {
        respond(422, ['ok' => false, 'error' => 'Password must be at least 8 characters.']);
    }

    return [$usernameRaw, $password];
}

function readJsonBody(): array
{
    $rawBody = file_get_contents('php://input');
    if ($rawBody === false || trim($rawBody) === '') {
        respond(400, ['ok' => false, 'error' => 'Empty request body.']);
    }

    $decoded = json_decode($rawBody, true);
    if (!is_array($decoded)) {
        respond(400, ['ok' => false, 'error' => 'Invalid JSON payload.']);
    }

    return $decoded;
}

function ensureDirectory(string $path): void
{
    if (!is_dir($path) && !mkdir($path, 0775, true) && !is_dir($path)) {
        respond(500, ['ok' => false, 'error' => 'Failed to create storage directory.']);
    }
}

function ensureUsersFile(string $usersFile): void
{
    if (!file_exists($usersFile)) {
        writeJsonFile($usersFile, new stdClass(), 'Failed to initialize users store.');
    }
}

function readUsers(string $usersFile): array
{
    $raw = file_get_contents($usersFile);
    if ($raw === false) {
        respond(500, ['ok' => false, 'error' => 'Failed to read users store.']);
    }

    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        return [];
    }

    return $decoded;
}

function userDataFile(string $accountsDir, string $username): string
{
    $safe = preg_replace('/[^a-z0-9._-]/', '_', strtolower($username));
    if (!is_string($safe) || $safe === '') {
        $safe = 'unknown';
    }

    return $accountsDir . DIRECTORY_SEPARATOR . $safe . '.json';
}

function writeJsonFile(string $file, $payload, string $errorMessage): void
{
    $json = json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    if ($json === false) {
        respond(500, ['ok' => false, 'error' => 'Failed to encode JSON payload.']);
    }

    $written = file_put_contents($file, $json . PHP_EOL, LOCK_EX);
    if ($written === false) {
        respond(500, ['ok' => false, 'error' => $errorMessage]);
    }
}

function sanitizeSettings(array $settings): array
{
    return [
        'journalName' => sanitizeJournalName($settings['journalName'] ?? 'Chester'),
        'startingBalance' => positiveNumber($settings['startingBalance'] ?? 10000, 10000),
        'balanceOverride' => nonNegativeNumber($settings['balanceOverride'] ?? 0, 0),
        'dailyMaxLoss' => nonNegativeNumber($settings['dailyMaxLoss'] ?? 300, 300),
        'weeklyMaxLoss' => nonNegativeNumber($settings['weeklyMaxLoss'] ?? 1000, 1000),
        'riskPerTrade' => nonNegativeNumber($settings['riskPerTrade'] ?? 1, 1),
        'equityGoal' => positiveNumber($settings['equityGoal'] ?? 15000, 15000),
    ];
}

function sanitizeJournalName($value): string
{
    $name = trim((string) $value);
    $collapsed = preg_replace('/\s+/', ' ', $name);
    if (is_string($collapsed)) {
        $name = $collapsed;
    }

    if ($name === '') {
        return 'Chester';
    }

    if (function_exists('mb_substr')) {
        return mb_substr($name, 0, 24);
    }

    return substr($name, 0, 24);
}

function sanitizeArray($value): array
{
    return is_array($value) ? $value : [];
}

function sanitizeObject($value)
{
    if (is_array($value)) {
        return $value;
    }

    if (is_object($value)) {
        return $value;
    }

    return new stdClass();
}

function positiveNumber($value, float $fallback): float
{
    if (!is_numeric($value)) {
        return $fallback;
    }

    $num = (float) $value;
    return $num > 0 ? $num : $fallback;
}

function nonNegativeNumber($value, float $fallback): float
{
    if (!is_numeric($value)) {
        return $fallback;
    }

    $num = (float) $value;
    return $num >= 0 ? $num : $fallback;
}

function respond(int $statusCode, array $payload): void
{
    http_response_code($statusCode);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}
