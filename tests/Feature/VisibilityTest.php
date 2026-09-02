<?php

declare(strict_types=1);

use Datawell\Reports\Models\Report;
use Datawell\Reports\Reports;
use Datawell\Reports\Tests\Fixtures\Models\User;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Database\Eloquent\Builder;

beforeEach(function (): void {
    $this->seedDatabase();
});

it('lets the host narrow shared reports with the visibility hook', function (): void {
    $me = $this->viewer();
    $sameWorkspace = $this->privilegedViewer();
    $elsewhere = User::query()->create([
        'name' => 'Elsewhere', 'email' => null, 'workspace_id' => 9, 'abilities' => [],
    ]);

    $this->report($sameWorkspace, ['title' => 'Near', 'shared' => true]);
    $this->report($elsewhere, ['title' => 'Far', 'shared' => true]);
    $this->report($me, ['title' => 'Mine']);

    /** @var Reports $reports */
    $reports = app(Reports::class);

    // A tenancy rule: shared reports are visible only from owners in my workspace.
    $reports->resolveVisibilityUsing(function (Builder $query, Authenticatable $viewer): void {
        $query->whereIn('owner_id', fn ($owners) => $owners
            ->select('id')->from('users')
            ->where('workspace_id', $viewer->getAttribute('workspace_id')));
    });

    expect($reports->visibleTo($me)->pluck('title')->all())->toEqualCanonicalizing(['Near', 'Mine']);
});

it('validates as the viewer and reads an unavailable source as a source error', function (): void {
    $viewer = $this->viewer();
    $report = $this->report($viewer, ['source' => 'gone']);

    $verdict = app(Reports::class)->validate($report, $viewer);

    expect($verdict->fails())->toBeTrue()
        ->and($verdict->errors)->toHaveKey('source');
});

it('drops request keys a report may not store', function (): void {
    $owner = $this->viewer();

    $report = app(Reports::class)->create($owner, [
        'title' => 'x', 'source' => 'people',
        'request' => [
            'groupBy' => [['key' => 'active']],
            'aggregates' => [['fn' => 'count']],
            'select' => ['name'],
            'page' => ['size' => 5],
        ],
        'chart' => ['type' => 'table'],
    ]);

    expect(Report::query()->find($report->id)?->request)->toBe([
        'groupBy' => [['key' => 'active']],
        'aggregates' => [['fn' => 'count']],
    ]);
});
