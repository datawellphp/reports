// A saved report on a page: title, owner/shared badges, the chart replayed as
// the viewer — or the permission placeholder (D61) — and clone/edit/delete.

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { BucketResult, Schema } from '../lib';
import { datawell, isWireError } from '../lib';
import { ReportChart } from './report-chart';
import type { Report } from './reports-lib';
import { reports } from './reports-lib';

type ReportCardProps = {
    report: Report;
    onEdit?: (report: Report) => void;
    onCloned?: (clone: Report) => void;
    onDeleted?: (report: Report) => void;
};

const schemaCache = new Map<string, Promise<Schema>>();

function schemaFor(source: string): Promise<Schema> {
    let pending = schemaCache.get(source);

    if (pending === undefined) {
        pending = datawell.schema(source);
        schemaCache.set(source, pending);
    }

    return pending;
}

export function ReportPlaceholder({ report }: { report: Report }) {
    const reasons = Object.values(report.errors ?? {}).flat();

    return (
        <div className="bg-muted/40 text-muted-foreground flex h-full min-h-40 flex-col items-center justify-center gap-2 rounded-md border border-dashed p-6 text-center text-sm">
            <div className="text-foreground font-medium">
                {report.mine
                    ? 'This report no longer runs.'
                    : "You don't have permission to view this chart."}
            </div>
            {report.mine && reasons.length > 0 && (
                <ul className="text-xs">
                    {reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                    ))}
                </ul>
            )}
            {!report.mine && (
                <p className="text-xs">
                    It uses data your account can't see. Ask the owner, or hide
                    charts like this from the list.
                </p>
            )}
        </div>
    );
}

export function ReportCard({
    report,
    onEdit,
    onCloned,
    onDeleted,
}: ReportCardProps) {
    const [result, setResult] = useState<BucketResult | null>(null);
    const [schema, setSchema] = useState<Schema | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const available = report.valid !== false;

    useEffect(() => {
        if (!available) {
            return;
        }

        let cancelled = false;
        setResult(null);
        setError(null);

        void Promise.all([reports.run(report.id), schemaFor(report.source)])
            .then(([next, loadedSchema]) => {
                if (!cancelled) {
                    setResult(next);
                    setSchema(loadedSchema);
                }
            })
            .catch((requestError: unknown) => {
                if (!cancelled) {
                    setError(
                        isWireError(requestError)
                            ? requestError.message
                            : 'The report could not be run.',
                    );
                }
            });

        return () => {
            cancelled = true;
        };
    }, [report.id, report.updatedAt, report.source, available]);

    const clone = () => {
        setBusy(true);
        void reports
            .clone(report.id)
            .then((created) => onCloned?.(created))
            .finally(() => setBusy(false));
    };

    const destroy = () => {
        if (!confirmingDelete) {
            setConfirmingDelete(true);

            return;
        }

        setBusy(true);
        void reports
            .destroy(report.id)
            .then(() => onDeleted?.(report))
            .finally(() => setBusy(false));
    };

    return (
        <Card className="flex h-full flex-col">
            <CardHeader>
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <CardTitle className="truncate">
                            {report.title}
                        </CardTitle>
                        {report.description && (
                            <CardDescription>
                                {report.description}
                            </CardDescription>
                        )}
                    </div>
                    <div className="flex shrink-0 gap-1">
                        {report.mine ? (
                            <Badge variant="outline">Mine</Badge>
                        ) : (
                            <Badge variant="secondary">
                                {report.owner.label ?? 'Shared'}
                            </Badge>
                        )}
                        {report.shared && report.mine && (
                            <Badge variant="secondary">Shared</Badge>
                        )}
                    </div>
                </div>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-3">
                <div className="min-h-40 flex-1">
                    {!available && <ReportPlaceholder report={report} />}
                    {available && error !== null && (
                        <div className="text-destructive text-sm">{error}</div>
                    )}
                    {available && error === null && result === null && (
                        <Skeleton className="h-40 w-full" />
                    )}
                    {available && result !== null && (
                        <ReportChart
                            title={report.title}
                            result={result}
                            request={report.request}
                            chart={report.chart}
                            schema={schema}
                        />
                    )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {report.mine && onEdit && (
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onEdit(report)}
                            disabled={busy}
                        >
                            Edit
                        </Button>
                    )}
                    {onCloned && available && (
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={clone}
                            disabled={busy}
                        >
                            {report.mine ? 'Duplicate' : 'Clone to edit'}
                        </Button>
                    )}
                    {report.mine && onDeleted && (
                        <Button
                            size="sm"
                            variant={confirmingDelete ? 'destructive' : 'ghost'}
                            onClick={destroy}
                            onBlur={() => setConfirmingDelete(false)}
                            disabled={busy}
                        >
                            {confirmingDelete ? 'Confirm delete' : 'Delete'}
                        </Button>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
