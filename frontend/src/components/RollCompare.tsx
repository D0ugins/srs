import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTooltip } from "@visx/tooltip";
import { bisector } from "d3-array";
import { RollGraphsContainer, RollMapContainer } from "./RollAnalysis";
import RollHeader from "./RollHeader";
import type { GraphData } from "./RollGraph";
import type { MapPath, Position } from "./RollMap";
import type { RollDetails, RollEvent, RollGraphData } from "@/lib/roll";
import { GRAPH_SERIES_COLORS } from "@/lib/constants";
import { transformMediaUrl } from "@/lib/format";

export interface CompareRoll {
    roll: RollDetails;
    graphs?: RollGraphData;
}

const VIDEO_CHOICES = ['video_preview', 'edited_vid', 'video_preview_c', 'edited_vid_c'];

function pickVideoUrl(roll: RollDetails): string | undefined {
    const video = VIDEO_CHOICES
        .map(type => roll.roll_files.find(file => file.type === type))
        .find(f => f !== undefined);
    return transformMediaUrl(video?.uri);
}

const bisectNumber = bisector<number, number>(d => d).left;

function valueAt(series: GraphData | undefined, t: number): number | undefined {
    if (!series || series.timestamp.length === 0) return undefined;
    const i = bisectNumber(series.timestamp, t);
    return series.values[i - 1];
}

function positionAt(positions: Array<Position> | undefined, t: number): Position | undefined {
    if (!positions || positions.length === 0) return undefined;
    const i = bisector<Position, number>(d => d.timestamp).left(positions, t);
    const d0 = positions[i - 1];
    const d1 = positions[i];
    if (d1 === undefined) return d0;
    if (d0 === undefined) return d1;
    return t - d0.timestamp > d1.timestamp - t ? d1 : d0;
}

interface Derived {
    color: string;
    label: string;
    videoUrl?: string;
    videoStart: number;
    speed?: GraphData;
    centripetal?: GraphData;
    energy?: GraphData;
    positions?: Array<Position>;
}

export default function RollCompare({ rolls, events }: { rolls: Array<CompareRoll>; events: Array<RollEvent> }) {
    const [timestamp, setTimestamp] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [showVideo, setShowVideo] = useState<Array<boolean>>(() =>
        rolls.map((_, i) => rolls.length <= 4 || i === 0));

    const videoRefs = useRef<Array<HTMLVideoElement | null>>([]);
    const timestampRef = useRef(0);
    timestampRef.current = timestamp;

    const derived = useMemo<Array<Derived>>(() => rolls.map(({ roll, graphs }, i) => {
        const color = GRAPH_SERIES_COLORS[i % GRAPH_SERIES_COLORS.length];
        const label = `${roll.driver.name} ${roll.buggy.abbreviation}`;
        const gps = graphs?.gps_data;

        const speed = gps ? { timestamp: gps.timestamp, values: gps.speed, color, label } : undefined;
        const centripetal = graphs?.centripetal
            ? { timestamp: graphs.centripetal.timestamp, values: graphs.centripetal.values, color, label }
            : undefined;
        const energy = gps
            ? { timestamp: gps.timestamp, values: gps.speed.map((v, j) => 0.5 * v * v + 9.81 * gps.elevation[j]), color, label }
            : undefined;
        const positions = gps
            ? gps.timestamp.map((t, j) => ({ lat: gps.lat[j], long: gps.long[j], timestamp: t }))
            : undefined;

        return { color, label, videoUrl: pickVideoUrl(roll), videoStart: graphs?.video_start ?? 0, speed, centripetal, energy, positions };
    }), [rolls]);

    const {
        tooltipData, tooltipLeft, tooltipTop, showTooltip, hideTooltip,
    } = useTooltip<{ timestamp: number; values: Array<{ label: string; value: number }> }>();
    const handleMouseLeave = useCallback(() => hideTooltip(), [hideTooltip]);

    const updateVideoTime = useCallback((timeSeconds: number) => {
        const t = timeSeconds * 1000;
        setTimestamp(t);
        derived.forEach((d, i) => {
            const v = videoRefs.current[i];
            if (!v) return;
            const target = (t - d.videoStart) / 1000;
            v.currentTime = isFinite(v.duration) ? Math.min(Math.max(0, target), v.duration) : Math.max(0, target);
        });
    }, [derived]);

    // Play/pause all videos; align them before playing.
    useEffect(() => {
        derived.forEach((d, i) => {
            const v = videoRefs.current[i];
            if (!v) return;
            if (playing) {
                const target = (timestampRef.current - d.videoStart) / 1000;
                if (isFinite(v.duration)) v.currentTime = Math.min(Math.max(0, target), v.duration);
                v.play().catch(() => { });
            } else {
                v.pause();
            }
        });
    }, [playing, showVideo, derived]);

    // While playing, the first mounted video drives the shared timestamp / playhead.
    useEffect(() => {
        if (!playing) return;
        let masterIdx = -1;
        for (let i = 0; i < videoRefs.current.length; i++) {
            if (videoRefs.current[i]) { masterIdx = i; break; }
        }
        if (masterIdx === -1) return;
        const master = videoRefs.current[masterIdx] as any;
        const masterStart = derived[masterIdx].videoStart;
        let handle: number | null = null;
        const tick = () => {
            setTimestamp(master.currentTime * 1000 + masterStart);
            handle = master.requestVideoFrameCallback(tick);
        };
        handle = master.requestVideoFrameCallback(tick);
        return () => { if (handle != null) master.cancelVideoFrameCallback(handle); };
    }, [playing, showVideo, derived]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === ' ') { e.preventDefault(); setPlaying(p => !p); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); updateVideoTime(timestampRef.current / 1000 + (e.shiftKey ? 5 : 1 / 30)); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); updateVideoTime(Math.max(0, timestampRef.current / 1000 - (e.shiftKey ? 5 : 1 / 30))); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [updateVideoTime]);

    const graphData = useMemo(() => {
        const speed = derived.map(d => d.speed).filter((s): s is GraphData => !!s);
        const centripetal = derived.map(d => d.centripetal).filter((s): s is GraphData => !!s);
        const energy = derived.map(d => d.energy).filter((s): s is GraphData => !!s);
        return {
            speed: speed.length ? speed : undefined,
            centripetal: centripetal.length ? centripetal : undefined,
            energy: energy.length ? energy : undefined,
        };
    }, [derived]);

    const hasGraphData = graphData.speed || graphData.centripetal || graphData.energy;

    const mapPaths = useMemo<Array<MapPath>>(() => derived
        .filter(d => d.positions && d.positions.length > 0)
        .map(d => ({ positions: d.positions!, currentLocation: positionAt(d.positions, timestamp), color: d.color, label: d.label })),
        [derived, timestamp]);

    return (
        <div className="flex h-full gap-4 p-2">
            <div className="flex-[1] flex flex-col min-h-0 min-w-0">
                <div className="shrink-0 mb-2 pb-1 border-b border-gray-300">
                    <span className="text-xs text-neutral-600">Time </span>
                    <span className="font-mono text-sm">{(timestamp / 1000).toFixed(3)}s</span>
                </div>
                <div className="overflow-y-auto flex-1 pr-1 divide-y divide-gray-300">
                    {derived.map((d, i) => (
                        <div key={i} className="py-3 first:pt-0">
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                    <span className="shrink-0 w-3 h-3 rounded-full" style={{ backgroundColor: d.color }} />
                                    <RollHeader roll={rolls[i].roll} compact />
                                </div>
                                <label className="flex items-center gap-1 text-xs text-neutral-600 cursor-pointer shrink-0">
                                    <input
                                        type="checkbox"
                                        checked={showVideo[i] ?? false}
                                        onChange={() => setShowVideo(prev => prev.map((v, j) => j === i ? !v : v))}
                                    />
                                    Show video
                                </label>
                            </div>
                            {showVideo[i] && (
                                d.videoUrl ? (
                                    <video
                                        ref={el => { videoRefs.current[i] = el; }}
                                        className="w-full mt-2 cursor-pointer bg-black"
                                        src={d.videoUrl}
                                        key={d.videoUrl}
                                        muted
                                        playsInline
                                        onLoadedMetadata={e => {
                                            const v = e.currentTarget;
                                            const target = (timestampRef.current - d.videoStart) / 1000;
                                            v.currentTime = Math.min(Math.max(0, target), v.duration || 0);
                                        }}
                                        onClick={() => setPlaying(p => !p)}
                                    />
                                ) : (
                                    <div className="mt-2 py-4 text-center text-xs text-neutral-500 bg-neutral-100">No video</div>
                                )
                            )}
                            <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                                <Stat label="Speed (m/s)" value={valueAt(d.speed, timestamp)} />
                                <Stat label="Centrip. (m/s²)" value={valueAt(d.centripetal, timestamp)} />
                                <Stat label="Energy (J/kg)" value={valueAt(d.energy, timestamp)} />
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="flex-[2] flex flex-col min-h-0 min-w-0">
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
                        <div className="flex items-center justify-center h-full text-neutral-500">No graph data available</div>
                    )}
                </div>
                <div className="h-1/3">
                    <RollMapContainer paths={mapPaths} />
                </div>
            </div>
        </div>
    );
}

function Stat({ label, value }: { label: string; value?: number }) {
    return <div>
        <div className="text-[10px] text-neutral-500 leading-tight">{label}</div>
        <div className="font-mono text-sm">{value !== undefined ? value.toFixed(2) : '---'}</div>
    </div>;
}
