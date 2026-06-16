import type { RollDataTree, RollTreeLeaf } from "./RollSidebar";
import { Link, useLocation } from "@tanstack/react-router";


function RollLeaf({ leaf, depth, activeId, compareSet, onToggleCompare }: {
    leaf: RollTreeLeaf;
    depth: number;
    activeId?: string;
    compareSet: Set<string>;
    onToggleCompare: (rollId: string) => void;
}) {
    const location = useLocation();
    const { roll, displayName } = leaf;
    const rollId = roll.id.toString();
    const isActive = rollId === activeId;

    const pathParts = location.pathname.split('/');
    pathParts[2] = rollId;

    return (
        <div className="relative flex items-center">
            <Link
                className="text-neutral-700 block flex-1 min-w-0 truncate pr-5"
                activeProps={{
                    className: 'text-neutral-700 block flex-1 min-w-0 truncate pr-5 bg-neutral-200',
                    style: { marginLeft: `-${depth}em`, paddingLeft: `${depth}em` }
                }}
                to={pathParts.join('/')}
                params={{ rollId }}
            >
                <span>{displayName}{displayName !== "" ? " - " : ""}</span><span>
                    {roll.start_time
                        ? new Date(roll.start_time + "Z").toLocaleString('en-US', {
                            timeZone: 'America/New_York',
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: false
                        })
                        : <> Roll #{roll.roll_number} </>
                    }
                </span>
            </Link>
            {!isActive && (
                <label
                    className="absolute right-0 inset-y-0 flex items-center pl-4 pr-4 cursor-pointer"
                    title="Compare with active roll"
                >
                    <input
                        type="checkbox"
                        className="shrink-0 cursor-pointer accent-neutral-500"
                        checked={compareSet.has(rollId)}
                        onChange={() => onToggleCompare(rollId)}
                    />
                </label>
            )}
        </div>
    );
}


export default function RollTree({ rollTree, path, depth, expandedNodes, setExpandedNodes, activeId, compareSet, onToggleCompare }: {
    rollTree: RollDataTree;
    path: string;
    depth: number;
    expandedNodes: Set<string>;
    setExpandedNodes: React.Dispatch<React.SetStateAction<Set<string>>>;
    activeId?: string;
    compareSet: Set<string>;
    onToggleCompare: (rollId: string) => void;
}) {
    if (rollTree.kind == 'leaf') {
        return <RollLeaf leaf={rollTree} depth={depth} activeId={activeId} compareSet={compareSet} onToggleCompare={onToggleCompare} />;
    }

    const nodePath = `${path}/${rollTree.header}`
    const expanded = expandedNodes.has(nodePath);

    const toggleExpanded = () => {
        setExpandedNodes(prev => {
            const next = new Set(prev);
            if (next.has(nodePath)) next.delete(nodePath);
            else next.add(nodePath);
            return next;
        });
    };

    return (
        <div>
            <div className="cursor-pointer" onClick={toggleExpanded}>
                {expanded ? '▼' : '▶'} {rollTree.header}
            </div>
            {
                expanded && <div className="ml-[1em]">
                    {rollTree.children.map((child, index) => (
                        <RollTree key={index} rollTree={child} path={nodePath} depth={depth} expandedNodes={expandedNodes} setExpandedNodes={setExpandedNodes} activeId={activeId} compareSet={compareSet} onToggleCompare={onToggleCompare} />
                    ))}
                </div>
            }
        </div>
    );
}