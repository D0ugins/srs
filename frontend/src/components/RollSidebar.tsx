import type { ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import RollTree from './RollTree'
import { Link } from '@tanstack/react-router'

export interface RollData {
    id: number
    roll_number?: number
    start_time?: string

    driver: {
        id: number
        name: string

        created_at: string
        updated_at: string
    }

    buggy: {
        id: number
        name: string
        abbreviation: string

        created_at: string
        updated_at: string
    }

    roll_date: {
        id: number
        year: number
        month: number
        day: number

        temperature?: number
        humidity?: number
        type: "weekend" | "midnight"

        notes: string
    }

    roll_files: {
        id: number
        uri: string
        sensor_id: number
        type: string

        created_at: string
        updated_at: string
    }[]

    driver_notes: string
    mech_notes: string
    pusher_notes: string

    created_at: string
    updated_at: string
}

interface RollTreeLeaf {
    kind: 'leaf'
    element: ReactElement
}

interface RollTreeNode {
    kind: 'node'
    header: string
    children: RollDataTree[]
}

export type RollDataTree = RollTreeNode | RollTreeLeaf

function formatDate(dateObj: { year: number; month: number; day: number }): string {
    return `${dateObj.year}/${String(dateObj.month).padStart(2, '0')}/${String(dateObj.day).padStart(2, '0')}`;
}

export type RollOrderKey = 'type' | 'date' | 'driver' | 'buggy'

function getGroupKey(roll: RollData, key: RollOrderKey): string {
    switch (key) {
        case 'type':
            return roll.roll_date.type;
        case 'date':
            return formatDate(roll.roll_date);
        case 'driver':
            return roll.driver.name;
        case 'buggy':
            return roll.buggy.name;
        default:
            console.error(`Unknown grouping key: ${key}`);
            return 'unknown';
    }
}

function groupRolls(rolls: RollData[], leaves: Map<RollData, RollTreeLeaf>, groupings: RollOrderKey[]): RollDataTree[] {
    if (groupings.length === 0) {
        return rolls.map(roll => leaves.get(roll)!);
    }

    const groupingKey = groupings[0];
    const grouped: Map<string, RollData[]> = new Map();

    for (const roll of rolls) {
        const key = getGroupKey(roll, groupingKey);
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(roll);
    }

    const result: RollDataTree[] = [];
    for (const [key, groupedRolls] of grouped.entries()) {
        const children = groupRolls(groupedRolls, leaves, groupings.slice(1));
        result.push({
            kind: 'node' as const,
            header: key,
            children: children,
        });
    }

    return result;
}

function buildRollTree(rolls: RollData[], groupings: RollOrderKey[],
    _sort: unknown[] = [], _filters: unknown[] = [],
    makeLeaf: (roll: RollData, name: string) => RollTreeLeaf): RollDataTree[] {

    // Filter
    // TODO

    // Sort
    // TODO

    const leaves: Map<RollData, RollTreeLeaf> = new Map();
    for (const roll of rolls) {
        let name = '';
        if (!groupings.includes('type')) name += `${roll.roll_date.type} `
        if (!groupings.includes('date')) name += `${formatDate(roll.roll_date)} `
        if (!groupings.includes('driver')) name += `${roll.driver.name} `
        if (!groupings.includes('buggy')) name += `${roll.buggy.name} `

        leaves.set(roll, makeLeaf(roll, name.trim()));
    }
    return groupRolls(rolls, leaves, groupings);
}


export default function RollSidebar({ updateId, selectedId }:
    { updateId: (id: number) => void, selectedId: number | undefined }) {
    const { data, isPending, isError } = useQuery({
        queryKey: ['rolls'],
        queryFn: async () => {
            const response = await fetch(`${import.meta.env.VITE_BACKEND_URL}/rolls`)
            if (!response.ok) {
                throw new Error('Network response was not ok')
            }
            const data = await response.json() as RollData[];
            return data.sort((a: any, b: any) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
        },
    })

    if (isPending) {
        return <div>Loading...</div>
    }

    if (isError) {
        return <div>Error loading rolls.</div>
    }
    const groupings = ['type', 'driver', 'buggy'] as RollOrderKey[];

    const makeLeaf = (roll: RollData, name: string): RollTreeLeaf => ({
        kind: 'leaf' as const,
        element: <div className={`text-gray-700 ${roll.id === selectedId ? 'bg-gray-200' : ''}`}
            style={roll.id === selectedId ? { marginLeft: `-${groupings.length}em`, paddingLeft: `${groupings.length}em`, } : {}}
            onClick={() => updateId(roll.id)}>
            <span>{name} - </span><span>
                {roll.start_time
                    ? roll.start_time.slice(-8, -3)
                    : <> {formatDate(roll.roll_date)} Roll #{roll.roll_number} </>
                }
            </span>
        </div>,
    });

    const rollTrees = buildRollTree(data, ['type', 'driver', 'buggy'], [], [], makeLeaf);
    return <>{rollTrees.map(tree => (<RollTree rollTree={tree} />))}</>
}