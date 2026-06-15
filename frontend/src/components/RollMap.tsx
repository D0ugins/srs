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


// Satellite image (course_sat.png) dimensions, used to letterbox it within the SVG.
const IMAGE_ASPECT = 6912 / 4608;

// Letterbox the satellite image into a centered rect and build the lat/long scales for it.
function mapGeometry(width: number, height: number) {
    const containerAspect = width / height;
    const imgW = containerAspect > IMAGE_ASPECT ? height * IMAGE_ASPECT : width;
    const imgH = containerAspect > IMAGE_ASPECT ? height : width / IMAGE_ASPECT;
    const imgX = (width - imgW) / 2;
    const imgY = (height - imgH) / 2;
    const xScale = scaleLinear({ domain: [-79.948599138, -79.940837694], range: [imgX, imgX + imgW] });
    const yScale = scaleLinear({ domain: [40.4383888, 40.442326861], range: [imgY + imgH, imgY] });
    return { imgX, imgY, imgW, imgH, xScale, yScale };
}

// The unchanging map layer: satellite image, full tracks and hill lines. Memoized so video
// playback (which only moves currentLocation) doesn't re-render the whole paths.
const StaticPaths = memo(({ width, height, drawSize, paths }: {
    width: number; height: number; drawSize: number;
    paths: { positions: Position[]; color: string }[];
}) => {
    const { imgX, imgY, imgW, imgH, xScale, yScale } = mapGeometry(width, height);
    return <>
        <image href={`${import.meta.env.BASE_URL || '/'}course_sat.png`} x={imgX} y={imgY} width={imgW} height={imgH} />
        {paths.map((path, idx) => (
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
        {HILL_LINES.map((line, idx) => (
            <LinePath
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
        ))}
    </>;
}, (a, b) =>
    a.width === b.width && a.height === b.height && a.drawSize === b.drawSize &&
    a.paths.length === b.paths.length &&
    a.paths.every((p, i) => p.positions === b.paths[i]?.positions && p.color === b.paths[i]?.color)
);

export default memo(({ width, height, zoom, paths, rotation = 0 }:
    RollMapProps & { width: number; height: number, zoom: ZoomType<SVGSVGElement>, rotation?: number }) => {
    const { xScale, yScale } = mapGeometry(width, height);
    const drawSize = Math.max(1 / zoom.transformMatrix.scaleX, 0.1);

    const resolved = (paths ?? []).map((path, idx) => ({
        ...path,
        color: path.color ?? GRAPH_SERIES_COLORS[idx % GRAPH_SERIES_COLORS.length],
    }));

    return <svg width={width} height={height} ref={zoom.containerRef} className='touch-none'>
        <Group transform={zoom.toString()}>
            <Group transform={`rotate(${rotation} ${width / 2} ${height / 2})`}>
                <StaticPaths width={width} height={height} drawSize={drawSize} paths={resolved} />
                {resolved.map((path, idx) => path.currentLocation && <circle
                    key={idx}
                    cx={xScale(path.currentLocation.long)}
                    cy={yScale(path.currentLocation.lat)}
                    r={3 * Math.max(drawSize, 0.33)}
                    fill={path.color}
                    stroke="white"
                    strokeWidth={drawSize}
                />)}
            </Group>
        </Group>
    </svg>
})
