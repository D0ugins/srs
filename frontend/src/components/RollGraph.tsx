import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { Grid } from "@visx/grid";
import { Line, LinePath } from "@visx/shape";
import { localPoint } from "@visx/event";
import { bisector } from "d3-array";

interface GraphData {
    timestamp: number[];
    values: number[];
}

const margin = { top: 25, right: 30, bottom: 30, left: 50 };

const bisectTimestamp = bisector<{ x: number; y: number }, number>(d => d.x).left;

export default function RollGraph({
    parentWidth,
    parentHeight,
    data,
    title,
    top = 0,
    onMouseMove,
    onMouseLeave,
    showTooltip,
}: {
    parentWidth: number;
    parentHeight: number;
    data: GraphData;
    title: string;
    top?: number;
    onMouseMove?: (event: React.MouseEvent | React.TouchEvent) => void;
    onMouseLeave?: () => void;
    showTooltip?: (args: any) => void;
}) {
    const width = parentWidth - margin.left - margin.right;
    const height = parentHeight - margin.top - margin.bottom;
    const xScale = scaleLinear({
        domain: [0, Math.max(...data.timestamp)],
        range: [0, width],
    })
    let min = Math.min(...data.values);
    const yScale = scaleLinear({
        domain: [min, Math.max(...data.values) * 1.1],
        range: [height, 0],
    })

    const X_TICKS = 9;
    const Y_TICKS = 7;

    const dataPoints = data.timestamp.map((t, i) => ({ x: t, y: data.values[i] }));

    const handleLocalMouseMove = (event: React.MouseEvent | React.TouchEvent) => {
        const point = localPoint(event);
        console.debug(point)
        if (!point || !showTooltip) return;

        const x = point.x - margin.left;
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
            tooltipLeft: xScale(d.x) + margin.left,
            tooltipTop: point.y,
        });

        onMouseMove?.(event);
    };

    return <Group top={top + margin.top} left={margin.left} >
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
        <LinePath
            data={dataPoints}
            x={d => xScale(d.x)}
            y={d => yScale(d.y)}
            stroke="#7777ffff"
            strokeWidth={2}
        />
        {min < 0 && <Line
            from={{ x: 0, y: yScale(0) }}
            to={{ x: width, y: yScale(0) }}
            stroke="#000"
            opacity={0.5}
            strokeWidth={2}
        />}
        <rect
            y={-margin.top}
            width={width}
            height={height + margin.bottom + margin.top}
            fill="transparent"
            onMouseMove={handleLocalMouseMove}
            onMouseLeave={onMouseLeave}
            onTouchMove={handleLocalMouseMove}
            onTouchEnd={onMouseLeave}
        />
    </Group>
}