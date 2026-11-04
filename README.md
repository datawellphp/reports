<div align="center">
    <h1>Datawell Reports</h1>
</div>

<p align="center">
    <a href="https://packagist.org/packages/datawell/reports"><img src="https://img.shields.io/packagist/v/datawell/reports.svg?style=flat-square" alt="Packagist"></a>
    <a href="https://packagist.org/packages/datawell/reports"><img src="https://img.shields.io/packagist/php-v/datawell/reports.svg?style=flat-square" alt="PHP from Packagist"></a>
    <a href="https://packagist.org/packages/datawell/reports"><img src="https://img.shields.io/packagist/dt/datawell/reports.svg?style=flat-square" alt="Total Downloads"></a>
</p>

Saved, shareable charts over Datawell data sources. A report is a stored
QueryRequest (`groupBy` + `aggregates`, plus filters and parameters) and a
presentation; it is always replayed as the person looking at it.

## Installation

```bash
composer require datawell/reports
php artisan vendor:publish --tag=reports-migrations
php artisan migrate
```

The React builder, card and chart publish next to the tables component:

```bash
php artisan vendor:publish --tag=tables-frontend   # once, from datawell/tables
php artisan vendor:publish --tag=reports-frontend  # resources/js/datawell/reports/
npm install --save-exact @tanstack/charts@0.16.0
```

## How it works

- **Owned, optionally shared.** The creator owns a report and is the only one
  who edits or deletes it. `shared: true` makes it visible to everyone;
  anyone who can see a report can **clone** it and edit the clone.
- **Replayed as the viewer.** Running a report goes through the core executor
  as the current user: their permissions, their scope, never the author's
  numbers. Before rendering, each report is dry-run validated against the
  viewer's schema; one that references a field or source they cannot see
  comes back `valid: false` with the reasons, and the published card renders
  a permission placeholder instead of a chart.
- **Tenancy hook.** Narrow which shared reports a viewer sees:

```php
use Datawell\Reports\Reports;

app(Reports::class)->resolveVisibilityUsing(function ($query, $viewer) {
    $query->whereIn('owner_id', $viewer->team->members()->select('id'));
});
```

## Endpoints

Under `datawell/reports` (configurable in `config/reports.php`):

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Visible reports, each with the viewer's `valid` verdict |
| POST | `/` | Create (validated as the owner) |
| GET | `/{report}` | One report |
| PUT | `/{report}` | Update (owner only, else 403) |
| DELETE | `/{report}` | Delete (owner only) |
| POST | `/{report}/clone` | A private copy owned by the caller |
| POST | `/{report}/run` | Buckets, replayed as the viewer |

Anything the viewer may not see is a `404`, indistinguishable from a missing
report.

## Front-end

```tsx
import { ReportBuilder } from '@/datawell/reports/report-builder';
import { ReportCard } from '@/datawell/reports/report-card';
```

`<ReportCard report={…} onEdit onCloned onDeleted />` runs the report and
renders the chart or the placeholder. `<ReportBuilder sources initial onSaved />`
derives dimension and measure pickers from the schema and previews live.
Chart types: `bar`, `barHorizontal`, `line`, `area`, `pie`, `number`, `table`.

## Testing

```bash
composer test
```

## Contributing

This repository is a read-only copy of the `reports` package, published automatically from Datawell's development repository, so changes aren't merged here directly. Issues and pull requests are still welcome: accepted changes are applied upstream and published back here. See the [contributing guide](.github/CONTRIBUTING.md).

## License

MIT. See [LICENSE.md](LICENSE.md).
