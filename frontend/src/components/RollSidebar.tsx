import { useState, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import RollTree from './RollTree'
import { capitalize, formatDate } from '@/lib/format'
import SidebarFilters from './SidebarFilters'
import type { RollDataBase } from '@/lib/roll'

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

export const ROLL_ORDER_KEYS = ['type', 'date', 'driver', 'buggy'] as const;
export type RollOrderKey = typeof ROLL_ORDER_KEYS[number];

function getGroupKey(roll: RollDataBase, key: RollOrderKey): string {
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

function groupRolls(rolls: RollDataBase[], leaves: Map<RollDataBase, RollTreeLeaf>, groupings: RollOrderKey[]): RollDataTree[] {
    if (groupings.length === 0) {
        return rolls.map(roll => leaves.get(roll)!);
    }

    const groupingKey = groupings[0];
    const grouped: Map<string, RollDataBase[]> = new Map();

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
            header: capitalize(key),
            children: children,
        });
    }

    return result;
}

function buildRollTree(rolls: RollDataBase[], groupings: RollOrderKey[], _filters: unknown[] = [],
    makeLeaf: (roll: RollDataBase, name: string) => RollTreeLeaf): RollDataTree[] {

    // Filter
    // TODO

    const leaves: Map<RollDataBase, RollTreeLeaf> = new Map();
    for (const roll of rolls) {
        let name = '';
        if (!groupings.includes('type')) name += `${capitalize(roll.roll_date.type)} `
        if (!groupings.includes('driver')) name += `${roll.driver.name} `
        if (!groupings.includes('buggy')) name += `${roll.buggy.name} `
        if (!groupings.includes('date')) name += `${formatDate(roll.roll_date)} `

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
            const data = await response.json() as RollDataBase[];
            return data.sort((a, b) => {
                if (a.roll_date.year !== b.roll_date.year) return b.roll_date.year - a.roll_date.year;
                if (a.roll_date.month !== b.roll_date.month) return b.roll_date.month - a.roll_date.month;
                if (a.roll_date.day !== b.roll_date.day) return b.roll_date.day - a.roll_date.day;

                if (a.roll_number !== undefined && b.roll_number !== undefined) return b.roll_number - a.roll_number;
                if (a.start_time && b.start_time) return b.start_time.localeCompare(a.start_time);
                return b.updated_at.localeCompare(a.updated_at);
            });
        },
    });

    const [groupings, setGroupings] = useState<RollOrderKey[]>(['type', 'driver']);
    const [filters, setFilters] = useState<unknown[]>([]); // TODO

    if (isPending) {
        return <div>Loading...</div>
    }

    if (isError) {
        return <div>Error loading rolls.</div>
    }

    const makeLeaf = (roll: RollDataBase, name: string): RollTreeLeaf => ({
        kind: 'leaf' as const,
        element: <div className={`text-gray-700 ${roll.id === selectedId ? 'bg-gray-200' : ''}`}
            style={roll.id === selectedId ? { marginLeft: `-${groupings.length}em`, paddingLeft: `${groupings.length}em`, } : {}}
            onClick={() => updateId(roll.id)}>
            <span>{name}{name !== "" ? " - " : ""}</span><span>
                {roll.start_time
                    ? roll.start_time.slice(-8, -3)
                    : <> {formatDate(roll.roll_date)} Roll #{roll.roll_number} </>
                }
            </span>
        </div>,
    });

    const rollTrees = buildRollTree(data, groupings, [], makeLeaf);
    return <>
        <SidebarFilters groupings={groupings} setGroupings={setGroupings} />
        <hr />
        {rollTrees.map((tree, i) => (<RollTree rollTree={tree} key={i} />))}
    </>
}