import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import type { ScaleLinear } from "d3-scale";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { Line } from "@visx/shape";
import { localPoint } from "@visx/event";

import { bisector } from "d3-array";
import { useMemo, memo } from "react";
import { GRAPH_MARGIN, GRAPH_SERIES_COLORS } from "@/lib/constants";
import GraphLine, { type BandSeries } from "./GraphLine";

const MemoizedAxisLeft = memo(({ scale, numTicks }: { scale: ScaleLinear<number, number, never>; numTicks: number }) => (
    <AxisLeft<typeof scale> scale={scale} numTicks={numTicks} />
));

const BAND_DOMAIN_SLACK = 0.5;   // the band may grow the y-domain to at most 2x the data span

export interface GraphData {
    timestamp: number[];
    values: number[];
    // 1-sigma per point; drawn as a +/- 2 sd band. Absent for series without it.
    sd?: number[];
    // optional per-series overrides
    color?: string;
    label?: string;
}

export interface TooltipData {
    timestamp: number;
    values: { label: string; value: number; color?: string }[];
}

type Point = { x: number; y: number };

const bisectTimestamp = bisector<Point, number>(d => d.x).left;

// Find the data point nearest to `timestamp`, mirroring the original snap logic.
function nearestPoint(points: Point[], timestamp: number): Point | undefined {
    if (points.length === 0) return undefined;
    const index = bisectTimestamp(points, timestamp, 1);
    const d0 = points[index - 1];
    const d1 = points[index];
    let d = d0;
    if (d1 && d1.x) {
        d = timestamp - d0.x > d1.x - timestamp ? d1 : d0;
    }
    return d;
}


interface RollGraphProps {
    parentWidth: number;
    parentHeight: number;
    data: GraphData[];
    title: string;
    top?: number;
    xScale: ScaleLinear<number, number, never>;
    formatX?: (value: number) => string;
    // Keep 0 on the panel even when the data sits well away from it.
    includeZero?: boolean;
    showAxis?: boolean;
    backgroundColor?: string;
    onMouseMove?: (event: React.MouseEvent | React.TouchEvent) => void;
    onMouseLeave?: () => void;
    showTooltip?: (args: any) => void;
}


export default memo(({
    parentWidth,
    parentHeight,
    data,
    title,
    top = 0,
    includeZero = false,
    showAxis = true,
    backgroundColor,
    xScale,
    formatX = (value: number) => (value / 1000).toFixed(3),
    onMouseMove,
    onMouseLeave,
    showTooltip,
}: RollGraphProps) => {
    const width = parentWidth - GRAPH_MARGIN.left - GRAPH_MARGIN.right;
    const height = showAxis ? parentHeight - GRAPH_MARGIN.bottom : parentHeight - GRAPH_MARGIN.bottom

    // resolve colors
    const series = useMemo(() => data.map((s, i) => ({
        points: s.timestamp.map((t, j) => ({ x: t, y: s.values[j] })),
        color: s.color ?? GRAPH_SERIES_COLORS[i % GRAPH_SERIES_COLORS.length],
        label: s.label ?? title,
    })), [data, title]);

    const bands = useMemo(() => {
        const out: BandSeries[] = [];
        data.forEach((s, i) => {
            const sd = s.sd;
            if (!sd) return;
            out.push({
                color: s.color ?? GRAPH_SERIES_COLORS[i % GRAPH_SERIES_COLORS.length],
                points: s.timestamp.map((t, j) => {
                    const v = s.values[j];
                    const e = sd[j];
                    const ok = Number.isFinite(v) && Number.isFinite(e);
                    return { x: t, lo: ok ? v - 2 * e : NaN, hi: ok ? v + 2 * e : NaN };
                }),
            });
        });
        return out;
    }, [data]);

    const { min, max } = useMemo(() => {
        let min = Infinity;
        let max = -Infinity;
        let bandMin = Infinity;
        let bandMax = -Infinity;
        for (const s of data) {
            for (const v of s.values) {
                if (v < min) min = v;
                if (v > max) max = v;
            }
            const sd = s.sd;
            if (!sd) continue;
            for (let i = 0; i < s.values.length; i++) {
                const v = s.values[i];
                const e = sd[i];
                if (!Number.isFinite(v) || !Number.isFinite(e)) continue;
                if (v - 2 * e < bandMin) bandMin = v - 2 * e;
                if (v + 2 * e > bandMax) bandMax = v + 2 * e;
            }
        }
        if (!isFinite(min) || !isFinite(max)) return { min: 0, max: 1 };
        // Widen to the band, but never past BAND_DOMAIN_SLACK of the data span each side: on ~2 % of
        // rolls the band is many times the range and would flatten the trace to a line.
        if (isFinite(bandMin)) {
            const span = max - min || Math.abs(max) || 1;
            min = Math.max(bandMin, min - span * BAND_DOMAIN_SLACK);
            max = Math.min(bandMax, max + span * BAND_DOMAIN_SLACK);
        }

        if (includeZero) { min = Math.min(min, 0); max = Math.max(max, 0); }

        if (min > 0 && min / max < 0.1) min = 0;
        else min = min - (max - min) * 0.1;

        max = max + (max - min) * 0.1;
        return { min, max };
    }, [data, includeZero]);

    const yScale = useMemo(() => scaleLinear({
        domain: [min, max],
        range: [height, 0],
    }), [height, min, max]);

    const X_TICKS = 9;
    const Y_TICKS = 7;

    const handleLocalMouseMove = (event: React.MouseEvent | React.TouchEvent) => {
        const point = localPoint(event);
        if (!point || !showTooltip) return;

        const x = point.x - GRAPH_MARGIN.left;
        const timestamp = xScale.invert(x);

        const values: { label: string; value: number; color: string }[] = [];
        let tooltipTimestamp = timestamp;
        let snapped = false;
        for (const s of series) {
            const d = nearestPoint(s.points, timestamp);
            if (!d) continue;
            values.push({ label: s.label, value: d.y, color: s.color });
            // snap only to first series
            if (!snapped) {
                tooltipTimestamp = d.x;
                snapped = true;
            }
        }
        if (values.length === 0) return;

        showTooltip({
            tooltipData: {
                timestamp: tooltipTimestamp,
                values,
            },
            tooltipLeft: xScale(tooltipTimestamp) + GRAPH_MARGIN.left,
            tooltipTop: point.y,
        });

        onMouseMove?.(event);
    };

    return <Group top={top + GRAPH_MARGIN.top} left={GRAPH_MARGIN.left} >
        {backgroundColor && (
            <rect
                x={0}
                y={0}
                width={width}
                height={height}
                fill={backgroundColor}
            />
        )}
        <text
            x={width / 2}
            y={-2}
            fontSize={10}
            textAnchor="middle"
        >
            {title}
        </text>
        {showAxis && <AxisBottom<typeof xScale>
            scale={xScale}
            top={height}
            numTicks={X_TICKS} tickFormat={(value) => formatX(+value)}
        />}
        <MemoizedAxisLeft scale={yScale} numTicks={Y_TICKS} />
        <GraphLine
            series={series}
            bands={bands}
            xScale={xScale}
            yScale={yScale}
            width={width}
            height={height}
            numTicksX={X_TICKS}
            numTicksY={Y_TICKS}
            gridColor="#E7E7E7"
        />
        {min < 0 && <Line
            from={{ x: 0, y: yScale(0) }}
            to={{ x: width, y: yScale(0) }}
            stroke="#000"
            opacity={0.5}
            strokeWidth={2}
        />}

        <rect
            y={-GRAPH_MARGIN.top}
            width={width}
            height={height + GRAPH_MARGIN.bottom + GRAPH_MARGIN.top}
            fill="transparent"
            onMouseMove={handleLocalMouseMove}
            onMouseLeave={onMouseLeave}
            onTouchMove={handleLocalMouseMove}
            onTouchEnd={onMouseLeave}
        />
    </Group>
})