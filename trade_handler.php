<?php
declare(strict_types=1);

session_start();
header('Content-Type: application/json; charset=utf-8');

$action = isset($_GET['action']) ? (string) $_GET['action'] : 'load';

$defaults = [
    'settings' => [
        'journalName' => 'Your',
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
    respond(500, ['ok' => false, 'error' => debugMessage('Database initialization failed. Check DATABASE_URL and table schema.', $error)]);
}

try {
    if ($action === 'session') {
        $username = currentUsername();
        $isAdmin = $username !== null ? isAdminUsername($pdo, $username) : false;
        respond(200, [
            'ok' => true,
            'authenticated' => $username !== null,
            'username' => $username,
            'isAdmin' => $isAdmin,
        ]);
    }

    if ($action === 'register') {
        requireMethod('POST');
        [$identifier, $password, $email] = readCredentials(true);
        $username = resolveRegistrationUsername($pdo, $identifier, $email);

        $hash = password_hash($password, PASSWORD_DEFAULT);
        if (!is_string($hash) || $hash === '') {
            respond(500, ['ok' => false, 'error' => 'Failed to secure password.']);
        }

        try {
            $pdo->beginTransaction();
            $stmt = $pdo->prepare(
                'INSERT INTO journal_users (username, email, auth_provider, password_hash) VALUES (:username, :email, :auth_provider, :password_hash) RETURNING id'
            );
            $stmt->execute([
                ':username' => $username,
                ':email' => $email !== '' ? $email : null,
                ':auth_provider' => 'email',
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
                respond(409, ['ok' => false, 'error' => 'Account already exists for that username or email.']);
            }

            throw $error;
        }

        $_SESSION['username'] = $username;
        $_SESSION['user_id'] = $userId;
        logLoginEvent($pdo, $userId, $username, 'register', true);

        respond(200, ['ok' => true, 'username' => $username, 'isAdmin' => isAdminUsername($pdo, $username)]);
    }

    if ($action === 'login') {
        requireMethod('POST');
        [$identifier, $password] = readCredentials(false);
        $username = $identifier;

        $user = findUserByIdentifier($pdo, $username);
        if ($user === null || !password_verify($password, $user['passwordHash'])) {
            logLoginEvent($pdo, $user['id'] ?? null, $username, 'login', false);
            respond(401, ['ok' => false, 'error' => 'Invalid username or password.']);
        }

        $_SESSION['username'] = $user['username'];
        $_SESSION['user_id'] = $user['id'];

        ensureJournalDataRow($pdo, $user['id'], $defaults);
        logLoginEvent($pdo, $user['id'], $user['username'], 'login', true);

        respond(200, ['ok' => true, 'username' => $user['username'], 'isAdmin' => isAdminUsername($pdo, $user['username'])]);
    }

    if ($action === 'forgot_password') {
        requireMethod('POST');
        $decoded = readJsonBody();
        $email = strtolower(trim((string) ($decoded['email'] ?? '')));
        if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            respond(422, ['ok' => false, 'error' => 'Enter a valid email address.']);
        }

        ensurePasswordResetRequest($pdo, $email);
        respond(200, ['ok' => true, 'message' => 'If the email exists, a reset request has been recorded.']);
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
        if (!isAdminUsername($pdo, $auth['username'])) {
            respond(403, ['ok' => false, 'error' => 'Admin access required.']);
        }
        $logs = listAdminLoginEvents($pdo);
        respond(200, ['ok' => true, 'logs' => $logs]);
    }

    if ($action === 'users_admin') {
        $auth = requireAuth($pdo);
        if (!isAdminUsername($pdo, $auth['username'])) {
            respond(403, ['ok' => false, 'error' => 'Admin access required.']);
        }
        $users = listAdminUsers($pdo);
        respond(200, ['ok' => true, 'users' => $users]);
    }

    respond(400, ['ok' => false, 'error' => 'Unknown action.']);
} catch (Throwable $error) {
    respond(500, ['ok' => false, 'error' => debugMessage('Server operation failed.', $error)]);
}

function createPdoFromEnvironment(): PDO
{
    ensurePgsqlDriverLoaded();

    $urlCandidates = [
        getenv('DATABASE_URL'),
        getenv('DATABASE_PRIVATE_URL'),
        getenv('POSTGRES_URL'),
        getenv('POSTGRESQL_URL'),
        getenv('DATABASE_PUBLIC_URL'),
    ];

    $errors = [];
    foreach ($urlCandidates as $candidate) {
        $url = sanitizeConnectionString(is_string($candidate) ? $candidate : '');
        if ($url === '') {
            continue;
        }

        try {
            return createPdoFromDatabaseUrl($url);
        } catch (Throwable $error) {
            $errors[] = $error->getMessage();
        }
    }

    $host = trim((string) getenv('PGHOST'));
    $port = trim((string) getenv('PGPORT'));
    $database = trim((string) getenv('PGDATABASE'));
    $user = trim((string) getenv('PGUSER'));
    $password = (string) getenv('PGPASSWORD');
    $sslmode = trim((string) getenv('PGSSLMODE'));

    if ($host === '' || $database === '' || $user === '') {
        if (count($errors) > 0) {
            throw new RuntimeException('Unable to connect using URL env vars: ' . implode(' | ', array_slice($errors, 0, 3)));
        }
        throw new RuntimeException('Missing DB env vars. Set DATABASE_URL (or DATABASE_PRIVATE_URL) on app service.');
    }

    $dsn = sprintf('pgsql:host=%s;port=%s;dbname=%s', $host, $port !== '' ? $port : '5432', $database);
    $dsn .= ';sslmode=' . resolveSslMode($host, $sslmode);

    return new PDO($dsn, $user, $password, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
}

function createPdoFromDatabaseUrl(string $databaseUrl): PDO
{
    $sanitizedUrl = sanitizeConnectionString($databaseUrl);
    $parts = parse_url($sanitizedUrl);
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
    $querySsl = isset($query['sslmode']) && is_string($query['sslmode']) ? trim($query['sslmode']) : '';
    $envSsl = trim((string) getenv('PGSSLMODE'));
    $dsn .= ';sslmode=' . resolveSslMode($host, $querySsl !== '' ? $querySsl : $envSsl);

    return new PDO($dsn, $user, $password, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
}

function sanitizeConnectionString(string $value): string
{
    $trimmed = trim($value);
    if ($trimmed === '') {
        return '';
    }

    $quoted = preg_replace('/^(["\'])(.*)\1$/', '$2', $trimmed);
    $result = is_string($quoted) ? trim($quoted) : $trimmed;

    if (str_contains($result, '${') || str_contains($result, '<')) {
        return '';
    }

    return $result;
}

function ensurePgsqlDriverLoaded(): void
{
    $drivers = PDO::getAvailableDrivers();
    if (!in_array('pgsql', $drivers, true)) {
        throw new RuntimeException('PDO pgsql driver missing. Ensure container includes pdo_pgsql extension.');
    }
}

function resolveSslMode(string $host, string $configured): string
{
    if ($configured !== '') {
        return $configured;
    }

    if (str_ends_with(strtolower($host), '.railway.internal')) {
        return 'disable';
    }

    return 'prefer';
}

function ensureSchema(PDO $pdo): void
{
    $pdo->exec(
        <<<SQL
        CREATE TABLE IF NOT EXISTS journal_users (
            id BIGSERIAL PRIMARY KEY,
            username VARCHAR(32) NOT NULL UNIQUE,
            email VARCHAR(190) NULL UNIQUE,
            auth_provider VARCHAR(24) NOT NULL DEFAULT 'email',
            oauth_subject TEXT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        SQL
    );

    $pdo->exec(
        <<<SQL
        CREATE TABLE IF NOT EXISTS password_reset_requests (
            id BIGSERIAL PRIMARY KEY,
            email VARCHAR(190) NOT NULL,
            requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        SQL
    );

    $pdo->exec(
        <<<SQL
        CREATE TABLE IF NOT EXISTS journal_notes (
            user_id BIGINT PRIMARY KEY REFERENCES journal_users(id) ON DELETE CASCADE,
            settings JSONB NOT NULL DEFAULT '{}'::jsonb,
            reflections JSONB NOT NULL DEFAULT '[]'::jsonb,
            replay_notes JSONB NOT NULL DEFAULT '{}'::jsonb,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        SQL
    );

    $pdo->exec(
        <<<SQL
        CREATE TABLE IF NOT EXISTS trades (
            user_id BIGINT PRIMARY KEY REFERENCES journal_users(id) ON DELETE CASCADE,
            payload JSONB NOT NULL DEFAULT '[]'::jsonb,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        SQL
    );

    $pdo->exec(
        <<<SQL
        CREATE TABLE IF NOT EXISTS trade_screenshots (
            id BIGSERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL REFERENCES journal_users(id) ON DELETE CASCADE,
            trade_id VARCHAR(64) NOT NULL,
            screenshot_name TEXT NOT NULL DEFAULT '',
            screenshot_data TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        SQL
    );

    $pdo->exec(
        <<<SQL
        CREATE TABLE IF NOT EXISTS login_info (
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

    // Keep schema migration safe for legacy tables with older column names/order.
    $pdo->exec('ALTER TABLE journal_notes ADD COLUMN IF NOT EXISTS user_id BIGINT');
    $pdo->exec('ALTER TABLE journal_notes ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT \'{}\'::jsonb');
    $pdo->exec('ALTER TABLE journal_notes ADD COLUMN IF NOT EXISTS reflections JSONB NOT NULL DEFAULT \'[]\'::jsonb');
    $pdo->exec('ALTER TABLE journal_notes ADD COLUMN IF NOT EXISTS replay_notes JSONB NOT NULL DEFAULT \'{}\'::jsonb');
    $pdo->exec('ALTER TABLE journal_notes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()');

    $pdo->exec('ALTER TABLE journal_users ADD COLUMN IF NOT EXISTS email VARCHAR(190)');
    $pdo->exec('ALTER TABLE journal_users ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(24) NOT NULL DEFAULT \'email\'');
    $pdo->exec('ALTER TABLE journal_users ADD COLUMN IF NOT EXISTS oauth_subject TEXT');
    $pdo->exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_users_email ON journal_users (email)');

    $pdo->exec('ALTER TABLE trades ADD COLUMN IF NOT EXISTS user_id BIGINT');
    $pdo->exec('ALTER TABLE trades ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT \'[]\'::jsonb');
    $pdo->exec('ALTER TABLE trades ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()');

    $pdo->exec('ALTER TABLE login_info ADD COLUMN IF NOT EXISTS user_id BIGINT');
    $pdo->exec('ALTER TABLE login_info ADD COLUMN IF NOT EXISTS username VARCHAR(32) NOT NULL DEFAULT \'\'');
    $pdo->exec('ALTER TABLE login_info ADD COLUMN IF NOT EXISTS event_type VARCHAR(24) NOT NULL DEFAULT \'login\'');
    $pdo->exec('ALTER TABLE login_info ADD COLUMN IF NOT EXISTS success BOOLEAN NOT NULL DEFAULT TRUE');
    $pdo->exec('ALTER TABLE login_info ADD COLUMN IF NOT EXISTS ip_address INET');
    $pdo->exec('ALTER TABLE login_info ADD COLUMN IF NOT EXISTS user_agent TEXT');
    $pdo->exec('ALTER TABLE login_info ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()');

    $pdo->exec('ALTER TABLE trade_screenshots ADD COLUMN IF NOT EXISTS user_id BIGINT');
    $pdo->exec('ALTER TABLE trade_screenshots ADD COLUMN IF NOT EXISTS trade_id VARCHAR(64) NOT NULL DEFAULT \'\'');
    $pdo->exec('ALTER TABLE trade_screenshots ADD COLUMN IF NOT EXISTS screenshot_name TEXT NOT NULL DEFAULT \'\'');
    $pdo->exec('ALTER TABLE trade_screenshots ADD COLUMN IF NOT EXISTS screenshot_data TEXT NOT NULL DEFAULT \'\'');
    $pdo->exec('ALTER TABLE trade_screenshots ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()');
    $pdo->exec('ALTER TABLE trade_screenshots ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()');

    createIndexIfColumnsExist(
        $pdo,
        'login_info',
        ['created_at'],
        'CREATE INDEX IF NOT EXISTS idx_login_info_created_at ON login_info (created_at DESC)'
    );
    createIndexIfColumnsExist(
        $pdo,
        'login_info',
        ['username'],
        'CREATE INDEX IF NOT EXISTS idx_login_info_username ON login_info (username)'
    );
    createIndexIfColumnsExist(
        $pdo,
        'trade_screenshots',
        ['user_id', 'trade_id'],
        'CREATE INDEX IF NOT EXISTS idx_trade_screenshots_user_trade ON trade_screenshots (user_id, trade_id)'
    );
    createIndexIfColumnsExist(
        $pdo,
        'journal_notes',
        ['user_id'],
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_notes_user_id ON journal_notes (user_id)'
    );
    createIndexIfColumnsExist(
        $pdo,
        'trades',
        ['user_id'],
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_trades_user_id ON trades (user_id)'
    );
}

function createIndexIfColumnsExist(PDO $pdo, string $tableName, array $columns, string $sql): void
{
    foreach ($columns as $column) {
        if (!tableColumnExists($pdo, $tableName, (string) $column)) {
            return;
        }
    }

    try {
        $pdo->exec($sql);
    } catch (PDOException $error) {
        $sqlState = (string) ($error->errorInfo[0] ?? '');
        // Ignore undefined column/table errors for legacy schemas.
        if ($sqlState === '42703' || $sqlState === '42P01') {
            return;
        }
        throw $error;
    }
}

function tableColumnExists(PDO $pdo, string $tableName, string $columnName): bool
{
    $stmt = $pdo->prepare(
        <<<SQL
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = :table_name
          AND column_name = :column_name
        LIMIT 1
        SQL
    );

    $stmt->execute([
        ':table_name' => $tableName,
        ':column_name' => $columnName,
    ]);

    return $stmt->fetchColumn() !== false;
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

    $user = findUserByIdentifier($pdo, $username);
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

function readCredentials(bool $forRegister = false): array
{
    $decoded = readJsonBody();
    $identifierRaw = strtolower(trim((string) ($decoded['identifier'] ?? $decoded['email'] ?? $decoded['username'] ?? '')));
    $emailRaw = isset($decoded['email']) ? strtolower(trim((string) $decoded['email'])) : '';
    $password = isset($decoded['password']) ? (string) $decoded['password'] : '';

    if ($identifierRaw === '') {
        respond(422, ['ok' => false, 'error' => 'Enter a username or email address.']);
    }

    if (strlen($password) < 8) {
        respond(422, ['ok' => false, 'error' => 'Password must be at least 8 characters.']);
    }

    if ($forRegister) {
        if (filter_var($identifierRaw, FILTER_VALIDATE_EMAIL)) {
            $emailRaw = $identifierRaw;
        } elseif (!preg_match('/^[a-z0-9._-]{3,32}$/', $identifierRaw)) {
            respond(422, ['ok' => false, 'error' => 'Username must be 3-32 chars or use a valid email address.']);
        }
    }

    return [$identifierRaw, $password, $emailRaw];
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

function findUserByIdentifier(PDO $pdo, string $identifier): ?array
{
    $stmt = $pdo->prepare(
        'SELECT id, username, email, auth_provider, password_hash FROM journal_users WHERE username = :identifier OR email = :identifier LIMIT 1'
    );
    $stmt->execute([':identifier' => $identifier]);
    $row = $stmt->fetch();
    if (!is_array($row)) {
        return null;
    }

    return [
        'id' => (int) $row['id'],
        'username' => (string) $row['username'],
        'email' => (string) ($row['email'] ?? ''),
        'provider' => (string) ($row['auth_provider'] ?? 'email'),
        'passwordHash' => (string) $row['password_hash'],
    ];
}

function createUsernameFromEmail(PDO $pdo, string $email): string
{
    $local = strtolower((string) preg_replace('/[^a-z0-9._-]+/', '', strstr($email, '@', true) ?: 'user'));
    $base = trim($local, '._-');
    if ($base === '') {
        $base = 'user';
    }
    $base = substr($base, 0, 24);

    $candidate = $base;
    $counter = 1;
    while (findUserByIdentifier($pdo, $candidate) !== null) {
        $suffix = (string) $counter;
        $candidate = substr($base, 0, max(1, 32 - strlen($suffix))) . $suffix;
        $counter += 1;
    }

    return $candidate;
}

function resolveRegistrationUsername(PDO $pdo, string $identifier, string $email): string
{
    if ($email !== '') {
        return createUsernameFromEmail($pdo, $email);
    }

    return $identifier;
}

function ensurePasswordResetRequest(PDO $pdo, string $email): void
{
    $stmt = $pdo->prepare(
        'INSERT INTO password_reset_requests (email, requested_at) VALUES (:email, NOW())'
    );
    $stmt->execute([':email' => $email]);
}

function isAdminUsername(PDO $pdo, string $username): bool
{
    $candidate = strtolower(trim($username));
    if ($candidate === '') {
        return false;
    }

    $adminEnv = trim((string) getenv('ADMIN_USERNAMES'));
    if ($adminEnv === '') {
        $singleAdmin = trim((string) getenv('ADMIN_USERNAME'));
        if ($singleAdmin !== '') {
            $adminEnv = $singleAdmin;
        }
    }

    if ($adminEnv !== '') {
        $admins = array_values(array_filter(array_map(
            static fn ($value): string => strtolower(trim((string) $value)),
            explode(',', $adminEnv)
        )));

        return in_array($candidate, $admins, true);
    }

    return $candidate === 'chesterlsc';
}

function listAdminUsers(PDO $pdo): array
{
    $stmt = $pdo->query(
        <<<SQL
        SELECT
            u.id,
            u.username,
            u.created_at::text AS created_at,
            CASE
                WHEN COALESCE(u.password_hash, '') <> ''
                    THEN 'Hashed'
                ELSE 'Not Set'
            END AS password_status,
            CASE
                WHEN t.payload IS NOT NULL AND jsonb_typeof(t.payload) = 'array'
                    THEN jsonb_array_length(t.payload)
                ELSE 0
            END AS trades_count,
            CASE
                WHEN n.reflections IS NOT NULL AND jsonb_typeof(n.reflections) = 'array'
                    THEN jsonb_array_length(n.reflections)
                ELSE 0
            END AS reflections_count,
            COALESCE(latest.event_type, '') AS last_event,
            COALESCE(latest.success, FALSE) AS last_success,
            COALESCE(latest.created_at::text, '') AS last_login_at,
            COALESCE(latest.user_agent, '') AS last_user_agent
        FROM journal_users u
        LEFT JOIN journal_notes n
            ON n.user_id = u.id
        LEFT JOIN trades t
            ON t.user_id = u.id
        LEFT JOIN LATERAL (
            SELECT li.event_type, li.success, li.created_at, li.user_agent
            FROM login_info li
            WHERE li.user_id = u.id OR li.username = u.username
            ORDER BY li.created_at DESC
            LIMIT 1
        ) latest ON TRUE
        ORDER BY u.created_at DESC
        LIMIT 500
        SQL
    );

    $rows = $stmt->fetchAll();
    return is_array($rows) ? $rows : [];
}

function listAdminLoginEvents(PDO $pdo): array
{
    $stmt = $pdo->query(
        <<<SQL
        SELECT
            id,
            username,
            event_type,
            success,
            COALESCE(ip_address::text, '') AS ip_address,
            COALESCE(user_agent, '') AS user_agent,
            created_at::text AS created_at
        FROM login_info
        ORDER BY created_at DESC
        LIMIT 500
        SQL
    );

    $rows = $stmt->fetchAll();
    return is_array($rows) ? $rows : [];
}

function logLoginEvent(PDO $pdo, ?int $userId, string $username, string $eventType, bool $success): void
{
    $stmt = $pdo->prepare(
        <<<SQL
        INSERT INTO login_info (user_id, username, event_type, success, ip_address, user_agent)
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
        FROM login_info
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
    $notesStmt = $pdo->prepare('SELECT user_id FROM journal_notes WHERE user_id = :user_id LIMIT 1');
    $notesStmt->execute([':user_id' => $userId]);
    $hasNotes = $notesStmt->fetchColumn() !== false;

    $tradesStmt = $pdo->prepare('SELECT user_id FROM trades WHERE user_id = :user_id LIMIT 1');
    $tradesStmt->execute([':user_id' => $userId]);
    $hasTrades = $tradesStmt->fetchColumn() !== false;

    if ($hasNotes && $hasTrades) {
        return;
    }

    upsertJournalData($pdo, $userId, $defaults);
}

function loadJournalData(PDO $pdo, int $userId, array $defaults): array
{
    $notesStmt = $pdo->prepare(
        'SELECT settings::text AS settings, reflections::text AS reflections, replay_notes::text AS replay_notes FROM journal_notes WHERE user_id = :user_id LIMIT 1'
    );
    $notesStmt->execute([':user_id' => $userId]);
    $notesRow = $notesStmt->fetch();

    $tradesStmt = $pdo->prepare(
        'SELECT payload::text AS payload FROM trades WHERE user_id = :user_id LIMIT 1'
    );
    $tradesStmt->execute([':user_id' => $userId]);
    $tradesRow = $tradesStmt->fetch();

    if (!is_array($notesRow) && !is_array($tradesRow)) {
        upsertJournalData($pdo, $userId, $defaults);
        return $defaults;
    }

    $settings = json_decode((string) ($notesRow['settings'] ?? ''), true);
    $trades = json_decode((string) ($tradesRow['payload'] ?? ''), true);
    $reflections = json_decode((string) ($notesRow['reflections'] ?? ''), true);
    $replayNotes = json_decode((string) ($notesRow['replay_notes'] ?? ''), true);

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

    $updateNotes = $pdo->prepare(
        <<<SQL
        UPDATE journal_notes
        SET
            settings = CAST(:settings AS jsonb),
            reflections = CAST(:reflections AS jsonb),
            replay_notes = CAST(:replay_notes AS jsonb),
            updated_at = NOW()
        WHERE user_id = :user_id
        SQL
    );

    $updateNotes->execute([
        ':user_id' => $userId,
        ':settings' => $settingsJson,
        ':reflections' => $reflectionsJson,
        ':replay_notes' => $replayNotesJson,
    ]);

    if ($updateNotes->rowCount() === 0) {
        $insertNotes = $pdo->prepare(
            <<<SQL
            INSERT INTO journal_notes (user_id, settings, reflections, replay_notes, updated_at)
            VALUES (
                :user_id,
                CAST(:settings AS jsonb),
                CAST(:reflections AS jsonb),
                CAST(:replay_notes AS jsonb),
                NOW()
            )
            SQL
        );

        $insertNotes->execute([
            ':user_id' => $userId,
            ':settings' => $settingsJson,
            ':reflections' => $reflectionsJson,
            ':replay_notes' => $replayNotesJson,
        ]);
    }

    $updateTrades = $pdo->prepare(
        <<<SQL
        UPDATE trades
        SET
            payload = CAST(:trades AS jsonb),
            updated_at = NOW()
        WHERE user_id = :user_id
        SQL
    );

    $updateTrades->execute([
        ':user_id' => $userId,
        ':trades' => $tradesJson,
    ]);

    if ($updateTrades->rowCount() === 0) {
        $insertTrades = $pdo->prepare(
            <<<SQL
            INSERT INTO trades (user_id, payload, updated_at)
            VALUES (:user_id, CAST(:trades AS jsonb), NOW())
            SQL
        );

        $insertTrades->execute([
            ':user_id' => $userId,
            ':trades' => $tradesJson,
        ]);
    }
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
