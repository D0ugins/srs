import { useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import RollTree from './RollTree'
import { capitalize, formatDate } from '@/lib/format'
import SidebarFilters from './SidebarFilters'
import type { RollDataBase } from '@/lib/roll'
import { Link } from '@tanstack/react-router'

export interface RollTreeLeaf {
    kind: 'leaf'
    roll: RollDataBase
    displayName: string
}

interface RollTreeNode {
    kind: 'node'
    header: string
    children: RollDataTree[]
}

export type RollDataTree = RollTreeNode | RollTreeLeaf

export const ROLL_ORDER_KEYS = ['raceday', 'date', 'driver', 'buggy'] as const;
export type RollOrderKey = typeof ROLL_ORDER_KEYS[number];

const GROUPINGS_KEY = 'rolls-sidebar-groupings';

function getGroupKey(roll: RollDataBase, key: RollOrderKey): string {
    switch (key) {
        case 'raceday': {
            const month = roll.roll_date.month;
            const year = roll.roll_date.year;
            const racedayYear = month <= 4 ? year : year + 1;
            return `RD ${racedayYear}`;
        }
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

function buildRollTree(rolls: RollDataBase[], groupings: RollOrderKey[], _filters: unknown[] = []): RollDataTree[] {

    // Filter
    // TODO

    const leaves: Map<RollDataBase, RollTreeLeaf> = new Map();
    for (const roll of rolls) {
        let name = '';
        if (!groupings.includes('driver')) name += `${roll.driver.name} `
        if (!groupings.includes('buggy')) name += `${roll.buggy.name} `
        if (!groupings.includes('date')) name += `${formatDate(roll.roll_date)} `

        leaves.set(roll, { kind: 'leaf', roll, displayName: name.trim() });
    }
    return groupRolls(rolls, leaves, groupings);
}


export default function RollSidebar({ expandedNodes, setExpandedNodes }: {
    expandedNodes: Set<string>;
    setExpandedNodes: React.Dispatch<React.SetStateAction<Set<string>>>;
}) {
    const { data, isPending, isError } = useQuery({
        queryKey: ['rolls'],
        queryFn: async () => {
            const response = await fetch(`${import.meta.env.VITE_BACKEND_URL}/rolls?type=weekend`)
            if (!response.ok) {
                throw new Error('Network response was not ok')
            }
            const data = await response.json() as RollDataBase[];
            return data.sort((a, b) => {
                if (a.roll_date.year !== b.roll_date.year) return b.roll_date.year - a.roll_date.year;
                if (a.roll_date.month !== b.roll_date.month) return b.roll_date.month - a.roll_date.month;
                if (a.roll_date.day !== b.roll_date.day) return b.roll_date.day - a.roll_date.day;

                if (a.roll_number !== undefined && b.roll_number !== undefined
                    && a.roll_number !== b.roll_number) return b.roll_number - a.roll_number;
                if (a.start_time && b.start_time) return b.start_time.localeCompare(a.start_time);
                return b.updated_at.localeCompare(a.updated_at);
            });
        },
    });

    const [groupings, setGroupings] = useState<RollOrderKey[]>(() => {
        try {
            const stored = localStorage.getItem(GROUPINGS_KEY);
            if (!stored) return ['date', 'driver'];
            const parsed = JSON.parse(stored) as string[];

            if (parsed.every(key => ROLL_ORDER_KEYS.includes(key as RollOrderKey)))
                return parsed as RollOrderKey[];
        } catch (e) {
            console.error('Failed to load groupings from localStorage', e);
        }
        return ['raceday', 'driver'];
    });
    // const [filters, setFilters] = useState<unknown[]>([]); // TODO

    useEffect(() => {
        try {
            localStorage.setItem(GROUPINGS_KEY, JSON.stringify(groupings));
        } catch (e) { console.error('Failed to save groupings to localStorage', e); }
    }, [groupings]);

    const rollTrees = useMemo(() => {
        if (!data) return [];
        return buildRollTree(data, groupings, []);
    }, [data, groupings]);

    if (isPending) {
        return <div>Loading...</div>
    }

    if (isError) {
        return <div>Error loading rolls.</div>
    }

    return <>
        <SidebarFilters groupings={groupings} setGroupings={setGroupings} />
        <hr />
        <div className="relative">
            <Link
                to="/rolls/new"
                className="absolute top-1.25 right-0 px-0.5 py-0.5 bg-green-200 rounded hover:bg-green-300 z-10"
            >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>

            </Link>
            {rollTrees.map((tree, i) => (<RollTree rollTree={tree} key={i} path="" depth={groupings.length} expandedNodes={expandedNodes} setExpandedNodes={setExpandedNodes} />))}
        </div>
    </>
}