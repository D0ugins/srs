import type { RollDataTree } from "./RollSidebar";
import { useState } from "react";


export default function RollTree({ rollTree }: { rollTree: RollDataTree }) {
    if (rollTree.kind == 'leaf') {
        return rollTree.element;
    }

    const [epanded, setExpanded] = useState(rollTree.children.length === 1);

    return (
        <div>
            <div className="cursor-pointer" onClick={() => setExpanded(!epanded)}>
                {epanded ? '▼' : '▶'} {rollTree.header}
            </div>
            <div className="ml-[1em]" style={{ display: epanded ? 'block' : 'none' }}>
                {rollTree.children.map((child, index) => (
                    <RollTree key={index} rollTree={child} />
                ))}
            </div>
        </div>
    );
}