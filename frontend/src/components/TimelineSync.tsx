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
    view: [number, number];         // visible master-time window (driven by the graphs)
    onOffsetChange: (index: number, offset: number) => void;
    onPrimaryClick: (masterTime: number) => void;
    onReset: () => void;
}

const ROW_H = 22;
const BAR_H = 18;
const PAD_TOP = 6;
const GAP = 6;
const PRIMARY_GAP = 10;

type Gesture =
    | { type: "offset"; index: number; startOffset: number; startClientX: number; msPerPx: number; moved: boolean }
    | { type: "primary"; masterAtDown: number; startClientX: number; msPerPx: number; moved: boolean };

export default function TimelineSync({
    rolls, offsets, playhead, view, onOffsetChange, onPrimaryClick, onReset,
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

    useEffect(() => {
        const el = outerRef.current;
        if (!el) return;
        const ro = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
        ro.observe(el);
        setWidth(el.clientWidth);
        return () => ro.disconnect();
    }, []);

    const xScale = scaleLinear({ domain: view, range: [0, innerW] });
    const localX = (clientX: number) => clientX - (svgRef.current?.getBoundingClientRect().left ?? 0) - marginL;

    const onMove = (e: PointerEvent) => {
        const g = gesture.current;
        if (!g) return;
        const dPx = e.clientX - g.startClientX;
        if (Math.abs(dPx) > 3) g.moved = true;
        const dMaster = dPx * g.msPerPx;
        if (g.type === "offset") onOffsetChange(g.index, g.startOffset - dMaster);
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
