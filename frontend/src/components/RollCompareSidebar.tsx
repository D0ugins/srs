import { memo, useContext, createContext, type Dispatch, type ReactNode, type SetStateAction } from "react";
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
    return (
        <div className="flex-[1] flex flex-col min-h-0 min-w-0">
            <div className="shrink-0 mb-2 pb-1 border-b border-gray-300">
                <span className="text-xs text-neutral-600">Time </span>
                <LiveTime />
            </div>
            <div className="overflow-y-auto flex-1 pr-1 divide-y divide-gray-300">
                {derived.map((d, i) => (
                    <div key={i} className="py-2 first:pt-0">
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                                <span className="shrink-0 w-3 h-3 rounded-full" style={{ backgroundColor: d.color }} />
                                <RollHeader roll={rolls[i].roll} compact />
                            </div>
                            <label className="flex items-center gap-1 text-xs text-neutral-600 cursor-pointer shrink-0">
                                <input
                                    type="checkbox"
                                    checked={showVideo[i] ?? false}
                                    onChange={() => setShowVideo(prev => prev.map((v, j) => j === i ? !v : v))}
                                />
                                Show video
                            </label>
                        </div>
                        {showVideo[i] && (
                            d.videoUrl ? (
                                <video
                                    ref={el => { videoRefs.current[i] = el; }}
                                    className="w-full mt-2 cursor-pointer bg-black"
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
                            ) : (
                                <div className="mt-2 py-4 text-center text-xs text-neutral-500 bg-neutral-100">No video</div>
                            )
                        )}
                        <LiveStats d={d} offset={offsets[i] ?? 0} />
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

function LiveStats({ d, offset }: { d: Derived; offset: number }) {
    const timestamp = useContext(TimestampContext);
    const t = timestamp + offset;
    return (
        <div className="mt-1 grid grid-cols-3 gap-2 text-center">
            <Stat label="Speed (m/s)" value={valueAt(d.speed, t)} />
            <Stat label={<>a<sub>y</sub> (m/s²)</>} value={valueAt(d.centripetal, t)} />
            <Stat label="Energy (J/kg)" value={valueAt(d.energy, t)} />
        </div>
    );
}

function Stat({ label, value }: { label: ReactNode; value?: number }) {
    return <div>
        <div className="text-[10px] text-neutral-500 leading-tight">{label}</div>
        <div className="font-mono text-sm">{value !== undefined ? value.toFixed(2) : '---'}</div>
    </div>;
}
