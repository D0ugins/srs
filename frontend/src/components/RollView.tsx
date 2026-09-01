import { useRef, useState, useEffect } from "react";
import { transformMediaUrl } from "@/lib/format";
import type { RollDetails, RollStats, StatKey, StatQuantity } from "@/lib/roll";

const VIDEO_CHOICES = ['video_preview', 'edited_vid', 'video_preview_c', 'edited_vid_c', 'follow_car_vid', 'misc_vid'];
const VIDEO_LABELS: Record<string, string> = {
    video_preview: 'Preview',
    edited_vid: 'Edited',
    video_preview_c: 'Preview c',
    edited_vid_c: 'Edited c',
    follow_car_vid: 'Follow car',
    misc_vid: 'Misc',
};

const HILL_TIME_KEYS: Array<StatKey> = [
    'time.hill_1-hill_2',
    'time.hill_2-crosswalk',
    'time.hill_3-hill_4',
    'time.hill_4-hill_5',
    'time.hill_5-finish_line',
];

const formatStatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = (seconds - (mins * 60)).toFixed(1);
    return `${mins}:${secs.padStart(4, '0')}`;
};

function TimeStat({ q, mmss }: { q?: StatQuantity, mmss?: boolean }) {
    if (q?.status !== 'ok' || q.value === null) return <span title={q?.note ?? q?.status}>---</span>;
    return <span>{mmss ? formatStatTime(q.value) : q.value.toFixed(1)}</span>;
}

function SdStat({ q }: { q?: StatQuantity }) {
    if (q?.status !== 'ok' || q.value === null) return <span title={q?.note ?? q?.status}>---</span>;
    return <span>{q.value.toFixed(2)}{q.sd !== null ? ` ± ${(2 * q.sd).toFixed(2)}` : ''} {q.unit}</span>;
}

export default function RollView({ roll, stats }: { roll: RollDetails, stats?: RollStats }) {
    const availableVideos = VIDEO_CHOICES
        .map(type => roll.roll_files.find(file => file.type === type))
        .filter(f => f !== undefined);
    const [videoType, setVideoType] = useState(availableVideos[0]?.type);
    const video = availableVideos.find(f => f.type === videoType) ?? availableVideos[0];

    const q = (key: StatKey) => stats?.quantities?.[key];

    const videoUrl = transformMediaUrl(video?.uri);
    const videoRef = useRef<HTMLVideoElement>(null);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isPlaying, setIsPlaying] = useState(true);
    const [isMuted, setIsMuted] = useState(true);
    const fps = 30; // TODO: store actual fps in db
    const frameCallbackIdRef = useRef<number | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [wasPlaying, setWasPlaying] = useState(false);
    const timelineRef = useRef<HTMLDivElement>(null);

    const updateFrame = () => {
        if (videoRef.current) {
            setCurrentTime(videoRef.current.currentTime);
            const videoElement = videoRef.current as any;
            if (videoElement.requestVideoFrameCallback) {
                frameCallbackIdRef.current = videoElement.requestVideoFrameCallback(updateFrame);
            }
        }
    };

    const handleLoadedMetadata = () => {
        if (videoRef.current) {
            setDuration(videoRef.current.duration);
            const videoElement = videoRef.current as any;
            if (videoElement.requestVideoFrameCallback) {
                frameCallbackIdRef.current = videoElement.requestVideoFrameCallback(updateFrame);
            }
        }
    };

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!videoRef.current) return;

            const frameTime = 1 / fps;

            if (e.key === 'ArrowRight') {
                e.preventDefault();
                videoRef.current.currentTime = Math.min(
                    videoRef.current.currentTime + 5,
                    duration
                );
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                videoRef.current.currentTime = Math.max(
                    videoRef.current.currentTime - 5,
                    0
                );
            } else if (e.key === '.') {
                e.preventDefault();
                videoRef.current.currentTime = Math.min(
                    videoRef.current.currentTime + frameTime,
                    duration
                );
            } else if (e.key === ',') {
                e.preventDefault();
                videoRef.current.currentTime = Math.max(
                    videoRef.current.currentTime - frameTime,
                    0
                );
            } else if (e.key === ' ') {
                e.preventDefault();
                if (videoRef.current.paused) {
                    videoRef.current.play();
                } else {
                    videoRef.current.pause();
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [fps, duration]);

    const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (videoRef.current && !isDragging) {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const percentage = x / rect.width;
            videoRef.current.currentTime = percentage * duration;
        }
    };

    const handlePlayheadMouseDown = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsDragging(true);
        if (videoRef.current) {
            setWasPlaying(!videoRef.current.paused);
            videoRef.current.pause();
        }
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isDragging && timelineRef.current && videoRef.current) {
                const rect = timelineRef.current.getBoundingClientRect();
                const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
                const percentage = x / rect.width;
                videoRef.current.currentTime = percentage * duration;
            }
        };

        const handleMouseUp = () => {
            if (isDragging) {
                setIsDragging(false);
                if (wasPlaying && videoRef.current) {
                    videoRef.current.play();
                }
            }
        };

        if (isDragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, duration, wasPlaying]);

    const handleVideoClick = () => {
        if (videoRef.current) {
            if (videoRef.current.paused) {
                videoRef.current.play();
            } else {
                videoRef.current.pause();
            }
        }
    };

    const togglePlay = () => {
        if (videoRef.current) {
            if (videoRef.current.paused) {
                videoRef.current.play();
                setIsPlaying(true);
            } else {
                videoRef.current.pause();
                setIsPlaying(false);
            }
        }
    };

    const toggleMute = () => {
        if (videoRef.current) {
            videoRef.current.muted = !videoRef.current.muted;
            setIsMuted(videoRef.current.muted);
        }
    };


    const formatVidTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        const frames = Math.floor((seconds % 1) * fps);
        return `${mins}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
    };

    useEffect(() => {
        if (videoRef.current) {
            if (stats?.video_roll_start_ms !== undefined) {
                videoRef.current.currentTime = stats.video_roll_start_ms / 1000;
            } else {
                videoRef.current.currentTime = (video?.local_start_ms ?? 0) / 1000;
            }
        }
    }, [videoRef.current, stats?.video_roll_start_ms]);

    useEffect(() => {
        const videoElement = videoRef.current;
        // Needed since react dev server calls setup/teardown twice on mount
        if (videoElement) videoElement.src = videoUrl || '';

        return () => {
            if (!videoElement) return;

            videoElement.pause();
            if (frameCallbackIdRef.current !== null) {
                videoElement.cancelVideoFrameCallback(frameCallbackIdRef.current);
                frameCallbackIdRef.current = null;
            }

            videoElement.removeAttribute('src');
            videoElement.load();
        };
    }, [videoUrl]);

    return (
        <>
            <div className="flex gap-4 max-h-[40%]">
                {
                    videoUrl ? <div className="relative w-1/2 overflow-hidden">
                        <video
                            ref={videoRef}
                            className="w-full h-full object-contain cursor-pointer"
                            autoPlay
                            muted
                            src={videoUrl}
                            key={videoUrl}
                            onLoadedMetadata={handleLoadedMetadata}
                            onClick={handleVideoClick}
                        >
                            Your browser does not support the video tag.
                        </video>
                        {availableVideos.length > 1 && (
                            <select
                                value={video?.type}
                                onChange={(e) => setVideoType(e.target.value)}
                                className="absolute top-2 right-2 bg-black/60 text-white text-sm rounded px-1 py-0.5 cursor-pointer"
                            >
                                {availableVideos.map(f => (
                                    <option key={f.type} value={f.type} className="bg-neutral-800 text-white">
                                        {VIDEO_LABELS[f.type] ?? f.type}
                                    </option>
                                ))}
                            </select>
                        )}
                    </div> : <div className="w-1/2 flex items-center justify-center bg-neutral-200 text-neutral-500">No video available</div>
                }

                <div className="flex-1">
                    <table className="w-full border-collapse border-t border-b">
                        <thead>
                            <tr className="border-b">
                                <th className="text-left py-2 w-16 border-l border-r px-2 font-normal">Hill</th>
                                <th className="text-left py-2 border-r px-2 font-normal">Pusher</th>
                                <th className="text-left py-2 border-r px-2 font-normal">Time</th>
                            </tr>
                        </thead>
                        <tbody>
                            {[1, 2, 3, 4, 5].map((hillNumber) => {
                                const rollHill = roll.roll_hills.find(rh => rh.hill_number === hillNumber);
                                return (
                                    <tr key={hillNumber} className="border-b last:border-b-0">
                                        <td className="py-2 w-16 border-l border-r px-2">{hillNumber}</td>
                                        <td className="py-2 border-r px-2">{rollHill?.pusher?.name || ''}</td>
                                        <td className="py-2 w-24 border-r px-2"> <TimeStat q={q(HILL_TIME_KEYS[hillNumber - 1])} /> </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    <div className="mt-4 flex text-center text-lg">
                        <div className="flex-1">
                            <span className="font-semibold">Freeroll Time: </span>
                            <TimeStat q={q('time.crosswalk-hill_3')} />
                            <span className="text-sm text-neutral-600"> (<TimeStat q={q('time.crosswalk-stop_sign')} />/<TimeStat q={q('time.stop_sign-hill_3')} />)
                            </span>
                        </div>
                        <div className="flex-1">
                            <span className="font-semibold">Course Time: </span>
                            <TimeStat q={q('time.hill_1-finish_line')} mmss />
                        </div>
                    </div>

                </div>
            </div>

            <div className="mt-8 grid grid-cols-3 gap-4 text-center">
                <div className="space-y-2">
                    <div>
                        <span className="font-semibold block">Crosswalk Speed</span>
                        <SdStat q={q('speed.crosswalk')} />
                    </div>
                    <div>
                        <span className="font-semibold block">Chute Speed</span>
                        <SdStat q={q('speed.chute_start')} />
                    </div>
                </div>
                <div className="space-y-2">
                    <div>
                        <span className="font-semibold block">To Chute Energy Loss</span>
                        <SdStat q={q('eloss.crosswalk-chute_start')} />
                    </div>
                    <div>
                        <span className="font-semibold block">Chute Energy Loss</span>
                        <SdStat q={q('eloss.chute_start-hill_3')} />
                    </div>
                </div>
                <div className="space-y-2">
                    <div>
                        <span className="font-semibold block">Hill 3 pickup</span>
                        <SdStat q={q('pickup.arc')} />
                    </div>
                    <div>
                        <span className="font-semibold block">Pickup speed</span>
                        <SdStat q={q('pickup.speed')} />
                    </div>
                </div>
            </div>

            {(roll.driver_notes || roll.mech_notes || roll.pusher_notes) && (
                <div className="mt-6 space-y-2">
                    {roll.driver_notes && (
                        <div>
                            <span className="font-semibold">Driver Notes: </span>
                            <span>{roll.driver_notes}</span>
                        </div>
                    )}
                    {roll.mech_notes && (
                        <div>
                            <span className="font-semibold">Mech Notes: </span>
                            <span>{roll.mech_notes.replaceAll('\n', ' // ')}</span>
                        </div>
                    )}
                    {roll.pusher_notes && (
                        <div>
                            <span className="font-semibold">Pusher Notes: </span>
                            <span>{roll.pusher_notes}</span>
                        </div>
                    )}
                </div>
            )}

            <div className="mt-auto bg-white border border-gray-300 rounded-lg shadow-lg p-4">
                <div className="flex items-start gap-6">
                    <div className="flex-1">
                        <div
                            ref={timelineRef}
                            className="relative h-8 bg-black rounded cursor-pointer"
                            onClick={handleTimelineClick}
                        >
                            <div
                                className="absolute h-full bg-yellow-500"
                                style={{ width: `${(currentTime / duration) * 100}%` }}
                            />
                            <div
                                className="absolute top-0 bottom-0 w-3 bg-neutral-400 cursor-grab active:cursor-grabbing rounded-sm"
                                style={{ left: `${(currentTime / duration) * 100}%`, transform: 'translateX(-50%)' }}
                                onMouseDown={handlePlayheadMouseDown}
                            />
                        </div>
                        <div className="flex justify-between text-sm text-neutral-600 mt-1">
                            <span>{formatVidTime(currentTime)}</span>
                            <span>{formatVidTime(duration)}</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={togglePlay}
                            className="w-8 h-8 flex items-center justify-center bg-neutral-200 hover:bg-neutral-300 rounded"
                            title={isPlaying ? "Pause" : "Play"}
                        >
                            {isPlaying ? (
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-6">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" />
                                </svg>
                            ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-6">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
                                </svg>
                            )}
                        </button>
                        <button
                            onClick={toggleMute}
                            className="w-8 h-8 flex items-center justify-center bg-neutral-200 hover:bg-neutral-300 rounded"
                            title={isMuted ? "Unmute" : "Mute"}
                        >
                            {isMuted ? (
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-6">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" />
                                </svg>

                            ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-6">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 9.75 19.5 12m0 0 2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6 4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" />
                                </svg>

                            )}
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}
