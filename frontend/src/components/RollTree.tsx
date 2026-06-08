import type { RollDataTree, RollTreeLeaf } from "./RollSidebar";
import { Link, useLocation } from "@tanstack/react-router";


function RollLeaf({ leaf, depth }: { leaf: RollTreeLeaf; depth: number }) {
    const location = useLocation();
    const { roll, displayName } = leaf;

    const pathParts = location.pathname.split('/');
    pathParts[2] = roll.id.toString();

    return (
        <Link
            className="text-gray-700 block"
            activeProps={{
                className: 'text-gray-700 block bg-gray-200',
                style: { marginLeft: `-${depth}em`, paddingLeft: `${depth}em` }
            }}
            to={pathParts.join('/')}
            params={{ rollId: roll.id.toString() }}
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
    );
}


export default function RollTree({ rollTree, path, depth, expandedNodes, setExpandedNodes }: {
    rollTree: RollDataTree;
    path: string;
    depth: number;
    expandedNodes: Set<string>;
    setExpandedNodes: React.Dispatch<React.SetStateAction<Set<string>>>;
}) {
    if (rollTree.kind == 'leaf') {
        return <RollLeaf leaf={rollTree} depth={depth} />;
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
                        <RollTree key={index} rollTree={child} path={nodePath} depth={depth} expandedNodes={expandedNodes} setExpandedNodes={setExpandedNodes} />
                    ))}
                </div>
            }
        </div>
    );
}