import { Group } from '@visx/group';
import { scaleLinear } from '@visx/scale';
import { LinePath } from '@visx/shape';
import type { ZoomProps } from '@visx/zoom';
type ZoomType<ElementType extends Element> = ZoomProps<ElementType>['children'] extends (zoom: infer U) => any ? U : never;

export interface RollMapProps {
    positions?: { lat: number, long: number, timestamp: number }[]
}

const IMAGE_WIDTH = 6912;
const IMAGE_HEIGHT = 4608;


export default function RollMap({ parent, positions, zoom }:
    RollMapProps & { parent: { width: number; height: number }, zoom: ZoomType<SVGSVGElement> }) {

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

    return <svg width={parent.width} height={parent.height} ref={zoom.containerRef}>
        <Group transform={zoom.toString()}>
            <image href="/course_sat.png" width="100%" />
            <LinePath
                key={zoom.transformMatrix.toString()}
                data={positions ?? []}
                x={d => xScale(d.long)}
                y={d => yScale(d.lat)}
                stroke="red"
                strokeWidth={1}
                fill="none"
                shapeRendering="geometricPrecision"
            />
        </Group>
    </svg>
}