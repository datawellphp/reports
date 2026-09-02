// The one file that touches @tanstack/charts (D62). Everything else deals in
// buckets and the report's chart spec; this turns them into a definition.

import { useMemo } from 'react';
import {
    areaY,
    barX,
    barY,
    defineChart,
    group,
    lineY,
    stack,
} from '@tanstack/charts';
import type { DomChartDefinition } from '@tanstack/charts';
import { colorLegend } from '@tanstack/charts/legend';
import { pie, polar, radialArc } from '@tanstack/charts/polar';
import { Chart } from '@tanstack/charts/react';
import { scaleBand } from '@tanstack/charts/scales/band';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import { scalePoint } from '@tanstack/charts/scales/point';
import { tooltip } from '@tanstack/charts/tooltip';
import type { BucketResult, Schema } from '../lib';
import type { ChartRow, ChartSpec, ReportRequest } from './reports-lib';
import {
    aggregateKey,
    aggregateLabel,
    bucketLabel,
    chartRows,
    fieldLabel,
} from './reports-lib';

type ReportChartProps = {
    title: string;
    result: BucketResult;
    request: ReportRequest;
    chart: ChartSpec;
    schema: Schema | null;
    height?: number;
};

const numberFormat = new Intl.NumberFormat();

// Every chart type resolves to the same definition shape the <Chart> accepts.
type Definition = DomChartDefinition;

// The default tooltip prints channel names ("x"); ours names the dimension
// value and lists one row per series with the measure's real label.
function tooltipFor(single: string) {
    return {
        use: tooltip,
        content: (points: readonly { datum: unknown }[]) => {
            const rows = points.map((point) => point.datum as ChartRow);

            return {
                title: rows[0]?.x ?? '',
                rows: rows.map((row) => ({
                    label:
                        rows.length > 1 || row.series !== single
                            ? row.series
                            : single,
                    value: numberFormat.format(row.value),
                })),
            };
        },
    };
}

function legendFor(series: string[]) {
    return series.length > 1
        ? { legend: colorLegend({ placement: 'bottom' as const }) }
        : {};
}

function cartesian(
    rows: ChartRow[],
    series: string[],
    chart: ChartSpec,
    yLabel: string,
): Definition {
    const stacked = chart.options.stacked === true;
    const multi = series.length > 1;
    const color = multi ? { color: 'series' as const } : {};
    const layout = multi ? { layout: stacked ? stack() : group() } : {};

    if (chart.type === 'barHorizontal') {
        return defineChart({
            marks: [barX(rows, { x: 'value', y: 'x', ...color, ...layout })],
            scales: {
                x: {
                    scale: scaleLinear,
                    nice: true,
                    grid: true,
                    axis: { label: yLabel },
                },
                y: { scale: () => scaleBand<string>().padding(0.2) },
            },
            color: legendFor(series),
            tooltip: tooltipFor(yLabel),
        });
    }

    if (chart.type === 'line') {
        return defineChart({
            marks: [
                lineY(rows, {
                    x: 'x',
                    y: 'value',
                    ...(multi ? { z: 'series' as const, ...color } : {}),
                    points: true,
                }),
            ],
            scales: {
                x: { scale: () => scalePoint<string>().padding(0.2) },
                y: {
                    scale: scaleLinear,
                    nice: true,
                    grid: true,
                    axis: { label: yLabel },
                },
            },
            color: legendFor(series),
            tooltip: tooltipFor(yLabel),
        });
    }

    if (chart.type === 'area') {
        return defineChart({
            marks: [
                areaY(rows, {
                    x: 'x',
                    y: 'value',
                    ...color,
                    ...(multi ? { layout: stack() } : {}),
                    fillOpacity: 0.8,
                }),
            ],
            scales: {
                x: { scale: () => scalePoint<string>().padding(0.1) },
                y: {
                    scale: scaleLinear,
                    nice: true,
                    grid: true,
                    axis: { label: yLabel },
                },
            },
            color: legendFor(series),
            tooltip: tooltipFor(yLabel),
        });
    }

    return defineChart({
        marks: [barY(rows, { x: 'x', y: 'value', ...color, ...layout })],
        scales: {
            x: { scale: () => scaleBand<string>().padding(0.2) },
            y: {
                scale: scaleLinear,
                nice: true,
                grid: true,
                axis: { label: yLabel },
            },
        },
        color: legendFor(series),
        tooltip: tooltipFor(yLabel),
    });
}

function pieChart(
    rows: ChartRow[],
    chart: ChartSpec,
    yLabel: string,
): Definition {
    // A pie has one dimension and one measure: series collapse onto x.
    const slices = pie(
        rows.map((row) => ({ label: row.x, value: Math.max(0, row.value) })),
        { value: 'value' },
    );
    const donut = chart.options.donut === true;

    return defineChart({
        marks: [
            polar({
                inset: 8,
                radiusRatio: 0.82,
                marks: [
                    radialArc(slices, {
                        color: 'label',
                        key: 'label',
                        cornerRadius: 3,
                        ...(donut
                            ? {
                                  innerRadius: ({
                                      radius,
                                  }: {
                                      radius: number;
                                  }) => radius * 0.58,
                              }
                            : {}),
                    }),
                ],
                scales: { angle: null, radius: null },
            }),
        ],
        scales: { x: null, y: null },
        color: { legend: colorLegend({ placement: 'bottom' }) },
        tooltip: {
            use: tooltip,
            content: (points: readonly { datum: unknown }[]) => {
                const slice = points[0]?.datum as
                    | { label: string; value: number }
                    | undefined;

                return {
                    title: slice?.label ?? '',
                    rows:
                        slice === undefined
                            ? []
                            : [
                                  {
                                      label: yLabel,
                                      value: numberFormat.format(slice.value),
                                  },
                              ],
                };
            },
        },
    });
}

function NumberChart({
    result,
    request,
    schema,
}: Pick<ReportChartProps, 'result' | 'request' | 'schema'>) {
    const bucket = result.buckets[0];
    const measure = request.aggregates[0];
    const value =
        bucket === undefined ? 0 : Number(bucket[aggregateKey(measure)] ?? 0);

    return (
        <div className="flex h-full flex-col items-center justify-center gap-1 py-6">
            <div className="text-4xl font-semibold tabular-nums">
                {numberFormat.format(value)}
            </div>
            <div className="text-muted-foreground text-sm">
                {aggregateLabel(measure, schema)}
            </div>
        </div>
    );
}

function TableChart({
    result,
    request,
    schema,
}: Pick<ReportChartProps, 'result' | 'request' | 'schema'>) {
    const dimensions = request.groupBy ?? [];

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead>
                    <tr className="border-b">
                        {dimensions.map((dimension) => (
                            <th
                                key={dimension.key}
                                className="px-3 py-2 text-left font-medium"
                            >
                                {fieldLabel(dimension.key, schema)}
                            </th>
                        ))}
                        {request.aggregates.map((aggregate) => (
                            <th
                                key={aggregateKey(aggregate)}
                                className="px-3 py-2 text-right font-medium"
                            >
                                {aggregateLabel(aggregate, schema)}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {result.buckets.map((bucket, index) => (
                        <tr key={index} className="border-b last:border-0">
                            {dimensions.map((dimension) => (
                                <td key={dimension.key} className="px-3 py-2">
                                    {bucketLabel(bucket[dimension.key])}
                                </td>
                            ))}
                            {request.aggregates.map((aggregate) => (
                                <td
                                    key={aggregateKey(aggregate)}
                                    className="px-3 py-2 text-right tabular-nums"
                                >
                                    {numberFormat.format(
                                        Number(
                                            bucket[aggregateKey(aggregate)] ??
                                                0,
                                        ),
                                    )}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export function ReportChart({
    title,
    result,
    request,
    chart,
    schema,
    height = 280,
}: ReportChartProps) {
    const shaped = useMemo(
        () => chartRows(result, request, schema),
        [result, request, schema],
    );

    const definition = useMemo((): Definition | null => {
        if (chart.type === 'number' || chart.type === 'table') {
            return null;
        }

        if (chart.type === 'pie') {
            return pieChart(shaped.rows, chart, shaped.yLabel);
        }

        return cartesian(shaped.rows, shaped.series, chart, shaped.yLabel);
    }, [chart, shaped]);

    if (chart.type === 'number') {
        return (
            <NumberChart result={result} request={request} schema={schema} />
        );
    }

    if (chart.type === 'table') {
        return <TableChart result={result} request={request} schema={schema} />;
    }

    if (result.buckets.length === 0) {
        return (
            <div className="text-muted-foreground flex h-full items-center justify-center py-10 text-sm">
                No data for this report.
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-1">
            {definition !== null && (
                <Chart
                    definition={definition}
                    height={height}
                    ariaLabel={title}
                    className="w-full"
                />
            )}
            {result.meta.truncated && (
                <p className="text-muted-foreground text-xs">
                    Showing the first {result.meta.count} groups; the rest were
                    capped by the server.
                </p>
            )}
        </div>
    );
}
