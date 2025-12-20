import { Recording } from '@/components/Recording';
import RollSidebar from '@/components/RollSidebar';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react';

export const Route = createFileRoute('/rolls/{-$rollId}')({
    component: RouteComponent,
})

function RouteComponent() {
    const { rollId: initiId } = Route.useParams();

    const [rollId, setRollId] = useState<number | undefined>(initiId ? +initiId : undefined);
    const updateId = (id: number) => {
        setRollId(id);
        history.pushState(null, '', `/rolls/${id}`);
    };


    const { data: roll, isLoading, error } = useQuery({
        queryKey: ['roll', rollId],
        queryFn: async () => {
            const response = await fetch(`${import.meta.env.VITE_BACKEND_URL}/roll/${rollId}`);
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.json();
        },
    });

    return <div className="flex h-full">
        <div className="w-64 border-r overflow-y-auto">
            <RollSidebar updateId={updateId} />
        </div>
        <div className="flex-1">
            {rollId === undefined ? null
                : isLoading ? <div>Loading...</div>
                    : error ? <div>Error loading roll data</div>
                        : <Recording roll={roll} />
            }
        </div>
    </div>

}
