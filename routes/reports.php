<?php

declare(strict_types=1);

use Datawell\Reports\Http\Controllers\ReportsController;
use Illuminate\Support\Facades\Route;

if (! config('reports.routes.enabled', true)) {
    return;
}

Route::group([
    'prefix' => config('reports.routes.prefix', 'datawell/reports'),
    'as' => 'datawell.reports.',
    'middleware' => config('reports.routes.middleware', ['web', 'auth']),
], function (): void {
    Route::get('/', [ReportsController::class, 'index'])->name('index');
    Route::post('/', [ReportsController::class, 'store'])->name('store');
    Route::get('{report}', [ReportsController::class, 'show'])->name('show');
    Route::put('{report}', [ReportsController::class, 'update'])->name('update');
    Route::delete('{report}', [ReportsController::class, 'destroy'])->name('destroy');
    Route::post('{report}/clone', [ReportsController::class, 'clone'])->name('clone');
    Route::post('{report}/run', [ReportsController::class, 'run'])->name('run');
});
