import { GRAPH_SERIES_COLORS, HILL_LINES } from '@/lib/constants';
import { Group } from '@visx/group';
import { scaleLinear } from '@visx/scale';
import { LinePath } from '@visx/shape';
import type { ZoomProps } from '@visx/zoom';
import { memo } from 'react';
type ZoomType<ElementType extends Element> = ZoomProps<ElementType>['children'] extends (zoom: infer U) => any ? U : never;

export interface Position {
    lat: number,
    long: number,
    timestamp: number,
}

export interface MapPath {
    positions: Position[];
    currentLocation?: Position;
    // optional per-path overrides
    color?: string;
    label?: string;
}

export interface RollMapProps {
    paths?: MapPath[]
}


export default memo(({ width, height, zoom, paths }:
    RollMapProps & { width: number; height: number, zoom: ZoomType<SVGSVGElement> }) => {
    const xScale = scaleLinear({
        domain: [-79.948599138, -79.940837694],
        range: [0, width],
    });

    const yScale = scaleLinear({
        domain: [40.4383888, 40.442326861],
        range: [height, 0],
    });

    const drawSize = Math.max(1 / zoom.transformMatrix.scaleX, 0.1);

    const resolved = (paths ?? []).map((path, idx) => ({
        ...path,
        color: path.color ?? GRAPH_SERIES_COLORS[idx % GRAPH_SERIES_COLORS.length],
    }));

    return <svg width={width} height={height} ref={zoom.containerRef} className='touch-none'>
        <Group transform={zoom.toString()}>
            <image href={`${import.meta.env.BASE_URL || '/'}course_sat.png`} width="100%" height="100%" />
            {resolved.map((path, idx) => (
                <LinePath
                    key={idx}
                    data={path.positions}
                    x={d => xScale(d.long)}
                    y={d => yScale(d.lat)}
                    stroke={path.color}
                    strokeWidth={2 * drawSize}
                    fill="none"
                    shapeRendering="geometricPrecision"
                />
            ))}
            {
                HILL_LINES.map((line, idx) => {
                    return <LinePath
                        key={idx}
                        data={line}
                        x={d => xScale(d.long)}
                        y={d => yScale(d.lat)}
                        stroke="red"
                        strokeWidth={1 * drawSize}
                        fill="none"
                        strokeLinecap='square'
                        shapeRendering="geometricPrecision"
                    />
                })
            }
            {resolved.map((path, idx) => path.currentLocation && <circle
                key={idx}
                cx={xScale(path.currentLocation.long)}
                cy={yScale(path.currentLocation.lat)}
                r={3 * drawSize}
                fill={path.color}
                stroke="white"
                strokeWidth={drawSize}
            />)}
        </Group>
    </svg>
})
