import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { Grid } from "@visx/grid";
import { Line, LinePath } from "@visx/shape";

interface GraphData {
    timestamp: number[];
    values: number[];
}

const margin = { top: 25, right: 30, bottom: 30, left: 50 };


export default function RollGraph({ parentWidth, parentHeight, data, title, top = 0 }:
    { parentWidth: number, parentHeight: number, data: GraphData, title: string, top?: number }) {
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
            data={data.timestamp.map((t, i) => ({ x: t, y: data.values[i] }))}
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
    </Group>
}