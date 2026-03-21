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

        $resetUrl = ensurePasswordResetRequest($pdo, $email);
        $message = 'If the email exists, a reset link has been sent.';
        $payload = ['ok' => true, 'message' => $message];
        if ($resetUrl !== null && shouldExposeResetUrl()) {
            $payload['resetUrl'] = $resetUrl;
        }
        respond(200, $payload);
    }

    if ($action === 'validate_reset_token') {
        $token = trim((string) ($_GET['token'] ?? ''));
        if ($token === '') {
            respond(422, ['ok' => false, 'error' => 'Reset token is required.']);
        }

        $request = findActivePasswordResetRequest($pdo, $token);
        if ($request === null) {
            respond(422, ['ok' => false, 'error' => 'Reset link is invalid or expired.']);
        }

        respond(200, ['ok' => true, 'valid' => true]);
    }

    if ($action === 'reset_password') {
        requireMethod('POST');
        $decoded = readJsonBody();
        $token = trim((string) ($decoded['token'] ?? ''));
        $password = isset($decoded['password']) ? (string) $decoded['password'] : '';

        if ($token === '') {
            respond(422, ['ok' => false, 'error' => 'Reset token is required.']);
        }
        if (strlen($password) < 8) {
            respond(422, ['ok' => false, 'error' => 'Password must be at least 8 characters.']);
        }

        resetPasswordWithToken($pdo, $token, $password);
        respond(200, ['ok' => true, 'message' => 'Password updated. You can log in now.']);
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

    if ($action === 'recent_trades') {
        $auth = requireAuth($pdo);
        $trades = listRecentTrades($pdo, $auth['id']);
        respond(200, ['ok' => true, 'trades' => $trades]);
    }

    if ($action === 'public_recent_trades') {
        $publicUser = findUserByIdentifier($pdo, 'chesterlsc');
        $trades = $publicUser !== null ? listRecentTrades($pdo, (int) $publicUser['id']) : [];
        respond(200, ['ok' => true, 'trades' => $trades]);
    }

    if ($action === 'live_prices') {
        $symbolsParam = $_GET['symbols'] ?? '';
        $symbols = is_array($symbolsParam) ? $symbolsParam : explode(',', (string) $symbolsParam);
        $prices = fetchLivePrices($pdo, $symbols);
        respond(200, ['ok' => true, 'prices' => $prices]);
    }

    if ($action === 'update_prices') {
        requireMethod('POST');
        $decoded = readJsonBody();
        $prices = isset($decoded['prices']) && is_array($decoded['prices']) ? $decoded['prices'] : [];
        $updated = upsertSymbolPrices($pdo, $prices);
        respond(200, ['ok' => true, 'updated' => $updated]);
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
            user_id BIGINT NULL REFERENCES journal_users(id) ON DELETE CASCADE,
            token_hash VARCHAR(64) NULL,
            requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMPTZ NULL,
            used_at TIMESTAMPTZ NULL
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
        CREATE TABLE IF NOT EXISTS symbol_prices (
            symbol TEXT PRIMARY KEY,
            price NUMERIC NOT NULL,
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
    $pdo->exec('ALTER TABLE password_reset_requests ADD COLUMN IF NOT EXISTS user_id BIGINT');
    $pdo->exec('ALTER TABLE password_reset_requests ADD COLUMN IF NOT EXISTS token_hash VARCHAR(64)');
    $pdo->exec('ALTER TABLE password_reset_requests ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ');
    $pdo->exec('ALTER TABLE password_reset_requests ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ');

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
    createIndexIfColumnsExist(
        $pdo,
        'password_reset_requests',
        ['token_hash'],
        'CREATE INDEX IF NOT EXISTS idx_password_reset_requests_token_hash ON password_reset_requests (token_hash)'
    );
    createIndexIfColumnsExist(
        $pdo,
        'password_reset_requests',
        ['email', 'requested_at'],
        'CREATE INDEX IF NOT EXISTS idx_password_reset_requests_email_requested ON password_reset_requests (email, requested_at DESC)'
    );
    createIndexIfColumnsExist(
        $pdo,
        'symbol_prices',
        ['updated_at'],
        'CREATE INDEX IF NOT EXISTS idx_symbol_prices_updated_at ON symbol_prices (updated_at DESC)'
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

function ensurePasswordResetRequest(PDO $pdo, string $email): ?string
{
    $user = findUserByIdentifier($pdo, $email);
    if ($user === null || ($user['email'] ?? '') === '') {
        return null;
    }

    $token = bin2hex(random_bytes(32));
    $tokenHash = hash('sha256', $token);

    $stmt = $pdo->prepare(
        <<<SQL
        INSERT INTO password_reset_requests (email, user_id, token_hash, requested_at, expires_at, used_at)
        VALUES (:email, :user_id, :token_hash, NOW(), NOW() + INTERVAL '60 minutes', NULL)
        SQL
    );
    $stmt->execute([
        ':email' => $email,
        ':user_id' => $user['id'],
        ':token_hash' => $tokenHash,
    ]);

    $resetUrl = buildResetUrl($token);
    sendPasswordResetEmail($email, $resetUrl, (string) $user['username']);

    return $resetUrl;
}

function resetPasswordWithToken(PDO $pdo, string $token, string $password): void
{
    $row = findActivePasswordResetRequest($pdo, $token);
    if ($row === null) {
        respond(422, ['ok' => false, 'error' => 'Reset link is invalid or expired.']);
    }

    $hash = password_hash($password, PASSWORD_DEFAULT);
    if (!is_string($hash) || $hash === '') {
        respond(500, ['ok' => false, 'error' => 'Failed to secure password.']);
    }

    $pdo->beginTransaction();
    try {
        $updateUser = $pdo->prepare('UPDATE journal_users SET password_hash = :password_hash WHERE id = :user_id');
        $updateUser->execute([
            ':password_hash' => $hash,
            ':user_id' => (int) $row['user_id'],
        ]);

        $markUsed = $pdo->prepare('UPDATE password_reset_requests SET used_at = NOW() WHERE id = :id');
        $markUsed->execute([':id' => (int) $row['id']]);

        $invalidateOthers = $pdo->prepare(
            'UPDATE password_reset_requests SET used_at = NOW() WHERE user_id = :user_id AND used_at IS NULL AND id <> :id'
        );
        $invalidateOthers->execute([
            ':user_id' => (int) $row['user_id'],
            ':id' => (int) $row['id'],
        ]);

        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $error;
    }
}

function findActivePasswordResetRequest(PDO $pdo, string $token): ?array
{
    $tokenHash = hash('sha256', $token);
    $stmt = $pdo->prepare(
        <<<SQL
        SELECT id, user_id
        FROM password_reset_requests
        WHERE token_hash = :token_hash
          AND used_at IS NULL
          AND expires_at IS NOT NULL
          AND expires_at > NOW()
        ORDER BY requested_at DESC
        LIMIT 1
        SQL
    );
    $stmt->execute([':token_hash' => $tokenHash]);
    $row = $stmt->fetch();

    return is_array($row) ? $row : null;
}

function buildResetUrl(string $token): string
{
    $baseUrl = trim((string) getenv('APP_URL'));
    if ($baseUrl === '') {
        $railwayDomain = trim((string) getenv('RAILWAY_PUBLIC_DOMAIN'));
        if ($railwayDomain !== '') {
            $baseUrl = 'https://' . $railwayDomain;
        }
    }
    if ($baseUrl === '') {
        $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
        $host = trim((string) ($_SERVER['HTTP_HOST'] ?? ''));
        $scriptName = trim((string) ($_SERVER['SCRIPT_NAME'] ?? ''));
        $dir = rtrim(str_replace('\\', '/', dirname($scriptName)), '/.');
        if ($host !== '') {
            $baseUrl = $scheme . '://' . $host . ($dir !== '' ? $dir : '');
        }
    }

    if ($baseUrl === '') {
        return '?reset=' . rawurlencode($token);
    }

    return rtrim($baseUrl, '/') . '/?reset=' . rawurlencode($token);
}

function sendPasswordResetEmail(string $email, string $resetUrl, string $username): void
{
    if (!function_exists('mail')) {
        return;
    }

    $subject = 'Your Journal password reset';
    $safeUsername = $username !== '' ? $username : 'trader';
    $message = implode("\r\n", [
        "Hello {$safeUsername},",
        '',
        'A password reset was requested for your Your Journal account.',
        'Open the link below to set a new password:',
        $resetUrl,
        '',
        'This link expires in 60 minutes.',
        'If you did not request this, you can ignore this email.',
    ]);

    $fromAddress = trim((string) getenv('MAIL_FROM'));
    $headers = [];
    if ($fromAddress !== '') {
        $headers[] = 'From: ' . $fromAddress;
        $headers[] = 'Reply-To: ' . $fromAddress;
    }
    $headers[] = 'Content-Type: text/plain; charset=UTF-8';

    @mail($email, $subject, $message, implode("\r\n", $headers));
}

function shouldExposeResetUrl(): bool
{
    $debug = strtolower(trim((string) getenv('APP_DEBUG')));
    return in_array($debug, ['1', 'true', 'yes'], true);
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
        'journalName' => sanitizeJournalName($settings['journalName'] ?? 'Your'),
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
        return 'Your';
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

function normalizeTradeStatus($value): string
{
    return trim((string) $value) === 'open' ? 'open' : 'closed';
}

function sanitizeTradesPayload($value): array
{
    if (!is_array($value)) {
        return [];
    }

    $result = [];
    foreach ($value as $item) {
        if (is_object($item)) {
            $item = get_object_vars($item);
        }

        if (!is_array($item)) {
            continue;
        }

        $status = normalizeTradeStatus(($item['status'] ?? null) ?? (!empty($item['in_progress']) ? 'open' : 'closed'));
        $createdAt = trim((string) ($item['createdAt'] ?? $item['created_at'] ?? ''));
        $updatedAt = trim((string) ($item['updatedAt'] ?? $item['updated_at'] ?? $createdAt));
        $closedAt = $status === 'open'
            ? ''
            : trim((string) ($item['closedAt'] ?? $item['closed_at'] ?? $updatedAt));

        $item['id'] = (string) ($item['id'] ?? '');
        $item['asset'] = (string) ($item['asset'] ?? $item['symbol'] ?? '');
        $item['direction'] = (string) ($item['direction'] ?? 'Buy');
        $item['entryPrice'] = is_numeric($item['entryPrice'] ?? $item['entry_price'] ?? null) ? (float) ($item['entryPrice'] ?? $item['entry_price']) : 0.0;
        $item['stopLoss'] = is_numeric($item['stopLoss'] ?? $item['stop_loss'] ?? null) ? (float) ($item['stopLoss'] ?? $item['stop_loss']) : 0.0;
        $item['takeProfit'] = is_numeric($item['takeProfit'] ?? $item['take_profit'] ?? null) ? (float) ($item['takeProfit'] ?? $item['take_profit']) : 0.0;
        $item['exitPrice'] = is_numeric($item['exitPrice'] ?? $item['exit_price'] ?? null) ? (float) ($item['exitPrice'] ?? $item['exit_price']) : 0.0;
        $item['netPnl'] = is_numeric($item['netPnl'] ?? $item['profit_loss'] ?? null) ? (float) ($item['netPnl'] ?? $item['profit_loss']) : 0.0;
        $item['status'] = $status;
        $item['createdAt'] = $createdAt;
        $item['updatedAt'] = $updatedAt;
        $item['closedAt'] = $closedAt;
        $result[] = $item;
    }

    return $result;
}

function listRecentTrades(PDO $pdo, int $userId): array
{
    $stmt = $pdo->prepare('SELECT payload::text AS payload FROM trades WHERE user_id = :user_id LIMIT 1');
    $stmt->execute([':user_id' => $userId]);
    $row = $stmt->fetch();
    if (!is_array($row)) {
        return [];
    }

    $decoded = json_decode((string) ($row['payload'] ?? ''), true);
    $trades = sanitizeTradesPayload($decoded);
    usort(
        $trades,
        static function (array $a, array $b): int {
            $leftDate = (string) ($a['date'] ?? '');
            $rightDate = (string) ($b['date'] ?? '');
            $dateSort = $rightDate <=> $leftDate;
            if ($dateSort !== 0) {
                return $dateSort;
            }

            $left = (string) ($a['createdAt'] ?? $a['updatedAt'] ?? '');
            $right = (string) ($b['createdAt'] ?? $b['updatedAt'] ?? '');
            return $right <=> $left;
        }
    );

    return array_map(
        static function (array $trade): array {
            return [
                'id' => (string) ($trade['id'] ?? ''),
                'symbol' => (string) ($trade['asset'] ?? ''),
                'date' => (string) ($trade['date'] ?? ''),
                'direction' => (string) ($trade['direction'] ?? ''),
                'entry_price' => is_numeric($trade['entryPrice'] ?? null) ? (float) $trade['entryPrice'] : 0.0,
                'stop_loss' => is_numeric($trade['stopLoss'] ?? null) ? (float) $trade['stopLoss'] : 0.0,
                'take_profit' => is_numeric($trade['takeProfit'] ?? null) ? (float) $trade['takeProfit'] : 0.0,
                'exit_price' => is_numeric($trade['exitPrice'] ?? null) ? (float) $trade['exitPrice'] : 0.0,
                'profit_loss' => is_numeric($trade['netPnl'] ?? null) ? (float) $trade['netPnl'] : 0.0,
                'pips' => is_numeric($trade['pips'] ?? null) ? (float) $trade['pips'] : 0.0,
                'status' => normalizeTradeStatus($trade['status'] ?? 'closed'),
                'created_at' => (string) ($trade['createdAt'] ?? ''),
                'closed_at' => (string) ($trade['closedAt'] ?? ''),
            ];
        },
        $trades
    );
}

function upsertSymbolPrices(PDO $pdo, array $entries): int
{
    if ($entries === []) {
        return 0;
    }

    $stmt = $pdo->prepare(
        <<<SQL
        INSERT INTO symbol_prices (symbol, price, updated_at)
        VALUES (:symbol, :price, NOW())
        ON CONFLICT (symbol)
        DO UPDATE SET price = EXCLUDED.price, updated_at = NOW()
        SQL
    );

    $updated = 0;
    foreach ($entries as $item) {
        if (is_object($item)) {
            $item = get_object_vars($item);
        }

        if (!is_array($item)) {
            continue;
        }

        $symbol = strtoupper(trim((string) ($item['symbol'] ?? '')));
        $price = $item['price'] ?? null;
        if ($symbol === '' || !preg_match('/^[A-Z0-9._=-]{2,24}$/', $symbol) || !is_numeric($price)) {
            continue;
        }

        $priceValue = (float) $price;
        if ($priceValue <= 0) {
            continue;
        }

        $stmt->execute([
            ':symbol' => $symbol,
            ':price' => $priceValue,
        ]);
        $updated += 1;
    }

    return $updated;
}

function fetchLivePrices(PDO $pdo, array $symbols): array
{
    $normalizedSymbols = [];
    foreach ($symbols as $symbol) {
        $normalized = normalizeLivePriceSymbol((string) $symbol);
        if ($normalized !== '') {
            $normalizedSymbols[$normalized] = true;
        }
    }

    if ($normalizedSymbols === []) {
        return [];
    }

    $requests = buildLivePriceRequests(array_keys($normalizedSymbols));
    $updates = [];

    foreach ($requests as $request) {
        $body = fetchRemoteJson((string) $request['url']);
        if (!is_array($body)) {
            continue;
        }

        $price = $request['readPrice']($body);
        if (!is_float($price) && !is_int($price)) {
            continue;
        }

        $priceValue = (float) $price;
        if ($priceValue <= 0) {
            continue;
        }

        foreach ($request['aliases'] as $alias) {
            $updates[(string) $alias] = $priceValue;
        }
    }

    if ($updates !== []) {
        $entries = [];
        foreach ($updates as $symbol => $price) {
            $entries[] = ['symbol' => $symbol, 'price' => $price];
        }
        upsertSymbolPrices($pdo, $entries);
    }

    $cached = loadCachedSymbolPrices($pdo, array_keys($normalizedSymbols));
    foreach ($cached as $symbol => $price) {
        if (!isset($updates[$symbol])) {
            $updates[$symbol] = $price;
        }
    }

    return $updates;
}

function normalizeLivePriceSymbol(string $symbol): string
{
    $raw = strtoupper(trim($symbol));
    if ($raw === '') {
        return '';
    }

    $normalized = preg_replace('/[:\/\s_-]+/', '', $raw);
    $normalized = preg_replace('/[^A-Z0-9.]/', '', (string) $normalized);
    $normalized = preg_replace('/\.(P|M|PRO|RAW|CASH)$/', '', (string) $normalized);
    $normalized = preg_replace('/(USDT|USDC|USD|BTC|ETH)(PERP|FUT|SWAP|SPOT)$/', '$1', (string) $normalized);
    $normalized = preg_replace('/(USDT|USDC|USD|BTC|ETH)(M|PRO)$/', '$1', (string) $normalized);

    return (string) $normalized;
}

function buildLivePriceRequests(array $symbols): array
{
    $requests = [];

    foreach ($symbols as $symbol) {
        $source = resolveLivePriceSource($symbol);
        if ($source === null) {
            continue;
        }

        $key = (string) $source['key'];
        if (!isset($requests[$key])) {
            $requests[$key] = $source + ['aliases' => []];
        }
        $requests[$key]['aliases'][$symbol] = $symbol;
    }

    foreach ($requests as &$request) {
        $request['aliases'] = array_values($request['aliases']);
    }
    unset($request);

    return array_values($requests);
}

function resolveLivePriceSource(string $symbol): ?array
{
    $normalized = normalizeLivePriceSymbol($symbol);
    if ($normalized === '') {
        return null;
    }

    $cryptoMap = [
        'BTCUSD' => 'BTCUSDT',
        'BTCUSDT' => 'BTCUSDT',
        'ETHUSD' => 'ETHUSDT',
        'ETHUSDT' => 'ETHUSDT',
        'ETCUSD' => 'ETCUSDT',
        'ETCUSDT' => 'ETCUSDT',
        'SOLUSD' => 'SOLUSDT',
        'SOLUSDT' => 'SOLUSDT',
        'XRPUSD' => 'XRPUSDT',
        'XRPUSDT' => 'XRPUSDT',
        'ADAUSD' => 'ADAUSDT',
        'ADAUSDT' => 'ADAUSDT',
        'DOGEUSD' => 'DOGEUSDT',
        'DOGEUSDT' => 'DOGEUSDT',
        'BNBUSD' => 'BNBUSDT',
        'BNBUSDT' => 'BNBUSDT',
        'LTCUSD' => 'LTCUSDT',
        'LTCUSDT' => 'LTCUSDT',
        'BCHUSD' => 'BCHUSDT',
        'BCHUSDT' => 'BCHUSDT',
        'AVAXUSD' => 'AVAXUSDT',
        'AVAXUSDT' => 'AVAXUSDT',
        'LINKUSD' => 'LINKUSDT',
        'LINKUSDT' => 'LINKUSDT',
        'DOTUSD' => 'DOTUSDT',
        'DOTUSDT' => 'DOTUSDT',
        'TRXUSD' => 'TRXUSDT',
        'TRXUSDT' => 'TRXUSDT',
        'MATICUSD' => 'MATICUSDT',
        'MATICUSDT' => 'MATICUSDT',
        'SUIUSD' => 'SUIUSDT',
        'SUIUSDT' => 'SUIUSDT',
        'TONUSD' => 'TONUSDT',
        'TONUSDT' => 'TONUSDT',
        'SHIBUSD' => 'SHIBUSDT',
        'SHIBUSDT' => 'SHIBUSDT',
    ];

    if (isset($cryptoMap[$normalized])) {
        $marketSymbol = $cryptoMap[$normalized];
        return [
            'key' => 'binance:' . $marketSymbol,
            'url' => 'https://api.binance.com/api/v3/ticker/price?symbol=' . rawurlencode($marketSymbol),
            'readPrice' => static function (array $body): ?float {
                $price = $body['price'] ?? null;
                return is_numeric($price) && (float) $price > 0 ? (float) $price : null;
            },
        ];
    }

    if ($normalized === 'XAUUSD' || $normalized === 'XAGUSD') {
        $metal = str_starts_with($normalized, 'XAG') ? 'XAG' : 'XAU';
        return [
            'key' => 'metal:' . $metal,
            'url' => 'https://api.gold-api.com/price/' . rawurlencode($metal),
            'readPrice' => static function (array $body): ?float {
                $price = $body['price'] ?? null;
                return is_numeric($price) && (float) $price > 0 ? (float) $price : null;
            },
        ];
    }

    return null;
}

function fetchRemoteJson(string $url): ?array
{
    if ($url === '') {
        return null;
    }

    $headers = [
        'Accept: application/json',
        'User-Agent: TraderJournal/1.0',
    ];

    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        if ($ch === false) {
            return null;
        }

        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_CONNECTTIMEOUT => 4,
            CURLOPT_TIMEOUT => 6,
            CURLOPT_HTTPHEADER => $headers,
        ]);

        $raw = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);

        if (!is_string($raw) || $raw === '' || $status < 200 || $status >= 300) {
            return null;
        }

        $decoded = json_decode($raw, true);
        return is_array($decoded) ? $decoded : null;
    }

    $context = stream_context_create([
        'http' => [
            'method' => 'GET',
            'header' => implode("\r\n", $headers),
            'timeout' => 6,
            'ignore_errors' => true,
        ],
    ]);

    $raw = @file_get_contents($url, false, $context);
    if (!is_string($raw) || $raw === '') {
        return null;
    }

    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : null;
}

function loadCachedSymbolPrices(PDO $pdo, array $symbols): array
{
    if ($symbols === []) {
        return [];
    }

    $placeholders = [];
    $params = [];
    foreach (array_values($symbols) as $index => $symbol) {
        $key = ':symbol_' . $index;
        $placeholders[] = $key;
        $params[$key] = $symbol;
    }

    $stmt = $pdo->prepare(
        'SELECT symbol, price FROM symbol_prices WHERE symbol IN (' . implode(', ', $placeholders) . ')'
    );
    $stmt->execute($params);

    $result = [];
    while ($row = $stmt->fetch()) {
        $symbol = strtoupper(trim((string) ($row['symbol'] ?? '')));
        $price = $row['price'] ?? null;
        if ($symbol !== '' && is_numeric($price) && (float) $price > 0) {
            $result[$symbol] = (float) $price;
        }
    }

    return $result;
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
