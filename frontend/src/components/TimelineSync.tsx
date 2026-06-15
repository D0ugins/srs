import { useEffect, useRef, useState } from "react";
import { Group } from "@visx/group";
import { RectClipPath } from "@visx/clip-path";
import { scaleLinear } from "@visx/scale";
import { Line } from "@visx/shape";
import { EVENT_COLORS, GRAPH_MARGIN } from "@/lib/constants";
import type { RollEvent } from "@/lib/roll";

export interface TimelineRoll {
    color: string;
    tMin: number;   // native data extent (ms)
    tMax: number;
    events: RollEvent[]; // native timestamps
}

interface TimelineSyncProps {
    rolls: TimelineRoll[];
    offsets: number[];              // master = native - offset
    playhead: number;               // master time (ms)
    view: [number, number];         // visible master-time window (shared with the graphs)
    fullDomain: [number, number];   // master extent at default offsets (zoom/pan bounds)
    onOffsetChange: (index: number, offset: number) => void;
    onViewChange: (view: [number, number]) => void;
    onPrimaryClick: (masterTime: number) => void;
    onReset: () => void;
}

const ROW_H = 22;
const BAR_H = 18;
const PAD_TOP = 6;
const GAP = 6;
const PRIMARY_GAP = 10;
const MIN_SPAN = 200; // ms

type Gesture =
    | { type: "offset"; index: number; startOffset: number; startClientX: number; msPerPx: number; moved: boolean }
    | { type: "pan"; startView: [number, number]; startClientX: number; msPerPx: number; moved: boolean }
    | { type: "primary"; masterAtDown: number; startClientX: number; msPerPx: number; moved: boolean };

export default function TimelineSync({
    rolls, offsets, playhead, view, fullDomain, onOffsetChange, onViewChange, onPrimaryClick, onReset,
}: TimelineSyncProps) {
    const outerRef = useRef<HTMLDivElement>(null);
    const svgRef = useRef<SVGSVGElement>(null);
    const [width, setWidth] = useState(0);
    const gesture = useRef<Gesture | null>(null);

    const marginL = GRAPH_MARGIN.left;
    const marginR = GRAPH_MARGIN.right;
    const innerW = Math.max(1, width - marginL - marginR);
    const extraGap = rolls.length > 1 ? PRIMARY_GAP : 0; // gap between the primary row and the rest
    const rowsH = rolls.length * ROW_H + extraGap;
    const height = PAD_TOP + rowsH + GAP;

    // Refs so the once-attached native wheel handler reads live state.
    const viewRef = useRef(view); viewRef.current = view;
    const innerWRef = useRef(innerW); innerWRef.current = innerW;
    const fullDomainRef = useRef(fullDomain); fullDomainRef.current = fullDomain;
    const onViewChangeRef = useRef(onViewChange); onViewChangeRef.current = onViewChange;

    useEffect(() => {
        const el = outerRef.current;
        if (!el) return;
        const ro = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
        ro.observe(el);
        setWidth(el.clientWidth);
        return () => ro.disconnect();
    }, []);

    const clampView = (v: [number, number], bounds: [number, number]): [number, number] => {
        let [a, b] = v;
        const span = b - a;
        if (a < bounds[0]) { a = bounds[0]; b = a + span; }
        if (b > bounds[1]) { b = bounds[1]; a = b - span; }
        if (a < bounds[0]) a = bounds[0];
        return [a, b];
    };

    // Non-passive wheel listener so we can preventDefault and zoom (around cursor).
    useEffect(() => {
        const el = svgRef.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const [v0, v1] = viewRef.current;
            const w = innerWRef.current;
            const bounds = fullDomainRef.current;
            const rect = el.getBoundingClientRect();
            const px = Math.min(w, Math.max(0, e.clientX - rect.left - marginL));
            const cursor = v0 + (px / w) * (v1 - v0);
            const fullSpan = Math.max(MIN_SPAN, bounds[1] - bounds[0]);
            const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
            const span = Math.min(fullSpan, Math.max(MIN_SPAN, (v1 - v0) * factor));
            const ratio = (cursor - v0) / (v1 - v0);
            onViewChangeRef.current(clampView([cursor - ratio * span, cursor - ratio * span + span], bounds));
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
    }, [marginL]);

    const xScale = scaleLinear({ domain: view, range: [0, innerW] });
    const localX = (clientX: number) => clientX - (svgRef.current?.getBoundingClientRect().left ?? 0) - marginL;

    const onMove = (e: PointerEvent) => {
        const g = gesture.current;
        if (!g) return;
        const dPx = e.clientX - g.startClientX;
        if (Math.abs(dPx) > 3) g.moved = true;
        const dMaster = dPx * g.msPerPx;
        if (g.type === "offset") onOffsetChange(g.index, g.startOffset - dMaster);
        else if (g.type === "pan") onViewChange(clampView([g.startView[0] - dMaster, g.startView[1] - dMaster], fullDomainRef.current));
    };
    const onUp = () => {
        const g = gesture.current;
        if (g && g.type === "primary" && !g.moved) onPrimaryClick(g.masterAtDown);
        gesture.current = null;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
    };
    const start = (e: React.PointerEvent, g: Gesture) => {
        e.preventDefault();
        gesture.current = g;
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };
    const msPerPx = () => (view[1] - view[0]) / innerW;

    return (
        <div ref={outerRef} className="shrink-0 relative" style={{ height }}>
            <button
                className="absolute top-0 right-1 z-10 text-[10px] text-neutral-500 hover:text-neutral-800 underline"
                onClick={onReset}
            >
                reset sync
            </button>
            <svg ref={svgRef} width={width} height={height} className="touch-none select-none">
                <rect
                    x={0} y={0} width={width} height={height} fill="transparent"
                    style={{ cursor: "grab" }}
                    onPointerDown={e => start(e, { type: "pan", startView: [...view], startClientX: e.clientX, msPerPx: msPerPx(), moved: false })}
                />
                <Group left={marginL} top={PAD_TOP}>
                    <RectClipPath id="timeline-clip" x={0} y={0} width={innerW} height={rowsH + GAP} />
                    <Group clipPath="url(#timeline-clip)">
                        {rolls.map((r, i) => {
                            const off = offsets[i] ?? 0;
                            const y = i * ROW_H + (i > 0 ? extraGap : 0) + (ROW_H - BAR_H) / 2;
                            const x0 = xScale(r.tMin - off);
                            const x1 = xScale(r.tMax - off);
                            const isPrimary = i === 0;
                            return (
                                <Group key={i}>
                                    <rect
                                        x={x0} y={y} width={Math.max(0, x1 - x0)} height={BAR_H} rx={2}
                                        fill={r.color} fillOpacity={0.18} stroke={r.color} strokeWidth={1}
                                        style={{ cursor: isPrimary ? "crosshair" : "ew-resize" }}
                                        onPointerDown={e => {
                                            e.stopPropagation();
                                            if (isPrimary) start(e, { type: "primary", masterAtDown: xScale.invert(localX(e.clientX)), startClientX: e.clientX, msPerPx: msPerPx(), moved: false });
                                            else start(e, { type: "offset", index: i, startOffset: off, startClientX: e.clientX, msPerPx: msPerPx(), moved: false });
                                        }}
                                    />
                                    {r.events.map((ev, k) => (
                                        <rect
                                            key={k} x={xScale(ev.timestamp_ms - off) - 1} y={y} width={2} height={BAR_H}
                                            fill={EVENT_COLORS[ev.type] ?? "gray"} pointerEvents="none"
                                        />
                                    ))}
                                </Group>
                            );
                        })}
                        <Line
                            from={{ x: xScale(playhead), y: 0 }} to={{ x: xScale(playhead), y: rowsH }}
                            stroke="#ff0000" strokeWidth={2} pointerEvents="none"
                        />
                    </Group>
                    {rolls.length > 1 && (
                        <Line
                            from={{ x: 0, y: ROW_H + extraGap / 2 }} to={{ x: innerW, y: ROW_H + extraGap / 2 }}
                            stroke="#9ca3af" strokeWidth={2} pointerEvents="none"
                        />
                    )}
                </Group>
            </svg>
        </div>
    );
}
