<?php

declare(strict_types=1);

namespace Datawell\Reports;

use Closure;
use Datawell\Exceptions\SourceNotFoundException;
use Datawell\Executor;
use Datawell\Query\QueryRequest;
use Datawell\Reports\Models\Report;
use Datawell\Result\BucketResult;
use Datawell\Validation\ValidationException;
use Datawell\Validation\ValidationReport;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Contracts\Config\Repository as Config;
use Illuminate\Contracts\Validation\Factory as ValidatorFactory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Validation\ValidationException as LaravelValidationException;

/**
 * Saved reports (D61): owner-scoped, optionally shared read-only, edited by
 * clone, and always replayed as the viewer through the core executor.
 */
final class Reports
{
    /** @var list<string> The request keys a report may store; everything else is the executor's business per run. */
    private const array REQUEST_KEYS = ['parameters', 'search', 'filters', 'groupBy', 'aggregates'];

    /** @var (Closure(Builder<Report>, Authenticatable): void)|null */
    private ?Closure $visibility = null;

    public function __construct(
        private readonly Executor $executor,
        private readonly ValidatorFactory $validators,
        private readonly Config $config,
    ) {}

    /**
     * Narrow which *shared* reports a viewer sees — the tenancy hook. The
     * package ships no team model; a host that has one applies it here.
     *
     * @param  Closure(Builder<Report>, Authenticatable): void  $callback
     */
    public function resolveVisibilityUsing(Closure $callback): void
    {
        $this->visibility = $callback;
    }

    /**
     * Everything the viewer may see: their own reports plus shared ones.
     *
     * @return Builder<Report>
     */
    public function visibleTo(Authenticatable $viewer): Builder
    {
        return Report::query()->where(function (Builder $query) use ($viewer): void {
            $query->where(fn (Builder $own) => $own
                ->where('owner_type', Report::ownerTypeOf($viewer))
                ->where('owner_id', $viewer->getAuthIdentifier()));

            $query->orWhere(function (Builder $shared) use ($viewer): void {
                $shared->where('shared', true);

                if ($this->visibility instanceof Closure) {
                    ($this->visibility)($shared, $viewer);
                }
            });
        });
    }

    /**
     * A report by id, or null when it does not exist or the viewer may not see it (D18).
     */
    public function findFor(int|string $id, Authenticatable $viewer): ?Report
    {
        return $this->visibleTo($viewer)->whereKey($id)->first();
    }

    /**
     * @param  array<string, mixed>  $attributes
     *
     * @throws ValidationException
     */
    public function create(Authenticatable $owner, array $attributes): Report
    {
        $report = new Report($this->validated($attributes, $owner));
        $report->owner_type = Report::ownerTypeOf($owner);
        $report->owner_id = $owner->getAuthIdentifier();
        $report->save();

        return $report;
    }

    /**
     * @param  array<string, mixed>  $attributes
     *
     * @throws AuthorizationException when the actor is not the owner
     * @throws ValidationException
     */
    public function update(Report $report, Authenticatable $actor, array $attributes): Report
    {
        $this->assertOwner($report, $actor);

        $report->fill($this->validated($attributes, $actor))->save();

        return $report;
    }

    /**
     * @throws AuthorizationException when the actor is not the owner
     */
    public function delete(Report $report, Authenticatable $actor): void
    {
        $this->assertOwner($report, $actor);

        $report->delete();
    }

    /**
     * Anyone who can see a report may clone it; the clone is theirs and starts private.
     */
    public function clone(Report $report, Authenticatable $actor): Report
    {
        $clone = $report->replicate(['shared']);
        $clone->title = $report->isOwnedBy($actor) ? 'Copy of '.$report->title : $report->title;
        $clone->shared = false;
        $clone->owner_type = Report::ownerTypeOf($actor);
        $clone->owner_id = $actor->getAuthIdentifier();
        $clone->save();

        return $clone;
    }

    /**
     * Dry-run the stored request against the viewer's schema (D38). A source
     * the viewer cannot see reads as an error on `source`, not an exception:
     * the list view needs a verdict per report, never a crash.
     */
    public function validate(Report $report, Authenticatable $viewer): ValidationReport
    {
        try {
            return $this->executor->validate($this->requestOf($report), $viewer);
        } catch (SourceNotFoundException) {
            return new ValidationReport(
                QueryRequest::fromArray(['source' => $report->source]),
                ['source' => ['This report uses a source that is not available to you.']],
            );
        } catch (ValidationException $exception) {
            return new ValidationReport(QueryRequest::fromArray(['source' => $report->source]), $exception->errors());
        }
    }

    /**
     * Replay the report as the viewer. Never the author's data.
     *
     * @throws SourceNotFoundException
     * @throws ValidationException
     */
    public function run(Report $report, Authenticatable $viewer): BucketResult
    {
        $result = $this->executor->run($this->requestOf($report), $viewer);

        if (! $result instanceof BucketResult) {
            throw ValidationException::withErrors(['aggregates' => ['A report must group or aggregate.']]);
        }

        return $result;
    }

    /**
     * The wire shape of a report, optionally with the viewer's validity verdict.
     *
     * @return array<string, mixed>
     */
    public function serialize(Report $report, Authenticatable $viewer, bool $withValidity = false): array
    {
        $owner = $report->owner;

        $data = [
            'id' => $report->id,
            'title' => $report->title,
            'description' => $report->description,
            'source' => $report->source,
            'request' => $report->request,
            'chart' => $report->chart,
            'shared' => $report->shared,
            'owner' => [
                'id' => $report->owner_id,
                'label' => $owner instanceof Model ? $owner->getAttribute('name') : null,
            ],
            'mine' => $report->isOwnedBy($viewer),
            'createdAt' => $report->created_at?->toIso8601String(),
            'updatedAt' => $report->updated_at?->toIso8601String(),
        ];

        if ($withValidity) {
            $verdict = $this->validate($report, $viewer);
            $data['valid'] = $verdict->passes();
            $data['errors'] = $verdict->errors;
        }

        return $data;
    }

    /**
     * @return array<string, mixed>
     */
    private function requestOf(Report $report): array
    {
        return ['source' => $report->source] + $report->request;
    }

    /**
     * Package-level shape checks, then the core's dry run as the actor: a
     * report that would not run for its owner is not worth saving.
     *
     * @param  array<string, mixed>  $attributes
     * @return array<string, mixed>
     *
     * @throws ValidationException
     */
    private function validated(array $attributes, Authenticatable $actor): array
    {
        /** @var list<string> $types */
        $types = $this->config->get('reports.chart_types', []);

        try {
            $clean = $this->validators->make($attributes, [
                'title' => ['required', 'string', 'max:150'],
                'description' => ['nullable', 'string', 'max:1000'],
                'source' => ['required', 'string'],
                'request' => ['required', 'array'],
                'request.parameters' => ['sometimes', 'array'],
                'request.search' => ['sometimes', 'nullable', 'string'],
                'request.filters' => ['sometimes', 'array'],
                'request.groupBy' => ['sometimes', 'array'],
                'request.aggregates' => ['required', 'array', 'min:1'],
                'chart' => ['required', 'array'],
                'chart.type' => ['required', 'string', 'in:'.implode(',', $types)],
                'chart.options' => ['sometimes', 'array'],
                'shared' => ['sometimes', 'boolean'],
            ])->validate();
        } catch (LaravelValidationException $exception) {
            throw ValidationException::withErrors($exception->errors());
        }

        /** @var array<string, mixed> $request */
        $request = $clean['request'];
        $request = array_intersect_key($request, array_flip(self::REQUEST_KEYS));

        if (($clean['chart']['type'] ?? null) !== 'number' && ($request['groupBy'] ?? []) === []) {
            throw ValidationException::withErrors(['request.groupBy' => ['This chart type needs at least one dimension.']]);
        }

        try {
            $this->executor->validate(['source' => $clean['source']] + $request, $actor)->throwIfFails();
        } catch (SourceNotFoundException) {
            throw ValidationException::withErrors(['source' => ['Unknown source.']]);
        }

        return [
            'title' => $clean['title'],
            'description' => $clean['description'] ?? null,
            'source' => $clean['source'],
            'request' => $request,
            'chart' => ['type' => $clean['chart']['type'], 'options' => $clean['chart']['options'] ?? []],
            'shared' => (bool) ($clean['shared'] ?? false),
        ];
    }

    /**
     * @throws AuthorizationException
     */
    private function assertOwner(Report $report, Authenticatable $actor): void
    {
        if (! $report->isOwnedBy($actor)) {
            throw new AuthorizationException('Only the owner can change this report. Clone it to make your own.');
        }
    }
}
