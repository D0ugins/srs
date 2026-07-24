import React, { useCallback, useEffect, useRef } from "react";
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

function isBuffered(video: HTMLVideoElement, time: number) {
    for (let i = 0; i < video.buffered.length; i++) {
        if (time >= video.buffered.start(i) && time <= video.buffered.end(i)) return true;
    }
    return false;
}

// Coalesces seeks to unbuffered positions so scrubbing keeps at most one request in flight
export function useCoalescedSeek(videoRef: React.RefObject<HTMLVideoElement | null>) {
    const pendingRef = useRef<number | null>(null);
    return useCallback((time: number) => {
        const video = videoRef.current;
        if (!video) return;
        if (video.seeking && !isBuffered(video, time)) {
            if (pendingRef.current === null) {
                video.addEventListener('seeked', () => {
                    const target = pendingRef.current;
                    pendingRef.current = null;
                    if (target !== null) video.currentTime = target;
                }, { once: true });
            }
            pendingRef.current = time;
        } else {
            pendingRef.current = null;
            video.currentTime = time;
        }
    }, [videoRef]);
}

const FPS = 30; // TODO: store actaul fps in db

export default function RollVideo({ roll, videoRef, setCurrentTime, setPlaying, duration, setDuration }: RollVideoProps) {
    const VIDEO_CHOICES = ['video_preview', 'edited_vid', 'video_preview_c', 'edited_vid_c', 'follow_car_vid', 'misc_vid'];
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

    if (!videoUrl) return <div>No video available</div>;
    return <video
        ref={videoRef}
        className="cursor-pointer"
        src={videoUrl}
        key={videoUrl}
        onLoadedMetadata={handleLoadedMetadata}
        onClick={handleVideoClick}
        muted
    >
        Your browser does not support the video tag.
    </video>
}