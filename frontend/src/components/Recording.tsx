import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { RollDetails, RollUpdate } from "@/lib/roll";
import { RecordingView } from "./RecordingView";
import { RecordingEdit, rollToRollUpdate } from "./RecordingEdit";

export function Recording({ roll }: { roll: RollDetails }) {
    const queryClient = useQueryClient();
    const [editing, setEditing] = useState(false);
    const [formData, setFormData] = useState<RollUpdate>(rollToRollUpdate(roll));
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const saveRollMutation = useMutation({
        mutationFn: async (updatedRoll: RollUpdate) => {
            const response = await fetch(`${import.meta.env.VITE_BACKEND_URL}/rolls/${roll.id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(updatedRoll)
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const error: any = new Error('Failed to update roll');
                error.status = response.status;
                error.data = errorData;
                throw error;
            }
            return response.json() as Promise<RollDetails>;
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ['rolls'] });
            queryClient.invalidateQueries({ queryKey: ['roll', roll.id] });
            setEditing(false);
            setErrorMessage(null);
            console.log('Roll updated successfully', data);
        },
        onError: (error: any) => {
            console.debug(error.data)
            console.error('Error updating roll:', error);
            const details = error.data?.detail?.[0];
            if (error.status === 422 && details?.msg) {
                setErrorMessage(`${details.loc?.slice(1).join('.')}: ${details.msg}`);
            } else {
                setErrorMessage('Failed to update roll. Please try again.');
            }
        }
    });

    return (
        <div className="flex flex-col h-full p-2">
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
                {editing ? (
                    <div className="flex gap-2">
                        <button onClick={() => saveRollMutation.mutate(formData)} className="px-4 py-1.5 bg-green-300 rounded hover:bg-green-400">
                            Save
                        </button>
                        <button onClick={() => { setEditing(false); setErrorMessage(null); }} className="px-4 py-1.5 bg-red-300 rounded hover:bg-red-400">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-6">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                ) : (
                    <button onClick={() => { setFormData(rollToRollUpdate(roll)); setEditing(true); setErrorMessage(null); }} className="px-1.5 py-1.5 bg-gray-300 rounded hover:bg-gray-400">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-6">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                        </svg>
                    </button>
                )}
            </div>
            {errorMessage && (
                <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
                    {errorMessage}
                </div>
            )}
            {!editing ? (
                <RecordingView roll={roll} />
            ) : (
                <RecordingEdit formData={formData} setFormData={setFormData} />
            )}
        </div>
    );
}
