import { useRef, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { transformMediaUrl } from "@/lib/format";
import type { RollDetails, RollUpdate, Driver, Buggy } from "@/lib/roll";


function RollView({ roll }: { roll: RollDetails }) {
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

    //TODO mute button
    return <><div className="flex gap-4">
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
                    {/* TODO: freeroll, overall, transitions (expandable? selectable?) */}
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
}

function RollEdit({ formData, setFormData }: { formData: RollUpdate, setFormData: (rollData: RollUpdate) => void }) {
    const { data: drivers, isLoading: driversLoading } = useQuery({
        queryKey: ['drivers'],
        queryFn: async () => {
            const response = await fetch(`${import.meta.env.VITE_BACKEND_URL}/drivers`);
            if (!response.ok) {
                throw new Error('Failed to fetch drivers');
            }
            return response.json() as Promise<Driver[]>;
        }
    });

    const { data: buggies, isLoading: buggiesLoading } = useQuery({
        queryKey: ['buggies'],
        queryFn: async () => {
            const response = await fetch(`${import.meta.env.VITE_BACKEND_URL}/buggies`);
            if (!response.ok) {
                throw new Error('Failed to fetch buggies');
            }
            return response.json() as Promise<Buggy[]>;
        }
    });

    return <div className="overflow-y-auto">
        <div className="mb-4 p-4 border border-gray-300 rounded">
            {/* <h2 className="text-xl font-semibold mb-3">Roll Info</h2> */}
            <div className="flex gap-8">
                <div className="w-2/3">
                    <div className="grid grid-cols-4 gap-4 mb-4">
                        <div>
                            <label className="block text-sm font-medium mb-1">Type</label>
                            <select
                                value={formData.roll_date.type || ''}
                                onChange={(e) => setFormData({
                                    ...formData,
                                    roll_date: { ...formData.roll_date, type: e.target.value as "weekend" | "midnight" | "raceday" }
                                })}
                                className="w-full px-3 py-2 border border-gray-300 rounded"
                            >
                                <option value="weekend">Weekend</option>
                                <option value="midnight">Midnight</option>
                                <option value="raceday">Raceday</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">Year</label>
                            <input
                                type="number"
                                value={formData.roll_date.year}
                                onChange={(e) => setFormData({
                                    ...formData,
                                    roll_date: { ...formData.roll_date, year: parseInt(e.target.value) }
                                })}
                                className="w-full px-3 py-2 border border-gray-300 rounded"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">Month</label>
                            <input
                                type="number"
                                min="1"
                                max="12"
                                value={formData.roll_date.month}
                                onChange={(e) => setFormData({
                                    ...formData,
                                    roll_date: { ...formData.roll_date, month: parseInt(e.target.value) }
                                })}
                                className="w-full px-3 py-2 border border-gray-300 rounded"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">Day</label>
                            <input
                                type="number"
                                min="1"
                                max="31"
                                value={formData.roll_date.day}
                                onChange={(e) => setFormData({
                                    ...formData,
                                    roll_date: { ...formData.roll_date, day: parseInt(e.target.value) }
                                })}
                                className="w-full px-3 py-2 border border-gray-300 rounded"
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium mb-1">Roll Number</label>
                            <input
                                type="number"
                                value={formData.roll_number || ''}
                                onChange={(e) => setFormData({
                                    ...formData,
                                    roll_number: e.target.value ? parseInt(e.target.value) : undefined
                                })}
                                className="w-full px-3 py-2 border border-gray-300 rounded"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">Start Time</label>
                            <input
                                type="time"
                                value={formData.start_time ? new Date(formData.start_time).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }) : ''}
                                onChange={(e) => {
                                    if (e.target.value) {
                                        const [hours, minutes] = e.target.value.split(':');
                                        const date = new Date(formData.roll_date.year, formData.roll_date.month - 1, formData.roll_date.day, parseInt(hours), parseInt(minutes));
                                        setFormData({
                                            ...formData,
                                            start_time: date.toISOString()
                                        });
                                    } else {
                                        setFormData({
                                            ...formData,
                                            start_time: undefined
                                        });
                                    }
                                }}
                                className="w-full px-3 py-2 border border-gray-300 rounded"
                            />
                        </div>
                    </div>
                </div>
                <div className="w-1/3">
                    <div className="mb-4">
                        <label className="block text-sm font-medium mb-1">Driver</label>
                        <select
                            value={formData.driver_name || ''}
                            onChange={(e) => setFormData({
                                ...formData,
                                driver_name: e.target.value
                            })}
                            disabled={driversLoading}
                            className="w-full px-3 py-2 border border-gray-300 rounded"
                        >
                            {drivers?.map((driver) => (
                                <option key={driver.id} value={driver.name}>
                                    {driver.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">Buggy</label>
                        <select
                            value={formData.buggy_abbreviation || ''}
                            onChange={(e) => setFormData({
                                ...formData,
                                buggy_abbreviation: e.target.value
                            })}
                            disabled={buggiesLoading}
                            className="w-full px-3 py-2 border border-gray-300 rounded"
                        >
                            {buggies?.map((buggy) => (
                                <option key={buggy.id} value={buggy.abbreviation}>
                                    {buggy.abbreviation}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>
            </div>
        </div>
    </div>
}

export function Recording({ roll }: { roll: RollDetails }) {
    const [editing, setEditing] = useState(false);
    const [formData, setFormData] = useState<RollUpdate>({
        driver_notes: roll.driver_notes,
        mech_notes: roll.mech_notes,
        pusher_notes: roll.pusher_notes,
        roll_number: roll.roll_number,
        start_time: roll.start_time,
        buggy_abbreviation: roll.buggy.abbreviation,
        driver_name: roll.driver.name,
        roll_date: {
            year: roll.roll_date.year,
            month: roll.roll_date.month,
            day: roll.roll_date.day,
            temperature: roll.roll_date.temperature,
            humidity: roll.roll_date.humidity,
            type: roll.roll_date.type
        },
        roll_files: roll.roll_files.map(rf => ({
            type: rf.type,
            uri: rf.uri,
            sensor_abbreviation: rf.sensor?.name
        })),
        roll_hills: roll.roll_hills.map(rh => ({
            hill_number: rh.id,
            pusher_name: rh.pusher?.name || ''
        }))
    });

    return <div className="flex flex-col h-full p-2">
        <div className="mb-4 pb-2 border-b border-gray-300 flex justify-between items-center">
            <h1 className="text-2xl">
                {roll.driver.name} - {roll.buggy.name} - {' '}
                {roll.roll_date.month}/{roll.roll_date.day}/{roll.roll_date.year}{' '}
                {roll.roll_number && `Roll #${roll.roll_number} `}
                {roll.start_time && (
                    <span className="text-base text-gray-500">
                        ({new Date(roll.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
                    </span>
                )}
            </h1>
            {
                editing ? <div className="flex gap-2">
                    <button onClick={() => setEditing(!editing)} className="px-1.5 py-1.5 bg-green-300 rounded hover:bg-green-400">
                        Save
                    </button>
                    <button onClick={() => setEditing(!editing)} className="px-1.5 py-1.5 bg-red-300 rounded hover:bg-red-400">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-6">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div> : <button onClick={() => setEditing(!editing)} className="px-1.5 py-1.5 bg-gray-300 rounded hover:bg-gray-400">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-6">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                    </svg>
                </button>
            }

        </div>
        {!editing ? <RollView roll={roll} /> :
            <div>
                <RollEdit formData={formData} setFormData={setFormData} />
            </div>
        }
    </div>
}
