import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import type { ScaleLinear } from "d3-scale";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { Grid } from "@visx/grid";
import { Line, LinePath } from "@visx/shape";
import { localPoint } from "@visx/event";
import { RectClipPath } from "@visx/clip-path";
import type { ZoomState } from "@visx/zoom";
import { bisector } from "d3-array";
import { useMemo } from "react";
import { GRAPH_MARGIN } from "./RollAnalysis";

export interface GraphData {
    timestamp: number[];
    values: number[];
}

export interface TooltipData {
    timestamp: number;
    values: { label: string; value: number }[];
}

const bisectTimestamp = bisector<{ x: number; y: number }, number>(d => d.x).left;

function zoomXScale(zoom: ZoomState, scale: ScaleLinear<number, number, never>): ScaleLinear<number, number, never> {
    const newDomain = scale.range().map(d => scale.invert(d - zoom.transformMatrix.translateX) / zoom.transformMatrix.scaleX);
    return scaleLinear({
        domain: newDomain,
        range: scale.range(),
    });
}

interface RollGraphProps {
    parentWidth: number;
    parentHeight: number;
    data: GraphData;
    title: string;
    top?: number;
    zoom: ZoomState
    videoTime?: number;
    onMouseMove?: (event: React.MouseEvent | React.TouchEvent) => void;
    onMouseLeave?: () => void;
    showTooltip?: (args: any) => void;
}

export default function RollGraph({
    parentWidth,
    parentHeight,
    data,
    title,
    top = 0,
    zoom,
    videoTime,
    onMouseMove,
    onMouseLeave,
    showTooltip,
}: RollGraphProps) {
    const width = parentWidth - GRAPH_MARGIN.left - GRAPH_MARGIN.right;
    const height = parentHeight - GRAPH_MARGIN.top - GRAPH_MARGIN.bottom;

    const xScale = useMemo(() => zoomXScale(zoom, scaleLinear({
        domain: [0, Math.max(...data.timestamp)],
        range: [0, width],
    })), [data, width, zoom]);

    let min = Math.min(...data.values);
    const yScale = useMemo(() => scaleLinear({
        domain: [min, Math.max(...data.values) * 1.1],
        range: [height, 0],
    }), [data, height,]);

    const X_TICKS = 9;
    const Y_TICKS = 7;

    const dataPoints = useMemo(() => data.timestamp.map((t, i) => ({ x: t, y: data.values[i] })), [data]);

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
        <text x={0} y={-5} fontSize={14}>
            {title}
        </text>
        <Grid
            width={width}
            height={height}
            xScale={xScale}
            yScale={yScale}
            numTicksRows={Y_TICKS}
            numTicksColumns={X_TICKS}
        />
        <AxisBottom<typeof xScale>
            scale={xScale}
            top={height}
            numTicks={X_TICKS} tickFormat={(value) => (+value / 1000).toFixed(3)}
        />
        <AxisLeft<typeof yScale> scale={yScale} numTicks={Y_TICKS} />
        <RectClipPath id="graph-clip-path" width={width} height={height} />
        <LinePath
            data={dataPoints}
            x={d => xScale(d.x)}
            y={d => yScale(d.y)}
            stroke="#7777ffff"
            strokeWidth={2}
            clipPath="url(#graph-clip-path)"
        />
        {min < 0 && <Line
            from={{ x: 0, y: yScale(0) }}
            to={{ x: width, y: yScale(0) }}
            stroke="#000"
            opacity={0.5}
            strokeWidth={2}
        />}
        {videoTime && <Line
            from={{ x: xScale(videoTime), y: 0 }}
            to={{ x: xScale(videoTime), y: height }}
            stroke="#ff0000"
            strokeWidth={2}
            shapeRendering="geometricPrecision"
            pointerEvents="none"
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
}