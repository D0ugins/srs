import { bisector } from "d3-array";
import type { Position } from "@/components/RollMap";

// Position along the primary roll's path, in metres, sampled at each roll's own gps timestamps.
// arc is non-decreasing, so it inverts back to a time.
export interface TrackAxis {
    timestamp: Array<number>;
    arc: Array<number>;
}

const M_PER_DEG = 111320;
const DEADBAND = 0.1;       // steps shorter than this are gps jitter, not travel
const BACK_M = 40;          // projection searches this far behind the previous match...
const AHEAD_M = 400;        // ...and this far ahead, so the loop's closure can't capture a sample
const SEED_FRACTION = 0.25; // the first sample is matched within this fraction of the path
const MIN_STEP = 0.2;       // an end sample advancing less than this draws as a vertical line
const MIN_POINTS = 2;

const bisectNumber = bisector<number, number>(d => d).left;

// Linear interpolation over an ascending x. Outside the range: the end value, or NaN when
// clamping is off (the caller wants "not covered" to be visible).
export function interp(xs: Array<number>, ys: Array<number>, x: number, clamp = true): number {
    if (xs.length === 0) return NaN;
    if (x <= xs[0]) return x < xs[0] && !clamp ? NaN : ys[0];
    if (x >= xs[xs.length - 1]) return x > xs[xs.length - 1] && !clamp ? NaN : ys[ys.length - 1];
    const i = bisectNumber(xs, x);
    const x0 = xs[i - 1], x1 = xs[i];
    const f = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
    return ys[i - 1] + f * (ys[i] - ys[i - 1]);
}

export const timeToArc = (a: TrackAxis, t: number, clamp = true) => interp(a.timestamp, a.arc, t, clamp);
export const arcToTime = (a: TrackAxis, s: number, clamp = true) => interp(a.arc, a.timestamp, s, clamp);

type XY = Array<[number, number]>;

function toXY(positions: Array<Position>, lat0: number): XY {
    const k = Math.cos((lat0 * Math.PI) / 180) * M_PER_DEG;
    return positions.map(p => [p.long * k, p.lat * M_PER_DEG]);
}

function cumulativeArc(xy: XY): Array<number> {
    const arc = new Array<number>(xy.length).fill(0);
    for (let i = 1; i < xy.length; i++) {
        const d = Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]);
        arc[i] = arc[i - 1] + (d < DEADBAND ? 0 : d);
    }
    return arc;
}

// Arc of the closest point on segments [j0, j1) of the reference path. `pinned` marks a match
// that landed on the path's outer end, i.e. the sample is past where the reference path goes.
function nearestArc(p: [number, number], base: XY, baseArc: Array<number>, j0: number, j1: number) {
    let best = Infinity, bestArc = baseArc[j0], bestJ = j0, bestT = 0;
    for (let j = j0; j < j1; j++) {
        const ax = base[j][0], ay = base[j][1];
        const bx = base[j + 1][0] - ax, by = base[j + 1][1] - ay;
        const len2 = bx * bx + by * by;
        const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p[0] - ax) * bx + (p[1] - ay) * by) / len2));
        const dx = p[0] - (ax + t * bx), dy = p[1] - (ay + t * by);
        const d2 = dx * dx + dy * dy;
        if (d2 < best) { best = d2; bestArc = baseArc[j] + t * (baseArc[j + 1] - baseArc[j]); bestJ = j; bestT = t; }
    }
    const pinned = (bestJ === 0 && bestT === 0) || (bestJ === base.length - 2 && bestT === 1);
    return { arc: bestArc, pinned };
}

// Walk outwards from a seed sample, keeping the match inside a window around the previous one:
// the course closes on itself, so an unwindowed search would match the finish to the start.
function projectPath(xy: XY, base: XY, baseArc: Array<number>, seed: number): Array<number> {
    const nSeg = base.length - 1;
    const window = (lo: number, hi: number): [number, number] => [
        Math.min(Math.max(0, bisectNumber(baseArc, lo) - 1), nSeg - 1),
        Math.min(nSeg, Math.max(1, bisectNumber(baseArc, hi) + 1)),
    ];

    const arc = new Array<number>(xy.length).fill(NaN);
    const [s0, s1] = window(0, baseArc[nSeg] * SEED_FRACTION);
    let prev = nearestArc(xy[seed], base, baseArc, s0, s1).arc;
    arc[seed] = prev;
    for (let k = seed + 1; k < xy.length; k++) {
        const [j0, j1] = window(prev - BACK_M, prev + AHEAD_M);
        const { arc: a, pinned } = nearestArc(xy[k], base, baseArc, j0, j1);
        if (pinned) continue;                       // past the reference path: no position for it
        prev = arc[k] = Math.max(prev, a);
    }
    prev = arc[seed];
    for (let k = seed - 1; k >= 0; k--) {
        const [j0, j1] = window(prev - AHEAD_M, prev + BACK_M);
        const { arc: a, pinned } = nearestArc(xy[k], base, baseArc, j0, j1);
        if (pinned) continue;
        prev = arc[k] = Math.min(prev, a);
    }
    return arc;
}

// Samples that share one position - the buggy standing still or being nudged into place at the
// line, or running past where the reference path starts or ends - would draw as a vertical line,
// so the ends are cut back to where the roll is actually travelling.
function trimToTravel(timestamp: Array<number>, arc: Array<number>): TrackAxis | undefined {
    // The longest run the projection could place at all, then its ends.
    let lo = 0, hi = -1;
    for (let i = 0; i < arc.length;) {
        if (!isFinite(arc[i])) { i++; continue; }
        let j = i;
        while (j + 1 < arc.length && isFinite(arc[j + 1])) j++;
        if (j - i > hi - lo) { lo = i; hi = j; }
        i = j + 1;
    }
    if (hi < lo) return undefined;
    while (lo < hi && arc[lo + 1] - arc[lo] < MIN_STEP) lo++;
    while (hi > lo && arc[hi] - arc[hi - 1] < MIN_STEP) hi--;
    if (hi - lo < MIN_POINTS - 1) return undefined;
    return { timestamp: timestamp.slice(lo, hi + 1), arc: arc.slice(lo, hi + 1) };
}

// Per-roll time -> position axes. Index 0 is the primary: its own travelled distance defines the
// axis (0 at its roll start) and every other roll is projected onto its path.
export function buildAxes(
    rolls: Array<{ positions?: Array<Position>; rollStart?: number }>,
): Array<TrackAxis | undefined> {
    const primary = rolls[0];
    if (rolls.length === 0 || !primary.positions || primary.positions.length < MIN_POINTS) {
        return rolls.map(() => undefined);
    }

    const lat0 = primary.positions[0].lat;
    const base = toXY(primary.positions, lat0);
    const baseArc = cumulativeArc(base);
    const baseTime = primary.positions.map(p => p.timestamp);
    const origin = primary.rollStart != null ? interp(baseTime, baseArc, primary.rollStart) : 0;

    return rolls.map((r, i) => {
        if (!r.positions || r.positions.length < MIN_POINTS) return undefined;
        const timestamp = r.positions.map(p => p.timestamp);
        if (i === 0) return trimToTravel(timestamp, baseArc.map(a => a - origin));
        const seed = r.rollStart != null ? Math.min(bisectNumber(timestamp, r.rollStart), timestamp.length - 1) : 0;
        const arc = projectPath(toXY(r.positions, lat0), base, baseArc, seed);
        return trimToTravel(timestamp, arc.map(a => a - origin));
    });
}
