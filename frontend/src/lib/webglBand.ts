// Filled uncertainty bands for GraphLine. Each band is drawn as TRIANGLE_STRIPs
// with the upper/lower edges interleaved, so concave shapes render correctly
// (a TRIANGLE_FAN would not). Geometry is uploaded once in data coordinates and
// zoom/pan only rewrites the transform uniform, matching the line renderer.

export interface BandPoint {
    x: number;
    lo: number;
    hi: number;
}

export interface BandConfig {
    points: Array<BandPoint>;
    color: [number, number, number, number];
}

interface DrawRange {
    start: number;
    count: number;
    color: [number, number, number, number];
}

const VERTEX_SRC = `#version 300 es
layout(location = 0) in vec2 a_position;
uniform vec2 u_scale;
uniform vec2 u_offset;
void main() {
    gl_Position = vec4(a_position * u_scale + u_offset, 0.0, 1.0);
}`;

const FRAGMENT_SRC = `#version 300 es
precision mediump float;
uniform vec4 u_color;
out vec4 outColor;
void main() {
    outColor = u_color;
}`;

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram | null {
    const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SRC);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC);
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        gl.deleteProgram(prog);
        return null;
    }
    return prog;
}

export class WebglBandPlot {
    private gl: WebGL2RenderingContext;
    private prog: WebGLProgram | null;
    private buffer: WebGLBuffer | null = null;
    private ranges: Array<DrawRange> = [];
    private uScale: WebGLUniformLocation | null = null;
    private uOffset: WebGLUniformLocation | null = null;
    private uColor: WebGLUniformLocation | null = null;
    private scale: [number, number] = [1, 1];
    private offset: [number, number] = [0, 0];

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
        this.prog = createProgram(gl);
        if (this.prog) {
            this.uScale = gl.getUniformLocation(this.prog, "u_scale");
            this.uOffset = gl.getUniformLocation(this.prog, "u_offset");
            this.uColor = gl.getUniformLocation(this.prog, "u_color");
        }
    }

    // X is stored relative to xRef for float32 precision, matching GraphLine.
    // A non-finite sample ends the current strip so gaps aren't bridged.
    initBands(bands: Array<BandConfig>, xRef: number) {
        const gl = this.gl;
        this.ranges = [];
        if (this.buffer) {
            gl.deleteBuffer(this.buffer);
            this.buffer = null;
        }

        let capacity = 0;
        for (const b of bands) capacity += b.points.length * 2;
        if (capacity === 0) return;

        const xy = new Float32Array(capacity * 2);
        let v = 0;
        for (const b of bands) {
            let runStart = v;
            for (const p of b.points) {
                if (!Number.isFinite(p.x) || !Number.isFinite(p.lo) || !Number.isFinite(p.hi)) {
                    if (v - runStart >= 4) this.ranges.push({ start: runStart, count: v - runStart, color: b.color });
                    runStart = v;
                    continue;
                }
                xy[2 * v] = p.x - xRef;
                xy[2 * v + 1] = p.hi;
                v++;
                xy[2 * v] = p.x - xRef;
                xy[2 * v + 1] = p.lo;
                v++;
            }
            if (v - runStart >= 4) this.ranges.push({ start: runStart, count: v - runStart, color: b.color });
        }
        if (this.ranges.length === 0) return;

        this.buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
        gl.bufferData(gl.ARRAY_BUFFER, xy.subarray(0, v * 2), gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }

    setGlobalTransform(scale: [number, number], offset: [number, number]) {
        this.scale = scale;
        this.offset = offset;
    }

    draw() {
        const gl = this.gl;
        if (!this.prog || !this.buffer || this.ranges.length === 0) return;

        gl.useProgram(this.prog);
        gl.uniform2f(this.uScale, this.scale[0], this.scale[1]);
        gl.uniform2f(this.uOffset, this.offset[0], this.offset[1]);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(0);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        for (const r of this.ranges) {
            gl.uniform4f(this.uColor, r.color[0], r.color[1], r.color[2], r.color[3]);
            gl.drawArrays(gl.TRIANGLE_STRIP, r.start, r.count);
        }

        // Same state the line plotters leave behind, so they are unaffected.
        gl.disableVertexAttribArray(0);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        gl.useProgram(null);
    }

    cleanup() {
        const gl = this.gl;
        if (this.prog) {
            gl.deleteProgram(this.prog);
            this.prog = null;
        }
        if (this.buffer) {
            gl.deleteBuffer(this.buffer);
            this.buffer = null;
        }
        this.ranges = [];
    }
}
