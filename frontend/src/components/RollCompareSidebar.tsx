import { memo, useContext, createContext, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { bisector } from "d3-array";
import RollHeader from "./RollHeader";
import type { GraphData } from "./RollGraph";
import type { CompareRoll, Derived } from "./RollCompare";

const bisectNumber = bisector<number, number>(d => d).left;

function valueAt(series: GraphData | undefined, t: number): number | undefined {
    if (!series || series.timestamp.length === 0) return undefined;
    const i = bisectNumber(series.timestamp, t);
    return series.values[i - 1];
}

// Live playhead time (ms) in master coordinates, updated every frame during playback.
// Kept in context so each tick only re-renders the time/stat leaves below, not the whole
// sidebar (videos, headers, checkboxes don't depend on it).
const TimestampContext = createContext(0);

interface SidebarProps {
    rolls: Array<CompareRoll>;
    derived: Array<Derived>;
    showVideo: Array<boolean>;
    setShowVideo: Dispatch<SetStateAction<Array<boolean>>>;
    offsets: Array<number>;
    videoRefs: React.RefObject<Array<HTMLVideoElement | null>>;
    timestampRef: React.RefObject<number>;
    offsetsRef: React.RefObject<Array<number>>;
    setPlaying: Dispatch<SetStateAction<boolean>>;
    timestamp: number;
}

export default function RollCompareSidebar({ timestamp, ...rest }: SidebarProps) {
    return (
        <TimestampContext.Provider value={timestamp}>
            <SidebarBody {...rest} />
        </TimestampContext.Provider>
    );
}

const SidebarBody = memo(function SidebarBody({
    rolls, derived, showVideo, setShowVideo, offsets, videoRefs, timestampRef, offsetsRef, setPlaying,
}: Omit<SidebarProps, 'timestamp'>) {
    const navigate = useNavigate();
    // rolls are ordered primary-first (index 0 is the primary roll).
    const ids = rolls.map(r => r.roll.id.toString());

    const makePrimary = (id: string) => {
        const rest = ids.filter(x => x !== id);
        navigate({ to: '/rolls/$rollId/compare/$compareIds', params: { rollId: id, compareIds: rest.join(',') } });
    };

    const rollTitle = (roll: CompareRoll['roll']) => {
        const d = roll.roll_date;
        const time = roll.start_time
            ? ` (${new Date(roll.start_time + "Z").toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' })})`
            : '';
        const number = roll.roll_number ? ` #${roll.roll_number}` : '';
        return `${roll.driver.name.toLowerCase()} ${roll.buggy.abbreviation} ${d.month}/${d.day}/${d.year}${number}${time}`;
    };

    const removeRoll = (id: string) => {
        const remaining = ids.filter(x => x !== id);
        if (remaining.length === 0) return;
        const [primary, ...rest] = remaining;
        if (rest.length === 0) navigate({ to: '/rolls/$rollId', params: { rollId: primary } });
        else navigate({ to: '/rolls/$rollId/compare/$compareIds', params: { rollId: primary, compareIds: rest.join(',') } });
    };

    return (
        <div className="flex-[1] flex flex-col min-h-0 min-w-0">
            <div className="shrink-0 mb-2 pb-1 border-b border-gray-300">
                <span className="text-xs text-neutral-600">Time </span>
                <LiveTime />
            </div>
            <div className="overflow-y-auto flex-1 pr-0.5 divide-y divide-gray-300">
                {derived.map((d, i) => (
                    <div key={i} className="py-2 first:pt-0">
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                                {i !== 0 ? (
                                    <button
                                        type="button"
                                        onClick={() => makePrimary(ids[i])}
                                        title="Make primary roll"
                                        className="shrink-0 p-0.5 rounded bg-neutral-100 hover:bg-neutral-200 text-neutral-600 hover:text-neutral-800 cursor-pointer"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="size-4">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                                        </svg>
                                    </button>
                                ) : (
                                    <span className="shrink-0 size-5" />
                                )}
                                <span className="shrink-0 w-3 h-3 rounded-full" style={{ backgroundColor: d.color }} />
                                <Link
                                    to="/rolls/$rollId"
                                    params={{ rollId: ids[i] }}
                                    target="_blank"
                                    className="min-w-0 hover:underline truncate"
                                    title={rollTitle(rolls[i].roll)}
                                >
                                    <RollHeader roll={rolls[i].roll} compact />
                                </Link>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                {d.videoUrl && (
                                    <label className="flex items-center gap-1 text-xs text-neutral-600 cursor-pointer ">
                                        <input
                                            type="checkbox"
                                            checked={showVideo[i] ?? false}
                                            onChange={() => setShowVideo(prev => prev.map((v, j) => j === i ? !v : v))}
                                        />
                                        Video
                                    </label>
                                )}
                                <button
                                    type="button"
                                    onClick={() => removeRoll(ids[i])}
                                    title="Remove from comparison"
                                    className="text-xs px-1.5 py-0.5 rounded text-neutral-500 hover:bg-red-100 hover:text-red-600 cursor-pointer "
                                >
                                    ✕
                                </button>
                            </div>
                        </div>
                        {showVideo[i] && d.videoUrl ? (
                            <div className="relative mt-2">
                                <video
                                    ref={el => { videoRefs.current[i] = el; }}
                                    className="w-full cursor-pointer bg-black"
                                    src={d.videoUrl}
                                    key={d.videoUrl}
                                    muted
                                    playsInline
                                    onLoadedMetadata={e => {
                                        const v = e.currentTarget;
                                        const target = (timestampRef.current - (d.videoStart - (offsetsRef.current[i] ?? 0))) / 1000;
                                        v.currentTime = Math.min(Math.max(0, target), v.duration || 0);
                                    }}
                                    onClick={() => setPlaying(p => !p)}
                                />
                                <div className="absolute inset-x-0 top-0 bg-black/40 px-1 pb-1 pointer-events-none">
                                    <LiveStats d={d} offset={offsets[i] ?? 0} overlay />
                                </div>
                            </div>
                        ) : (
                            <LiveStats d={d} offset={offsets[i] ?? 0} />
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
});

function LiveTime() {
    const timestamp = useContext(TimestampContext);
    return <span className="font-mono text-sm">{(timestamp / 1000).toFixed(3)}s</span>;
}

function LiveStats({ d, offset, overlay = false }: { d: Derived; offset: number; overlay?: boolean }) {
    const timestamp = useContext(TimestampContext);
    const t = timestamp + offset;
    return (
        <div className={`mt-1 grid ${d.a_fwd ? 'grid-cols-4' : 'grid-cols-2'} gap-2 text-center`}>
            <Stat label="Speed (m/s)" value={valueAt(d.speed, t)} overlay={overlay} />
            <Stat label="Energy (J/kg)" value={valueAt(d.energy, t)} overlay={overlay} />
            {d.a_fwd && <Stat label={<>a<sub>fwd</sub> (m/s²)</>} value={valueAt(d.a_fwd, t)} overlay={overlay} />}
            {d.a_lat && <Stat label={<>a<sub>lat</sub> (m/s²)</>} value={valueAt(d.a_lat, t)} overlay={overlay} />}
        </div>
    );
}

function Stat({ label, value, overlay = false }: { label: ReactNode; value?: number; overlay?: boolean }) {
    return <div>
        <div className={`text-[10px] leading-tight ${overlay ? 'text-neutral-200' : 'text-neutral-500'}`}>{label}</div>
        <div className={`font-mono text-sm ${overlay ? 'text-white' : ''}`}>{value !== undefined ? value.toFixed(2) : '---'}</div>
    </div>;
}
