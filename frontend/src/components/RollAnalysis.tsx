import type { RollDetails, RollGraphs } from "@/lib/roll";
import { ParentSize } from "@visx/responsive";
import RollGraph from "./RollGraph";


export default function RollAnalysis({ roll, graphs }: { roll: RollDetails, graphs: RollGraphs }) {


    return (
        <div className="mb-2 h-full relative">
            <ParentSize>
                {(parent) => <svg width={parent.width} height={parent.height}>
                    {graphs.gps_data &&
                        <RollGraph parentWidth={parent.width} parentHeight={parent.height / 4} title="Speed (m/s)" data={{
                            timestamp: graphs.gps_data!.timestamp,
                            values: graphs.gps_data!.speed
                        }} />
                    }
                    {graphs.centripetal &&
                        <RollGraph parentWidth={parent.width} parentHeight={parent.height / 4} top={parent.height / 4}
                            title="Centripetal Acceleration (m/s²)" data={graphs.centripetal} />
                    }
                </svg>
                }
            </ParentSize>
        </div>

    );
}