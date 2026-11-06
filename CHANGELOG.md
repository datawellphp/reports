# Release Notes

## v0.1.0 - 2026-11-06

First release of Datawell Reports.

- Saved, shareable reports: a stored query (group-by, aggregates, filters and parameters) plus a presentation, always run as the person viewing it.
- A `Reports` service and routes to create, update, clone, validate and run reports, with a migration for the `datawell_reports` table.
- React report builder, report card and charts (bar, line, area, pie and donut, number and table), published into your app with `vendor:publish`.
- Requires `datawell/datawell` ^0.1, PHP 8.3+ and Laravel 12 or 13.
