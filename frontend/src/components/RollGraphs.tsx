import React, { useMemo, useState, useEffect } from "react";
import { useTooltip, TooltipWithBounds, defaultStyles } from "@visx/tooltip";
import { Line, Polygon } from "@visx/shape";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import type { ScaleLinear } from "d3-scale";
import { RectClipPath } from "@visx/clip-path";
import { localPoint } from "@visx/event";
import type { ZoomProps, ZoomState } from "@visx/zoom";
import RollGraph, { type GraphData, type TooltipData } from "./RollGraph";

type ZoomType<ElementType extends Element> = ZoomProps<ElementType>['children'] extends (zoom: infer U) => any ? U : never;

const tooltipStyles = {
    ...defaultStyles,
    backgroundColor: "rgba(0,0,0,0.9)",
    color: "white",
    padding: "8px 12px",
    fontSize: "12px",
};

export const GRAPH_MARGIN = { top: 25, right: 30, bottom: 10, left: 50 };

export interface RollGraphsProps {
    data: {
        speed?: GraphData;
        centripetal?: GraphData;
        energy?: GraphData;
    }
    tooltipLeft?: number;
    tooltipTop?: number;
    tooltipData?: TooltipData;
    videoTime?: number;
    videoStart?: number;
    playing: boolean;
    showTooltip: (args: any) => void;
    handleMouseLeave: () => void;
    updateVideoTime: (time: number) => void;
    setPlaying: (playing: boolean) => void;
}

export function zoomXScale(zoom: ZoomState, scale: ScaleLinear<number, number, never>): ScaleLinear<number, number, never> {
    const newDomain = scale.range().map(d => scale.invert(d - zoom.transformMatrix.translateX) / zoom.transformMatrix.scaleX);
    return scaleLinear({
        domain: newDomain,
        range: scale.range(),
    });
}

export default function RollGraphs({ data,
    tooltipLeft, tooltipTop, tooltipData, playing, isDragging, videoStart,
    showTooltip, handleMouseLeave, updateVideoTime, setPlaying, setIsDragging,
    videoTime, zoom, parent }: RollGraphsProps &
    { zoom: ZoomType<SVGSVGElement>, parent: { width: number; height: number }, isDragging: boolean, setIsDragging: (dragging: boolean) => void }) {
    {
        const width = parent.width - GRAPH_MARGIN.left - GRAPH_MARGIN.right;
        const xScale = useMemo(() => {
            const allTimestamps = Object.values(data).flatMap(d => d.timestamp);
            const maxTime = Math.max(...allTimestamps);
            return zoomXScale(zoom, scaleLinear({
                domain: [0, maxTime],
                range: [0, width],
            }))
        }, [data, zoom.transformMatrix, width]);

        const [wasPlaying, setWasPlaying] = useState(false);

        const handlePlayheadMouseDown = (e: React.MouseEvent) => {
            e.stopPropagation();
            setWasPlaying(playing);
            setIsDragging(true);
            setPlaying(false);
        };

        const handleDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
            const point = localPoint(e);
            if (!point || !videoStart) return;

            const x = point.x - GRAPH_MARGIN.left;
            const timestamp = xScale.invert(x);
            updateVideoTime((timestamp - videoStart) / 1000);
        };

        useEffect(() => {
            const handleMouseMove = (e: MouseEvent) => {
                if (!isDragging || !videoStart) return;

                if (isDragging) {
                    const point = localPoint(e);
                    if (!point) return;

                    const x = point.x - GRAPH_MARGIN.left;
                    const timestamp = xScale.invert(x); // clamping handled in updateVideoTime
                    updateVideoTime((timestamp - videoStart) / 1000);
                }
            };

            const handleMouseUp = () => {
                if (isDragging) {
                    setIsDragging(false);
                    setPlaying(wasPlaying)
                }
            };

            if (isDragging) {
                window.addEventListener('mousemove', handleMouseMove);
                window.addEventListener('mouseup', handleMouseUp);
            }

            return () => {
                window.removeEventListener('mousemove', handleMouseMove);
                window.removeEventListener('mouseup', handleMouseUp);
            };
        }, [isDragging, wasPlaying, xScale]);

        return <div className="relative">
            <svg width={parent.width} height={parent.height}
                // Transform ensures pixel alignment
                className="cursor-move touch-none select-none"
                ref={zoom.containerRef}
                onDoubleClick={handleDoubleClick}>
                {data.speed &&
                    <RollGraph
                        parentWidth={parent.width}
                        parentHeight={parent.height / 4}
                        title="Speed (m/s)"
                        xScale={xScale}
                        data={data.speed}
                        onMouseLeave={handleMouseLeave}
                        showTooltip={showTooltip}
                    />
                }
                {data.centripetal &&
                    <RollGraph
                        parentWidth={parent.width}
                        parentHeight={parent.height / 4}
                        top={parent.height / 4}
                        title="Centripetal Acceleration (m/s²)"
                        xScale={xScale}
                        data={data.centripetal}
                        onMouseLeave={handleMouseLeave}
                        showTooltip={showTooltip}
                        showAxis={false}
                    />
                }
                {
                    data.energy &&
                    <RollGraph
                        parentWidth={parent.width}
                        parentHeight={parent.height / 4}
                        top={parent.height / 2}
                        title="Specific Energy (J/kg)"
                        xScale={xScale}
                        data={data.energy}
                        onMouseLeave={handleMouseLeave}
                        showTooltip={showTooltip}
                        showAxis={false}
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
                {
                    videoTime && <>
                        <Group top={GRAPH_MARGIN.top - 16} left={GRAPH_MARGIN.left} clipPath="url(#playhead-clip-path)"
                            shapeRendering="geometricPrecision" pointerEvents="none" opacity={0.75}
                            style={{ cursor: isDragging ? "grabbing" : "grab", pointerEvents: "all" }}
                            onMouseDown={handlePlayheadMouseDown} >
                            <RectClipPath id="playhead-clip-path" width={width} height={parent.height} />
                            <Line
                                from={{ x: xScale(videoTime), y: 2 }}
                                to={{ x: xScale(videoTime), y: parent.height }}
                                stroke="#ff0000"
                                strokeWidth={2}
                                shapeRendering="geometricPrecision"
                            />
                            <Polygon
                                points={[
                                    [xScale(videoTime), 14],
                                    [xScale(videoTime) - 6, 8],
                                    [xScale(videoTime) - 6, 2],
                                    [xScale(videoTime) + 6, 2],
                                    [xScale(videoTime) + 6, 8],
                                ]}
                                fill="#ff0000"
                            />
                        </Group></>
                }
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
        </div>
    }
}