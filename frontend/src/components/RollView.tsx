import { useRef, useState, useEffect } from "react";
import { transformMediaUrl } from "@/lib/format";
import type { RollDetails, RollStats } from "@/lib/roll";

export default function RollView({ roll, stats }: { roll: RollDetails, stats?: RollStats }) {
    const videoUrl = transformMediaUrl(
        roll.roll_files.find((file) => file.type === 'video_preview')?.uri ??
        roll.roll_files.find((file) => file.type === 'video_preview_c')?.uri
    );
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

    useEffect(() => {
        return () => {
            if (frameCallbackIdRef.current !== null && videoRef.current) {
                const videoElement = videoRef.current as any;
                if (videoElement.cancelVideoFrameCallback) {
                    videoElement.cancelVideoFrameCallback(frameCallbackIdRef.current);
                }
            }
        };
    }, []);

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

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);


    const formatVidTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        const frames = Math.floor((seconds % 1) * fps);
        return `${mins}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
    };

    const formatStatTime = (ms: number) => {
        const totalSeconds = ms / 1000;
        const mins = Math.floor(totalSeconds / 60);
        const secs = (totalSeconds - (mins * 60)).toFixed(1);
        return `${mins}:${secs.padStart(4, '0')}`;
    }

    useEffect(() => {
        if (videoRef.current && stats?.video_roll_start_ms !== undefined) {
            videoRef.current.currentTime = stats.video_roll_start_ms / 1000;
        }
    }, [videoRef.current, stats?.video_roll_start_ms]);

    return (
        <>
            <div className="flex gap-4">
                {
                    videoUrl ? <video
                        ref={videoRef}
                        className="w-1/2 cursor-pointer"
                        autoPlay
                        muted
                        src={videoUrl}
                        onLoadedMetadata={handleLoadedMetadata}
                        onClick={handleVideoClick}
                    >
                        Your browser does not support the video tag.
                    </video> : <div className="w-1/2 flex items-center justify-center bg-gray-200 text-gray-500">No video available</div>
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
                                const rollHill = roll.roll_hills[hillNumber - 1];
                                const time = stats?.[`hill${hillNumber}_time_ms` as keyof RollStats];
                                return (
                                    <tr key={hillNumber} className="border-b last:border-b-0">
                                        <td className="py-2 w-16 border-l border-r px-2">{hillNumber}</td>
                                        <td className="py-2 border-r px-2">{rollHill?.pusher?.name || ''}</td>
                                        <td className="py-2 w-24 border-r px-2"> {time !== undefined ? (time / 1000).toFixed(1) : '---'} </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    <div className="mt-4 flex text-center text-lg">
                        <div className="flex-1">
                            <span className="font-semibold">Freeroll Time: </span>
                            <span>{stats?.freeroll_time_ms !== undefined ? (stats?.freeroll_time_ms / 1000).toFixed(1) : '---'}</span>
                        </div>
                        <div className="flex-1">
                            <span className="font-semibold">Course Time: </span>
                            <span>{stats?.course_time_ms !== undefined ? formatStatTime(stats.course_time_ms) : '---'}</span>
                        </div>
                    </div>

                </div>
            </div>

            <div className="mt-8 grid grid-cols-3 gap-4 text-center">
                <div className="space-y-2">
                    <div>
                        <span className="font-semibold block">Max Speed</span>
                        <span>{stats?.max_speed !== undefined ? stats.max_speed.toFixed(2) : '---'} m/s</span>
                    </div>
                    <div>
                        <span className="font-semibold block">Max Energy</span>
                        <span>{stats?.max_energy !== undefined ? stats.max_energy.toFixed(2) : '---'} J/kg</span>
                    </div>
                </div>
                <div className="space-y-2">
                    <div>
                        <span className="font-semibold block">Pickup Speed</span>
                        <span>{stats?.pickup_speed !== undefined ? stats.pickup_speed.toFixed(2) : '---'} m/s</span>
                    </div>
                    <div>
                        <span className="font-semibold block">Rollup Height</span>
                        <span>{stats?.rollup_height !== undefined ? stats.rollup_height.toFixed(2) : '---'} m</span>
                    </div>
                </div>
                <div>
                    <span className="font-semibold block">Freeroll Energy Loss</span>
                    <span>{stats?.freeroll_energy_loss !== undefined ? stats.freeroll_energy_loss.toFixed(2) : '---'} J/kg</span>
                </div>
            </div>

            <div className="mt-auto bg-white border border-gray-300 rounded-lg shadow-lg p-4">
                <div className="flex items-start gap-6">
                    <div className="flex-1">
                        <div
                            ref={timelineRef}
                            className="relative h-8 bg-gray-800 rounded cursor-pointer"
                            onClick={handleTimelineClick}
                        >
                            <div
                                className="absolute h-full bg-yellow-500"
                                style={{ width: `${(currentTime / duration) * 100}%` }}
                            />
                            <div
                                className="absolute top-0 bottom-0 w-3 bg-gray-400 cursor-grab active:cursor-grabbing rounded-sm"
                                style={{ left: `${(currentTime / duration) * 100}%`, transform: 'translateX(-50%)' }}
                                onMouseDown={handlePlayheadMouseDown}
                            />
                        </div>
                        <div className="flex justify-between text-sm text-gray-600 mt-1">
                            <span>{formatVidTime(currentTime)}</span>
                            <span>{formatVidTime(duration)}</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={togglePlay}
                            className="w-8 h-8 flex items-center justify-center bg-gray-200 hover:bg-gray-300 rounded"
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
                            className="w-8 h-8 flex items-center justify-center bg-gray-200 hover:bg-gray-300 rounded"
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
