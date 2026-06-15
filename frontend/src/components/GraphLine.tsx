import type { ScaleLinear } from "d3-scale";
import { useRef, useLayoutEffect, useCallback, memo } from "react";
import { WebglPlot, WebglLinePlot, type LineConfig } from "webgl-plot";

export interface LineSeries {
    points: { x: number; y: number }[];
    color: string;
}

interface GraphLineProps {
    series: LineSeries[];
    xScale: ScaleLinear<number, number, never>;
    yScale: ScaleLinear<number, number, never>;
    width: number;
    height: number;
    strokeWidth?: number;
}

function hexToRgba(hex: string): [number, number, number, number] {
    let h = hex.replace("#", "");
    if (h.length === 3) h = h.split("").map(c => c + c).join("");
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return [r, g, b, a];
}

// All series in a single graph share one WebGL context (one WebglLinePlot).
// Points are uploaded once in data coordinates; zoom/pan only updates the
// global transform on the GPU, so redraws are a uniform write + draw call.
export default memo(({
    series,
    xScale,
    yScale,
    width,
    height,
    strokeWidth = 2,
}: GraphLineProps) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const wglpRef = useRef<WebglPlot | null>(null);
    const plotRef = useRef<WebglLinePlot | null>(null);
    const loseTimerRef = useRef<number | null>(null);
    // X is uploaded relative to this reference to keep float32 precision when
    // timestamps are large; folded back into the offset at draw time.
    const xRefRef = useRef(0);
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

    // Latest scales/size, read by the stable redraw() without re-creating it.
    const xScaleRef = useRef(xScale); xScaleRef.current = xScale;
    const yScaleRef = useRef(yScale); yScaleRef.current = yScale;
    const widthRef = useRef(width); widthRef.current = width;
    const heightRef = useRef(height); heightRef.current = height;

    // Map data coords -> WebGL clip space [-1, 1] so the line aligns with the
    // d3 scales (and thus the SVG grid/axes), then draw.
    const redraw = useCallback(() => {
        const wglp = wglpRef.current;
        const plot = plotRef.current;
        if (!wglp || !plot) return;

        const xs = xScaleRef.current;
        const ys = yScaleRef.current;
        const w = widthRef.current;
        const h = heightRef.current;
        if (w <= 0 || h <= 0) return;

        const scaleX = ((xs(1) - xs(0)) * 2) / w;
        const offsetX = (xs(xRefRef.current) * 2) / w - 1;
        const scaleY = (-(ys(1) - ys(0)) * 2) / h;
        const offsetY = 1 - (ys(0) * 2) / h;

        plot.setGlobalTransform([scaleX, scaleY], [offsetX, offsetY]);
        wglp.clear();
        plot.draw();
    }, []);

    // Create the WebGL context once. Transparent so the SVG grid shows through.
    useLayoutEffect(() => {
        // A StrictMode remount re-runs setup right after cleanup; cancel the
        // pending context teardown so we keep the canvas's existing context.
        if (loseTimerRef.current !== null) {
            clearTimeout(loseTimerRef.current);
            loseTimerRef.current = null;
        }
        const canvas = canvasRef.current;
        if (!canvas) return;
        const options: { backgroundColor: [number, number, number, number]; transparent: boolean } = {
            backgroundColor: [0, 0, 0, 0],
            transparent: true,
        };
        const wglp = new WebglPlot(canvas, options as ConstructorParameters<typeof WebglPlot>[1]);
        wglpRef.current = wglp;

        return () => {
            plotRef.current?.cleanup();
            plotRef.current = null;
            wglpRef.current = null;
            // Defer so a synchronous StrictMode remount can cancel it (above).
            // A real unmount has no remount, so this fires and frees the context.
            loseTimerRef.current = window.setTimeout(() => {
                wglp.gl.getExtension("WEBGL_lose_context")?.loseContext();
                loseTimerRef.current = null;
            }, 0);
        };
    }, []);

    // Upload series points whenever the data (or thickness/dpr) changes.
    useLayoutEffect(() => {
        const wglp = wglpRef.current;
        if (!wglp) return;

        plotRef.current?.cleanup();

        let xRef = Infinity;
        for (const s of series) if (s.points.length) xRef = Math.min(xRef, s.points[0].x);
        xRefRef.current = isFinite(xRef) ? xRef : 0;

        const plot = wglp.newThinLinePlotter(Math.max(1, series.length));
        plotRef.current = plot;

        const configs: LineConfig[] = series.map(s => {
            const xy = new Float32Array(s.points.length * 2);
            for (let i = 0; i < s.points.length; i++) {
                xy[2 * i] = s.points[i].x - xRefRef.current;
                xy[2 * i + 1] = s.points[i].y;
            }
            return {
                points: xy,
                color: hexToRgba(s.color),
                thickness: strokeWidth * dpr,
                scale: [1, 1],
                offset: [0, 0],
                enabled: s.points.length > 1,
            };
        });
        plot.initLines(configs);
        redraw();
    }, [series, strokeWidth, dpr, redraw]);

    // Resize the drawing buffer / viewport, then redraw.
    useLayoutEffect(() => {
        const canvas = canvasRef.current;
        const wglp = wglpRef.current;
        if (!canvas || !wglp) return;
        canvas.width = Math.max(1, Math.round(width * dpr));
        canvas.height = Math.max(1, Math.round(height * dpr));
        wglp.gl.viewport(0, 0, canvas.width, canvas.height);
        redraw();
    }, [width, height, dpr, redraw]);

    // Zoom/pan: scales change every tick -> just re-apply the transform.
    useLayoutEffect(() => {
        redraw();
    }, [xScale, yScale, redraw]);

    return (
        <foreignObject x={0} y={0} width={width} height={height} style={{ overflow: "hidden" }}>
            <canvas
                ref={canvasRef}
                style={{
                    width: `${width}px`,
                    height: `${height}px`,
                    display: "block",
                    pointerEvents: "none",
                }}
            />
        </foreignObject>
    );
});
