import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTooltip } from "@visx/tooltip";
import { bisector } from "d3-array";
import { RollGraphsContainer, RollMapContainer } from "./RollAnalysis";
import RollHeader from "./RollHeader";
import TimelineSync, { type TimelineRoll } from "./TimelineSync";
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

// Index of the position geographically closest to a target lat/long, considering
// only points at/after minTimestamp. Returns -1 if no candidate qualifies.
function closestPositionIndex(positions: Array<Position>, target: Position, minTimestamp = -Infinity): number {
    const cosLat = Math.cos((target.lat * Math.PI) / 180);
    let best = -1;
    let bestDist = Infinity;
    for (let j = 0; j < positions.length; j++) {
        if (positions[j].timestamp < minTimestamp) continue;
        const dLat = positions[j].lat - target.lat;
        const dLong = (positions[j].long - target.long) * cosLat;
        const dist = dLat * dLat + dLong * dLong;
        if (dist < bestDist) { bestDist = dist; best = j; }
    }
    return best;
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
    events: Array<RollEvent>;
    tMin: number;
    tMax: number;
    rollStart?: number;
}

export default function RollCompare({ rolls }: { rolls: Array<CompareRoll> }) {
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

        const events = roll.roll_events ?? [];
        const ts = gps?.timestamp ?? graphs?.centripetal?.timestamp ?? [];
        const tMin = ts.length ? ts[0] : 0;
        const tMax = ts.length ? ts[ts.length - 1] : 0;
        const rollStart = events.find(e => e.type === 'roll_start')?.timestamp_ms;

        return {
            color, label, videoUrl: pickVideoUrl(roll), videoStart: graphs?.video_start ?? 0,
            speed, centripetal, energy, positions, events, tMin, tMax, rollStart,
        };
    }), [rolls]);

    // Per-roll time offset: master_time = native_time - offset. Primary (0) anchors the axis.
    // Default aligns each roll's roll_start to the primary's, falling back to no offset.
    const defaultOffsets = useMemo(() => {
        const primaryStart = derived[0]?.rollStart;
        return derived.map((d, i) => {
            if (i === 0) return 0;
            if (primaryStart != null && d.rollStart != null) return d.rollStart - primaryStart;
            return 0;
        });
    }, [derived]);

    const [offsets, setOffsets] = useState<Array<number>>(defaultOffsets);
    const offsetsRef = useRef(offsets);
    offsetsRef.current = offsets;

    const rollKey = rolls.map(r => r.roll.id).join(',');
    useEffect(() => { setOffsets(defaultOffsets); }, [rollKey]);

    // Stable canvas for the timeline: union of all roll extents at default offsets.
    const fullDomain = useMemo<[number, number]>(() => {
        let lo = Infinity, hi = -Infinity;
        derived.forEach((d, i) => {
            const off = defaultOffsets[i] ?? 0;
            lo = Math.min(lo, d.tMin - off);
            hi = Math.max(hi, d.tMax - off);
        });
        if (!isFinite(lo) || !isFinite(hi) || hi <= lo) return [0, 1000];
        const pad = (hi - lo) * 0.02;
        return [lo - pad, hi + pad];
    }, [derived, defaultOffsets]);

    // Visible time window, shared between the graphs and the timeline. The graph's zoom
    // is the source of truth: it reports changes here, and the timeline drives it back.
    const [view, setView] = useState<[number, number]>(fullDomain);
    const graphSetViewRef = useRef<((v: [number, number]) => void) | null>(null);
    const registerGraphSetView = useCallback((fn: (v: [number, number]) => void) => { graphSetViewRef.current = fn; }, []);
    const handleGraphViewChange = useCallback((v: [number, number]) => setView(v), []);
    const handleTimelineViewChange = useCallback((v: [number, number]) => {
        setView(v);
        graphSetViewRef.current?.(v);
    }, []);
    useEffect(() => {
        setView(fullDomain);
        graphSetViewRef.current?.(fullDomain);
    }, [fullDomain[0], fullDomain[1]]);

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
            const target = (t - (d.videoStart - (offsetsRef.current[i] ?? 0))) / 1000;
            v.currentTime = isFinite(v.duration) ? Math.min(Math.max(0, target), v.duration) : Math.max(0, target);
        });
    }, [derived]);

    // Play/pause all videos; align them before playing.
    useEffect(() => {
        derived.forEach((d, i) => {
            const v = videoRefs.current[i];
            if (!v) return;
            if (playing) {
                const target = (timestampRef.current - (d.videoStart - (offsetsRef.current[i] ?? 0))) / 1000;
                if (isFinite(v.duration)) v.currentTime = Math.min(Math.max(0, target), v.duration);
                v.play().catch(() => { });
            } else {
                v.pause();
            }
        });
    }, [playing, showVideo, derived]);

    // Re-seek a roll's video when its timeline is shifted, so the preview reflects the new sync.
    const prevOffsetsRef = useRef(offsets);
    useEffect(() => {
        const prev = prevOffsetsRef.current;
        derived.forEach((d, i) => {
            if ((offsets[i] ?? 0) === (prev[i] ?? 0)) return;
            const v = videoRefs.current[i];
            if (!v) return;
            const target = (timestampRef.current - (d.videoStart - (offsets[i] ?? 0))) / 1000;
            v.currentTime = isFinite(v.duration) ? Math.min(Math.max(0, target), v.duration) : Math.max(0, target);
        });
        prevOffsetsRef.current = offsets;
    }, [offsets, derived]);

    // While playing, the first mounted video drives the shared timestamp / playhead.
    useEffect(() => {
        if (!playing) return;
        let masterIdx = -1;
        for (let i = 0; i < videoRefs.current.length; i++) {
            if (videoRefs.current[i]) { masterIdx = i; break; }
        }
        if (masterIdx === -1) return;
        const master = videoRefs.current[masterIdx] as any;
        let handle: number | null = null;
        const tick = () => {
            const masterStart = derived[masterIdx].videoStart - (offsetsRef.current[masterIdx] ?? 0);
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
            else if (e.key === 'ArrowLeft') { e.preventDefault(); updateVideoTime(timestampRef.current / 1000 - (e.shiftKey ? 5 : 1 / 30)); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [updateVideoTime]);

    // Graph series shifted into master time so all rolls align on a shared axis.
    const graphData = useMemo(() => {
        const shift = (s: GraphData | undefined, off: number) =>
            s ? { ...s, timestamp: s.timestamp.map(t => t - off) } : undefined;
        const speed: GraphData[] = [];
        const centripetal: GraphData[] = [];
        const energy: GraphData[] = [];
        derived.forEach((d, i) => {
            const off = offsets[i] ?? 0;
            const sp = shift(d.speed, off); if (sp) speed.push(sp);
            const ce = shift(d.centripetal, off); if (ce) centripetal.push(ce);
            const en = shift(d.energy, off); if (en) energy.push(en);
        });
        return {
            speed: speed.length ? speed : undefined,
            centripetal: centripetal.length ? centripetal : undefined,
            energy: energy.length ? energy : undefined,
        };
    }, [derived, offsets]);

    const hasGraphData = graphData.speed || graphData.centripetal || graphData.energy;

    const mapPaths = useMemo<Array<MapPath>>(() => derived
        .filter(d => d.positions && d.positions.length > 0)
        .map((d, i) => ({
            positions: d.positions!,
            currentLocation: positionAt(d.positions, timestamp + (offsets[i] ?? 0)),
            color: d.color,
            label: d.label,
        })),
        [derived, timestamp, offsets]);

    const timelineRolls = useMemo<Array<TimelineRoll>>(() =>
        derived.map(d => ({ color: d.color, tMin: d.tMin, tMax: d.tMax, events: d.events })),
        [derived]);

    // Click on the primary timeline: align every other roll so its geographically
    // closest point sits at the clicked timestamp.
    const onPrimaryClick = useCallback((masterTime: number) => {
        const target = positionAt(derived[0]?.positions, masterTime + (offsetsRef.current[0] ?? 0));
        const newOffsets = offsetsRef.current.map((o, i) => {
            if (i === 0) return o;
            const positions = derived[i].positions;
            if (!target || !positions || positions.length === 0) return o;
            // Only match against points after the roll's start, when known.
            const idx = closestPositionIndex(positions, target, derived[i].rollStart);
            if (idx < 0) return o;
            return positions[idx].timestamp - masterTime;
        });
        offsetsRef.current = newOffsets;
        setOffsets(newOffsets);
        updateVideoTime(masterTime / 1000); // seeks videos using the new offsets
    }, [derived, updateVideoTime]);

    const setOffset = useCallback((index: number, offset: number) => {
        setOffsets(prev => prev.map((o, i) => i === index ? offset : o));
    }, []);

    const resetSync = useCallback(() => setOffsets(defaultOffsets), [defaultOffsets]);

    return (
        <div className="flex h-full gap-4 p-2">
            <div className="flex-[1] flex flex-col min-h-0 min-w-0">
                <div className="shrink-0 mb-2 pb-1 border-b border-gray-300">
                    <span className="text-xs text-neutral-600">Time </span>
                    <span className="font-mono text-sm">{(timestamp / 1000).toFixed(3)}s</span>
                </div>
                <div className="overflow-y-auto flex-1 pr-1 divide-y divide-gray-300">
                    {derived.map((d, i) => (
                        <div key={i} className="py-2 first:pt-0">
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
                                            const target = (timestampRef.current - (d.videoStart - (offsetsRef.current[i] ?? 0))) / 1000;
                                            v.currentTime = Math.min(Math.max(0, target), v.duration || 0);
                                        }}
                                        onClick={() => setPlaying(p => !p)}
                                    />
                                ) : (
                                    <div className="mt-2 py-4 text-center text-xs text-neutral-500 bg-neutral-100">No video</div>
                                )
                            )}
                            <div className="mt-1 grid grid-cols-3 gap-2 text-center">
                                <Stat label="Speed (m/s)" value={valueAt(d.speed, timestamp + (offsets[i] ?? 0))} />
                                <Stat label="Centrip. (m/s²)" value={valueAt(d.centripetal, timestamp + (offsets[i] ?? 0))} />
                                <Stat label="Energy (J/kg)" value={valueAt(d.energy, timestamp + (offsets[i] ?? 0))} />
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="flex-[3] flex flex-col min-h-0 min-w-0">
                <TimelineSync
                    rolls={timelineRolls}
                    offsets={offsets}
                    playhead={timestamp}
                    view={view}
                    fullDomain={fullDomain}
                    onOffsetChange={setOffset}
                    onViewChange={handleTimelineViewChange}
                    onPrimaryClick={onPrimaryClick}
                    onReset={resetSync}
                />
                <div className="flex-1 flex flex-col min-h-0">
                    <div className="h-3/5 pb-2">
                        {hasGraphData ? (
                            <RollGraphsContainer
                                data={graphData}
                                xDomain={fullDomain}
                                onViewChange={handleGraphViewChange}
                                registerSetView={registerGraphSetView}
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
                        ) : (
                            <div className="flex items-center justify-center h-full text-neutral-500">No graph data available</div>
                        )}
                    </div>
                    <div className="h-2/5">
                        <RollMapContainer paths={mapPaths} />
                    </div>
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
