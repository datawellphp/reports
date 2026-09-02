<?php

declare(strict_types=1);

namespace Datawell\Reports\Http\Controllers;

use Datawell\Exceptions\SourceNotFoundException;
use Datawell\Validation\ValidationException;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The same response discipline as the tables package (D57): validation
 * failures are 422s with the error bag, anything the viewer may not see is
 * an indistinguishable 404 (D18), and touching a report you can see but do
 * not own is a 403 — no leak, since visibility was already granted.
 */
abstract class Controller
{
    /**
     * @param  callable(): mixed  $callback
     */
    protected function respond(callable $callback, int $status = 200): JsonResponse
    {
        try {
            $payload = $callback();
        } catch (ValidationException $exception) {
            return new JsonResponse([
                'message' => $exception->getMessage(),
                'errors' => $exception->errors(),
            ], 422);
        } catch (SourceNotFoundException) {
            return $this->notFound();
        } catch (AuthorizationException $exception) {
            return new JsonResponse(['message' => $exception->getMessage()], 403);
        }

        return $payload === null ? $this->notFound() : new JsonResponse($payload, $status);
    }

    protected function notFound(): JsonResponse
    {
        return new JsonResponse(['message' => 'Not found.'], 404);
    }

    protected function user(Request $request): Authenticatable
    {
        return $request->user() ?? abort(401);
    }
}
