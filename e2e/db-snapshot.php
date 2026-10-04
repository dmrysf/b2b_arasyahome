<?php

declare(strict_types=1);

// Prints row counts of the production tables (and, separately, of the B2B company tables) in the disposable B2B
// E2E database, so the suite can prove that B2B creates and mutates no production data.

use Arasya\Operations\Database\Connection;
use Arasya\Operations\Tests\OperationsTestSupport as T;

$api = dirname(__DIR__) . '/operations-api';
require $api . '/bootstrap.php';
require $api . '/tests/OperationsTestSupport.php';

$dbName = (string) getenv('ARASYA_E2E_DB_NAME');
if (!str_contains($dbName, 'e2e') || !str_contains($dbName, 'test')) {
    fwrite(STDERR, "ARASYA_E2E_DB_NAME must name the disposable E2E database.\n");
    exit(2);
}
$pdo = Connection::create(T::config($dbName));
$counts = [];
/** @var array<string, int|string> $counts */
foreach (['operational_orders', 'operational_order_items', 'order_activity_events', 'order_projection_receipts', 'order_operation_idempotency', 'employee_order_relations'] as $table) {
    $counts[$table] = (int) $pdo->query("SELECT COUNT(*) FROM {$table}")->fetchColumn();
}
$counts['production_state'] = (string) $pdo->query("SELECT CONCAT(COUNT(*), ':', COALESCE(SUM(production_version), 0), ':', COALESCE(SUM(version), 0)) FROM operational_orders")->fetchColumn();
$counts['b2b_companies'] = (int) $pdo->query('SELECT COUNT(*) FROM b2b_companies')->fetchColumn();
echo json_encode($counts, JSON_THROW_ON_ERROR), "\n";
