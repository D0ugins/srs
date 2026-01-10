import { useRef, useState, useEffect } from "react";

export interface VideoTimelineProps {
    videoRef: React.RefObject<HTMLVideoElement | null>;
    currentTime: number;
    duration: number;
    playing: boolean;
    setPlaying: React.Dispatch<React.SetStateAction<boolean>>;
    updateVideoTime: (time: number) => void;
    videoStart?: number;
}

const FPS = 30;

export default function VideoTimeline({
    videoRef,
    currentTime,
    duration,
    playing,
    setPlaying,
    updateVideoTime,
}: VideoTimelineProps) {
    const [isDragging, setIsDragging] = useState(false);
    const [wasPlaying, setWasPlaying] = useState(false);
    const timelineRef = useRef<HTMLDivElement>(null);

    const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!isDragging && timelineRef.current) {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const percentage = x / rect.width;
            const newTime = percentage * duration;
            updateVideoTime(newTime);
        }
    };

    const handlePlayheadMouseDown = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsDragging(true);
        if (videoRef.current) {
            setWasPlaying(!videoRef.current.paused);
            setPlaying(false);
        }
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isDragging && timelineRef.current) {
                const rect = timelineRef.current.getBoundingClientRect();
                const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
                const percentage = x / rect.width;
                const newTime = percentage * duration;
                updateVideoTime(newTime);
            }
        };

        const handleMouseUp = () => {
            if (isDragging) {
                setIsDragging(false);
                if (wasPlaying) {
                    setPlaying(true);
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
    }, [isDragging, duration, wasPlaying, updateVideoTime, setPlaying]);

    const togglePlay = () => {
        setPlaying((prev) => !prev);
    };

    const formatVidTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        const frames = Math.floor((seconds % 1) * FPS);
        return `${mins}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
    };

    const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

    return (
        <div className="flex flex-col justify-start p-4">
            <div className="bg-white border border-gray-300 rounded-lg shadow-lg p-4">
                <div className="flex items-start gap-4">
                    <div className="flex-1">
                        <div
                            ref={timelineRef}
                            className="relative h-8 bg-gray-800 rounded cursor-pointer"
                            onClick={handleTimelineClick}
                        >
                            <div
                                className="absolute h-full bg-yellow-500 rounded-l"
                                style={{ width: `${progress}%` }}
                            />
                            <div
                                className="absolute top-0 bottom-0 w-3 bg-gray-400 cursor-grab active:cursor-grabbing rounded-sm"
                                style={{ left: `${progress}%`, transform: 'translateX(-50%)' }}
                                onMouseDown={handlePlayheadMouseDown}
                            />
                        </div>
                        <div className="flex justify-between text-sm text-gray-600 mt-1">
                            <span>{formatVidTime(currentTime)}</span>
                            <span>{formatVidTime(duration)}</span>
                        </div>
                    </div>
                    <button
                        onClick={togglePlay}
                        className="w-10 h-10 flex items-center justify-center bg-gray-200 hover:bg-gray-300 rounded shrink-0"
                        title={playing ? "Pause" : "Play"}
                    >
                        {playing ? (
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-6">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" />
                            </svg>
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-6">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
                            </svg>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
