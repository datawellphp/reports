<?php

declare(strict_types=1);

namespace Datawell\Reports;

use Illuminate\Support\ServiceProvider;

class ReportsServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        $this->mergeConfigFrom(__DIR__.'/../config/reports.php', 'reports');

        $this->app->singleton(Reports::class);
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        $this->loadRoutesFrom(__DIR__.'/../routes/reports.php');

        if (! $this->app->runningInConsole()) {
            return;
        }

        $this->publishes([
            __DIR__.'/../config/reports.php' => config_path('reports.php'),
        ], ['reports', 'reports-config']);

        $this->publishesMigrations([
            __DIR__.'/../database/migrations' => database_path('migrations'),
        ], ['reports', 'reports-migrations']);

        // The report builder, card and chart (D62), published into the host app
        // Breeze-style next to the tables component: the app owns the copy.
        $this->publishes([
            __DIR__.'/../resources/js' => resource_path('js/datawell/reports'),
        ], ['reports', 'reports-frontend']);
    }
}
