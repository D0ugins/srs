import type { RollDetails, RollEvent, RollGraphData } from "@/lib/roll";
import { useMemo, useCallback, useRef, useState, useEffect, memo } from "react";
import { ParentSize } from "@visx/responsive";
import { useTooltip } from "@visx/tooltip";
import { applyMatrixToPoint, Zoom, type TransformMatrix } from "@visx/zoom";
import RollGraphs, { GRAPH_MARGIN, type RollGraphsProps } from "./RollGraphs";
import RollVideo from "./RollVideo";
import RollMap, { type Position, type RollMapProps } from "./RollMap";
import { bisector } from "d3-array";
import RollEventList from "./RollEventList";

function RollGraphsContainer(props: RollGraphsProps) {
    const [isPlayheadDragging, setIsPlayheadDragging] = useState(false);

    return <div className="h-full relative">
        <ParentSize>
            {(parent) => <Zoom<SVGSVGElement>
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
            }
        </ParentSize>
    </div>
}

const IMAGE_WIDTH = 6912;
const IMAGE_HEIGHT = 4608;

const RollMapContainer = memo((props: RollMapProps) => {
    return <div className="h-full relative">
        <ParentSize>
            {(parent) => {
                const imageAspectRatio = IMAGE_WIDTH / IMAGE_HEIGHT;
                const containerAspectRatio = parent.width / parent.height;

                const renderedWidth = containerAspectRatio > imageAspectRatio ? parent.height * imageAspectRatio : parent.width;
                const renderedHeight = containerAspectRatio > imageAspectRatio ? parent.height : parent.width / imageAspectRatio;
                return <Zoom<SVGSVGElement>
                    width={renderedWidth}
                    height={renderedHeight}
                    constrain={(transformMatrix, _prev) => {
                        let { scaleX, scaleY, translateX, translateY } = transformMatrix;
                        scaleX = Math.max(1, scaleX);
                        scaleY = Math.max(1, scaleY);

                        const scaledWidth = parent.width * scaleX;
                        const scaledHeight = parent.height * scaleY;
                        const maxTranslateX = Math.max(0, scaledWidth - parent.width);
                        const maxTranslateY = Math.max(0, scaledHeight - parent.height);
                        const constrainedTranslateX = Math.min(0, Math.max(-maxTranslateX, translateX));
                        const constrainedTranslateY = Math.min(0, Math.max(-maxTranslateY, translateY));
                        return {
                            ...transformMatrix, scaleX, scaleY,
                            translateX: constrainedTranslateX,
                            translateY: constrainedTranslateY,
                        };
                    }}
                >
                    {(zoom) => <RollMap width={renderedWidth} height={renderedHeight} zoom={zoom} {...props} />}
                </Zoom>
            }
            }
        </ParentSize>
    </div>
})

export default function RollAnalysis({ roll, graphs, events }: { roll: RollDetails, graphs: RollGraphData, events: RollEvent[] }) {
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

    const positions = useMemo(() => {
        if (!graphs.gps_data) return undefined;
        const positions = graphs.gps_data.timestamp.map((timestamp, i) => ({
            lat: graphs.gps_data!.lat[i],
            long: graphs.gps_data!.long[i],
            timestamp: timestamp
        }));
        return positions;
    }, [graphs.gps_data]);

    const handleMouseLeave = useCallback(() => {
        hideTooltip();
    }, [hideTooltip]);

    const videoStart = graphs.camera_starts[0];
    const updateVideoTime = useCallback((time: number) => {
        const adjustedTime = Math.min(Math.max(0, time - (videoStart / 1000)), duration)
        if (videoRef.current) {
            videoRef.current.currentTime = adjustedTime
        }
        setCurrentTime(adjustedTime);
    }, [duration, videoStart]);

    const timestamp = videoStart ? currentTime * 1000 + videoStart : undefined;
    useEffect(() => {
        if (!videoRef.current) return;

        if (playing && videoRef.current.paused) videoRef.current.play();
        else if (!playing && !videoRef.current.paused) videoRef.current.pause();
    }, [playing]);

    const currentLocation = useMemo(() => {
        if (!graphs.gps_data || timestamp === undefined || !positions) return undefined;
        let index = bisector<Position, number>(d => d.timestamp).left(positions, timestamp)
        // const index = bisectTimestamp(dataPoints, timeStamp, 1);
        const d0 = positions[index - 1];
        const d1 = positions[index];

        if (d1 === undefined) return d0;
        if (d0 === undefined) return d1;
        return timestamp - d0.timestamp > d1.timestamp - timestamp ? d1 : d0;
    }, [graphs.gps_data, timestamp]);

    return (
        <div className="flex h-full gap-4 mb-2">
            <div className="flex-[1] min-w-0">
                <RollVideo
                    roll={roll}
                    videoRef={videoRef}
                    setCurrentTime={setCurrentTime}
                    duration={duration}
                    setDuration={setDuration}
                    setPlaying={setPlaying}
                />
                <RollEventList events={events} updateVideoTime={updateVideoTime} />
            </div>
            <div className="flex-[2] h-full min-w-0">
                <div className="h-2/3 pb-2">
                    <RollGraphsContainer
                        data={data}
                        tooltipLeft={tooltipLeft}
                        tooltipTop={tooltipTop}
                        tooltipData={tooltipData}
                        videoTime={timestamp}
                        showTooltip={showTooltip}
                        handleMouseLeave={handleMouseLeave}
                        updateVideoTime={updateVideoTime}
                        playing={playing}
                        setPlaying={setPlaying}
                    />
                </div>
                <div className="h-1/3 pl-6">
                    <RollMapContainer positions={positions} currentLocation={currentLocation} />
                </div>
            </div>
        </div>
    );
}