import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { RollDetails, RollUpdate, Driver, Buggy, Sensor, Pusher } from "@/lib/roll";
import Autocomplete from "./Autocomplete";

export function rollToRollUpdate(roll: RollDetails): RollUpdate {
    return {
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
            sensor_abbreviation: rf.sensor?.abbreviation
        })),
        roll_hills: roll.roll_hills.map(rh => ({
            hill_number: rh.hill_number,
            pusher_name: rh.pusher?.name || ''
        }))
    };
}

export default function RollEdit({ formData, setFormData }: { formData: RollUpdate, setFormData: (rollData: RollUpdate) => void }) {
    const pusherInputRefs = useRef<(HTMLInputElement | null)[]>([]);

    const { data: drivers, isLoading: driversLoading } = useQuery({
        queryKey: ['drivers'],
        queryFn: async () => {
            const response = await fetch(`${import.meta.env.VITE_BACKEND_URL}/drivers`);
            if (!response.ok) {
                throw new Error('Failed to fetch drivers');
            }
            const data: Driver[] = await response.json();
            if (!formData.driver_name) {
                setFormData({
                    ...formData,
                    driver_name: data[0]?.name || ''
                });
            }
            return data;
        }
    });

    const { data: buggies, isLoading: buggiesLoading } = useQuery({
        queryKey: ['buggies'],
        queryFn: async () => {
            const response = await fetch(`${import.meta.env.VITE_BACKEND_URL}/buggies`);
            if (!response.ok) {
                throw new Error('Failed to fetch buggies');
            }
            const data: Buggy[] = await response.json();
            if (!formData.buggy_abbreviation) {
                setFormData({
                    ...formData,
                    buggy_abbreviation: data[0]?.abbreviation || ''
                });
            }
            return data;
        }
    });

    const { data: sensors, isLoading: sensorsLoading } = useQuery({
        queryKey: ['sensors'],
        queryFn: async () => {
            const response = await fetch(`${import.meta.env.VITE_BACKEND_URL}/sensors`);
            if (!response.ok) {
                throw new Error('Failed to fetch sensors');
            }
            return response.json() as Promise<Sensor[]>;
        }
    });

    const { data: pushers, isLoading: pushersLoading } = useQuery({
        queryKey: ['pushers'],
        queryFn: async () => {
            const response = await fetch(`${import.meta.env.VITE_BACKEND_URL}/pushers`);
            if (!response.ok) {
                throw new Error('Failed to fetch pushers');
            }
            return response.json() as Promise<Pusher[]>;
        }
    });

    const { data: fileTypes, isLoading: fileTypesLoading } = useQuery({
        queryKey: ['fileTypes'],
        queryFn: async () => {
            const response = await fetch(`${import.meta.env.VITE_BACKEND_URL}/files/types`);
            if (!response.ok) {
                throw new Error('Failed to fetch file types');
            }
            return response.json() as Promise<string[]>;
        }
    });

    const addRollFile = () => {
        setFormData({
            ...formData,
            roll_files: [...formData.roll_files, { type: '', uri: '', sensor_abbreviation: undefined }]
        });
    };

    const removeRollFile = (index: number) => {
        setFormData({
            ...formData,
            roll_files: formData.roll_files.filter((_, i) => i !== index)
        });
    };

    const updateRollFile = (index: number, field: keyof RollUpdate['roll_files'][0], value: string | undefined) => {
        const updatedFiles = [...formData.roll_files];
        updatedFiles[index] = { ...updatedFiles[index], [field]: value };
        setFormData({
            ...formData,
            roll_files: updatedFiles
        });
    };

    const updateRollHill = (hillNumber: number, pusherName: string) => {
        const updatedHills = [...formData.roll_hills];
        const existingIndex = updatedHills.findIndex(h => h.hill_number === hillNumber);

        if (existingIndex >= 0) {
            updatedHills[existingIndex] = { hill_number: hillNumber, pusher_name: pusherName };
        } else {
            updatedHills.push({ hill_number: hillNumber, pusher_name: pusherName });
        }

        setFormData({
            ...formData,
            roll_hills: updatedHills
        });
    };

    const focusNextPusherInput = (currentHillNumber: number) => {
        const nextIndex = currentHillNumber;
        if (nextIndex < pusherInputRefs.current.length) {
            pusherInputRefs.current[nextIndex]?.focus();
        }
    };

    return (
        <div className="overflow-y-auto">
            <div className="mb-4 px-4 py-2 border border-gray-300 rounded">
                <div className="flex gap-8">
                    <div className="w-2/3">
                        <div className="grid grid-cols-4 gap-2 mb-2">
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
                                <label className="block text-sm font-medium mb-0.5">Year</label>
                                <input
                                    type="number"
                                    value={formData.roll_date.year}
                                    onChange={(e) => setFormData({
                                        ...formData,
                                        roll_date: { ...formData.roll_date, year: parseInt(e.target.value) },
                                        start_time: formData.start_time ? `${e.target.value}-${String(formData.roll_date.month).padStart(2, '0')}-${String(formData.roll_date.day).padStart(2, '0')}${formData.start_time.slice(10)}` : undefined
                                    })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-0.5">Month</label>
                                <input
                                    type="number"
                                    min="1"
                                    max="12"
                                    value={formData.roll_date.month}
                                    onChange={(e) => setFormData({
                                        ...formData,
                                        roll_date: { ...formData.roll_date, month: parseInt(e.target.value) },
                                        start_time: formData.start_time ? `${formData.roll_date.year}-${String(e.target.value).padStart(2, '0')}-${String(formData.roll_date.day).padStart(2, '0')}${formData.start_time.slice(10)}` : undefined
                                    })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-0.5">Day</label>
                                <input
                                    type="number"
                                    min="1"
                                    max="31"
                                    value={formData.roll_date.day}
                                    onChange={(e) => setFormData({
                                        ...formData,
                                        roll_date: { ...formData.roll_date, day: parseInt(e.target.value) },
                                        start_time: formData.start_time ? `${formData.roll_date.year}-${String(formData.roll_date.month).padStart(2, '0')}-${String(e.target.value).padStart(2, '0')}${formData.start_time.slice(10)}` : undefined
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
                                <label className="block text-sm font-medium mb-1">Start Time (EST)</label>
                                <input
                                    type="time"
                                    value={formData.start_time?.slice(11, 16) || ''}
                                    onChange={(e) => {
                                        if (e.target.value) {
                                            setFormData({
                                                ...formData,
                                                start_time: `${formData.roll_date.year}-${String(formData.roll_date.month).padStart(2, '0')}-${String(formData.roll_date.day).padStart(2, '0')}T${e.target.value}:00`
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
                        <div className="mb-2">
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

            <div className="flex gap-4 mb-4">
                <div className="p-4 border border-gray-300 rounded w-1/2">
                    <div className="flex justify-between items-center mb-3">
                        <h2 className="text-xl font-semibold">Roll Files</h2>
                        <button
                            onClick={addRollFile}
                            className="px-3 py-1 bg-gray-300 rounded hover:bg-gray-500"
                        >
                            + Add File
                        </button>
                    </div>
                    <div className="space-y-2">
                        {formData.roll_files.map((file, index) => (
                            <div key={index} className="flex gap-2 items-center">
                                <div className="w-32 flex-shrink-0">
                                    <Autocomplete
                                        value={file.type}
                                        onChange={(value) => updateRollFile(index, 'type', value)}
                                        options={fileTypes || []}
                                        placeholder="Type"
                                        disabled={fileTypesLoading}
                                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                    />
                                </div>
                                <input
                                    type="text"
                                    value={file.uri}
                                    onChange={(e) => updateRollFile(index, 'uri', e.target.value)}
                                    placeholder="URI"
                                    className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm"
                                />
                                <select
                                    value={file.sensor_abbreviation || ''}
                                    onChange={(e) => updateRollFile(index, 'sensor_abbreviation', e.target.value || undefined)}
                                    disabled={sensorsLoading}
                                    className="w-24 px-2 py-1 border border-gray-300 rounded text-sm"
                                >
                                    <option value="">Unknown</option>
                                    {sensors?.map((sensor) => (
                                        <option key={sensor.id} value={sensor.abbreviation}>
                                            {sensor.abbreviation}
                                        </option>
                                    ))}
                                </select>
                                <button
                                    onClick={() => removeRollFile(index)}
                                    className="px-1.5 py-1.5 bg-red-300 rounded hover:bg-red-400"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-4">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="p-4 border border-gray-300 rounded w-1/2">
                    <div className="space-y-2">
                        {[1, 2, 3, 4, 5].map((hillNumber) => {
                            const hill = formData.roll_hills.find(h => h.hill_number === hillNumber);

                            return (
                                <div key={hillNumber} className="flex gap-2 items-center">
                                    <span className="w-20 px-2 py-1 text-sm font-medium">Hill {hillNumber}</span>
                                    <Autocomplete
                                        value={hill?.pusher_name || ''}
                                        onChange={(value) => updateRollHill(hillNumber, value)}
                                        inputRef={(el) => { pusherInputRefs.current[hillNumber - 1] = el }}
                                        options={pushers?.map(p => p.name) || []}
                                        placeholder="Pusher name"
                                        disabled={pushersLoading}
                                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                        onEnterKey={() => focusNextPusherInput(hillNumber)}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            <div className="mb-4 p-4 border border-gray-300 rounded">
                <div className="grid grid-cols-3 gap-4">
                    <div>
                        <label className="block text-sm font-medium mb-1">Driver Notes</label>
                        <textarea
                            value={formData.driver_notes}
                            onChange={(e) => setFormData({
                                ...formData,
                                driver_notes: e.target.value
                            })}
                            placeholder="Driver notes..."
                            className="w-full px-3 py-2 border border-gray-300 rounded text-sm resize-none"
                            rows={4}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">Mech Notes</label>
                        <textarea
                            value={formData.mech_notes}
                            onChange={(e) => setFormData({
                                ...formData,
                                mech_notes: e.target.value
                            })}
                            placeholder="Mech notes..."
                            className="w-full px-3 py-2 border border-gray-300 rounded text-sm resize-none"
                            rows={4}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">Pusher Notes</label>
                        <textarea
                            value={formData.pusher_notes}
                            onChange={(e) => setFormData({
                                ...formData,
                                pusher_notes: e.target.value
                            })}
                            placeholder="Pusher notes..."
                            className="w-full px-3 py-2 border border-gray-300 rounded text-sm resize-none"
                            rows={4}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
