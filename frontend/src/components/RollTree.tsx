import type { RollDataTree } from "./RollSidebar";


export default function RollTree({ rollTree, path, expandedNodes, setExpandedNodes }: {
    rollTree: RollDataTree;
    path: string;
    expandedNodes: Set<string>;
    setExpandedNodes: React.Dispatch<React.SetStateAction<Set<string>>>;
}) {
    if (rollTree.kind == 'leaf') {
        return rollTree.element;
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
                        <RollTree key={index} rollTree={child} path={nodePath} expandedNodes={expandedNodes} setExpandedNodes={setExpandedNodes} />
                    ))}
                </div>
            }
        </div>
    );
}