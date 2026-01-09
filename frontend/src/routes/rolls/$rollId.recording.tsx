import RollAnalysis from "@/components/RollAnalysis";
import RollHeader from "@/components/RollHeader";
import type { EventType } from "@/lib/constants";
import type { RollEvent } from "@/lib/roll";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute('/rolls/$rollId/recording')({
    component: RouteComponent,
})

export interface RollEventInput {
    key: number;
    type: EventType;
    tag?: string;
    timestamp_ms: number;
    editing: boolean;
}

function RouteComponent() {
    const { rollId } = Route.useParams();
    const [events, setEvents] = useState<RollEventInput[]>([]);

    const { data: graphs, isLoading: graphsLoading, error: graphsError } = useQuery({
        queryKey: ['roll', rollId, 'recording'],
        queryFn: async () => {
            if (rollId === undefined) return null;

            const response = await fetch(`${import.meta.env.VITE_BACKEND_URL}/rolls/${rollId}/graphs`);
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.json();
        },
    });
    const { data: roll, isLoading: rollLoading, error: rollError } = useQuery({
        queryKey: ['roll', rollId],
        queryFn: async () => {
            if (rollId === undefined) return null;

            const response = await fetch(`${import.meta.env.VITE_BACKEND_URL}/rolls/${rollId}`);
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.json();
        },
    });

    const { data: eventsRaw, isLoading: eventsLoading, error: eventsError } = useQuery({
        queryKey: ['roll', rollId, 'events'],
        queryFn: async () => {
            if (rollId === undefined) return null;

            const response = await fetch(`${import.meta.env.VITE_BACKEND_URL}/rolls/${rollId}/events`);
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.json();
        },
    });

    useEffect(() => {
        if (!eventsRaw) return;
        setEvents(eventsRaw
            .sort((a: RollEvent, b: RollEvent) => a.timestamp_ms - b.timestamp_ms)
            .map((event: RollEvent, index: number) => ({
                key: index,
                type: event.type,
                tag: event.tag,
                timestamp_ms: event.timestamp_ms,
                active: true,
            })));
    }, [eventsRaw]);

    const queryClient = useQueryClient();
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const saveEventsMutation = useMutation({
        mutationFn: async (events: RollEvent[]) => {
            console.debug('Saving events:', events);
            const response = await fetch(`${import.meta.env.VITE_BACKEND_URL}/rolls/${roll.id}/events`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(events.map(e => ({ type: e.type, tag: e.tag ?? undefined, timestamp_ms: e.timestamp_ms }))),
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const error: any = new Error('Failed to update roll events');
                error.status = response.status;
                error.data = errorData;
                throw error;
            }
            return response.json() as Promise<RollEvent[]>;
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ['rolls'] });
            queryClient.invalidateQueries({ queryKey: ['roll', roll.id] });
            console.log('Roll Events updated successfully', data);
        },
        onError: (error: any) => {
            console.debug(events)
            console.debug(error.data)
            console.error('Error updating roll:', error);
            const details = error.data?.detail?.[0];
            if (error.status === 422 && details?.msg) {
                setErrorMessage(`${details.loc?.slice(1).join('.')}: ${details.msg}`);
            } else if (typeof error.data.detail === 'string') {
                setErrorMessage(`Failed to create roll events: ${error.data.detail}`);
            } else {
                setErrorMessage('Failed to create roll events: Unknown error');
            }
        }
    });

    if (rollLoading) {
        return <div>Loading...</div>
    }
    if (rollError) {
        return <div>Error loading recording data.</div>
    }

    return (
        <div className="flex flex-col flex-1 p-2">
            <div className="mb-4 pb-2 border-b border-gray-300 flex justify-between items-center">
                <RollHeader roll={roll} />
                <div className="flex gap-2">
                    <button onClick={() => saveEventsMutation.mutate(events)} className="px-4 py-1.5 bg-green-300 rounded hover:bg-green-400">
                        Save
                    </button>
                    <Link from={Route.fullPath} to=".." className="px-4 py-1.5 bg-red-300 rounded hover:bg-red-400">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-6">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </Link>
                </div>
            </div>
            {errorMessage && (
                <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
                    {errorMessage}
                </div>
            )}
            <div className="flex-1 min-h-0">
                {(graphsLoading || eventsLoading) ? 'Loading...' : (graphsError || eventsError) ? 'Error loading roll data.'
                    : <RollAnalysis roll={roll} graphs={graphs} events={events} setEvents={setEvents} />}
            </div>
        </div >
    );
}