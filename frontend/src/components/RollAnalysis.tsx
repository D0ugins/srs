import type { RollDetails, RollGraphs } from "@/lib/roll";
import { useMemo, useCallback } from "react";
import { ParentSize } from "@visx/responsive";
import { useTooltip, TooltipWithBounds, defaultStyles } from "@visx/tooltip";
import { Line } from "@visx/shape";
import { applyMatrixToPoint, Zoom, type TransformMatrix } from "@visx/zoom";
import RollGraph from "./RollGraph";

const tooltipStyles = {
    ...defaultStyles,
    backgroundColor: "rgba(0,0,0,0.9)",
    color: "white",
    padding: "8px 12px",
    fontSize: "12px",
};

export const GRAPH_MARGIN = { top: 25, right: 30, bottom: 30, left: 50 };

export default function RollAnalysis({ roll, graphs }: { roll: RollDetails, graphs: RollGraphs }) {
    const {
        tooltipData,
        tooltipLeft,
        tooltipTop,
        showTooltip,
        hideTooltip,
    } = useTooltip<{ timestamp: number; values: { label: string; value: number }[] }>();

    const speedData = useMemo(() => ({
        timestamp: graphs.gps_data?.timestamp ?? [],
        values: graphs.gps_data?.speed ?? []
    }), [graphs.gps_data]);

    const centripetalData = useMemo(() => graphs.centripetal, [graphs.centripetal]);

    const handleMouseLeave = useCallback(() => {
        hideTooltip();
    }, [hideTooltip]);

    return (
        <div className="mb-2 h-full relative">
            <ParentSize>
                {(parent) => <Zoom<SVGSVGElement>
                    width={parent.width}
                    height={parent.height}
                    scaleXMin={1}
                    wheelDelta={(event) => ({ scaleX: event.deltaY > 0 ? 0.9 : 1.1, scaleY: 1 })}
                    constrain={(transformMatrix: TransformMatrix, _prevTransformMatrix: TransformMatrix) => {
                        if (transformMatrix.scaleX <= 1) return { ...transformMatrix, scaleX: 1, translateX: 0 };
                        const min = applyMatrixToPoint(transformMatrix, { x: 0, y: 0 });
                        const innerWidth = parent.width - GRAPH_MARGIN.left - GRAPH_MARGIN.right;
                        const max = applyMatrixToPoint(transformMatrix, { x: innerWidth, y: 0 });
                        if (min.x > 0) {
                            return {
                                ...transformMatrix,
                                translateX: 0,
                            }
                        }
                        if (max.x < innerWidth) {
                            return {
                                ...transformMatrix,
                                translateX: innerWidth - (max.x - transformMatrix.translateX),
                            }
                        }
                        return transformMatrix;
                    }}
                >{
                        (zoom) => <div className="relative">
                            <svg width={parent.width} height={parent.height}
                                style={{ cursor: zoom.isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}
                                ref={zoom.containerRef}>
                                {graphs.gps_data &&
                                    <RollGraph
                                        parentWidth={parent.width}
                                        parentHeight={parent.height / 4}
                                        title="Speed (m/s)"
                                        zoom={zoom}
                                        data={speedData}
                                        onMouseLeave={handleMouseLeave}
                                        showTooltip={showTooltip}
                                    />
                                }
                                {centripetalData &&
                                    <RollGraph
                                        parentWidth={parent.width}
                                        parentHeight={parent.height / 4}
                                        top={parent.height / 4}
                                        title="Centripetal Acceleration (m/s²)"
                                        data={centripetalData}
                                        zoom={zoom}
                                        onMouseLeave={handleMouseLeave}
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
                        </div>}
                </Zoom>}
            </ParentSize>
        </div>
    );
}