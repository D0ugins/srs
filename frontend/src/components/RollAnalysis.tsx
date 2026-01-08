import type { RollDetails, RollGraphs } from "@/lib/roll";
import React, { useMemo, useCallback, useRef, useState, use, useEffect } from "react";
import { ParentSize } from "@visx/responsive";
import { useTooltip, TooltipWithBounds, defaultStyles } from "@visx/tooltip";
import { Line, Polygon } from "@visx/shape";
import { applyMatrixToPoint, Zoom, type GenericWheelEvent, type TransformMatrix, type ZoomProps, type ZoomState } from "@visx/zoom";
import RollGraph, { type GraphData, type TooltipData } from "./RollGraph";
import { transformMediaUrl } from "@/lib/format";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import type { ScaleLinear } from "d3-scale";
import { RectClipPath } from "@visx/clip-path";
import { localPoint } from "@visx/event";
type ZoomType<ElementType extends Element> = ZoomProps<ElementType>['children'] extends (zoom: infer U) => any ? U : never;

const tooltipStyles = {
    ...defaultStyles,
    backgroundColor: "rgba(0,0,0,0.9)",
    color: "white",
    padding: "8px 12px",
    fontSize: "12px",
};

export const GRAPH_MARGIN = { top: 25, right: 30, bottom: 30, left: 50 };

interface RollGraphsProps {
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

function zoomXScale(zoom: ZoomState, scale: ScaleLinear<number, number, never>): ScaleLinear<number, number, never> {
    const newDomain = scale.range().map(d => scale.invert(d - zoom.transformMatrix.translateX) / zoom.transformMatrix.scaleX);
    return scaleLinear({
        domain: newDomain,
        range: scale.range(),
    });
}

function RollGraphs({ data,
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
                className="cursor-move touch-none"
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
                                from={{ x: xScale(videoTime), y: 0 }}
                                to={{ x: xScale(videoTime), y: parent.height }}
                                stroke="#ff0000"
                                strokeWidth={2}
                                shapeRendering="geometricPrecision"
                            />
                            <Polygon
                                points={[
                                    [xScale(videoTime), 12],
                                    [xScale(videoTime) - 6, 4],
                                    [xScale(videoTime) - 6, -2],
                                    [xScale(videoTime) + 6, -2],
                                    [xScale(videoTime) + 6, 4],
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

function RollGraphsContainer(props: RollGraphsProps) {
    const [isPlayheadDragging, setIsPlayheadDragging] = useState(false);

    return <div className="h-full relative">
        <ParentSize>
            {(parent) => {
                return <Zoom<SVGSVGElement>
                    width={parent.width}
                    height={parent.height}
                    scaleXMin={1}
                    wheelDelta={(event) => ({ scaleX: event.deltaY > 0 ? 0.9 : 1.1, scaleY: 1 })}
                    constrain={(transformMatrix: TransformMatrix, prev: TransformMatrix) => {
                        if (transformMatrix.scaleX <= 1) return { ...transformMatrix, scaleX: 1, translateX: 0 };
                        if (isPlayheadDragging) transformMatrix = { ...transformMatrix, translateX: prev.translateX };
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
                >{(zoom) => <RollGraphs zoom={zoom} parent={parent} isDragging={isPlayheadDragging} setIsDragging={setIsPlayheadDragging} {...props} />}
                </Zoom>
            }}
        </ParentSize>
    </div>
}

interface RollVideoProps {
    roll: RollDetails;
    videoRef: React.RefObject<HTMLVideoElement | null>;
    setCurrentTime: (time: number) => void;
    setPlaying: React.Dispatch<React.SetStateAction<boolean>>;
    setDuration: (duration: number) => void;
}

function RollVideo({ roll, videoRef, setCurrentTime, setPlaying, setDuration }: RollVideoProps) {
    const videoUrl = transformMediaUrl(
        roll.roll_files.find((file) => file.type === 'video_preview')?.uri
    );
    const frameCallbackIdRef = useRef<number | null>(null);

    const updateFrame = () => {
        if (!videoRef.current) return;
        setCurrentTime(videoRef.current.currentTime);
        const videoElement = videoRef.current as any;
        if (videoElement.requestVideoFrameCallback) {
            frameCallbackIdRef.current = videoElement.requestVideoFrameCallback(updateFrame);
        }
    };

    const handleLoadedMetadata = () => {
        if (!videoRef.current) return;
        setDuration(videoRef.current.duration);
        const videoElement = videoRef.current as any;
        if (videoElement.requestVideoFrameCallback) {
            frameCallbackIdRef.current = videoElement.requestVideoFrameCallback(updateFrame);
        }
    };

    const handleVideoClick = () => {
        if (!videoRef.current) return;
        setPlaying((prev) => !prev);
    };

    return <video
        ref={videoRef}
        className="cursor-pointer"
        src={videoUrl}
        onLoadedMetadata={handleLoadedMetadata}
        onClick={handleVideoClick}
        muted
    >
        Your browser does not support the video tag.
    </video>
}

export default function RollAnalysis({ roll, graphs }: { roll: RollDetails, graphs: RollGraphs }) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [currentTime, setCurrentTime] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [duration, setDuration] = useState(0);

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

    const centripetalData = useMemo(() => graphs.centripetal ?? { timestamp: [], values: [] }, [graphs.centripetal]);

    const energyData = useMemo(() => {
        if (!graphs.gps_data || !graphs.centripetal) return { timestamp: [], values: [] };
        const values = graphs.gps_data.speed.map((v, i) => 0.5 * v * v + 9.81 * graphs.gps_data!.elevation[i]);
        return {
            timestamp: graphs.gps_data.timestamp,
            values,
        };
    }, [graphs.gps_data]);

    const data = useMemo(() => ({
        speed: speedData.timestamp.length > 0 ? speedData : undefined,
        centripetal: centripetalData.timestamp.length > 0 ? centripetalData : undefined,
        energy: energyData.timestamp.length > 0 ? energyData : undefined,
    }), [speedData, centripetalData, energyData]);

    const handleMouseLeave = useCallback(() => {
        hideTooltip();
    }, [hideTooltip]);

    const updateVideoTime = useCallback((time: number) => {
        if (videoRef.current) {
            videoRef.current.currentTime = Math.min(Math.max(0, time), duration);
        }
        setCurrentTime(time);
    }, [duration]);

    const videoStart = graphs.camera_starts[0];
    const timeStamp = videoStart ? currentTime * 1000 + videoStart : undefined;
    useEffect(() => {
        if (!videoRef.current) return;

        if (playing && videoRef.current.paused) videoRef.current.play();
        else if (!playing && !videoRef.current.paused) videoRef.current.pause();
    }, [playing]);

    return (
        <div className="flex h-full gap-4">
            <div className="flex-[1]">
                <RollVideo
                    roll={roll}
                    videoRef={videoRef}
                    setCurrentTime={setCurrentTime}
                    setDuration={setDuration}
                    setPlaying={setPlaying}
                />
            </div>
            <div className="flex-[2] h-full min-w-0">
                <RollGraphsContainer
                    data={data}
                    tooltipLeft={tooltipLeft}
                    tooltipTop={tooltipTop}
                    tooltipData={tooltipData}
                    videoTime={timeStamp}
                    videoStart={videoStart}
                    showTooltip={showTooltip}
                    handleMouseLeave={handleMouseLeave}
                    updateVideoTime={updateVideoTime}
                    playing={playing}
                    setPlaying={setPlaying}
                />
            </div>
        </div>
    );
}