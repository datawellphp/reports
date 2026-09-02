<?php

declare(strict_types=1);

namespace Datawell\Reports\Tests;

use Datawell\DatawellServiceProvider;
use Datawell\Reports\Models\Report;
use Datawell\Reports\ReportsServiceProvider;
use Datawell\Reports\Tests\Fixtures\Models\User;
use Datawell\Reports\Tests\Fixtures\Sources\People;
use Datawell\Reports\Tests\Fixtures\Sources\Tags;
use Illuminate\Support\Facades\Gate;
use Orchestra\Testbench\TestCase as Orchestra;

abstract class TestCase extends Orchestra
{
    protected function getPackageProviders($app): array
    {
        return [
            DatawellServiceProvider::class,
            ReportsServiceProvider::class,
        ];
    }

    protected function defineEnvironment($app): void
    {
        $app['config']->set('datawell.sources', [People::class, Tags::class]);
        $app['config']->set('datawell.lint.enabled', true);
        $app['config']->set('app.timezone', 'UTC');
        $app['config']->set('app.key', 'base64:'.base64_encode(random_bytes(32)));
    }

    protected function setUp(): void
    {
        parent::setUp();

        Gate::define('view-contact-details', fn (User $user): bool => $user->hasAbility('view-contact-details'));
    }

    protected function seedDatabase(): void
    {
        $schema = require __DIR__.'/Fixtures/Database/schema.php';
        $schema->create();
        $schema->seed();

        $reports = require __DIR__.'/../database/migrations/2026_09_02_000000_create_datawell_reports_table.php';
        $reports->up();
    }

    protected function viewer(): User
    {
        return User::query()->create(['name' => 'Viewer', 'email' => 'viewer@acme.test', 'workspace_id' => 2, 'abilities' => []]);
    }

    protected function privilegedViewer(): User
    {
        return User::query()->create(['name' => 'Privileged', 'email' => 'privileged@acme.test', 'workspace_id' => 2, 'abilities' => ['view-contact-details']]);
    }

    /**
     * A valid "active people, counted" report owned by the given user.
     *
     * @param  array<string, mixed>  $overrides
     */
    protected function report(User $owner, array $overrides = []): Report
    {
        return Report::query()->create(array_replace([
            'owner_type' => $owner->getMorphClass(),
            'owner_id' => $owner->getKey(),
            'title' => 'People by activity',
            'description' => null,
            'source' => 'people',
            'request' => ['groupBy' => [['key' => 'active']], 'aggregates' => [['fn' => 'count']]],
            'chart' => ['type' => 'bar', 'options' => []],
            'shared' => false,
        ], $overrides));
    }
}
