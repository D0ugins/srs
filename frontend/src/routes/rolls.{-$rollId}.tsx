import { Recording } from '@/components/Recording';
import RollSidebar from '@/components/RollSidebar';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect } from 'react';

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

    useEffect(() => {
        const handlePopState = () => {
            const pathParts = window.location.pathname.split('/');
            const newRollId = pathParts[pathParts.length - 1];
            if (newRollId && !isNaN(+newRollId)) {
                setRollId(+newRollId);
            } else {
                setRollId(undefined);
            }
        };

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

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
        <div className="w-64 border-r overflow-y-auto p-2">
            <RollSidebar updateId={updateId} selectedId={rollId} />
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
