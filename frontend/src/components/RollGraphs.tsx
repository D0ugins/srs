import React, { useMemo, useState, useEffect } from "react";
import { TooltipWithBounds, defaultStyles } from "@visx/tooltip";
import { Line, Polygon } from "@visx/shape";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import type { ScaleLinear } from "d3-scale";
import { RectClipPath } from "@visx/clip-path";
import { localPoint } from "@visx/event";
import type { ZoomProps, ZoomState } from "@visx/zoom";
import RollGraph, { type GraphData, type TooltipData } from "./RollGraph";
import type { RollEvent } from "@/lib/roll";
import { EVENT_COLORS, GRAPH_MARGIN } from "@/lib/constants";

type ZoomType<ElementType extends Element> = ZoomProps<ElementType>['children'] extends (zoom: infer U) => any ? U : never;

const tooltipStyles = {
    ...defaultStyles,
    backgroundColor: "rgba(0,0,0,0.9)",
    color: "white",
    padding: "8px 12px",
    fontSize: "12px",
};


export interface RollGraphsProps {
    data: {
        speed?: GraphData[];
        centripetal?: GraphData[];
        energy?: GraphData[];
    }
    xDomain?: [number, number];
    tooltipLeft?: number;
    tooltipTop?: number;
    tooltipData?: TooltipData;
    videoTime?: number;
    playing: boolean;
    events?: RollEvent[];
    showTooltip: (args: any) => void;
    handleMouseLeave: () => void;
    updateVideoTime: (time: number) => void;
    setPlaying: (playing: boolean) => void;
    // Sharing the horizontal zoom/pan with an external view (e.g. the comparison timeline).
    onViewChange?: (view: [number, number]) => void;
    registerSetView?: (setView: (view: [number, number]) => void) => void;
}

export function zoomXScale(zoom: ZoomState, scale: ScaleLinear<number, number, never>): ScaleLinear<number, number, never> {
    const newDomain = scale.range().map(d => scale.invert(d - zoom.transformMatrix.translateX) / zoom.transformMatrix.scaleX);
    return scaleLinear({
        domain: newDomain,
        range: scale.range(),
    });
}

export default function RollGraphs({ data, events, xDomain, onViewChange, registerSetView,
    tooltipLeft, tooltipTop, tooltipData, playing, isDragging,
    showTooltip, handleMouseLeave, updateVideoTime, setPlaying, setIsDragging,
    videoTime, zoom, parent }: RollGraphsProps &
    { zoom: ZoomType<SVGSVGElement>, parent: { width: number; height: number }, isDragging: boolean, setIsDragging: (dragging: boolean) => void }) {
    {
        const width = parent.width - GRAPH_MARGIN.left - GRAPH_MARGIN.right;
        const xScale = useMemo(() => {
            let domain: [number, number];
            if (xDomain) {
                domain = xDomain;
            } else {
                let maxTime = 0;
                for (const key in data) {
                    const series = data[key as keyof typeof data];
                    if (series) {
                        for (const d of series) maxTime = Math.max(maxTime, ...d.timestamp);
                    }
                }
                domain = [0, maxTime];
            }
            return zoomXScale(zoom, scaleLinear({
                domain,
                range: [0, width],
            }))
        }, [data, zoom.transformMatrix, width, xDomain]);

        // Report the visible time window so an external view (the timeline) can follow the zoom/pan.
        useEffect(() => {
            if (!onViewChange) return;
            const [v0, v1] = xScale.domain();
            onViewChange([v0, v1]);
        }, [xScale, onViewChange]);

        // Expose a setter so an external view can drive this graph's zoom/pan.
        useEffect(() => {
            if (!registerSetView || !xDomain) return;
            const [a, b] = xDomain;
            registerSetView(([v0, v1]) => {
                const scaleX = (b - a) / (v1 - v0);
                const translateX = -((v0 - a) * width) / (v1 - v0);
                zoom.setTransformMatrix({ ...zoom.transformMatrix, scaleX, scaleY: 1, translateX, translateY: 0, skewX: 0, skewY: 0 });
            });
        }, [registerSetView, xDomain, width, zoom]);

        const speedSeries = data.speed;
        const centripetalSeries = data.centripetal;
        const energySeries = data.energy;

        const [wasPlaying, setWasPlaying] = useState(false);

        const handlePlayheadMouseDown = (e: React.MouseEvent) => {
            e.stopPropagation();
            setWasPlaying(playing);
            setIsDragging(true);
            setPlaying(false);
        };

        const handleDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
            const point = localPoint(e);
            if (!point) return;

            const x = point.x - GRAPH_MARGIN.left;
            const timestamp = xScale.invert(x);
            updateVideoTime(timestamp / 1000);
        };

        useEffect(() => {
            const handleMouseMove = (e: MouseEvent) => {
                if (!isDragging) return;

                if (isDragging) {
                    const point = localPoint(e);
                    if (!point) return;

                    const x = point.x - GRAPH_MARGIN.left;
                    const timestamp = xScale.invert(x); // clamping handled in updateVideoTime
                    updateVideoTime(timestamp / 1000);
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

        if (!Object.values(data).some(d => d && d.length > 0)) {
            return <div className="flex items-center justify-center h-full text-neutral-500">
                No data available for this roll
            </div>
        }

        return <div className="relative">
            <svg width={parent.width} height={parent.height}
                // Transform ensures pixel alignment
                className="cursor-move touch-none select-none"
                ref={zoom.containerRef}
                onDoubleClick={handleDoubleClick}>
                {speedSeries &&
                    <RollGraph
                        parentWidth={parent.width}
                        parentHeight={parent.height / 4}
                        title="Speed (m/s)"
                        xScale={xScale}
                        data={speedSeries}
                        onMouseLeave={handleMouseLeave}
                        showTooltip={showTooltip}
                        showAxis={false}
                    />
                }
                {centripetalSeries &&
                    <RollGraph
                        parentWidth={parent.width}
                        parentHeight={parent.height / 4}
                        top={parent.height / 4}
                        title="Centripetal Acceleration (m/s²)"
                        xScale={xScale}
                        data={centripetalSeries}
                        onMouseLeave={handleMouseLeave}
                        showTooltip={showTooltip}
                        showAxis={false}
                    />
                }
                {
                    energySeries &&
                    <RollGraph
                        parentWidth={parent.width}
                        parentHeight={parent.height / 4}
                        top={parent.height / 2}
                        title="Specific Energy (J/kg)"
                        xScale={xScale}
                        data={energySeries}
                        onMouseLeave={handleMouseLeave}
                        showTooltip={showTooltip}
                        showAxis={true}
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
                    videoTime != undefined && <>
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
                {
                    events && <Group top={GRAPH_MARGIN.top} left={GRAPH_MARGIN.left} >
                        {events.slice(0).reverse().map((event, index) => { // Reverse to draw earlier events on top
                            const x = xScale(event.timestamp_ms);
                            return <Group key={index}>

                                <Polygon
                                    points={[
                                        [x, 2],
                                        [x - 5, -4],
                                        [x + 5, -4],
                                    ]}
                                    fill={EVENT_COLORS[event.type] ?? 'gray'}
                                />
                            </Group>
                        })}
                    </Group>
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
                            <div key={i} className="flex items-center gap-1.5">
                                {v.color && (
                                    <span
                                        className="inline-block rounded-full"
                                        style={{ width: 8, height: 8, backgroundColor: v.color }}
                                    />
                                )}
                                <span>{v.label}: {v.value.toFixed(2)}</span>
                            </div>
                        ))}
                    </div>
                </TooltipWithBounds>
            )}
        </div>
    }
}