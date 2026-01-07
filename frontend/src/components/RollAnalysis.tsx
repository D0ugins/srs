import type { RollDetails, RollGraphs } from "@/lib/roll";
import { ParentSize } from "@visx/responsive";
import { useTooltip, TooltipWithBounds, defaultStyles } from "@visx/tooltip";
import { localPoint } from "@visx/event";
import { Line } from "@visx/shape";
import RollGraph from "./RollGraph";

const tooltipStyles = {
    ...defaultStyles,
    backgroundColor: "rgba(0,0,0,0.9)",
    color: "white",
    padding: "8px 12px",
    fontSize: "12px",
};

export default function RollAnalysis({ roll, graphs }: { roll: RollDetails, graphs: RollGraphs }) {
    const {
        tooltipData,
        tooltipLeft,
        tooltipTop,
        showTooltip,
        hideTooltip,
    } = useTooltip<{ timestamp: number; values: { label: string; value: number }[] }>();

    return (
        <div className="mb-2 h-full relative">
            <ParentSize>
                {(parent) => <>
                    <svg width={parent.width} height={parent.height}>
                        {graphs.gps_data &&
                            <RollGraph
                                parentWidth={parent.width}
                                parentHeight={parent.height / 4}
                                title="Speed (m/s)"
                                data={{
                                    timestamp: graphs.gps_data!.timestamp,
                                    values: graphs.gps_data!.speed
                                }}
                                onMouseLeave={hideTooltip}
                                showTooltip={showTooltip}
                            />
                        }
                        {graphs.centripetal &&
                            <RollGraph
                                parentWidth={parent.width}
                                parentHeight={parent.height / 4}
                                top={parent.height / 4}
                                title="Centripetal Acceleration (m/s²)"
                                data={graphs.centripetal}
                                onMouseLeave={hideTooltip}
                                showTooltip={showTooltip}
                            />
                        }
                        {tooltipLeft !== undefined && (
                            <Line
                                from={{ x: tooltipLeft, y: 0 }}
                                to={{ x: tooltipLeft, y: parent.height }}
                                stroke="#666"
                                strokeWidth={1}
                                pointerEvents="none"
                                strokeDasharray="4,2"
                            />
                        )}
                    </svg>
                    {tooltipData && (
                        <TooltipWithBounds
                            // key={Math.random()}
                            top={tooltipTop}
                            left={tooltipLeft}
                            style={tooltipStyles}
                        >
                            <div>
                                <strong>Time: {(tooltipData.timestamp / 1000).toFixed(3)}s</strong>
                                {tooltipData.values.map((v, i) => (
                                    <div key={i}>
                                        {v.label}: {v.value.toFixed(2)}
                                    </div>
                                ))}
                            </div>
                        </TooltipWithBounds>
                    )}
                </>}
            </ParentSize>
        </div>
    );
}