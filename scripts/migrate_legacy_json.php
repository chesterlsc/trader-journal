<?php
declare(strict_types=1);

/**
 * One-time migration utility:
 * - Imports legacy data/users.json + data/accounts/*.json into PostgreSQL
 * - Keeps existing users/data via UPSERT
 *
 * Usage:
 *   php scripts/migrate_legacy_json.php
 *
 * Requires:
 *   DATABASE_URL or PGHOST/PGDATABASE/PGUSER/PGPASSWORD
 */

$root = dirname(__DIR__);
$usersFile = $root . '/data/users.json';
$accountsDir = $root . '/data/accounts';

if (!is_file($usersFile)) {
    fwrite(STDERR, "users.json not found at {$usersFile}\n");
    exit(1);
}

$usersRaw = file_get_contents($usersFile);
if (!is_string($usersRaw) || trim($usersRaw) === '') {
    fwrite(STDERR, "users.json is empty or unreadable.\n");
    exit(1);
}

$usersDecoded = json_decode($usersRaw, true);
if (!is_array($usersDecoded)) {
    fwrite(STDERR, "users.json has invalid JSON structure.\n");
    exit(1);
}

try {
    $pdo = createPdoFromEnvironment();
    ensureSchema($pdo);
} catch (Throwable $error) {
    fwrite(STDERR, "Database connection failed: {$error->getMessage()}\n");
    exit(1);
}

$importedUsers = 0;
$importedData = 0;
$missingAccountFiles = 0;

foreach ($usersDecoded as $username => $meta) {
    $usernameStr = strtolower(trim((string) $username));
    $passwordHash = is_array($meta) ? (string) ($meta['passwordHash'] ?? '') : '';

    if ($usernameStr === '' || $passwordHash === '') {
        continue;
    }

    $userId = upsertUser($pdo, $usernameStr, $passwordHash);
    $importedUsers += 1;

    $accountPath = $accountsDir . '/' . safeUsernameFile($usernameStr) . '.json';
    if (!is_file($accountPath)) {
        $missingAccountFiles += 1;
        upsertJournalData($pdo, $userId, [
            'settings' => defaultSettings(),
            'trades' => [],
            'reflections' => [],
            'replayNotes' => new stdClass(),
        ]);
        continue;
    }

    $accountRaw = file_get_contents($accountPath);
    $accountDecoded = is_string($accountRaw) ? json_decode($accountRaw, true) : null;
    $payload = is_array($accountDecoded) ? $accountDecoded : [];

    upsertJournalData($pdo, $userId, [
        'settings' => sanitizeSettings($payload['settings'] ?? []),
        'trades' => sanitizeArray($payload['trades'] ?? []),
        'reflections' => sanitizeArray($payload['reflections'] ?? []),
        'replayNotes' => sanitizeReplayNotes($payload['replayNotes'] ?? []),
    ]);
    $importedData += 1;
}

fwrite(STDOUT, "Migration completed.\n");
fwrite(STDOUT, "- Users imported/upserted: {$importedUsers}\n");
fwrite(STDOUT, "- Journal records imported/upserted: {$importedData}\n");
fwrite(STDOUT, "- Missing account files: {$missingAccountFiles}\n");

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

function upsertUser(PDO $pdo, string $username, string $passwordHash): int
{
    $stmt = $pdo->prepare(
        <<<SQL
        INSERT INTO journal_users (username, password_hash)
        VALUES (:username, :password_hash)
        ON CONFLICT (username) DO UPDATE SET
            password_hash = EXCLUDED.password_hash
        RETURNING id
        SQL
    );
    $stmt->execute([
        ':username' => $username,
        ':password_hash' => $passwordHash,
    ]);

    $id = (int) $stmt->fetchColumn();
    if ($id <= 0) {
        throw new RuntimeException("Failed to upsert user: {$username}");
    }

    return $id;
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

function defaultSettings(): array
{
    return [
        'journalName' => 'Chester',
        'startingBalance' => 10000,
        'balanceOverride' => 0,
        'dailyMaxLoss' => 300,
        'weeklyMaxLoss' => 1000,
        'riskPerTrade' => 1,
        'equityGoal' => 15000,
    ];
}

function sanitizeSettings(array $settings): array
{
    $defaults = defaultSettings();
    return [
        'journalName' => sanitizeJournalName($settings['journalName'] ?? $defaults['journalName']),
        'startingBalance' => positiveNumber($settings['startingBalance'] ?? $defaults['startingBalance'], $defaults['startingBalance']),
        'balanceOverride' => nonNegativeNumber($settings['balanceOverride'] ?? $defaults['balanceOverride'], $defaults['balanceOverride']),
        'dailyMaxLoss' => nonNegativeNumber($settings['dailyMaxLoss'] ?? $defaults['dailyMaxLoss'], $defaults['dailyMaxLoss']),
        'weeklyMaxLoss' => nonNegativeNumber($settings['weeklyMaxLoss'] ?? $defaults['weeklyMaxLoss'], $defaults['weeklyMaxLoss']),
        'riskPerTrade' => nonNegativeNumber($settings['riskPerTrade'] ?? $defaults['riskPerTrade'], $defaults['riskPerTrade']),
        'equityGoal' => positiveNumber($settings['equityGoal'] ?? $defaults['equityGoal'], $defaults['equityGoal']),
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

function encodeJsonForDb($value): string
{
    $json = json_encode($value, JSON_UNESCAPED_SLASHES);
    if (!is_string($json)) {
        throw new RuntimeException('Failed to encode JSON payload for DB write.');
    }

    return $json;
}

function safeUsernameFile(string $username): string
{
    $safe = preg_replace('/[^a-z0-9._-]/', '_', strtolower($username));
    if (!is_string($safe) || $safe === '') {
        return 'unknown';
    }

    return $safe;
}
