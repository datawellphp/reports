<?php

declare(strict_types=1);

namespace Datawell\Reports\Models;

use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\MorphTo;
use Illuminate\Support\Carbon;

/**
 * A saved report (D61): a stored QueryRequest plus its presentation.
 *
 * @property int $id
 * @property string $owner_type
 * @property int|string $owner_id
 * @property string $title
 * @property string|null $description
 * @property string $source
 * @property array<string, mixed> $request
 * @property array{type: string, options: array<string, mixed>} $chart
 * @property bool $shared
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
class Report extends Model
{
    protected $table = 'datawell_reports';

    protected $guarded = [];

    protected $casts = [
        'request' => 'array',
        'chart' => 'array',
        'shared' => 'boolean',
    ];

    /**
     * @return MorphTo<Model, $this>
     */
    public function owner(): MorphTo
    {
        return $this->morphTo();
    }

    public function isOwnedBy(Authenticatable $user): bool
    {
        return $this->owner_type === self::ownerTypeOf($user)
            && (string) $this->owner_id === (string) $user->getAuthIdentifier();
    }

    public static function ownerTypeOf(Authenticatable $user): string
    {
        return $user instanceof Model ? $user->getMorphClass() : $user::class;
    }
}
