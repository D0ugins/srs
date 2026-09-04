import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTooltip } from "@visx/tooltip";
import { bisector } from "d3-array";
import { RollGraphsContainer, RollMapContainer } from "./RollAnalysis";
import RollCompareSidebar from "./RollCompareSidebar";
import TimelineSync, { type TimelineRoll } from "./TimelineSync";
import type { GraphData } from "./RollGraph";
import type { MapPath, Position } from "./RollMap";
import type { RollDetails, RollEvent, RollGraphData } from "@/lib/roll";
import { GRAPH_SERIES_COLORS } from "@/lib/constants";
import { transformMediaUrl } from "@/lib/format";
import { arcToTime, buildAxes, timeToArc } from "@/lib/track";

export interface CompareRoll {
    roll: RollDetails;
    graphs?: RollGraphData;
}

const VIDEO_CHOICES = ['video_preview', 'edited_vid', 'video_preview_c', 'edited_vid_c', 'follow_car_vid', 'misc_vid'];

// Points drawn on the delta panel; the primary's samples are decimated to this many.
const DELTA_POINTS = 800;

const AXIS_MODE_KEY = 'srs.compare.axis';

function storedAxisMode(): boolean {
    try { return localStorage.getItem(AXIS_MODE_KEY) === 'position'; } catch { return false; }
}

function pickVideoUrl(roll: RollDetails): string | undefined {
    const video = VIDEO_CHOICES
        .map(type => roll.roll_files.find(file => file.type === type))
        .find(f => f !== undefined);
    return transformMediaUrl(video?.uri);
}

function positionAt(positions: Array<Position> | undefined, t: number): Position | undefined {
    if (!positions || positions.length === 0 || !isFinite(t)) return undefined;
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

export interface Derived {
    color: string;
    label: string;
    videoUrl?: string;
    videoStart: number;
    speed?: GraphData;
    energy?: GraphData;
    a_drag?: GraphData;
    a_lat?: GraphData;
    positions?: Array<Position>;
    events: Array<RollEvent>;
    tMin: number;
    tMax: number;
    rollStart?: number;
    freerollStart?: number;
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

        const speed = gps ? { timestamp: gps.timestamp, values: gps.speed, sd: gps.sd_speed, color, label } : undefined;
        const energy = gps
            ? {
                timestamp: gps.timestamp,
                values: gps.energy ?? gps.speed.map((v, j) => 0.5 * v * v + 9.81 * gps.elevation[j]),
                // sd_energy indexes the served energy, not the locally derived fallback.
                sd: gps.energy ? gps.sd_energy : undefined,
                color, label,
            }
            : undefined;
        const a_drag = gps?.a_drag
            ? { timestamp: gps.timestamp, values: gps.a_drag, sd: gps.sd_a_drag, color, label }
            : undefined;
        const a_lat = gps?.a_lat
            ? { timestamp: gps.timestamp, values: gps.a_lat, sd: gps.sd_a_lat, color, label }
            : undefined;
        const positions = gps
            ? gps.timestamp.map((t, j) => ({ lat: gps.lat[j], long: gps.long[j], timestamp: t }))
            : undefined;

        const events = roll.roll_events ?? [];
        const ts = gps?.timestamp ?? [];
        const tMin = ts.length ? ts[0] : 0;
        const tMax = ts.length ? ts[ts.length - 1] : 0;
        const rollStart = events.find(e => e.type === 'roll_start')?.timestamp_ms;
        const freerollStart = events.find(e => e.type === 'freeroll_start')?.timestamp_ms;

        return {
            color, label, videoUrl: pickVideoUrl(roll), videoStart: graphs?.video_start ?? 0,
            speed, energy, a_drag, a_lat, positions, events, tMin, tMax, rollStart, freerollStart,
        };
    }), [rolls]);

    // Distance along the primary roll's path, with every other roll projected onto it.
    const axes = useMemo(
        () => buildAxes(derived.map(d => ({ positions: d.positions, rollStart: d.rollStart }))),
        [derived]);
    const [byPosition, setByPosition] = useState(storedAxisMode);
    const positionMode = byPosition && axes[0] !== undefined;

    // Per-roll time offset: master_time = native_time - offset. Primary (0) anchors the axis.
    // Default aligns each roll's roll_start to the primary's, falling back to no offset.
    const defaultOffsets = useMemo(() => {
        const primaryStart = derived[0]?.freerollStart;
        return derived.map((d, i) => {
            if (i === 0) return 0;
            if (primaryStart != null && d.freerollStart != null) return d.freerollStart - primaryStart;
            return 0;
        });
    }, [derived]);

    const [offsets, setOffsets] = useState<Array<number>>(defaultOffsets);
    const offsetsRef = useRef(offsets);
    offsetsRef.current = offsets;

    const rollKey = rolls.map(r => r.roll.id).join(',');
    useEffect(() => { setOffsets(defaultOffsets); }, [rollKey]);

    // The shared x axis is either master time or position along the primary's track. Videos, map,
    // graphs and sidebar stats all convert through these; nothing else knows which mode is on.
    const toNative = useCallback((i: number, x: number) => {
        if (!positionMode) return x + (offsetsRef.current[i] ?? 0);
        const axis = axes[i];
        return axis ? arcToTime(axis, x) : NaN;
    }, [positionMode, axes]);
    const fromNative = useCallback((i: number, t: number, clamp = true) => {
        if (!positionMode) return t - (offsetsRef.current[i] ?? 0);
        const axis = axes[i];
        return axis ? timeToArc(axis, t, clamp) : NaN;
    }, [positionMode, axes]);
    const toNativeRef = useRef(toNative);
    toNativeRef.current = toNative;
    const fromNativeRef = useRef(fromNative);
    fromNativeRef.current = fromNative;

    // Start the playhead at the primary roll's freeroll start when available.
    useEffect(() => {
        const fr = derived[0]?.freerollStart;
        if (fr == null) return;
        const base = axes[0];
        setTimestamp(positionMode && base ? timeToArc(base, fr) : fr - (defaultOffsets[0] ?? 0));
    }, [rollKey]);

    // Stable canvas for the timeline: union of all roll extents at default offsets.
    const fullDomain = useMemo<[number, number]>(() => {
        let lo = Infinity, hi = -Infinity;
        if (positionMode) {
            axes.forEach(axis => {
                if (!axis || axis.arc.length === 0) return;
                lo = Math.min(lo, axis.arc[0]);
                hi = Math.max(hi, axis.arc[axis.arc.length - 1]);
            });
        } else {
            derived.forEach((d, i) => {
                const off = defaultOffsets[i] ?? 0;
                lo = Math.min(lo, d.tMin - off);
                hi = Math.max(hi, d.tMax - off);
            });
        }
        if (!isFinite(lo) || !isFinite(hi) || hi <= lo) return [0, 1000];
        const pad = (hi - lo) * 0.02;
        return [lo - pad, hi + pad];
    }, [derived, defaultOffsets, positionMode, axes]);

    // Visible window, shared between the graphs and the timeline. The graph's zoom
    // is the source of truth: it reports changes here and the timeline follows.
    const [view, setView] = useState<[number, number]>(fullDomain);
    const graphSetViewRef = useRef<((v: [number, number]) => void) | null>(null);
    const registerGraphSetView = useCallback((fn: (v: [number, number]) => void) => { graphSetViewRef.current = fn; }, []);
    const handleGraphViewChange = useCallback((v: [number, number]) => setView(v), []);
    useEffect(() => {
        setView(fullDomain);
        graphSetViewRef.current?.(fullDomain);
    }, [fullDomain[0], fullDomain[1]]);

    const {
        tooltipData, tooltipLeft, tooltipTop, showTooltip, hideTooltip,
    } = useTooltip<{ timestamp: number; values: Array<{ label: string; value: number }> }>();
    const handleMouseLeave = useCallback(() => hideTooltip(), [hideTooltip]);

    // Move the playhead to an axis coordinate (master ms, or metres in position mode).
    const seek = useCallback((x: number) => {
        setTimestamp(x);
        derived.forEach((d, i) => {
            const v = videoRefs.current[i];
            if (!v) return;
            const native = toNativeRef.current(i, x);
            if (!isFinite(native)) return;
            const target = (native - d.videoStart) / 1000;
            v.currentTime = isFinite(v.duration) ? Math.min(Math.max(0, target), v.duration) : Math.max(0, target);
        });
    }, [derived]);

    // Step the playhead in time, whatever the axis is: a step in metres would be unusable.
    const step = useCallback((seconds: number) => {
        const native = toNativeRef.current(0, timestampRef.current);
        const x = fromNativeRef.current(0, native + seconds * 1000);
        if (isFinite(x)) seek(x);
    }, [seek]);

    // Play/pause all videos; align them before playing.
    useEffect(() => {
        derived.forEach((d, i) => {
            const v = videoRefs.current[i];
            if (!v) return;
            if (playing) {
                const native = toNativeRef.current(i, timestampRef.current);
                const target = (native - d.videoStart) / 1000;
                if (isFinite(v.duration) && isFinite(target)) v.currentTime = Math.min(Math.max(0, target), v.duration);
                v.play().catch(() => { });
            } else {
                v.pause();
            }
        });
    }, [playing, showVideo, derived]);

    // Re-seek a roll's video when its timeline is shifted, so the preview reflects the new sync.
    // Position mode maps videos by track position, so the offsets don't move them there.
    const prevOffsetsRef = useRef(offsets);
    useEffect(() => {
        const prev = prevOffsetsRef.current;
        prevOffsetsRef.current = offsets;
        if (positionMode) return;
        derived.forEach((d, i) => {
            if ((offsets[i] ?? 0) === (prev[i] ?? 0)) return;
            const v = videoRefs.current[i];
            if (!v) return;
            const target = (toNativeRef.current(i, timestampRef.current) - d.videoStart) / 1000;
            v.currentTime = isFinite(v.duration) ? Math.min(Math.max(0, target), v.duration) : Math.max(0, target);
        });
    }, [offsets, derived, positionMode]);

    // Switching the axis keeps the same instant, but every video has to be re-placed on it.
    const axisSettled = useRef(false);
    useEffect(() => {
        if (!axisSettled.current) { axisSettled.current = true; return; }
        seek(timestampRef.current);
    }, [positionMode]);

    // While playing, the first mounted video drives the shared playhead.
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
            const native = master.currentTime * 1000 + derived[masterIdx].videoStart;
            const x = fromNativeRef.current(masterIdx, native);
            if (isFinite(x)) setTimestamp(x);
            handle = master.requestVideoFrameCallback(tick);
        };
        handle = master.requestVideoFrameCallback(tick);
        return () => { if (handle != null) master.cancelVideoFrameCallback(handle); };
    }, [playing, showVideo, derived]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === ' ') { e.preventDefault(); setPlaying(p => !p); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); step(e.shiftKey ? 5 : 1 / 30); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); step(e.shiftKey ? -5 : -1 / 30); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [step]);

    // Time behind the primary at each position along its track, drawn as the first graph panel.
    const deltas = useMemo<Array<GraphData>>(() => {
        const base = axes[0];
        if (!positionMode || !base) return [];
        const stride = Math.max(1, Math.ceil(base.arc.length / DELTA_POINTS));
        const arc: Array<number> = [];
        for (let j = 0; j < base.arc.length; j += stride) arc.push(base.arc[j]);
        const last = base.arc[base.arc.length - 1];
        if (arc[arc.length - 1] !== last) arc.push(last);
        const baseOff = offsets[0] ?? 0;

        return derived.flatMap((d, i) => {
            const axis = axes[i];
            if (i === 0 || !axis) return [];
            const off = offsets[i] ?? 0;
            // Positions the roll never reached are left out rather than extrapolated.
            const timestamp: Array<number> = [];
            const values: Array<number> = [];
            arc.forEach(s => {
                const t = arcToTime(axis, s, false);
                if (!isFinite(t)) return;
                timestamp.push(s);
                values.push(((t - off) - (arcToTime(base, s, false) - baseOff)) / 1000);
            });
            return timestamp.length ? [{ timestamp, values, color: d.color, label: d.label }] : [];
        });
    }, [axes, derived, offsets, positionMode]);

    // Graph series moved onto the shared axis so all rolls line up. On the position axis a roll's
    // samples from outside the primary's track have nowhere to sit, and are dropped.
    const graphData = useMemo(() => {
        const shift = (s: GraphData | undefined, i: number): GraphData | undefined => {
            if (!s) return undefined;
            if (!positionMode) return { ...s, timestamp: s.timestamp.map(t => fromNative(i, t)) };
            const timestamp: Array<number> = [];
            const values: Array<number> = [];
            const sd: Array<number> = [];
            s.timestamp.forEach((t, j) => {
                const x = fromNative(i, t, false);
                if (!isFinite(x)) return;
                timestamp.push(x);
                values.push(s.values[j]);
                if (s.sd) sd.push(s.sd[j]);
            });
            return timestamp.length ? { ...s, timestamp, values, sd: s.sd ? sd : undefined } : undefined;
        };
        const speed: GraphData[] = [];
        const energy: GraphData[] = [];
        const a_drag: GraphData[] = [];
        const a_lat: GraphData[] = [];
        derived.forEach((d, i) => {
            if (positionMode && !axes[i]) return;
            const sp = shift(d.speed, i); if (sp) speed.push(sp);
            const en = shift(d.energy, i); if (en) energy.push(en);
            const af = shift(d.a_drag, i); if (af) a_drag.push(af);
            const al = shift(d.a_lat, i); if (al) a_lat.push(al);
        });
        return {
            delta: positionMode && deltas.length ? deltas : undefined,
            speed: speed.length ? speed : undefined,
            energy: energy.length ? energy : undefined,
            a_drag: a_drag.length ? a_drag : undefined,
            a_lat: a_lat.length ? a_lat : undefined,
        };
    }, [derived, offsets, fromNative, positionMode, axes, deltas]);

    const hasGraphData = graphData.speed || graphData.energy || graphData.a_drag || graphData.a_lat;

    const mapPaths = useMemo<Array<MapPath>>(() => derived
        .map((d, i): MapPath | undefined => (d.positions && d.positions.length > 0
            ? {
                positions: d.positions,
                currentLocation: positionAt(d.positions, toNative(i, timestamp)),
                color: d.color,
                label: d.label,
            }
            : undefined))
        .filter((p): p is MapPath => p !== undefined),
        [derived, timestamp, offsets, toNative]);

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
        seek(masterTime); // seeks videos using the new offsets
    }, [derived, seek]);

    const setOffset = useCallback((index: number, offset: number) => {
        setOffsets(prev => prev.map((o, i) => i === index ? offset : o));
    }, []);

    const resetSync = useCallback(() => setOffsets(defaultOffsets), [defaultOffsets]);

    // Keep the playhead on the same instant when the axis changes under it.
    const setAxisMode = useCallback((next: boolean) => {
        if (next === byPosition) return;
        const base = axes[0];
        if (base) {
            const native = toNativeRef.current(0, timestampRef.current);
            const x = next ? timeToArc(base, native) : native - (offsetsRef.current[0] ?? 0);
            if (isFinite(x)) setTimestamp(x);
        }
        setByPosition(next);
        try { localStorage.setItem(AXIS_MODE_KEY, next ? 'position' : 'time'); } catch { /* private mode */ }
    }, [axes, byPosition]);

    return (
        <div className="flex h-full gap-4 p-2">
            <RollCompareSidebar
                rolls={rolls}
                derived={derived}
                showVideo={showVideo}
                setShowVideo={setShowVideo}
                toNative={toNative}
                toNativeRef={toNativeRef}
                positionMode={positionMode}
                videoRefs={videoRefs}
                timestampRef={timestampRef}
                setPlaying={setPlaying}
                timestamp={timestamp}
            />

            <div className="flex-[3] flex flex-col min-h-0 min-w-0">
                <div className="flex-1 flex flex-col min-h-0">
                    <div className="h-3/5 pb-2 overflow-y-auto flex flex-col">
                        <div className="shrink-0 flex justify-center items-center gap-2 text-sm">
                            <span className={positionMode ? 'text-neutral-500' : 'text-neutral-800 font-semibold'}>t</span>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={positionMode}
                                disabled={!axes[0]}
                                onClick={() => setAxisMode(!positionMode)}
                                title="Index the timeline by time (t) or by position along the primary roll's track (x)"
                                className="relative w-11 h-6 rounded-full bg-neutral-300 disabled:opacity-40 cursor-pointer"
                            >
                                <span
                                    className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${positionMode ? 'left-5.5' : 'left-0.5'}`}
                                />
                            </button>
                            <span className={positionMode ? 'text-neutral-800 font-semibold' : 'text-neutral-500'}>x</span>
                        </div>
                        {!positionMode && (
                            <TimelineSync
                                rolls={timelineRolls}
                                offsets={offsets}
                                playhead={timestamp}
                                view={view}
                                onOffsetChange={setOffset}
                                onPrimaryClick={onPrimaryClick}
                                onReset={resetSync}
                            />
                        )}
                        {hasGraphData ? (
                            <div className="flex-1 min-h-[55vh]">
                                <RollGraphsContainer
                                    data={graphData}
                                    xDomain={fullDomain}
                                    xUnit={positionMode ? 'm' : 's'}
                                    onViewChange={handleGraphViewChange}
                                    registerSetView={registerGraphSetView}
                                    tooltipLeft={tooltipLeft}
                                    tooltipTop={tooltipTop}
                                    tooltipData={tooltipData}
                                    videoTime={timestamp}
                                    showTooltip={showTooltip}
                                    handleMouseLeave={handleMouseLeave}
                                    seek={seek}
                                    playing={playing}
                                    setPlaying={setPlaying}
                                />
                            </div>
                        ) : (
                            <div className="flex-1 flex items-center justify-center text-neutral-500">No graph data available</div>
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
