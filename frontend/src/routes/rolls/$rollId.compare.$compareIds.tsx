import { useQueries } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import type { CompareRoll } from "@/components/RollCompare";
import RollCompare from "@/components/RollCompare";

export const Route = createFileRoute('/rolls/$rollId/compare/$compareIds')({
    component: RouteComponent,
})

async function fetchJson(url: string) {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Network response was not ok');
    return response.json();
}

function RouteComponent() {
    const { rollId, compareIds } = Route.useParams();

    const ids = useMemo(() => {
        const list = [rollId, ...compareIds.split(',').map(s => s.trim()).filter(Boolean)];
        return Array.from(new Set(list));
    }, [rollId, compareIds]);

    const rollQueries = useQueries({
        queries: ids.map(id => ({
            queryKey: ['roll', id],
            queryFn: () => fetchJson(`${import.meta.env.VITE_BACKEND_URL}/rolls/${id}`),
        })),
    });

    const graphQueries = useQueries({
        queries: ids.map(id => ({
            queryKey: ['roll', id, 'recording'],
            queryFn: () => fetchJson(`${import.meta.env.VITE_BACKEND_URL}/rolls/${id}/graphs`),
        })),
    });

    const rollsLoading = rollQueries.some(q => q.isLoading);
    const rollsError = rollQueries.some(q => q.isError);

    const readyKey = rollQueries.map(q => !!q.data).join(',') + '|' + graphQueries.map(q => !!q.data).join(',');
    const rolls = useMemo<Array<CompareRoll>>(() => {
        const list: Array<CompareRoll> = ids.map((_, i) => ({ roll: rollQueries[i].data, graphs: graphQueries[i].data }));
        return list.filter(r => !!r.roll);
    }, [readyKey, ids]);

    if (rollsLoading) return <div className="p-2">Loading...</div>;
    if (rollsError) return <div className="p-2">Error loading roll data</div>;
    if (rolls.length === 0) return <div className="p-2">No rolls to compare</div>;

    // min-w-0 needed to prevent issues when resize sidebar
    return <div className="flex-1 min-w-0 h-full">
        <RollCompare rolls={rolls} />
    </div>;
}
