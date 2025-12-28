import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RollDetails, RollUpdate } from "@/lib/roll";
import RollEdit, { rollToRollUpdate } from "@/components/RollEdit";
import RollHeader from "@/components/RollHeader";

export const Route = createFileRoute('/rolls/$rollId/edit')({
    component: RouteComponent,
})

function RouteComponent() {
    const { rollId } = Route.useParams();

    const { data: roll, isLoading, error } = useQuery({
        queryKey: ['roll', rollId],
        queryFn: async () => {
            if (rollId === undefined) return null;

            const response = await fetch(`${import.meta.env.VITE_BACKEND_URL}/rolls/${rollId}`);
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.json();
        },
    });

    const queryClient = useQueryClient();
    const navigate = Route.useNavigate();
    const [formData, setFormData] = useState<RollUpdate | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    useEffect(() => {
        if (roll) setFormData(rollToRollUpdate(roll));
    }, [roll]);

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
            console.log('Roll updated successfully', data);
            navigate({ to: '..' });
        },
        onError: (error: any) => {
            console.debug(formData)
            console.debug(error.data)
            console.error('Error updating roll:', error);
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

    if (error) return <div>Error loading roll data</div>;
    else if (!formData || isLoading) return <div>Loading...</div>;

    return (
        <div className="flex flex-col h-full p-2">
            <div className="mb-4 pb-2 border-b border-gray-300 flex justify-between items-center">
                <RollHeader roll={roll} />
                <div className="flex gap-2">
                    <button onClick={() => saveRollMutation.mutate(formData)} className="px-4 py-1.5 bg-green-300 rounded hover:bg-green-400">
                        Save
                    </button>
                    <Link from={Route.fullPath} to=".." className="px-4 py-1.5 bg-red-300 rounded hover:bg-red-400">
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
