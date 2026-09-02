// Types and a same-origin client for the datawell/reports endpoints (D61),
// plus the bucket → chart-row flattening the chart component renders from.

import type {
    AggregateSpec,
    Bucket,
    BucketResult,
    EntityRef,
    FilterGroup,
    GroupSpec,
    Schema,
    WireError,
} from '../lib';

export const CHART_TYPES = [
    'bar',
    'barHorizontal',
    'line',
    'area',
    'pie',
    'number',
    'table',
] as const;

export type ChartType = (typeof CHART_TYPES)[number];

export const CHART_LABELS: Record<ChartType, string> = {
    bar: 'Bar',
    barHorizontal: 'Horizontal bar',
    line: 'Line',
    area: 'Area',
    pie: 'Pie',
    number: 'Number',
    table: 'Table',
};

export type ChartSpec = {
    type: ChartType;
    options: { stacked?: boolean; donut?: boolean; [key: string]: unknown };
};

export type ReportRequest = {
    parameters?: Record<string, unknown>;
    search?: string;
    filters?: FilterGroup;
    groupBy?: GroupSpec[];
    aggregates: AggregateSpec[];
};

export type Report = {
    id: number;
    title: string;
    description: string | null;
    source: string;
    request: ReportRequest;
    chart: ChartSpec;
    shared: boolean;
    owner: { id: number | string; label: string | null };
    mine: boolean;
    createdAt: string | null;
    updatedAt: string | null;
    valid?: boolean;
    errors?: Record<string, string[]>;
};

export type ReportInput = {
    title: string;
    description?: string | null;
    source: string;
    request: ReportRequest;
    chart: ChartSpec;
    shared: boolean;
};

function xsrfToken(): string {
    const match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);

    return match ? decodeURIComponent(match[1]) : '';
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(url, {
        credentials: 'same-origin',
        ...init,
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-XSRF-TOKEN': xsrfToken(),
            'X-Requested-With': 'XMLHttpRequest',
        },
    });

    const body = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
    >;

    if (!response.ok) {
        throw {
            status: response.status,
            message:
                typeof body.message === 'string'
                    ? body.message
                    : 'Request failed.',
            errors: (body.errors ?? {}) as Record<string, string[]>,
        } satisfies WireError;
    }

    return body as T;
}

const base = '/datawell/reports';

export const reports = {
    list: () => request<{ reports: Report[] }>(base),

    show: (id: number | string) => request<Report>(`${base}/${id}`),

    create: (input: ReportInput) =>
        request<Report>(base, { method: 'POST', body: JSON.stringify(input) }),

    update: (id: number | string, input: ReportInput) =>
        request<Report>(`${base}/${id}`, {
            method: 'PUT',
            body: JSON.stringify(input),
        }),

    destroy: (id: number | string) =>
        request<{ deleted: boolean }>(`${base}/${id}`, { method: 'DELETE' }),

    clone: (id: number | string) =>
        request<Report>(`${base}/${id}/clone`, { method: 'POST' }),

    run: (id: number | string) =>
        request<BucketResult>(`${base}/${id}/run`, { method: 'POST' }),
};

// The wire key an aggregate lands under in a bucket: `count`, or `<fn>_<field>`.
export function aggregateKey(aggregate: AggregateSpec): string {
    return aggregate.field === undefined
        ? aggregate.fn
        : `${aggregate.fn}_${aggregate.field}`;
}

export function aggregateLabel(
    aggregate: AggregateSpec,
    schema: Schema | null,
): string {
    if (aggregate.field === undefined) {
        return 'Count';
    }

    const field = schema?.fields.find((item) => item.key === aggregate.field);

    return `${aggregate.fn.toUpperCase()} of ${field?.label ?? aggregate.field}`;
}

export function fieldLabel(key: string, schema: Schema | null): string {
    return schema?.fields.find((item) => item.key === key)?.label ?? key;
}

// A bucket dimension value is an entity ref, a scalar, or null (D53).
export function bucketLabel(value: Bucket[string]): string {
    if (value === null || value === undefined) {
        return '—';
    }

    if (typeof value === 'object') {
        return String((value as EntityRef).label);
    }

    return String(value);
}

export type ChartRow = {
    x: string;
    series: string;
    value: number;
};

/**
 * Flatten buckets into (x, series, value) rows. One dimension + one measure
 * is the simple case; a second dimension becomes the series; several
 * measures without a second dimension become the series instead.
 */
export function chartRows(
    result: BucketResult,
    request: ReportRequest,
    schema: Schema | null,
): { rows: ChartRow[]; series: string[]; xLabel: string; yLabel: string } {
    const dimensions = request.groupBy ?? [];
    const measures = request.aggregates;
    const rows: ChartRow[] = [];
    const series = new Set<string>();

    const xKey = dimensions[0]?.key;
    const seriesKey = dimensions[1]?.key;

    for (const bucket of result.buckets) {
        const x = xKey === undefined ? 'All' : bucketLabel(bucket[xKey]);

        if (seriesKey !== undefined) {
            const name = bucketLabel(bucket[seriesKey]);
            const value = Number(bucket[aggregateKey(measures[0])] ?? 0);
            series.add(name);
            rows.push({ x, series: name, value });

            continue;
        }

        for (const measure of measures) {
            const name = aggregateLabel(measure, schema);
            series.add(name);
            rows.push({
                x,
                series: name,
                value: Number(bucket[aggregateKey(measure)] ?? 0),
            });
        }
    }

    return {
        rows,
        series: [...series],
        xLabel: xKey === undefined ? '' : fieldLabel(xKey, schema),
        yLabel:
            seriesKey !== undefined || measures.length === 1
                ? aggregateLabel(measures[0], schema)
                : 'Value',
    };
}

const HIDE_KEY = 'datawell.reports.hideUnavailable';

export function readHideUnavailable(): boolean {
    try {
        return window.localStorage.getItem(HIDE_KEY) === '1';
    } catch {
        return false;
    }
}

export function writeHideUnavailable(value: boolean): void {
    try {
        window.localStorage.setItem(HIDE_KEY, value ? '1' : '0');
    } catch {
        // A private window or blocked storage: the toggle simply does not persist.
    }
}
