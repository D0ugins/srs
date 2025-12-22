import { capitalize } from "@/lib/format";
import { ROLL_ORDER_KEYS, type RollOrderKey } from "./RollSidebar";

export default function SidebarFilters({ groupings, setGroupings }:
    { groupings: RollOrderKey[], setGroupings: (g: RollOrderKey[]) => void }) {

    const handleGroupingChange = (index: number, value: string) => {
        const newGroupings = groupings.slice(0, index);
        if (value !== 'none') newGroupings.push(value as RollOrderKey);
        setGroupings(newGroupings);
    };

    return <div className="mb-2">
        <h3 className="font-bold mb-1">Group By:</h3>
        {
            [...Array(4)].map((_, index) => <select
                className="mr-2 pl-[2px] pb-[2px] border rounded"
                onChange={(e) => handleGroupingChange(index, e.target.value)}
            >
                <option key="none" value="none">---</option>
                {
                    ROLL_ORDER_KEYS.filter(key => !groupings.slice(0, index).includes(key))
                        .map(key =>
                            <option key={key} value={key} selected={groupings[index] === key}>{capitalize(key)}</option>)
                }
            </select>)
        }

    </div>
}