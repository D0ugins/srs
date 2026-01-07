import type { RollDetails, RollGraphs } from "@/lib/roll";
import { useMemo, useCallback, useRef, useState } from "react";
import { ParentSize } from "@visx/responsive";
import { useTooltip, TooltipWithBounds, defaultStyles } from "@visx/tooltip";
import { Line } from "@visx/shape";
import { applyMatrixToPoint, Zoom, type TransformMatrix } from "@visx/zoom";
import RollGraph, { type GraphData, type TooltipData } from "./RollGraph";
import { transformMediaUrl } from "@/lib/format";

const tooltipStyles = {
    ...defaultStyles,
    backgroundColor: "rgba(0,0,0,0.9)",
    color: "white",
    padding: "8px 12px",
    fontSize: "12px",
};

export const GRAPH_MARGIN = { top: 25, right: 30, bottom: 30, left: 50 };

interface RollGraphsProps {
    speedData?: GraphData;
    centripetalData?: GraphData;
    tooltipLeft?: number;
    tooltipTop?: number;
    tooltipData?: TooltipData;
    videoTime?: number;
    showTooltip: (args: any) => void;
    handleMouseLeave: () => void;
}

function RollGraphs({ speedData, centripetalData,
    tooltipLeft, tooltipTop, tooltipData, showTooltip, handleMouseLeave,
    videoTime }: RollGraphsProps) {
    return <div className="h-full relative">
        <ParentSize>
            {(parent) => {
                return <Zoom<SVGSVGElement>
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
                                // Transform ensures pixel alignment
                                style={{ cursor: zoom.isDragging ? 'grabbing' : 'grab', touchAction: 'none', transform: 'translate(0, 0)' }}
                                ref={zoom.containerRef}>
                                {speedData &&
                                    <RollGraph
                                        parentWidth={parent.width}
                                        parentHeight={parent.height / 4}
                                        title="Speed (m/s)"
                                        zoom={zoom}
                                        data={speedData}
                                        videoTime={videoTime}
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
                                        zoom={zoom}
                                        data={centripetalData}
                                        videoTime={videoTime}
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
                </Zoom>
            }}
        </ParentSize>
    </div>
}

interface RollVideoProps {
    roll: RollDetails;
    videoRef: React.RefObject<HTMLVideoElement | null>;
    setCurrentTime: (time: number) => void;
}

function RollVideo({ roll, videoRef, setCurrentTime, }: RollVideoProps) {
    const videoUrl = transformMediaUrl(
        roll.roll_files.find((file) => file.type === 'video_preview')?.uri
    );
    const frameCallbackIdRef = useRef<number | null>(null);

    const updateFrame = () => {
        if (videoRef.current) {
            setCurrentTime(videoRef.current.currentTime);
            const videoElement = videoRef.current as any;
            if (videoElement.requestVideoFrameCallback) {
                frameCallbackIdRef.current = videoElement.requestVideoFrameCallback(updateFrame);
            }
        }
    };

    const handleLoadedMetadata = () => {
        if (videoRef.current) {
            const videoElement = videoRef.current as any;
            if (videoElement.requestVideoFrameCallback) {
                frameCallbackIdRef.current = videoElement.requestVideoFrameCallback(updateFrame);
            }
        }
    };

    const handleVideoClick = () => {
        if (videoRef.current) {
            if (videoRef.current.paused) {
                videoRef.current.play();
            } else {
                videoRef.current.pause();
            }
        }
    };

    return <video
        ref={videoRef}
        className="cursor-pointer"
        autoPlay
        src={videoUrl}
        onLoadedMetadata={handleLoadedMetadata}
        onClick={handleVideoClick}
    >
        Your browser does not support the video tag.
    </video>
}

export default function RollAnalysis({ roll, graphs }: { roll: RollDetails, graphs: RollGraphs }) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [currentTime, setCurrentTime] = useState(0);

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

    const handleMouseLeave = useCallback(() => {
        hideTooltip();
    }, [hideTooltip]);

    const cameraStart = graphs.camera_starts[0];
    const timeStamp = cameraStart ? currentTime * 1000 + cameraStart : undefined;

    return (
        <div className="flex h-full gap-4">
            <div className="flex-[1]">
                <RollVideo
                    roll={roll}
                    videoRef={videoRef}
                    setCurrentTime={setCurrentTime}
                />
            </div>
            <div className="flex-[2] h-full">
                <RollGraphs
                    speedData={speedData.timestamp.length > 0 ? speedData : undefined}
                    centripetalData={centripetalData.timestamp.length > 0 ? centripetalData : undefined}
                    tooltipLeft={tooltipLeft}
                    tooltipTop={tooltipTop}
                    tooltipData={tooltipData}
                    videoTime={timeStamp}
                    showTooltip={showTooltip}
                    handleMouseLeave={handleMouseLeave}
                />
            </div>
        </div>
    );
}