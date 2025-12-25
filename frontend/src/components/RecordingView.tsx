import { useRef, useState, useEffect } from "react";
import { transformMediaUrl } from "@/lib/format";
import type { RollDetails } from "@/lib/roll";

export default function RecordingView({ roll }: { roll: RollDetails }) {
    const videoUrl = transformMediaUrl(
        roll.roll_files.find((file) => file.type === 'video_preview')?.uri
    );
    const videoRef = useRef<HTMLVideoElement>(null);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [fps, setFps] = useState(30);
    const frameCallbackIdRef = useRef<number | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [wasPlaying, setWasPlaying] = useState(false);
    const timelineRef = useRef<HTMLDivElement>(null);

    // ...existing code (updateFrame, handleLoadedMetadata, useEffects, handlers, formatTime)...

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
                setFps(fps);
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

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        const frames = Math.floor((seconds % 1) * fps);
        return `${mins}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
    };

    const handleVideoClick = () => {
        if (videoRef.current) {
            if (videoRef.current.paused) {
                videoRef.current.play();
            } else {
                videoRef.current.pause();
            }
        }
    };

    return (
        <>
            <div className="flex gap-4">
                <video
                    ref={videoRef}
                    className="w-1/2 cursor-pointer"
                    autoPlay
                    src={videoUrl}
                    onLoadedMetadata={handleLoadedMetadata}
                    onClick={handleVideoClick}
                >
                    Your browser does not support the video tag.
                </video>

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
                                return (
                                    <tr key={hillNumber} className="border-b last:border-b-0">
                                        <td className="py-2 w-16 border-l border-r px-2">{hillNumber}</td>
                                        <td className="py-2 border-r px-2">{rollHill?.pusher?.name || ''}</td>
                                        <td className="py-2 w-24 border-r px-2">---</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="mt-auto bg-white border border-gray-300 rounded-lg shadow-lg p-4">
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
                    <span>{formatTime(currentTime)}</span>
                    <span>{fps} fps</span>
                    <span>{formatTime(duration)}</span>
                </div>
            </div>
        </>
    );
}
