import type { EventType, RollEvent } from "@/lib/roll";

function formatTimestamp(ms: number): string {
    const seconds = ms / 1000;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = (seconds % 60).toFixed(2);
    return minutes > 0 ? `${minutes}:${remainingSeconds.padStart(5, '0')}` : `${remainingSeconds}s`;
}

interface RollEventListProps {
    events: RollEvent[];
    updateVideoTime: (time: number) => void;
}

export const EVENT_COLORS: Record<EventType, string> = {
    'roll_start': '#166534',
    'hill_start': '#4ade80',
    'roll_end': '#991b1b',
};

export default function RollEventList({ events, updateVideoTime }: RollEventListProps) {
    if (events.length === 0) {
        return <div className="mt-4 text-gray-500 text-sm">No events recorded</div>;
    }

    return (
        <div className="mt-4">
            <h3 className="text-sm font-semibold mb-2">Events</h3>
            <ul className="max-h-48 overflow-y-auto space-y-1 text-sm">
                {events.map((event, index) => (
                    <li key={event.id ?? index} className="flex items-center gap-2 p-1 rounded hover:bg-gray-100"
                        onClick={() => updateVideoTime(event.timestamp_ms / 1000)}
                        style={{ cursor: 'pointer', borderLeft: `4px solid ${EVENT_COLORS[event.type]}`, backgroundColor: `${EVENT_COLORS[event.type]}10` }}
                    >
                        <span className="font-medium">{event.type}{event.tag ? `: ${event.tag}` : ''}</span>
                        <span className="text-gray-500 ml-auto">{formatTimestamp(event.timestamp_ms)}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}