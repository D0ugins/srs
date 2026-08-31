import type { ScaleLinear } from "d3-scale";
import { useRef, useLayoutEffect, useCallback, memo } from "react";
import { WebglPlot, WebglLinePlot, type LineConfig } from "webgl-plot";
import { WebglBandPlot, type BandPoint } from "@/lib/webglBand";

export interface LineSeries {
    points: { x: number; y: number }[];
    color: string;
}

export interface BandSeries {
    points: BandPoint[];
    color: string;
}

// Stable default so the upload effect doesn't re-run for band-less graphs.
const NO_BANDS: BandSeries[] = [];
// The +-2 sd band is typically only 1-3 px tall (the estimate is precise), and the 2 px line
// covers its middle, so the fill alone is invisible on most rolls; the edges carry it.
const BAND_ALPHA = 0.3;
const BAND_EDGE_ALPHA = 0.55;
// Bands are drawn in a darkened form of the series colour: at these alphas a light hue like
// SRS_GOLD washes out against the panel. Scaled by luminance, so pale colours darken and the
// already-dark ones are left alone.
const BAND_LUMA = 0.45;

function darken(c: [number, number, number, number]): [number, number, number, number] {
    const luma = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const k = luma > BAND_LUMA ? BAND_LUMA / luma : 1;
    return [c[0] * k, c[1] * k, c[2] * k, c[3]];
}

interface GraphLineProps {
    series: LineSeries[];
    bands?: BandSeries[];
    xScale: ScaleLinear<number, number, never>;
    yScale: ScaleLinear<number, number, never>;
    width: number;
    height: number;
    strokeWidth?: number;
    numTicksX?: number;
    numTicksY?: number;
    gridColor?: string;
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
    bands = NO_BANDS,
    xScale,
    yScale,
    width,
    height,
    strokeWidth = 2,
    numTicksX = 9,
    numTicksY = 7,
    gridColor = "#E7E7E7",
}: GraphLineProps) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const wglpRef = useRef<WebglPlot | null>(null);
    const plotRef = useRef<WebglLinePlot | null>(null);
    const bandPlotRef = useRef<WebglBandPlot | null>(null);
    const gridPlotRef = useRef<WebglLinePlot | null>(null);
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
    const numTicksXRef = useRef(numTicksX); numTicksXRef.current = numTicksX;
    const numTicksYRef = useRef(numTicksY); numTicksYRef.current = numTicksY;
    const gridColorRef = useRef(gridColor); gridColorRef.current = gridColor;

    // Rebuild the grid lines at the current d3 tick positions and draw them.
    // Geometry is computed directly in clip space [-1, 1] (identity transform),
    // so the grid tracks zoom/pan and stays aligned with the SVG axis ticks.
    const drawGrid = useCallback((w: number, h: number) => {
        const grid = gridPlotRef.current;
        if (!grid) return;
        const xs = xScaleRef.current;
        const ys = yScaleRef.current;
        const color = hexToRgba(gridColorRef.current);

        const configs: LineConfig[] = [];
        for (const t of xs.ticks(numTicksXRef.current)) {
            const cx = (xs(t) / w) * 2 - 1;
            configs.push({ points: new Float32Array([cx, -1, cx, 1]), color, enabled: true });
        }
        for (const t of ys.ticks(numTicksYRef.current)) {
            const cy = 1 - (ys(t) / h) * 2;
            configs.push({ points: new Float32Array([-1, cy, 1, cy]), color, enabled: true });
        }
        grid.initLines(configs);
        grid.setGlobalTransform([1, 1], [0, 0]);
        grid.draw();
    }, []);

    // Map data coords -> WebGL clip space [-1, 1] so the line aligns with the
    // d3 scales (and thus the SVG axes), then draw grid behind the lines.
    const redraw = useCallback(() => {
        const wglp = wglpRef.current;
        if (!wglp) return;

        const xs = xScaleRef.current;
        const ys = yScaleRef.current;
        const w = widthRef.current;
        const h = heightRef.current;
        if (w <= 0 || h <= 0) return;

        wglp.clear();
        drawGrid(w, h);

        const scaleX = ((xs(1) - xs(0)) * 2) / w;
        const offsetX = (xs(xRefRef.current) * 2) / w - 1;
        const scaleY = (-(ys(1) - ys(0)) * 2) / h;
        const offsetY = 1 - (ys(0) * 2) / h;

        // Bands first so they sit behind their lines.
        const bandPlot = bandPlotRef.current;
        if (bandPlot) {
            bandPlot.setGlobalTransform([scaleX, scaleY], [offsetX, offsetY]);
            bandPlot.draw();
        }

        const plot = plotRef.current;
        if (!plot) return;

        plot.setGlobalTransform([scaleX, scaleY], [offsetX, offsetY]);
        plot.draw();
    }, [drawGrid]);

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
        gridPlotRef.current = wglp.newThinLinePlotter(64);

        return () => {
            plotRef.current?.cleanup();
            plotRef.current = null;
            bandPlotRef.current?.cleanup();
            bandPlotRef.current = null;
            gridPlotRef.current?.cleanup();
            gridPlotRef.current = null;
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
        for (const b of bands) if (b.points.length) xRef = Math.min(xRef, b.points[0].x);
        xRefRef.current = isFinite(xRef) ? xRef : 0;

        const edges: LineConfig[] = [];
        for (const b of bands) {
            for (const key of ["hi", "lo"] as const) {
                const xy = new Float32Array(b.points.length * 2);
                for (let i = 0; i < b.points.length; i++) {
                    xy[2 * i] = b.points[i].x - xRefRef.current;
                    xy[2 * i + 1] = b.points[i][key];
                }
                const color = darken(hexToRgba(b.color));
                color[3] = BAND_EDGE_ALPHA;
                edges.push({
                    points: xy, color, thickness: dpr, scale: [1, 1], offset: [0, 0],
                    enabled: b.points.length > 1,
                });
            }
        }

        const plot = wglp.newThinLinePlotter(Math.max(1, series.length + edges.length));
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
        plot.initLines([...edges, ...configs]);   // edges first so the series line draws over them

        if (bands.length > 0 && !bandPlotRef.current) bandPlotRef.current = new WebglBandPlot(wglp.gl);
        bandPlotRef.current?.initBands(bands.map(b => {
            const color = darken(hexToRgba(b.color));
            color[3] = BAND_ALPHA;
            return { points: b.points, color };
        }), xRefRef.current);

        redraw();
    }, [series, bands, strokeWidth, dpr, redraw]);

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
    // Also redraws when the grid tick counts / color change.
    useLayoutEffect(() => {
        redraw();
    }, [xScale, yScale, numTicksX, numTicksY, gridColor, redraw]);

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
