import type { RollEventInput } from "@/routes/rolls/$rollId.recording";

function formatTimestamp(ms: number): string {
    const seconds = ms / 1000;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = (seconds % 60).toFixed(2);
    return minutes > 0 ? `${minutes}:${remainingSeconds.padStart(5, '0')}` : `${remainingSeconds}s`;
}

interface RollEventListProps {
    events: RollEventInput[];
    updateVideoTime: (time: number) => void;
    setEvents: React.Dispatch<React.SetStateAction<RollEventInput[]>>;
    videoTimestamp?: number;
}

export const EVENT_TYPES = ['roll_start', 'hill_start', 'freeroll_start', 'roll_end'] as const;
export type EventType = typeof EVENT_TYPES[number];
export const EVENT_COLORS: Record<EventType, string> = {
    'roll_start': '#166534',
    'hill_start': '#4ade80',
    'freeroll_start': '#4ade80',
    'roll_end': '#991b1b',
};

function RollEvent({ event, onEdit, onDelete }: { event: RollEventInput, onEdit: () => void, onDelete: () => void }) {
    return <>
        <span className="font-medium ">{event.type}{event.tag ? `: ${event.tag}` : ''}</span>
        <span className="text-gray-700 ml-auto">{formatTimestamp(event.timestamp_ms)}</span>
        {/* Edit */}
        <button
            onClick={onEdit}
            className="text-gray-600 hover:text-gray-800 py-1"
        >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
            </svg>
        </button>
        {/* Delete */}
        <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="text-red-400 hover:text-red-600 py-1"
        >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
            </svg>
        </button>
    </>;
}


function RollEventEdit({ event, setEvents, onDone, onDelete }:
    { event: RollEventInput, setEvents: React.Dispatch<React.SetStateAction<RollEventInput[]>>, onDone: () => void, onDelete: () => void }) {

    const updateEvent = (updates: Partial<RollEventInput>) => {
        setEvents(events => events.map(e =>
            e.key === event.key ? { ...e, ...updates } : e
        ));
    };


    const handleTimestampChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const seconds = parseFloat(e.target.value);
        if (!isNaN(seconds)) {
            updateEvent({ timestamp_ms: Math.round(seconds * 1000) });
        }
    };

    return (
        <div className="flex items-center gap-2 py-1 w-full" onClick={(e) => e.stopPropagation()}>
            {/* Type */}
            <select
                value={event.type}
                onChange={(e) => updateEvent({ type: e.target.value as EventType })}
                className="text-sm border rounded px-1 py-0.5"
            >
                {EVENT_TYPES.map(type => (
                    <option key={type} value={type}>{type}</option>
                ))}
            </select>
            {/* Tag */}
            <input
                type="text"
                value={event.tag || ''}
                onChange={(e) => updateEvent({ tag: e.target.value || undefined })}
                placeholder="tag"
                className="text-sm border rounded px-1 py-0.5 w-20"
            />
            {/* Timestamp */}
            <input
                type="number"
                value={(event.timestamp_ms / 1000).toFixed(2)}
                onChange={handleTimestampChange}
                step="0.01"
                className="text-sm border rounded px-1 py-0.5 w-20 ml-auto"
            />
            {/* Ok */}
            <button
                onClick={(e) => { e.stopPropagation(); onDone(); }}
                className="text-gray-600 hover:text-gray-800"
            >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
            </button>
            {/* Delete */}
            <button
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                className="text-red-400 hover:text-red-600 pr-1"
            >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                </svg>
            </button>
        </div>
    );
}

// TODO
function guessNextEvent(events: RollEventInput[], videoTimestamp?: number): { type: EventType; tag?: string } {
    return { type: 'roll_start' };
}


export default function RollEventList({ events, setEvents, updateVideoTime, videoTimestamp }: RollEventListProps) {
    function onEventClick(event: RollEventInput) {
        updateVideoTime(event.timestamp_ms / 1000);
    }

    function toggleEdit(event: RollEventInput) {
        setEvents(events.map(e => ({ ...e, editing: e.key === event.key && !event.editing })));
    }

    function deleteEvent(event: RollEventInput) {
        setEvents(events.filter(e => e.key !== event.key));
    }

    function addEvent() {
        const newKey = events.length > 0 ? Math.max(...events.map(e => e.key)) + 1 : 0;
        const newEvent: RollEventInput = {
            key: newKey,
            ...guessNextEvent(events, videoTimestamp),
            timestamp_ms: videoTimestamp ? Math.round(videoTimestamp) : 0,
            editing: true,
        };
        setEvents(events => [...events.map(e => ({ ...e, editing: false })), newEvent].sort((a, b) => a.timestamp_ms - b.timestamp_ms));
    }

    return (
        <div className="mt-4">
            <div className="flex justify-between items-center mb-2">
                <h3 className="text-sm font-semibold">Events</h3>
                <button
                    onClick={addEvent}
                    className="text-sm text-gray-600 flex items-center gap-1 bg-green-200 hover:bg-green-300 rounded"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                </button>
            </div>
            {events.length === 0 ? (
                <div className="text-gray-500 text-sm">No events recorded</div>
            ) : (
                <ul className="max-h-48 overflow-y-auto space-y-1 text-sm">
                    {events.map((event) => (
                        <li className="flex items-center gap-2 py-0 px-1 rounded hover:bg-gray-100" key={event.key}
                            onClick={() => onEventClick(event)}
                            style={{ cursor: 'pointer', borderLeft: `4px solid ${EVENT_COLORS[event.type]}`, backgroundColor: `${EVENT_COLORS[event.type]}10` }}>
                            {event.editing ?
                                <RollEventEdit key={event.key} event={event} setEvents={setEvents} onDone={() => toggleEdit(event)} onDelete={() => deleteEvent(event)} /> :
                                <RollEvent key={event.key} event={event} onEdit={() => toggleEdit(event)} onDelete={() => deleteEvent(event)} />
                            }
                        </li>))}
                </ul>
            )}
        </div>
    );
}