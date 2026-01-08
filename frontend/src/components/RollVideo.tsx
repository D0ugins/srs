import React, { useRef } from "react";
import type { RollDetails } from "@/lib/roll";
import { transformMediaUrl } from "@/lib/format";

export interface RollVideoProps {
    roll: RollDetails;
    videoRef: React.RefObject<HTMLVideoElement | null>;
    setCurrentTime: (time: number) => void;
    setPlaying: React.Dispatch<React.SetStateAction<boolean>>;
    setDuration: (duration: number) => void;
}

export default function RollVideo({ roll, videoRef, setCurrentTime, setPlaying, setDuration }: RollVideoProps) {
    const videoUrl = transformMediaUrl(
        roll.roll_files.find((file) => file.type === 'video_preview')?.uri
    );
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
        setDuration(videoRef.current.duration);
        const videoElement = videoRef.current as any;
        if (videoElement.requestVideoFrameCallback) {
            frameCallbackIdRef.current = videoElement.requestVideoFrameCallback(updateFrame);
        }
    };

    const handleVideoClick = () => {
        if (!videoRef.current) return;
        setPlaying((prev) => !prev);
    };

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