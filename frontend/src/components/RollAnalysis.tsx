import type { RollDetails, RollGraphData } from "@/lib/roll";
import { useMemo, useCallback, useRef, useState, useEffect, memo } from "react";
import { ParentSize } from "@visx/responsive";
import { useTooltip } from "@visx/tooltip";
import { applyMatrixToPoint, Zoom, type TransformMatrix, type ZoomProps } from "@visx/zoom";
import RollGraphs, { type RollGraphsProps } from "./RollGraphs";
import RollVideo from "./RollVideo";
import RollMap, { type MapPath, type Position, type RollMapProps } from "./RollMap";
import { bisector } from "d3-array";
import RollEventList from "./RollEventList";
import type { RollEventInput } from "@/routes/rolls/$rollId.recording";
import { GRAPH_MARGIN } from "@/lib/constants";
import VideoTimeline from "./VideoTimeline";

type ZoomType<ElementType extends Element> = ZoomProps<ElementType>['children'] extends (zoom: infer U) => any ? U : never;

export function RollGraphsContainer(props: RollGraphsProps) {
    const [isPlayheadDragging, setIsPlayheadDragging] = useState(false);

    return <div className="h-full relative">
        <ParentSize>
            {(parent) => <Zoom<SVGSVGElement>
                width={parent.width}
                height={parent.height}
                scaleXMin={1}
                wheelDelta={(event) => ({ scaleX: event.deltaY > 0 ? 0.9 : 1.1, scaleY: 1 })}
                constrain={(transformMatrix: TransformMatrix, prev: TransformMatrix) => {
                    // Prevent rerender when dragging playhead
                    if (isPlayheadDragging) return prev;
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
            >{(zoom) => <RollGraphs zoom={zoom} parent={parent} isDragging={isPlayheadDragging} setIsDragging={setIsPlayheadDragging} {...props} />}
            </Zoom>
            }
        </ParentSize>
    </div>
}

export const RollMapContainer = memo((props: RollMapProps) => {
    const [rotation, setRotation] = useState(0);
    // Kept in sync so the Zoom's constrain (and rotateAround's setTransformMatrix, which
    // runs before the state re-renders) always sees the up-to-date angle.
    const rotationRef = useRef(0);
    rotationRef.current = rotation;

    // Rotation happens around svg center, so adjust translate to make it appear to be around view point
    const rotateAround = (zoom: ZoomType<SVGSVGElement>, w: number, h: number, next: number) => {
        const { scaleX: s, translateX: tx, translateY: ty } = zoom.transformMatrix;
        const dr = ((next - rotation) * Math.PI) / 180;
        const cos = Math.cos(dr), sin = Math.sin(dr);
        const qx = (w / 2 - tx) / s - w / 2;
        const qy = (h / 2 - ty) / s - h / 2;
        rotationRef.current = next;
        zoom.setTransformMatrix({
            ...zoom.transformMatrix,
            translateX: (1 - s) * (w / 2) - s * (cos * qx - sin * qy),
            translateY: (1 - s) * (h / 2) - s * (sin * qx + cos * qy),
        });
        setRotation(next);
    };

    return <div className="h-full relative">
        <ParentSize>
            {(parent) => {
                return <Zoom<SVGSVGElement>
                    width={parent.width}
                    height={parent.height}
                    constrain={(transformMatrix, _prev) => {
                        const scaleX = Math.max(1, transformMatrix.scaleX);
                        const scaleY = Math.max(1, transformMatrix.scaleY);
                        const w = parent.width, h = parent.height;
                        const rad = (rotationRef.current * Math.PI) / 180;
                        const cos = Math.cos(rad), sin = Math.sin(rad);

                        // Content point under the screen centre: undo translate+scale, then rotation.
                        const qx = (w / 2 - transformMatrix.translateX) / scaleX - w / 2;
                        const qy = (h / 2 - transformMatrix.translateY) / scaleY - h / 2;
                        let px = cos * qx + sin * qy;
                        let py = -sin * qx + cos * qy;

                        // Clamp it so the viewport stays over the content.
                        const marginX = w / (2 * scaleX) - w / 2;
                        const marginY = h / (2 * scaleY) - h / 2;
                        px = Math.min(-marginX, Math.max(marginX, px));
                        py = Math.min(-marginY, Math.max(marginY, py));

                        // Map the clamped point back to a translate (rotation then scale).
                        const rx = cos * px - sin * py;
                        const ry = sin * px + cos * py;
                        return {
                            ...transformMatrix, scaleX, scaleY,
                            translateX: w / 2 - scaleX * (w / 2 + rx),
                            translateY: h / 2 - scaleY * (h / 2 + ry),
                        };
                    }}
                >
                    {(zoom) => <>
                        <RollMap width={parent.width} height={parent.height} zoom={zoom} rotation={rotation} {...props} />
                        <div className="absolute bottom-1 left-1/4 right-1/4 z-10 flex items-center gap-2 bg-black/30 rounded px-2 py-0.5 text-xs text-white">
                            <input
                                type="range"
                                min={-180}
                                max={180}
                                value={rotation}
                                onChange={e => rotateAround(zoom, parent.width, parent.height, Number(e.target.value))}
                                className="flex-1 min-w-0 accent-[#fdb724]"
                            />
                            <span className="font-mono w-9 text-right shrink-0">{rotation}°</span>
                        </div>
                    </>}
                </Zoom>
            }
            }
        </ParentSize>
    </div>
})

interface RollAnalysisProps {
    roll: RollDetails;
    graphs: RollGraphData;
    events: RollEventInput[];
    setEvents: React.Dispatch<React.SetStateAction<RollEventInput[]>>;
}

export default function RollAnalysis({ roll, graphs, events, setEvents }: RollAnalysisProps) {
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

    const hasGraphData = data.speed || data.centripetal || data.energy;

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

    const videoStart = graphs.video_start ?? 0;
    const updateVideoTime = useCallback((time: number) => {
        if (videoRef.current) {
            const adjustedTime = Math.min(Math.max(0, time - (videoStart / 1000)), duration)
            videoRef.current.currentTime = adjustedTime
            setCurrentTime(adjustedTime);
        }
        else { setCurrentTime(time); } // TODO: clamp based on graph
    }, [duration, videoStart]);

    const timestamp = currentTime * 1000 + videoStart;
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

    const mapPaths = useMemo<MapPath[]>(() => {
        if (!positions) return [];
        return [{ positions, currentLocation }];
    }, [positions, currentLocation]);

    const currentData = useMemo(() => {
        if (!data) return undefined;
        const currentValues: { label: string; value: number }[] = [];
        if (data.speed) {
            const index = bisector<number, number>(d => d).left(data.speed.timestamp, timestamp);
            const speedValue = data.speed.values[index - 1];
            if (speedValue !== undefined) currentValues.push({ label: "Speed (m/s)", value: speedValue });
        }
        if (data.centripetal) {
            const index = bisector<number, number>(d => d).left(data.centripetal.timestamp, timestamp);
            const centripetalValue = data.centripetal.values[index - 1];
            if (centripetalValue !== undefined) currentValues.push({ label: "Centripetal Acceleration (m/s²)", value: centripetalValue });
        }
        if (data.energy) {
            const index = bisector<number, number>(d => d).left(data.energy.timestamp, timestamp);
            const energyValue = data.energy.values[index - 1];
            if (energyValue !== undefined) currentValues.push({ label: "Energy (J/kg)", value: energyValue });
        }
        return {
            timestamp,
            values: currentValues,
        };
    }, [data, timestamp]);

    const graphData = useMemo(() => {
        return {
            speed: data.speed && [data.speed],
            centripetal: data.centripetal && [data.centripetal],
            energy: data.energy && [data.energy],
        }
    }, [data]);

    return (
        <div className="flex h-full gap-4 mb-2">
            <div className="flex flex-col flex-[1] min-w-0">
                <RollVideo
                    roll={roll}
                    videoRef={videoRef}
                    setCurrentTime={setCurrentTime}
                    duration={duration}
                    setDuration={setDuration}
                    setPlaying={setPlaying}
                />
                <RollEventList events={events} setEvents={setEvents} updateVideoTime={updateVideoTime} videoTimestamp={timestamp} />
            </div>
            <div className="flex-[2] h-full min-w-0">
                <div className="h-2/3 pb-2">
                    {hasGraphData ? (
                        <RollGraphsContainer
                            data={graphData}
                            tooltipLeft={tooltipLeft}
                            tooltipTop={tooltipTop}
                            tooltipData={tooltipData}
                            videoTime={timestamp}
                            showTooltip={showTooltip}
                            handleMouseLeave={handleMouseLeave}
                            updateVideoTime={updateVideoTime}
                            playing={playing}
                            setPlaying={setPlaying}
                            events={events}
                        />
                    ) : (
                        <>
                            <VideoTimeline
                                videoRef={videoRef}
                                currentTime={currentTime}
                                duration={duration}
                                playing={playing}
                                setPlaying={setPlaying}
                                updateVideoTime={updateVideoTime}
                                videoStart={videoStart}
                            />
                            <div className="text-neutral-500 text-center">No graph data available</div>
                        </>
                    )}
                </div>
                {hasGraphData && (
                    <div className="flex h-1/3 pl-6 gap-8">
                        <div className="flex-1 min-w-1/2">
                            <RollMapContainer paths={mapPaths} />
                        </div>
                        <div className="overflow-y-auto flex-1 flex-col text-left">
                            <div className="text-s text-neutral-600">Time</div>
                            <div className="font-mono text-m mb-2">{(timestamp / 1000).toFixed(3)}s</div>
                            {currentData?.values.map((v) => (
                                <div key={v.label} className="mb-1">
                                    <div className="text-s text-neutral-600">{v.label}</div>
                                    <div className="font-mono text-m">{v.value.toFixed(2)}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}