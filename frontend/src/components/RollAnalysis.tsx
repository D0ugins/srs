import type { RollDetails, RollGraphs } from "@/lib/roll";
import { ParentSize } from "@visx/responsive";
import RollGraph from "./RollGraph";


export default function RollAnalysis({ roll, graphs }: { roll: RollDetails, graphs: RollGraphs }) {
    return (
        <div>
            {graphs.gps_data &&
                <div className="mb-2 h-64 relative"><ParentSize>
                    {(parent) => <svg width={parent.width} height={parent.height}>
                        <RollGraph parentWidth={parent.width} parentHeight={parent.height} data={{
                            timestamps: graphs.gps_data!.timestamp,
                            values: graphs.gps_data!.speed
                        }} />
                    </svg>
                    }
                </ParentSize></div>
            }
            {/* <div>{JSON.stringify(graphs, null, 2)}</div> */}
        </div>
    );
}