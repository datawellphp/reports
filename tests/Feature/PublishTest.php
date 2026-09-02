<?php

declare(strict_types=1);

use Illuminate\Support\Facades\File;

it('publishes the front-end next to the tables component with relative imports', function (): void {
    $target = resource_path('js/datawell/reports');
    File::deleteDirectory($target);

    $this->artisan('vendor:publish', ['--tag' => 'reports-frontend'])->assertSuccessful();

    expect(File::exists($target.'/report-builder.tsx'))->toBeTrue()
        ->and(File::exists($target.'/report-card.tsx'))->toBeTrue()
        ->and(File::exists($target.'/report-chart.tsx'))->toBeTrue()
        ->and(File::exists($target.'/reports-lib.ts'))->toBeTrue();

    // The published files reach the tables component as a sibling (../lib, ../filters).
    foreach (File::files($target) as $file) {
        expect($file->getContents())->not->toContain('@/datawell/');
    }

    File::deleteDirectory($target);
});

it('publishes the migration and config', function (): void {
    $this->artisan('vendor:publish', ['--tag' => 'reports-migrations'])->assertSuccessful();
    $this->artisan('vendor:publish', ['--tag' => 'reports-config'])->assertSuccessful();

    expect(File::glob(database_path('migrations/*_create_datawell_reports_table.php')))->not->toBeEmpty()
        ->and(File::exists(config_path('reports.php')))->toBeTrue();
});
