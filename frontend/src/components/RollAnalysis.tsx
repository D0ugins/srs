import type { RollDetails, RollGraphData } from "@/lib/roll";
import { useMemo, useCallback, useRef, useState, useEffect } from "react";
import { ParentSize } from "@visx/responsive";
import { useTooltip } from "@visx/tooltip";
import { applyMatrixToPoint, Zoom, type TransformMatrix } from "@visx/zoom";
import RollGraphs, { GRAPH_MARGIN, type RollGraphsProps } from "./RollGraphs";
import RollVideo from "./RollVideo";

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



export default function RollAnalysis({ roll, graphs }: { roll: RollDetails, graphs: RollGraphData }) {
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
    // [890555.9326319562,  0.0,                    71198699.26796, 
    //  0.0,                -1170119.0001883141,    47322335.071882315,
    //  0.0,                0.0,                    1.0                 ]
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