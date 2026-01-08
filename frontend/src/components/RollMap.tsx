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
export interface RollMapProps {
    positions?: Position[]
    currentLocation?: Position
}

const IMAGE_WIDTH = 6912;
const IMAGE_HEIGHT = 4608;


export default memo(({ parent, zoom, positions, currentLocation }:
    RollMapProps & { parent: { width: number; height: number }, zoom: ZoomType<SVGSVGElement> }) => {

    const imageAspectRatio = IMAGE_WIDTH / IMAGE_HEIGHT;
    const containerAspectRatio = parent.width / parent.height;

    const renderedWidth = containerAspectRatio > imageAspectRatio ? parent.height * imageAspectRatio : parent.width;
    const renderedHeight = containerAspectRatio > imageAspectRatio ? parent.height : parent.width / imageAspectRatio;

    const xScale = scaleLinear({
        domain: [-79.948599138, -79.940837694],
        range: [0, renderedWidth],
    });

    const yScale = scaleLinear({
        domain: [40.4383888, 40.442326861],
        range: [renderedHeight, 0],
    });

    const drawSize = Math.max(1 / zoom.transformMatrix.scaleX, 0.33);

    return <svg width={parent.width} height={parent.height} ref={zoom.containerRef} className='touch-none'>
        <Group transform={zoom.toString()}>
            <image href="/course_sat.png" width="100%" />
            <LinePath
                data={positions ?? []}
                x={d => xScale(d.long)}
                y={d => yScale(d.lat)}
                stroke="gold"
                strokeWidth={2 * drawSize}
                fill="none"
                shapeRendering="geometricPrecision"
            />
            {currentLocation && <circle
                cx={xScale(currentLocation.long)}
                cy={yScale(currentLocation.lat)}
                r={3 * drawSize}
                fill="black"
                stroke="white"
                strokeWidth={drawSize}
            />}
        </Group>
    </svg>
})