import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { RollDetails, RollUpdate } from "@/lib/roll";
import RollEdit from "@/components/RollEdit";

export const Route = createFileRoute('/rolls/new')({
    component: RouteComponent,
})

function RouteComponent() {
    const queryClient = useQueryClient();
    const navigate = Route.useNavigate();

    const currentDate = new Date();
    const initialFormData: RollUpdate = {
        driver_notes: '',
        mech_notes: '',
        pusher_notes: '',
        roll_number: undefined,
        start_time: undefined,
        buggy_abbreviation: '',
        driver_name: '',
        roll_date: {
            year: currentDate.getFullYear(),
            month: currentDate.getMonth() + 1,
            day: currentDate.getDate(),
            temperature: undefined,
            humidity: undefined,
            type: 'weekend'
        },
        roll_files: [],
        roll_hills: []
    };

    const [formData, setFormData] = useState<RollUpdate>(initialFormData);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const createRollMutation = useMutation({
        mutationFn: async (newRoll: RollUpdate) => {
            const response = await fetch(`${import.meta.env.VITE_BACKEND_URL}/rolls`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(newRoll)
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const error: any = new Error('Failed to create roll');
                error.status = response.status;
                error.data = errorData;
                throw error;
            }
            return response.json() as Promise<RollDetails>;
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ['rolls'] });
            console.log('Roll created successfully', data);
            navigate({ to: '/rolls/$rollId', params: { rollId: data.id.toString() } });
        },
        onError: (error: any) => {
            console.debug(formData);
            console.debug(error.data);
            console.error('Error creating roll:', error);
            const details = error.data?.detail?.[0];
            if (error.status === 422 && details?.msg) {
                setErrorMessage(`${details.loc?.slice(1).join('.')}: ${details.msg}`);
            } else if (typeof error.data.detail === 'string') {
                setErrorMessage(`Failed to create roll: ${error.data.detail}`);
            } else {
                setErrorMessage('Failed to create roll: Unknown error');
            }
        }
    });

    return (
        <div className="flex flex-col h-full p-2">
            <div className="mb-4 pb-2 border-b border-gray-300 flex justify-between items-center">
                <h1 className="text-2xl font-bold">New Roll</h1>
                <div className="flex gap-2">
                    <button
                        onClick={() => createRollMutation.mutate(formData)}
                        className="px-4 py-1.5 bg-green-300 rounded hover:bg-green-400"
                        disabled={createRollMutation.isPending}
                    >
                        {createRollMutation.isPending ? 'Creating...' : 'Create'}
                    </button>
                    <Link to="/rolls" className="px-4 py-1.5 bg-red-300 rounded hover:bg-red-400">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-6">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </Link>
                </div>
            </div>
            {errorMessage && (
                <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
                    {errorMessage}
                </div>
            )}
            <RollEdit formData={formData} setFormData={setFormData} />
        </div>
    );
}