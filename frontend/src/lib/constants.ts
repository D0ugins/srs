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