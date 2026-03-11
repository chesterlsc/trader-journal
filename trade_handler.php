<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

$action = isset($_GET['action']) ? (string) $_GET['action'] : 'load';
$dataDir = __DIR__ . DIRECTORY_SEPARATOR . 'data';
$dataFile = $dataDir . DIRECTORY_SEPARATOR . 'journal_data.json';

$defaults = [
    'settings' => [
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

if (!is_dir($dataDir)) {
    if (!mkdir($dataDir, 0775, true) && !is_dir($dataDir)) {
        respond(500, ['ok' => false, 'error' => 'Failed to create data directory.']);
    }
}

if ($action === 'save') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        respond(405, ['ok' => false, 'error' => 'Use POST for save action.']);
    }

    $rawBody = file_get_contents('php://input');
    if ($rawBody === false || trim($rawBody) === '') {
        respond(400, ['ok' => false, 'error' => 'Empty request body.']);
    }

    $decoded = json_decode($rawBody, true);
    if (!is_array($decoded)) {
        respond(400, ['ok' => false, 'error' => 'Invalid JSON payload.']);
    }

    $payload = [
        'updatedAt' => date(DATE_ATOM),
        'settings' => sanitizeSettings($decoded['settings'] ?? []),
        'trades' => sanitizeArray($decoded['trades'] ?? []),
        'reflections' => sanitizeArray($decoded['reflections'] ?? []),
        'replayNotes' => sanitizeObject($decoded['replayNotes'] ?? []),
    ];

    $json = json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    if ($json === false) {
        respond(500, ['ok' => false, 'error' => 'Failed to encode journal data.']);
    }

    $written = file_put_contents($dataFile, $json . PHP_EOL, LOCK_EX);
    if ($written === false) {
        respond(500, ['ok' => false, 'error' => 'Failed to write journal data.']);
    }

    respond(200, ['ok' => true, 'message' => 'Journal data saved.', 'updatedAt' => $payload['updatedAt']]);
}

if ($action === 'load') {
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

respond(400, ['ok' => false, 'error' => 'Unknown action. Use ?action=load or ?action=save.']);

function sanitizeSettings(array $settings): array
{
    return [
        'startingBalance' => positiveNumber($settings['startingBalance'] ?? 10000, 10000),
        'balanceOverride' => nonNegativeNumber($settings['balanceOverride'] ?? 0, 0),
        'dailyMaxLoss' => nonNegativeNumber($settings['dailyMaxLoss'] ?? 300, 300),
        'weeklyMaxLoss' => nonNegativeNumber($settings['weeklyMaxLoss'] ?? 1000, 1000),
        'riskPerTrade' => nonNegativeNumber($settings['riskPerTrade'] ?? 1, 1),
        'equityGoal' => positiveNumber($settings['equityGoal'] ?? 15000, 15000),
    ];
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
