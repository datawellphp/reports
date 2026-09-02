<?php

declare(strict_types=1);

namespace Datawell\Reports\Http\Controllers;

use Datawell\Reports\Models\Report;
use Datawell\Reports\Reports;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ReportsController extends Controller
{
    public function __construct(private readonly Reports $reports) {}

    /**
     * Every report the viewer may see, each with the viewer's validity verdict
     * from a dry run (D38) — so the list can show placeholders without running N queries.
     */
    public function index(Request $request): JsonResponse
    {
        $user = $this->user($request);

        return $this->respond(fn (): array => [
            'reports' => $this->reports->visibleTo($user)
                ->orderByDesc('updated_at')
                ->get()
                ->map(fn (Report $report): array => $this->reports->serialize($report, $user, withValidity: true))
                ->values()
                ->all(),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $this->user($request);

        return $this->respond(
            fn (): array => $this->reports->serialize($this->reports->create($user, $request->all()), $user, withValidity: true),
            201,
        );
    }

    public function show(Request $request, int|string $report): JsonResponse
    {
        $user = $this->user($request);

        return $this->respond(function () use ($report, $user): ?array {
            $found = $this->reports->findFor($report, $user);

            return $found === null ? null : $this->reports->serialize($found, $user, withValidity: true);
        });
    }

    public function update(Request $request, int|string $report): JsonResponse
    {
        $user = $this->user($request);

        return $this->respond(function () use ($request, $report, $user): ?array {
            $found = $this->reports->findFor($report, $user);

            return $found === null
                ? null
                : $this->reports->serialize($this->reports->update($found, $user, $request->all()), $user, withValidity: true);
        });
    }

    public function destroy(Request $request, int|string $report): JsonResponse
    {
        $user = $this->user($request);

        return $this->respond(function () use ($report, $user): ?array {
            $found = $this->reports->findFor($report, $user);

            if ($found === null) {
                return null;
            }

            $this->reports->delete($found, $user);

            return ['deleted' => true];
        });
    }

    public function clone(Request $request, int|string $report): JsonResponse
    {
        $user = $this->user($request);

        return $this->respond(function () use ($report, $user): ?array {
            $found = $this->reports->findFor($report, $user);

            return $found === null
                ? null
                : $this->reports->serialize($this->reports->clone($found, $user), $user, withValidity: true);
        }, 201);
    }

    /**
     * Replay the report as the viewer: their scope, their permissions, never the author's numbers.
     */
    public function run(Request $request, int|string $report): JsonResponse
    {
        $user = $this->user($request);

        return $this->respond(function () use ($report, $user): ?array {
            $found = $this->reports->findFor($report, $user);

            return $found === null ? null : $this->reports->run($found, $user)->toArray();
        });
    }
}
