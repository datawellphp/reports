// Build or edit a report: pick a source, dimensions (from `groupable` fields,
// with grains), measures (from each field's `aggregates`), filters, and a
// chart type — with a live preview replayed through the same endpoints.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { FilterBar } from '../filters';
import type {
    AggregateSpec,
    BucketResult,
    EntityRef,
    FilterCondition,
    GroupSpec,
    QueryBody,
    Schema,
    SchemaFilter,
    SchemaParameter,
    SourceSummary,
} from '../lib';
import { datawell, isWireError } from '../lib';
import { ReportChart } from './report-chart';
import type { ChartSpec, ChartType, Report, ReportInput } from './reports-lib';
import {
    CHART_LABELS,
    CHART_TYPES,
    aggregateKey,
    reports,
} from './reports-lib';

type ReportBuilderProps = {
    sources: SourceSummary[];
    initial?: Report | null;
    onSaved: (report: Report) => void;
    onCancel?: () => void;
};

const GRAIN_LABELS: Record<string, string> = {
    day: 'Day',
    week: 'Week',
    month: 'Month',
    quarter: 'Quarter',
    year: 'Year',
};

const NONE = '__none__';

async function loadOptions(sourceKey: string): Promise<EntityRef[]> {
    const [schema, result] = await Promise.all([
        datawell.schema(sourceKey),
        datawell.query(sourceKey, { page: { size: 50 } }),
    ]);

    const labelKey = schema.source.representation.label;

    return result.rows.map((row) => {
        const raw = row[labelKey];
        const label =
            typeof raw === 'object' && raw !== null && 'label' in raw
                ? String((raw as EntityRef).label)
                : typeof raw === 'string'
                  ? raw
                  : String(row.id);

        return { id: row.id, label };
    });
}

function ParameterInput({
    parameter,
    value,
    onChange,
}: {
    parameter: SchemaParameter;
    value: unknown;
    onChange: (value: unknown) => void;
}) {
    const [choices, setChoices] = useState<EntityRef[] | null>(null);
    const from = parameter.from?.source;

    useEffect(() => {
        if (from === undefined) {
            return;
        }

        void loadOptions(from).then(setChoices);
    }, [from]);

    if (from !== undefined) {
        return (
            <Select
                value={
                    value === undefined ? '' : String(value as string | number)
                }
                onValueChange={(next) => onChange(next)}
            >
                <SelectTrigger className="w-56">
                    <SelectValue
                        placeholder={`Pick a ${parameter.label.toLowerCase()}`}
                    />
                </SelectTrigger>
                <SelectContent>
                    {choices === null && (
                        <div className="text-muted-foreground p-2 text-xs">
                            Loading…
                        </div>
                    )}
                    {choices?.map((choice) => (
                        <SelectItem key={choice.id} value={String(choice.id)}>
                            {choice.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        );
    }

    return (
        <Input
            className="w-56"
            value={value === undefined ? '' : String(value as string | number)}
            onChange={(event) => onChange(event.target.value)}
            placeholder={parameter.label}
        />
    );
}

export function ReportBuilder({
    sources,
    initial = null,
    onSaved,
    onCancel,
}: ReportBuilderProps) {
    const [source, setSource] = useState(
        initial?.source ?? sources[0]?.key ?? '',
    );
    const [schema, setSchema] = useState<Schema | null>(null);
    const [title, setTitle] = useState(initial?.title ?? '');
    const [description, setDescription] = useState(initial?.description ?? '');
    const [parameters, setParameters] = useState<Record<string, unknown>>(
        initial?.request.parameters ?? {},
    );
    const [search, setSearch] = useState(initial?.request.search ?? '');
    const [conditions, setConditions] = useState<FilterCondition[]>(
        // Saved filters are flat conditions (the builder never nests groups).
        (initial?.request.filters?.conditions ?? []).filter(
            (condition): condition is FilterCondition => 'filter' in condition,
        ),
    );
    const [dimensions, setDimensions] = useState<GroupSpec[]>(
        initial?.request.groupBy ?? [],
    );
    const [measures, setMeasures] = useState<AggregateSpec[]>(
        initial?.request.aggregates ?? [{ fn: 'count' }],
    );
    const [chartType, setChartType] = useState<ChartType>(
        initial?.chart.type ?? 'bar',
    );
    const [stacked, setStacked] = useState(
        initial?.chart.options.stacked === true,
    );
    const [donut, setDonut] = useState(initial?.chart.options.donut === true);
    const [shared, setShared] = useState(initial?.shared ?? false);
    const [optionsByFilter, setOptionsByFilter] = useState<
        Record<string, EntityRef[]>
    >({});
    const requestedOptions = useRef(new Set<string>());
    const [preview, setPreview] = useState<BucketResult | null>(null);
    const [previewError, setPreviewError] = useState<string[] | null>(null);
    const [saving, setSaving] = useState(false);
    const [saveErrors, setSaveErrors] = useState<string[]>([]);

    // Load the schema whenever the source changes; a new source resets the pickers.
    useEffect(() => {
        if (source === '') {
            return;
        }

        let cancelled = false;
        setSchema(null);

        void datawell.schema(source).then((next) => {
            if (cancelled) {
                return;
            }

            setSchema(next);

            if (initial === null || initial.source !== source) {
                const firstGroupable = next.fields.find(
                    (field) => field.groupable,
                );
                setDimensions(
                    firstGroupable
                        ? [
                              {
                                  key: firstGroupable.key,
                                  ...(firstGroupable.grains?.[0]
                                      ? { grain: firstGroupable.grains[0] }
                                      : {}),
                              },
                          ]
                        : [],
                );
                setMeasures([{ fn: 'count' }]);
                setConditions([]);
                setParameters({});
                requestedOptions.current.clear();
                setOptionsByFilter({});
            }
        });

        return () => {
            cancelled = true;
        };
    }, [source, initial]);

    const groupable = schema?.fields.filter((field) => field.groupable) ?? [];
    const measurable =
        schema?.fields.filter((field) => (field.aggregates ?? []).length > 0) ??
        [];

    const ensureOptions = (filter: SchemaFilter) => {
        const field = schema?.fields.find((item) => item.key === filter.key);

        if (!field || requestedOptions.current.has(filter.key)) {
            return;
        }

        requestedOptions.current.add(filter.key);

        if (field.options && field.options.strategy === 'inline') {
            setOptionsByFilter((previous) => ({
                ...previous,
                [filter.key]: (field.options as { values: EntityRef[] }).values,
            }));

            return;
        }

        const target =
            field.options && field.options.strategy === 'source'
                ? field.options.source
                : field.source;

        if (target === undefined) {
            return;
        }

        void loadOptions(target).then((options) =>
            setOptionsByFilter((previous) => ({
                ...previous,
                [filter.key]: options,
            })),
        );
    };

    const request: ReportInput['request'] = useMemo(
        () => ({
            ...(Object.keys(parameters).length > 0 ? { parameters } : {}),
            ...(search !== '' ? { search } : {}),
            ...(conditions.length > 0 ? { filters: { conditions } } : {}),
            ...(chartType === 'number' ? {} : { groupBy: dimensions }),
            aggregates: measures,
        }),
        [parameters, search, conditions, dimensions, measures, chartType],
    );

    const chart: ChartSpec = useMemo(
        () => ({
            type: chartType,
            options: {
                ...(stacked ? { stacked: true } : {}),
                ...(donut ? { donut: true } : {}),
            },
        }),
        [chartType, stacked, donut],
    );

    const requiredParametersMissing = (schema?.parameters ?? []).some(
        (parameter) =>
            parameter.required &&
            (parameters[parameter.key] === undefined ||
                parameters[parameter.key] === ''),
    );

    // Live preview through the ordinary query endpoint — the report will replay identically.
    useEffect(() => {
        if (schema === null || requiredParametersMissing) {
            return;
        }

        if (chartType !== 'number' && dimensions.length === 0) {
            setPreview(null);
            setPreviewError(['Pick at least one dimension.']);

            return;
        }

        let cancelled = false;
        const handle = setTimeout(() => {
            const body: QueryBody = { ...request };

            datawell
                .queryBuckets(schema.source.key, body)
                .then((next) => {
                    if (!cancelled) {
                        setPreview(next);
                        setPreviewError(null);
                    }
                })
                .catch((requestError: unknown) => {
                    if (!cancelled) {
                        setPreview(null);
                        setPreviewError(
                            isWireError(requestError)
                                ? Object.values(requestError.errors).flat()
                                : ['The preview failed.'],
                        );
                    }
                });
        }, 250);

        return () => {
            cancelled = true;
            clearTimeout(handle);
        };
    }, [
        schema,
        request,
        chartType,
        dimensions.length,
        requiredParametersMissing,
    ]);

    const save = () => {
        setSaving(true);
        setSaveErrors([]);

        const input: ReportInput = {
            title,
            description: description === '' ? null : description,
            source,
            request,
            chart,
            shared,
        };

        const call =
            initial === null
                ? reports.create(input)
                : reports.update(initial.id, input);

        void call
            .then((saved) => onSaved(saved))
            .catch((requestError: unknown) => {
                setSaveErrors(
                    isWireError(requestError)
                        ? [
                              requestError.message,
                              ...Object.values(requestError.errors).flat(),
                          ]
                        : ['Saving failed.'],
                );
            })
            .finally(() => setSaving(false));
    };

    const setDimension = (index: number, key: string) => {
        setDimensions((previous) => {
            const next = [...previous];

            if (key === NONE) {
                next.splice(index, 1);

                return next;
            }

            const field = schema?.fields.find((item) => item.key === key);
            next[index] = {
                key,
                ...(field?.grains?.[0] ? { grain: field.grains[0] } : {}),
            };

            return next;
        });
    };

    const setGrain = (index: number, grain: string) => {
        setDimensions((previous) =>
            previous.map((dimension, i) =>
                i === index ? { ...dimension, grain } : dimension,
            ),
        );
    };

    const toggleMeasure = (measure: AggregateSpec, checked: boolean) => {
        setMeasures((previous) => {
            const without = previous.filter(
                (item) => aggregateKey(item) !== aggregateKey(measure),
            );

            return checked ? [...without, measure] : without;
        });
    };

    const hasMeasure = (measure: AggregateSpec) =>
        measures.some((item) => aggregateKey(item) === aggregateKey(measure));

    const dimensionPicker = (index: number) => {
        const current = dimensions[index];

        return (
            <div key={index} className="flex flex-wrap items-center gap-2">
                <Select
                    value={current?.key ?? NONE}
                    onValueChange={(next) => setDimension(index, next)}
                >
                    <SelectTrigger className="w-56">
                        <SelectValue placeholder="Dimension" />
                    </SelectTrigger>
                    <SelectContent>
                        {index > 0 && (
                            <SelectItem value={NONE}>None</SelectItem>
                        )}
                        {groupable
                            .filter(
                                (field) =>
                                    field.key === current?.key ||
                                    !dimensions.some(
                                        (d) => d.key === field.key,
                                    ),
                            )
                            .map((field) => (
                                <SelectItem key={field.key} value={field.key}>
                                    {field.label}
                                </SelectItem>
                            ))}
                    </SelectContent>
                </Select>
                {current !== undefined &&
                    (
                        schema?.fields.find((f) => f.key === current.key)
                            ?.grains ?? []
                    ).length > 0 && (
                        <Select
                            value={current.grain ?? ''}
                            onValueChange={(next) => setGrain(index, next)}
                        >
                            <SelectTrigger className="w-32">
                                <SelectValue placeholder="Grain" />
                            </SelectTrigger>
                            <SelectContent>
                                {(
                                    schema?.fields.find(
                                        (f) => f.key === current.key,
                                    )?.grains ?? []
                                ).map((grain) => (
                                    <SelectItem key={grain} value={grain}>
                                        {GRAIN_LABELS[grain] ?? grain}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}
            </div>
        );
    };

    const canSave =
        title.trim() !== '' &&
        source !== '' &&
        measures.length > 0 &&
        (chartType === 'number' || dimensions.length > 0) &&
        !requiredParametersMissing &&
        previewError === null;

    return (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_1fr]">
            <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-2">
                    <Label htmlFor="report-title">Title</Label>
                    <Input
                        id="report-title"
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        placeholder="Signatures per month"
                    />
                </div>
                <div className="flex flex-col gap-2">
                    <Label htmlFor="report-description">Description</Label>
                    <Input
                        id="report-description"
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                        placeholder="Optional"
                    />
                </div>

                <div className="flex flex-col gap-2">
                    <Label>Source</Label>
                    <Select
                        value={source}
                        onValueChange={setSource}
                        disabled={initial !== null}
                    >
                        <SelectTrigger className="w-56">
                            <SelectValue placeholder="Source" />
                        </SelectTrigger>
                        <SelectContent>
                            {sources.map((item) => (
                                <SelectItem key={item.key} value={item.key}>
                                    {item.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                {schema === null && source !== '' && (
                    <Skeleton className="h-40 w-full" />
                )}

                {schema !== null && schema.parameters.length > 0 && (
                    <div className="flex flex-col gap-2">
                        <Label>Parameters</Label>
                        {schema.parameters.map((parameter) => (
                            <div
                                key={parameter.key}
                                className="flex items-center gap-2"
                            >
                                <span className="text-muted-foreground w-28 text-sm">
                                    {parameter.label}
                                </span>
                                <ParameterInput
                                    parameter={parameter}
                                    value={parameters[parameter.key]}
                                    onChange={(value) =>
                                        setParameters((previous) => ({
                                            ...previous,
                                            [parameter.key]: value,
                                        }))
                                    }
                                />
                            </div>
                        ))}
                    </div>
                )}

                {schema !== null && (
                    <>
                        <div className="flex flex-col gap-2">
                            <Label>Chart</Label>
                            <div className="flex flex-wrap items-center gap-3">
                                <Select
                                    value={chartType}
                                    onValueChange={(next) =>
                                        setChartType(next as ChartType)
                                    }
                                >
                                    <SelectTrigger className="w-44">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {CHART_TYPES.map((type) => (
                                            <SelectItem key={type} value={type}>
                                                {CHART_LABELS[type]}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {(chartType === 'bar' ||
                                    chartType === 'barHorizontal') && (
                                    <label className="flex items-center gap-2 text-sm">
                                        <Checkbox
                                            checked={stacked}
                                            onCheckedChange={(next) =>
                                                setStacked(next === true)
                                            }
                                        />
                                        Stacked
                                    </label>
                                )}
                                {chartType === 'pie' && (
                                    <label className="flex items-center gap-2 text-sm">
                                        <Checkbox
                                            checked={donut}
                                            onCheckedChange={(next) =>
                                                setDonut(next === true)
                                            }
                                        />
                                        Donut
                                    </label>
                                )}
                            </div>
                        </div>

                        {chartType !== 'number' && (
                            <div className="flex flex-col gap-2">
                                <Label>Dimensions</Label>
                                {groupable.length === 0 && (
                                    <p className="text-muted-foreground text-sm">
                                        This source publishes no groupable
                                        fields.
                                    </p>
                                )}
                                {groupable.length > 0 && dimensionPicker(0)}
                                {groupable.length > 1 &&
                                    dimensions.length > 0 &&
                                    chartType !== 'pie' &&
                                    dimensionPicker(1)}
                            </div>
                        )}

                        <div className="flex flex-col gap-2">
                            <Label>Measures</Label>
                            <label className="flex items-center gap-2 text-sm">
                                <Checkbox
                                    checked={hasMeasure({ fn: 'count' })}
                                    onCheckedChange={(next) =>
                                        toggleMeasure(
                                            { fn: 'count' },
                                            next === true,
                                        )
                                    }
                                />
                                Count
                            </label>
                            {measurable.map((field) =>
                                (field.aggregates ?? []).map((fn) => {
                                    const measure = { fn, field: field.key };

                                    return (
                                        <label
                                            key={aggregateKey(measure)}
                                            className="flex items-center gap-2 text-sm"
                                        >
                                            <Checkbox
                                                checked={hasMeasure(measure)}
                                                onCheckedChange={(next) =>
                                                    toggleMeasure(
                                                        measure,
                                                        next === true,
                                                    )
                                                }
                                            />
                                            {fn.toUpperCase()} of {field.label}
                                        </label>
                                    );
                                }),
                            )}
                        </div>

                        <div className="flex flex-col gap-2">
                            <Label>Filters</Label>
                            <Input
                                value={search}
                                onChange={(event) =>
                                    setSearch(event.target.value)
                                }
                                placeholder="Search…"
                                className="w-56"
                            />
                            <FilterBar
                                filters={schema.filters}
                                conditions={conditions}
                                optionsByFilter={optionsByFilter}
                                onChange={setConditions}
                                onNeedOptions={ensureOptions}
                            />
                        </div>

                        <label className="flex items-center gap-2 text-sm">
                            <Checkbox
                                checked={shared}
                                onCheckedChange={(next) =>
                                    setShared(next === true)
                                }
                            />
                            Share with everyone (they can view and clone, not
                            edit)
                        </label>
                    </>
                )}

                {saveErrors.length > 0 && (
                    <ul className="text-destructive text-sm">
                        {saveErrors.map((message) => (
                            <li key={message}>{message}</li>
                        ))}
                    </ul>
                )}

                <div className="flex gap-2">
                    <Button onClick={save} disabled={!canSave || saving}>
                        {initial === null ? 'Save report' : 'Save changes'}
                    </Button>
                    {onCancel && (
                        <Button
                            variant="ghost"
                            onClick={onCancel}
                            disabled={saving}
                        >
                            Cancel
                        </Button>
                    )}
                </div>
            </div>

            <div className="flex min-h-80 flex-col gap-2 rounded-md border p-4">
                <div className="text-muted-foreground text-xs font-medium uppercase">
                    Preview
                </div>
                {previewError !== null && (
                    <ul className="text-destructive text-sm">
                        {previewError.map((message) => (
                            <li key={message}>{message}</li>
                        ))}
                    </ul>
                )}
                {requiredParametersMissing && (
                    <p className="text-muted-foreground text-sm">
                        Choose the required parameters to preview.
                    </p>
                )}
                {previewError === null &&
                    preview === null &&
                    !requiredParametersMissing && (
                        <Skeleton className="h-64 w-full" />
                    )}
                {previewError === null && preview !== null && (
                    <ReportChart
                        title={title === '' ? 'Preview' : title}
                        result={preview}
                        request={request}
                        chart={chart}
                        schema={schema}
                        height={320}
                    />
                )}
            </div>
        </div>
    );
}
