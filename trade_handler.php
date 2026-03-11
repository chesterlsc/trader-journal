<?php
declare(strict_types=1);

session_start();
header('Content-Type: application/json; charset=utf-8');

$action = isset($_GET['action']) ? (string) $_GET['action'] : 'load';

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

try {
    $pdo = createPdoFromEnvironment();
    ensureSchema($pdo);
} catch (Throwable $error) {
    respond(500, ['ok' => false, 'error' => debugMessage('Database connection failed. Check DATABASE_URL.', $error)]);
}

try {
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

        $hash = password_hash($password, PASSWORD_DEFAULT);
        if (!is_string($hash) || $hash === '') {
            respond(500, ['ok' => false, 'error' => 'Failed to secure password.']);
        }

        try {
            $pdo->beginTransaction();
            $stmt = $pdo->prepare(
                'INSERT INTO journal_users (username, password_hash) VALUES (:username, :password_hash) RETURNING id'
            );
            $stmt->execute([
                ':username' => $username,
                ':password_hash' => $hash,
            ]);
            $userId = (int) $stmt->fetchColumn();
            if ($userId <= 0) {
                throw new RuntimeException('Failed to create account id.');
            }

            upsertJournalData($pdo, $userId, $defaults);
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }

            if (isUniqueViolation($error)) {
                respond(409, ['ok' => false, 'error' => 'Username already exists.']);
            }

            throw $error;
        }

        $_SESSION['username'] = $username;
        $_SESSION['user_id'] = $userId;
        logLoginEvent($pdo, $userId, $username, 'register', true);

        respond(200, ['ok' => true, 'username' => $username]);
    }

    if ($action === 'login') {
        requireMethod('POST');
        [$username, $password] = readCredentials();

        $user = findUserByUsername($pdo, $username);
        if ($user === null || !password_verify($password, $user['passwordHash'])) {
            logLoginEvent($pdo, $user['id'] ?? null, $username, 'login', false);
            respond(401, ['ok' => false, 'error' => 'Invalid username or password.']);
        }

        $_SESSION['username'] = $user['username'];
        $_SESSION['user_id'] = $user['id'];

        ensureJournalDataRow($pdo, $user['id'], $defaults);
        logLoginEvent($pdo, $user['id'], $user['username'], 'login', true);

        respond(200, ['ok' => true, 'username' => $user['username']]);
    }

    if ($action === 'logout') {
        requireMethod('POST');
        $username = currentUsername();
        if ($username !== null) {
            $sessionUserId = $_SESSION['user_id'] ?? null;
            $userId = (is_int($sessionUserId) || (is_string($sessionUserId) && ctype_digit($sessionUserId)))
                ? (int) $sessionUserId
                : null;
            logLoginEvent($pdo, $userId, $username, 'logout', true);
        }
        clearAuthSession();
        respond(200, ['ok' => true]);
    }

    if ($action === 'save') {
        requireMethod('POST');
        $auth = requireAuth($pdo);

        $decoded = readJsonBody();
        $payload = [
            'settings' => sanitizeSettings($decoded['settings'] ?? []),
            'trades' => sanitizeArray($decoded['trades'] ?? []),
            'reflections' => sanitizeArray($decoded['reflections'] ?? []),
            'replayNotes' => sanitizeReplayNotes($decoded['replayNotes'] ?? []),
        ];

        upsertJournalData($pdo, $auth['id'], $payload);

        respond(200, ['ok' => true, 'message' => 'Journal data saved.', 'updatedAt' => date(DATE_ATOM)]);
    }

    if ($action === 'load') {
        $auth = requireAuth($pdo);
        $data = loadJournalData($pdo, $auth['id'], $defaults);
        respond(200, ['ok' => true, 'data' => $data]);
    }

    if ($action === 'login_logs') {
        $auth = requireAuth($pdo);
        $logs = listLoginEventsForUser($pdo, $auth['id'], $auth['username']);
        respond(200, ['ok' => true, 'logs' => $logs]);
    }

    respond(400, ['ok' => false, 'error' => 'Unknown action.']);
} catch (Throwable $error) {
    respond(500, ['ok' => false, 'error' => debugMessage('Server operation failed.', $error)]);
}

function createPdoFromEnvironment(): PDO
{
    $databaseUrl = trim((string) getenv('DATABASE_URL'));
    if ($databaseUrl !== '') {
        return createPdoFromDatabaseUrl($databaseUrl);
    }

    $host = trim((string) getenv('PGHOST'));
    $port = trim((string) getenv('PGPORT'));
    $database = trim((string) getenv('PGDATABASE'));
    $user = trim((string) getenv('PGUSER'));
    $password = (string) getenv('PGPASSWORD');
    $sslmode = trim((string) getenv('PGSSLMODE'));

    if ($host === '' || $database === '' || $user === '') {
        throw new RuntimeException('Missing PGHOST/PGDATABASE/PGUSER or DATABASE_URL.');
    }

    $dsn = sprintf('pgsql:host=%s;port=%s;dbname=%s', $host, $port !== '' ? $port : '5432', $database);
    if ($sslmode !== '') {
        $dsn .= ';sslmode=' . $sslmode;
    }

    return new PDO($dsn, $user, $password, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
}

function createPdoFromDatabaseUrl(string $databaseUrl): PDO
{
    $parts = parse_url($databaseUrl);
    if ($parts === false) {
        throw new RuntimeException('Invalid DATABASE_URL format.');
    }

    $scheme = strtolower((string) ($parts['scheme'] ?? ''));
    if (!in_array($scheme, ['postgres', 'postgresql', 'pgsql'], true)) {
        throw new RuntimeException('DATABASE_URL must use postgres:// scheme.');
    }

    $host = (string) ($parts['host'] ?? '');
    $port = (int) ($parts['port'] ?? 5432);
    $database = ltrim((string) ($parts['path'] ?? ''), '/');
    $user = urldecode((string) ($parts['user'] ?? ''));
    $password = urldecode((string) ($parts['pass'] ?? ''));
    $query = [];
    parse_str((string) ($parts['query'] ?? ''), $query);

    if ($host === '' || $database === '' || $user === '') {
        throw new RuntimeException('DATABASE_URL missing host/database/user.');
    }

    $dsn = sprintf('pgsql:host=%s;port=%d;dbname=%s', $host, $port, $database);
    if (isset($query['sslmode']) && is_string($query['sslmode']) && $query['sslmode'] !== '') {
        $dsn .= ';sslmode=' . $query['sslmode'];
    }

    return new PDO($dsn, $user, $password, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
}

function ensureSchema(PDO $pdo): void
{
    $pdo->exec(
        <<<SQL
        CREATE TABLE IF NOT EXISTS journal_users (
            id BIGSERIAL PRIMARY KEY,
            username VARCHAR(32) NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        SQL
    );

    $pdo->exec(
        <<<SQL
        CREATE TABLE IF NOT EXISTS journal_data (
            user_id BIGINT PRIMARY KEY REFERENCES journal_users(id) ON DELETE CASCADE,
            settings JSONB NOT NULL DEFAULT '{}'::jsonb,
            trades JSONB NOT NULL DEFAULT '[]'::jsonb,
            reflections JSONB NOT NULL DEFAULT '[]'::jsonb,
            replay_notes JSONB NOT NULL DEFAULT '{}'::jsonb,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        SQL
    );

    $pdo->exec(
        <<<SQL
        CREATE TABLE IF NOT EXISTS journal_login_events (
            id BIGSERIAL PRIMARY KEY,
            user_id BIGINT NULL REFERENCES journal_users(id) ON DELETE SET NULL,
            username VARCHAR(32) NOT NULL,
            event_type VARCHAR(24) NOT NULL,
            success BOOLEAN NOT NULL DEFAULT TRUE,
            ip_address INET NULL,
            user_agent TEXT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        SQL
    );

    $pdo->exec(
        'CREATE INDEX IF NOT EXISTS idx_journal_login_events_created_at ON journal_login_events (created_at DESC)'
    );
    $pdo->exec(
        'CREATE INDEX IF NOT EXISTS idx_journal_login_events_username ON journal_login_events (username)'
    );
}

function currentUsername(): ?string
{
    $value = $_SESSION['username'] ?? null;
    return is_string($value) && $value !== '' ? $value : null;
}

function requireAuth(PDO $pdo): array
{
    $username = currentUsername();
    if ($username === null) {
        respond(401, ['ok' => false, 'error' => 'Not authenticated. Please login first.']);
    }

    $sessionUserId = $_SESSION['user_id'] ?? null;
    if (is_int($sessionUserId) || (is_string($sessionUserId) && ctype_digit($sessionUserId))) {
        return [
            'id' => (int) $sessionUserId,
            'username' => $username,
        ];
    }

    $user = findUserByUsername($pdo, $username);
    if ($user === null) {
        clearAuthSession();
        respond(401, ['ok' => false, 'error' => 'Session expired. Please login again.']);
    }

    $_SESSION['user_id'] = $user['id'];

    return [
        'id' => $user['id'],
        'username' => $user['username'],
    ];
}

function clearAuthSession(): void
{
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(
            session_name(),
            '',
            time() - 42000,
            $params['path'],
            $params['domain'],
            (bool) $params['secure'],
            (bool) $params['httponly']
        );
    }
    session_destroy();
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

function findUserByUsername(PDO $pdo, string $username): ?array
{
    $stmt = $pdo->prepare(
        'SELECT id, username, password_hash FROM journal_users WHERE username = :username LIMIT 1'
    );
    $stmt->execute([':username' => $username]);
    $row = $stmt->fetch();
    if (!is_array($row)) {
        return null;
    }

    return [
        'id' => (int) $row['id'],
        'username' => (string) $row['username'],
        'passwordHash' => (string) $row['password_hash'],
    ];
}

function logLoginEvent(PDO $pdo, ?int $userId, string $username, string $eventType, bool $success): void
{
    $stmt = $pdo->prepare(
        <<<SQL
        INSERT INTO journal_login_events (user_id, username, event_type, success, ip_address, user_agent)
        VALUES (:user_id, :username, :event_type, :success, CAST(:ip_address AS inet), :user_agent)
        SQL
    );

    $ip = clientIpAddress();
    $stmt->execute([
        ':user_id' => $userId,
        ':username' => substr(strtolower(trim($username)), 0, 32),
        ':event_type' => substr($eventType, 0, 24),
        ':success' => $success,
        ':ip_address' => $ip,
        ':user_agent' => userAgentString(),
    ]);
}

function listLoginEventsForUser(PDO $pdo, int $userId, string $username): array
{
    $stmt = $pdo->prepare(
        <<<SQL
        SELECT
            id,
            username,
            event_type,
            success,
            COALESCE(ip_address::text, '') AS ip_address,
            COALESCE(user_agent, '') AS user_agent,
            created_at::text AS created_at
        FROM journal_login_events
        WHERE user_id = :user_id OR username = :username
        ORDER BY created_at DESC
        LIMIT 200
        SQL
    );

    $stmt->execute([
        ':user_id' => $userId,
        ':username' => $username,
    ]);

    $rows = $stmt->fetchAll();
    return is_array($rows) ? $rows : [];
}

function ensureJournalDataRow(PDO $pdo, int $userId, array $defaults): void
{
    $stmt = $pdo->prepare('SELECT user_id FROM journal_data WHERE user_id = :user_id LIMIT 1');
    $stmt->execute([':user_id' => $userId]);
    $existing = $stmt->fetchColumn();
    if ($existing !== false) {
        return;
    }

    upsertJournalData($pdo, $userId, $defaults);
}

function loadJournalData(PDO $pdo, int $userId, array $defaults): array
{
    $stmt = $pdo->prepare(
        'SELECT settings::text AS settings, trades::text AS trades, reflections::text AS reflections, replay_notes::text AS replay_notes FROM journal_data WHERE user_id = :user_id LIMIT 1'
    );
    $stmt->execute([':user_id' => $userId]);
    $row = $stmt->fetch();

    if (!is_array($row)) {
        upsertJournalData($pdo, $userId, $defaults);
        return $defaults;
    }

    $settings = json_decode((string) ($row['settings'] ?? ''), true);
    $trades = json_decode((string) ($row['trades'] ?? ''), true);
    $reflections = json_decode((string) ($row['reflections'] ?? ''), true);
    $replayNotes = json_decode((string) ($row['replay_notes'] ?? ''), true);

    return [
        'settings' => sanitizeSettings(is_array($settings) ? $settings : []),
        'trades' => sanitizeArray($trades),
        'reflections' => sanitizeArray($reflections),
        'replayNotes' => sanitizeReplayNotes($replayNotes),
    ];
}

function upsertJournalData(PDO $pdo, int $userId, array $payload): void
{
    $settingsJson = encodeJsonForDb(sanitizeSettings($payload['settings'] ?? []));
    $tradesJson = encodeJsonForDb(sanitizeArray($payload['trades'] ?? []));
    $reflectionsJson = encodeJsonForDb(sanitizeArray($payload['reflections'] ?? []));
    $replayNotesJson = encodeJsonForDb(sanitizeReplayNotes($payload['replayNotes'] ?? []));

    $stmt = $pdo->prepare(
        <<<SQL
        INSERT INTO journal_data (user_id, settings, trades, reflections, replay_notes, updated_at)
        VALUES (
            :user_id,
            CAST(:settings AS jsonb),
            CAST(:trades AS jsonb),
            CAST(:reflections AS jsonb),
            CAST(:replay_notes AS jsonb),
            NOW()
        )
        ON CONFLICT (user_id) DO UPDATE SET
            settings = EXCLUDED.settings,
            trades = EXCLUDED.trades,
            reflections = EXCLUDED.reflections,
            replay_notes = EXCLUDED.replay_notes,
            updated_at = NOW()
        SQL
    );

    $stmt->execute([
        ':user_id' => $userId,
        ':settings' => $settingsJson,
        ':trades' => $tradesJson,
        ':reflections' => $reflectionsJson,
        ':replay_notes' => $replayNotesJson,
    ]);
}

function encodeJsonForDb($value): string
{
    $json = json_encode($value, JSON_UNESCAPED_SLASHES);
    if (!is_string($json)) {
        respond(500, ['ok' => false, 'error' => 'Failed to encode JSON payload.']);
    }

    return $json;
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

function sanitizeReplayNotes($value): array
{
    if (is_object($value)) {
        $value = get_object_vars($value);
    }

    if (!is_array($value)) {
        return [];
    }

    $result = [];
    foreach ($value as $key => $item) {
        $result[(string) $key] = is_scalar($item) || $item === null ? (string) ($item ?? '') : '';
    }

    return $result;
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

function isUniqueViolation(Throwable $error): bool
{
    if (!$error instanceof PDOException) {
        return false;
    }

    $sqlState = (string) ($error->errorInfo[0] ?? '');
    return $sqlState === '23505';
}

function debugMessage(string $baseMessage, Throwable $error): string
{
    $debug = strtolower(trim((string) getenv('APP_DEBUG')));
    if ($debug === '1' || $debug === 'true' || $debug === 'yes') {
        return $baseMessage . ' ' . $error->getMessage();
    }

    return $baseMessage;
}

function clientIpAddress(): ?string
{
    $forwarded = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '';
    if (is_string($forwarded) && $forwarded !== '') {
        $parts = explode(',', $forwarded);
        $candidate = trim((string) ($parts[0] ?? ''));
        if ($candidate !== '' && filter_var($candidate, FILTER_VALIDATE_IP)) {
            return $candidate;
        }
    }

    $remote = $_SERVER['REMOTE_ADDR'] ?? '';
    if (is_string($remote) && $remote !== '' && filter_var($remote, FILTER_VALIDATE_IP)) {
        return $remote;
    }

    return null;
}

function userAgentString(): string
{
    $ua = $_SERVER['HTTP_USER_AGENT'] ?? '';
    return substr(is_string($ua) ? $ua : '', 0, 500);
}

function respond(int $statusCode, array $payload): void
{
    http_response_code($statusCode);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}
