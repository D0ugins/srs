import type { ScaleLinear } from "d3-scale";
import { useRef, useEffect, useState, useCallback, memo } from "react";

interface GraphLineProps {
    data: { x: number; y: number }[];
    xScale: ScaleLinear<number, number, never>;
    yScale: ScaleLinear<number, number, never>;
    width: number;
    height: number;
    stroke?: string;
    strokeWidth?: number;
}

export default memo(({
    data,
    xScale,
    yScale,
    width,
    height,
    stroke = '#7777ffff',
    strokeWidth = 2,
}: GraphLineProps) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const xScaleRef = useRef(xScale);
    xScaleRef.current = xScale;
    const rafIdRef = useRef<number>(0);
    const [snapshotDomain, setSnapshotDomain] = useState<[number, number] | null>(null);
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

    // Draw the line on the canvas using the latest xScale from the ref.
    // Because xScale is read from a ref, this callback is stable across
    // zoom/pan ticks and won't cause the rAF effect to re-fire.
    const drawCanvas = useCallback(() => {
        const scale = xScaleRef.current;
        const canvas = canvasRef.current;
        if (!canvas) return;

        // Clear the CSS transform before drawing so the browser doesn't
        // paint this frame with both correct pixels AND the stale transform.
        canvas.style.transform = '';

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.scale(dpr, dpr);

        if (data.length > 0) {
            ctx.beginPath();
            ctx.strokeStyle = stroke;
            ctx.lineWidth = strokeWidth;
            ctx.lineJoin = 'round';

            ctx.moveTo(scale(data[0].x), yScale(data[0].y));
            for (let i = 1; i < data.length; i++) {
                ctx.lineTo(scale(data[i].x), yScale(data[i].y));
            }

            ctx.stroke();
        }

        ctx.restore();
        setSnapshotDomain(scale.domain() as [number, number]);
    }, [data, yScale, dpr, stroke, strokeWidth]);

    // Immediate draw when data or dimensions change
    useEffect(() => {
        drawCanvas();
    }, [drawCanvas, width, height]);

    // Schedule a real redraw on the next animation frame when xScale changes.
    // The CSS transform covers the 1-frame gap visually.
    useEffect(() => {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = requestAnimationFrame(() => {
            drawCanvas();
        });
        return () => cancelAnimationFrame(rafIdRef.current);
    }, [xScale, drawCanvas]);

    // Compute a CSS transform that maps the snapshot canvas to the current
    // xScale, so the line visually follows the zoom/pan without a redraw.
    let canvasTransform: string | undefined;
    if (snapshotDomain) {
        const [d0Old, d1Old] = snapshotDomain;
        const [d0New, d1New] = xScale.domain() as [number, number];
        const dOld = d1Old - d0Old;
        const dNew = d1New - d0New;

        if (dNew !== 0 && dOld !== 0) {
            const sx = dOld / dNew;
            const tx = -(d0New - d0Old) / dNew * width;

            if (Math.abs(sx - 1) > 1e-9 || Math.abs(tx) > 0.5) {
                canvasTransform = `translateX(${tx}px) scaleX(${sx})`;
            }
        }
    }

    return (
        <foreignObject x={0} y={0} width={width} height={height} style={{ overflow: 'hidden' }}>
            <canvas
                ref={canvasRef}
                width={width * dpr}
                height={height * dpr}
                style={{
                    width: `${width}px`,
                    height: `${height}px`,
                    pointerEvents: 'none',
                    transformOrigin: '0 0',
                    transform: canvasTransform,
                }}
            />
        </foreignObject>
    );
});
