import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import type { ScaleLinear } from "d3-scale";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { Grid } from "@visx/grid";
import { Line } from "@visx/shape";
import { localPoint } from "@visx/event";

import { bisector } from "d3-array";
import { useMemo, memo, useRef, useEffect } from "react";
import { GRAPH_MARGIN } from "@/lib/constants";

export interface GraphData {
    timestamp: number[];
    values: number[];
}

export interface TooltipData {
    timestamp: number;
    values: { label: string; value: number }[];
}

const bisectTimestamp = bisector<{ x: number; y: number }, number>(d => d.x).left;


interface RollGraphProps {
    parentWidth: number;
    parentHeight: number;
    data: GraphData;
    title: string;
    top?: number;
    xScale: ScaleLinear<number, number, never>;
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
    showAxis = true,
    backgroundColor,
    xScale,
    onMouseMove,
    onMouseLeave,
    showTooltip,
}: RollGraphProps) => {
    const width = parentWidth - GRAPH_MARGIN.left - GRAPH_MARGIN.right;
    const height = showAxis ? parentHeight - GRAPH_MARGIN.bottom : parentHeight - GRAPH_MARGIN.bottom

    const { min, max } = useMemo(() => {
        let min = Math.min(...data.values);
        let max = Math.max(...data.values);
        if (min > 0 && min / max < 0.1) min = 0;
        else min = min - (max - min) * 0.1;

        max = max + (max - min) * 0.1;
        return { min, max };
    }, [data]);

    const yScale = useMemo(() => scaleLinear({
        domain: [min, max],
        range: [height, 0],
    }), [data, height, min, max]);

    const X_TICKS = 9;
    const Y_TICKS = 7;

    const dataPoints = useMemo(() => data.timestamp.map((t, i) => ({ x: t, y: data.values[i] })), [data]);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.scale(dpr, dpr);

        if (dataPoints.length === 0) {
            ctx.restore();
            return;
        }

        ctx.beginPath();
        ctx.strokeStyle = '#7777ffff';
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';

        let started = false;
        for (const d of dataPoints) {
            const x = xScale(d.x);
            const y = yScale(d.y);
            if (!started) {
                ctx.moveTo(x, y);
                started = true;
            } else {
                ctx.lineTo(x, y);
            }
        }

        ctx.stroke();
        ctx.restore();
    }, [dataPoints, xScale, yScale, width, height, dpr]);

    const handleLocalMouseMove = (event: React.MouseEvent | React.TouchEvent) => {
        const point = localPoint(event);
        if (!point || !showTooltip) return;

        const x = point.x - GRAPH_MARGIN.left;
        const timestamp = xScale.invert(x);
        const index = bisectTimestamp(dataPoints, timestamp, 1);
        const d0 = dataPoints[index - 1];
        const d1 = dataPoints[index];
        let d = d0;
        if (d1 && d1.x) {
            d = timestamp - d0.x > d1.x - timestamp ? d1 : d0;
        }

        showTooltip({
            tooltipData: {
                timestamp: d.x,
                values: [{ label: title, value: d.y }],
            },
            tooltipLeft: xScale(d.x) + GRAPH_MARGIN.left,
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
        <Grid
            width={width}
            height={height}
            xScale={xScale}
            yScale={yScale}
            numTicksRows={Y_TICKS}
            numTicksColumns={X_TICKS}
            stroke="#E7E7E7"
            shapeRendering="geometricPrecision"
        />
        {showAxis && <AxisBottom<typeof xScale>
            scale={xScale}
            top={height}
            numTicks={X_TICKS} tickFormat={(value) => (+value / 1000).toFixed(3)}
        />}
        <AxisLeft<typeof yScale> scale={yScale} numTicks={Y_TICKS} />
        <foreignObject x={0} y={0} width={width} height={height}>
            <canvas
                ref={canvasRef}
                width={width * dpr}
                height={height * dpr}
                style={{ width: `${width}px`, height: `${height}px`, pointerEvents: 'none' }}
            />
        </foreignObject>
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