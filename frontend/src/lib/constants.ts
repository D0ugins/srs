export const GRAPH_MARGIN = { top: 25, right: 30, bottom: 12, left: 50 };

export const EVENT_TYPES = ['roll_start', 'hill_start', 'freeroll_start', 'roll_end', 'note'] as const;
export type EventType = typeof EVENT_TYPES[number];
export const EVENT_COLORS = {
    'roll_start': '#166534',
    'hill_start': '#4ade80',
    'freeroll_start': '#4ade80',
    'roll_end': '#991b1b',
    'note': '#77a0ff',
} as Record<EventType, string>;

export const HILL_LINES = [
    [{ long: -79.94167562920214, lat: 40.44160934443993 }, { long: -79.94164872395604, lat: 40.44160044911559 }],
    [{ long: -79.94208454349354, lat: 40.44067314941055 }, { long: -79.94206243828982, lat: 40.44066749957287 }],
    [{ long: -79.94245732108891, lat: 40.44022167684350 }, { long: -79.94244264813403, lat: 40.44018461839458 }],
    [{ long: -79.94699345845450, lat: 40.44152197862799 }, { long: -79.94703772174984, lat: 40.44144900677409 }],
    [{ long: -79.94616078342716, lat: 40.44133748254770 }, { long: -79.94619012667295, lat: 40.44126998544493 }],
    [{ long: -79.94458763221277, lat: 40.44103206276085 }, { long: -79.94461215996920, lat: 40.44096903057039 }],
    [{ long: -79.94254626041403, lat: 40.44060119480072 }, { long: -79.94257240091068, lat: 40.44051918034233 }]
]