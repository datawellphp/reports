<?php

declare(strict_types=1);

use Datawell\Reports\Models\Report;

beforeEach(function (): void {
    $this->seedDatabase();
});

it('creates a report for the authenticated user and returns it with a verdict', function (): void {
    $owner = $this->viewer();

    $response = $this->actingAs($owner)
        ->postJson('/datawell/reports', [
            'title' => 'Active people',
            'source' => 'people',
            'request' => [
                'filters' => ['conditions' => [['filter' => 'active', 'operator' => 'is', 'value' => true]]],
                'groupBy' => [['key' => 'active']],
                'aggregates' => [['fn' => 'count']],
            ],
            'chart' => ['type' => 'bar'],
        ])
        ->assertCreated()
        ->json();

    expect($response['title'])->toBe('Active people')
        ->and($response['mine'])->toBeTrue()
        ->and($response['shared'])->toBeFalse()
        ->and($response['valid'])->toBeTrue()
        ->and($response['chart'])->toBe(['type' => 'bar', 'options' => []])
        ->and($response['request'])->not->toHaveKey('source')
        ->and(Report::query()->count())->toBe(1);
});

it('rejects a report whose request would not run for its owner', function (): void {
    $this->actingAs($this->viewer())
        ->postJson('/datawell/reports', [
            'title' => 'By email',
            'source' => 'people',
            'request' => ['groupBy' => [['key' => 'email']], 'aggregates' => [['fn' => 'count']]],
            'chart' => ['type' => 'bar'],
        ])
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['groupBy.0.key']);
});

it('rejects an unknown chart type, a missing aggregate, and a dimensionless bar', function (): void {
    $owner = $this->viewer();

    $this->actingAs($owner)
        ->postJson('/datawell/reports', [
            'title' => 'x', 'source' => 'people',
            'request' => ['groupBy' => [['key' => 'active']], 'aggregates' => [['fn' => 'count']]],
            'chart' => ['type' => 'sparkline'],
        ])
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['chart.type']);

    $this->actingAs($owner)
        ->postJson('/datawell/reports', [
            'title' => 'x', 'source' => 'people',
            'request' => ['groupBy' => [['key' => 'active']]],
            'chart' => ['type' => 'bar'],
        ])
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['request.aggregates']);

    $this->actingAs($owner)
        ->postJson('/datawell/reports', [
            'title' => 'x', 'source' => 'people',
            'request' => ['aggregates' => [['fn' => 'count']]],
            'chart' => ['type' => 'bar'],
        ])
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['request.groupBy']);
});

it('accepts a number report with no dimension', function (): void {
    $this->actingAs($this->viewer())
        ->postJson('/datawell/reports', [
            'title' => 'Headcount', 'source' => 'people',
            'request' => ['aggregates' => [['fn' => 'count']]],
            'chart' => ['type' => 'number'],
        ])
        ->assertCreated()
        ->assertJsonPath('valid', true);
});

it('treats an unknown source as a validation error on the source key', function (): void {
    $this->actingAs($this->viewer())
        ->postJson('/datawell/reports', [
            'title' => 'x', 'source' => 'nope',
            'request' => ['groupBy' => [['key' => 'active']], 'aggregates' => [['fn' => 'count']]],
            'chart' => ['type' => 'bar'],
        ])
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['source']);
});

it('lists my reports and shared ones, never private reports of others', function (): void {
    $me = $this->viewer();
    $other = $this->privilegedViewer();

    $this->report($me, ['title' => 'Mine']);
    $this->report($other, ['title' => 'Theirs, shared', 'shared' => true]);
    $this->report($other, ['title' => 'Theirs, private']);

    $response = $this->actingAs($me)->getJson('/datawell/reports')->assertOk()->json('reports');

    expect(array_column($response, 'title'))->toEqualCanonicalizing(['Mine', 'Theirs, shared'])
        ->and(collect($response)->firstWhere('title', 'Mine')['mine'])->toBeTrue()
        ->and(collect($response)->firstWhere('title', 'Theirs, shared')['mine'])->toBeFalse()
        ->and(collect($response)->firstWhere('title', 'Theirs, shared')['owner']['label'])->toBe('Privileged');
});

it('marks a shared report the viewer lacks permission for as invalid, with the reason', function (): void {
    $author = $this->privilegedViewer();
    $this->report($author, [
        'title' => 'By email',
        'shared' => true,
        'request' => ['groupBy' => [['key' => 'email']], 'aggregates' => [['fn' => 'count']]],
    ]);

    $response = $this->actingAs($this->viewer())->getJson('/datawell/reports')->assertOk()->json('reports.0');

    expect($response['valid'])->toBeFalse()
        ->and($response['errors'])->toHaveKey('groupBy.0.key');

    $this->actingAs($author)->getJson('/datawell/reports')->assertOk()->assertJsonPath('reports.0.valid', true);
});

it('replays a report as the viewer, never as the author', function (): void {
    $author = $this->privilegedViewer();
    $report = $this->report($author, ['shared' => true]);

    $response = $this->actingAs($this->viewer())
        ->postJson("/datawell/reports/{$report->id}/run")
        ->assertOk()
        ->json();

    expect($response['buckets'])->toHaveCount(1)
        ->and($response['buckets'][0]['count'])->toBe(2)
        ->and($response['applied']['source'])->toBe('people');
});

it('refuses to run a report the viewer cannot see, with an indistinguishable 404', function (): void {
    $report = $this->report($this->privilegedViewer());

    $this->actingAs($this->viewer())->postJson("/datawell/reports/{$report->id}/run")->assertNotFound();
    $this->actingAs($this->viewer())->getJson("/datawell/reports/{$report->id}")->assertNotFound();
    $this->actingAs($this->viewer())->postJson('/datawell/reports/999/run')->assertNotFound();
});

it('returns 422 when running a shared report the viewer lacks permission for', function (): void {
    $report = $this->report($this->privilegedViewer(), [
        'shared' => true,
        'request' => ['groupBy' => [['key' => 'email']], 'aggregates' => [['fn' => 'count']]],
    ]);

    $this->actingAs($this->viewer())
        ->postJson("/datawell/reports/{$report->id}/run")
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['groupBy.0.key']);
});

it('lets only the owner update or delete, and tells a viewer to clone instead', function (): void {
    $owner = $this->privilegedViewer();
    $viewer = $this->viewer();
    $report = $this->report($owner, ['shared' => true]);

    $this->actingAs($viewer)
        ->putJson("/datawell/reports/{$report->id}", ['title' => 'Hijacked'])
        ->assertForbidden()
        ->assertJsonPath('message', 'Only the owner can change this report. Clone it to make your own.');

    $this->actingAs($viewer)->deleteJson("/datawell/reports/{$report->id}")->assertForbidden();

    $this->actingAs($owner)
        ->putJson("/datawell/reports/{$report->id}", [
            'title' => 'Renamed',
            'source' => 'people',
            'request' => $report->request,
            'chart' => ['type' => 'pie', 'options' => ['donut' => true]],
            'shared' => false,
        ])
        ->assertOk()
        ->assertJsonPath('title', 'Renamed')
        ->assertJsonPath('chart.options.donut', true)
        ->assertJsonPath('shared', false);

    $this->actingAs($owner)->deleteJson("/datawell/reports/{$report->id}")->assertOk();

    expect(Report::query()->count())->toBe(0);
});

it('clones a visible report into a private copy owned by the cloner', function (): void {
    $owner = $this->privilegedViewer();
    $viewer = $this->viewer();
    $report = $this->report($owner, ['shared' => true, 'title' => 'Shared one']);

    $clone = $this->actingAs($viewer)
        ->postJson("/datawell/reports/{$report->id}/clone")
        ->assertCreated()
        ->json();

    expect($clone['id'])->not->toBe($report->id)
        ->and($clone['title'])->toBe('Shared one')
        ->and($clone['mine'])->toBeTrue()
        ->and($clone['shared'])->toBeFalse()
        ->and($clone['request'])->toBe($report->request);

    // The clone is theirs to edit; the original is untouched.
    $this->actingAs($viewer)
        ->putJson("/datawell/reports/{$clone['id']}", [
            'title' => 'My version', 'source' => 'people', 'request' => $report->request, 'chart' => ['type' => 'line'],
        ])
        ->assertOk();

    expect($report->refresh()->title)->toBe('Shared one');

    // Cloning your own report names the copy.
    $this->actingAs($owner)
        ->postJson("/datawell/reports/{$report->id}/clone")
        ->assertCreated()
        ->assertJsonPath('title', 'Copy of Shared one');
});

it('cannot clone a report it cannot see', function (): void {
    $report = $this->report($this->privilegedViewer());

    $this->actingAs($this->viewer())->postJson("/datawell/reports/{$report->id}/clone")->assertNotFound();
});

it('requires authentication', function (): void {
    $this->getJson('/datawell/reports')->assertUnauthorized();
});
