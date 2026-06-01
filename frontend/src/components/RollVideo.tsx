import React, { useEffect, useRef } from "react";
import type { RollDetails } from "@/lib/roll";
import { transformMediaUrl } from "@/lib/format";

export interface RollVideoProps {
    roll: RollDetails;
    videoRef: React.RefObject<HTMLVideoElement | null>;
    setCurrentTime: (time: number) => void;
    setPlaying: React.Dispatch<React.SetStateAction<boolean>>;
    duration: number;
    setDuration: (duration: number) => void;
}

const FPS = 30; // TODO: store actaul fps in db

export default function RollVideo({ roll, videoRef, setCurrentTime, setPlaying, duration, setDuration }: RollVideoProps) {
    const VIDEO_CHOICES = ['video_preview', 'edited_vid', 'video_preview_c', 'edited_vid_c'];
    const video = VIDEO_CHOICES
        .map(type => roll.roll_files.find(file => file.type === type))
        .find(f => f !== undefined);
    const videoUrl = transformMediaUrl(video?.uri);

    const frameCallbackIdRef = useRef<number | null>(null);

    const updateFrame = () => {
        if (!videoRef.current) return;
        setCurrentTime(videoRef.current.currentTime);
        const videoElement = videoRef.current as any;
        if (videoElement.requestVideoFrameCallback) {
            frameCallbackIdRef.current = videoElement.requestVideoFrameCallback(updateFrame);
        }
    };

    const handleLoadedMetadata = () => {
        if (!videoRef.current) return;
        const videoElement = videoRef.current as any;
        setDuration(videoElement.duration);
        videoElement.currentTime = (video?.local_start_ms ?? 0) / 1000;
        if (videoElement.requestVideoFrameCallback) {
            frameCallbackIdRef.current = videoElement.requestVideoFrameCallback(updateFrame);
        }
    };

    const handleVideoClick = () => {
        if (!videoRef.current) return;
        setPlaying((prev) => !prev);
    };

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!videoRef.current) return;

            const frameTime = 1 / FPS;
            const skipTime = e.shiftKey ? 5 : frameTime;
            if (e.key === 'ArrowRight') {
                e.preventDefault();
                videoRef.current.currentTime = Math.min(
                    videoRef.current.currentTime + skipTime,
                    duration
                );
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                videoRef.current.currentTime = Math.max(
                    videoRef.current.currentTime - skipTime,
                    0
                );
            } else if (e.key === ' ') {
                e.preventDefault();
                setPlaying((prev) => !prev);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [duration]);

    if (!videoUrl) return <div>No video available</div>;
    return <video
        ref={videoRef}
        className="cursor-pointer"
        src={videoUrl}
        onLoadedMetadata={handleLoadedMetadata}
        onClick={handleVideoClick}
        muted
    >
        Your browser does not support the video tag.
    </video>
}