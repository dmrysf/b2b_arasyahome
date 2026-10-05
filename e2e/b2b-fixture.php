<?php

declare(strict_types=1);

// Builds a disposable database for the B2B real-API Chromium suite with the real Operations API code checked out
// at ./operations-api (pinned in e2e/operations-api.ref), bootstraps the single protected root identity through
// the real CLI service and creates controlled identities through the real management API: one with B2B access and
// a "B2B sales" role holding the four company permissions, one with order permissions, one with current account permissions, and one with Staff access only. It refuses any database
// whose name does not contain both "e2e" and "test", never touches production and creates no orders or companies.

use Arasya\Operations\Application\Container;
use Arasya\Operations\Database\Connection;
use Arasya\Operations\Database\MigrationRunner;
use Arasya\Operations\Database\SqlFileRunner;
use Arasya\Operations\Iam\RootBootstrapService;
use Arasya\Operations\Tests\OperationsTestSupport as T;

$api = dirname(__DIR__) . '/operations-api';
require $api . '/bootstrap.php';
require $api . '/tests/OperationsTestSupport.php';

$dbName = (string) getenv('ARASYA_E2E_DB_NAME');
if (preg_match('/^[a-z0-9_]*e2e[a-z0-9_]*test[a-z0-9_]*$|^[a-z0-9_]*test[a-z0-9_]*e2e[a-z0-9_]*$/D', $dbName) !== 1) {
    fwrite(STDERR, "ARASYA_E2E_DB_NAME must be a dedicated database whose name contains both 'e2e' and 'test'.\n");
    exit(2);
}
$host = (string) (getenv('ARASYA_TEST_DB_HOST') ?: '127.0.0.1');
$port = (int) (getenv('ARASYA_TEST_DB_PORT') ?: 3306);
$server = new PDO(sprintf('mysql:host=%s;port=%d;charset=utf8mb4', $host, $port), (string) getenv('ARASYA_TEST_DB_USER'), (string) getenv('ARASYA_TEST_DB_PASSWORD'), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$server->exec("DROP DATABASE IF EXISTS `{$dbName}`");
$server->exec("CREATE DATABASE `{$dbName}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");

$b2bOrigin = 'http://127.0.0.1:4179';
$adminOrigin = 'http://127.0.0.1:4175';
$config = T::config($dbName, [$b2bOrigin, $adminOrigin, T::ORIGIN]);
$pdo = Connection::create($config);
(new MigrationRunner($pdo))->migrate($api . '/database/migrations');
$seeds = glob($api . '/database/seeds/*.sql') ?: [];
sort($seeds, SORT_STRING);
foreach ($seeds as $seed) {
    (new SqlFileRunner($pdo))->run($seed);
}
if ((int) $pdo->query("SELECT COUNT(*) FROM applications WHERE application_key = 'b2b' AND status = 'active'")->fetchColumn() !== 1) {
    throw new RuntimeException('The pinned Operations API does not register the B2B application (migration 008).');
}
if ((int) $pdo->query("SELECT COUNT(*) FROM permissions WHERE permission_key LIKE 'b2b.companies.%' AND role_grantable = 1")->fetchColumn() !== 4) {
    throw new RuntimeException('The pinned Operations API does not provide the B2B company permissions (migration 009).');
}

$container = new Container($config, $pdo);
$kernel = $container->kernel();
$bootstrapPassword = (new RootBootstrapService($pdo, $container->passwordHasher(), $container->clock()))->bootstrap('b2b-e2e-root-bootstrap');
$rootPassword = 'root b2b e2e permanent passphrase 2026';
$call = static function (string $method, string $path, ?array $json, array $who) use ($kernel, $adminOrigin): array {
    $response = T::call($kernel, $method, $path, $json, ['origin' => $adminOrigin, 'x-csrf-token' => $who['csrf']], $who['cookie']);
    if ($response['status'] >= 300) {
        throw new RuntimeException("{$method} {$path} failed: " . json_encode($response['body']));
    }
    return $response;
};
$root = T::login($kernel, RootBootstrapService::ROOT_USERNAME, $bootstrapPassword);
$changed = $call('POST', '/auth/password', ['currentPassword' => $bootstrapPassword, 'newPassword' => $rootPassword], $root);
preg_match('/^arasya_session=([^;]+);/', $changed['headers']['Set-Cookie'], $match);
$root = ['cookie' => rawurldecode($match[1]), 'csrf' => (string) $changed['body']['csrfToken']];

$departmentId = (int) $pdo->query("SELECT department_id FROM departments WHERE status = 'active' ORDER BY department_id LIMIT 1")->fetchColumn();
$salesRole = (int) $call('POST', '/management/roles', [
    'name' => 'Vânzări B2B (E2E)', 'description' => null, 'authorityRank' => 200,
    'permissions' => ['b2b.companies.view', 'b2b.companies.create', 'b2b.companies.update', 'b2b.companies.manage_status'],
], $root)['body']['role']['id'];
$create = static function (string $name, string $username, array $applications, array $stages, array $roles = []) use ($call, $root, $departmentId): array {
    $body = $call('POST', '/management/employees', [
        'displayName' => $name, 'username' => $username, 'departmentId' => $departmentId, 'positionTitle' => null, 'managerId' => null,
        'applications' => $applications, 'roleIds' => $roles, 'stageIds' => $stages, 'status' => 'active',
    ], $root)['body'];
    return ['id' => (string) $body['employee']['id'], 'username' => $username, 'name' => $name, 'temporaryPassword' => (string) $body['temporaryPassword']];
};

$orderRole = (int) $call('POST', '/management/roles', [
    'name' => 'Comenzi B2B (E2E)', 'description' => null, 'authorityRank' => 200,
    'permissions' => ['b2b.companies.view', 'b2b.orders.view', 'b2b.orders.create', 'b2b.orders.update', 'b2b.orders.manage_status'],
], $root)['body']['role']['id'];

$accountRole = (int) $call('POST', '/management/roles', [
    'name' => 'Conturi curente B2B (E2E)', 'description' => null, 'authorityRank' => 200,
    'permissions' => ['b2b.companies.view', 'b2b.orders.view', 'b2b.accounts.view', 'b2b.accounts.record_payment', 'b2b.accounts.adjust', 'b2b.accounts.reverse', 'b2b.accounts.export'],
], $root)['body']['role']['id'];

$productionRole = (int) $call('POST', '/management/roles', [
    'name' => 'Trimitere producție B2B (E2E)', 'authorityRank' => 200,
    'permissions' => ['b2b.companies.view','b2b.orders.view','b2b.orders.create','b2b.orders.update','b2b.orders.manage_status','b2b.production.view','b2b.production.submit'],
], $root)['body']['role']['id'];
$projectRole = (int) $call('POST', '/management/roles', [
    'name' => 'Proiecte B2B (E2E)', 'authorityRank' => 200,
    'permissions' => ['b2b.companies.view','b2b.orders.view','b2b.orders.create','b2b.orders.update','b2b.orders.manage_status','b2b.production.view','b2b.production.submit',
        'b2b.projects.view','b2b.projects.create','b2b.projects.update','b2b.projects.archive','b2b.projects.convert'],
], $root)['body']['role']['id'];
$operatorRole = (int) $call('POST', '/management/roles', [
    'name' => 'Operator Staff (E2E)', 'authorityRank' => 200,
    'permissions' => ['orders.view_mine','orders.scan','orders.claim','orders.advance_stage'],
], $root)['body']['role']['id'];

echo json_encode([
    'origins' => ['b2b' => $b2bOrigin, 'admin' => $adminOrigin],
    'root' => ['username' => RootBootstrapService::ROOT_USERNAME, 'password' => $rootPassword],
    'b2bUser' => $create('Elena Vânzări', 'elena.vanzari.e2e', ['b2b'], [], [$salesRole]),
    'salesRoleId' => $salesRole,
    'orderUser' => $create('Ana Comenzi', 'ana.comenzi.e2e', ['b2b'], [], [$orderRole]),
    'accountUser' => $create('Ioana Contabil', 'ioana.conturi.e2e', ['b2b'], [], [$accountRole]),
    'productionUser' => $create('Dana Producție', 'dana.productie.e2e', ['b2b'], [], [$productionRole]),
    'projectUser' => $create('Radu Proiecte', 'radu.proiecte.e2e', ['b2b'], [], [$projectRole]),
    'operatorUser' => $create('Dan Atelier', 'dan.atelier.e2e', ['staff'], ['waiting','material-preparation'], [$operatorRole]),
    'staffUser' => $create('Mihai Atelier', 'mihai.atelier.e2e', ['staff'], ['waiting']),
], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), "\n";
