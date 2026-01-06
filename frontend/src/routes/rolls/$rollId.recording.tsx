import RollHeader from "@/components/RollHeader";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute('/rolls/$rollId/recording')({
    component: RouteComponent,
})

function RouteComponent() {
    const { rollId } = Route.useParams();

    const { data: graphs, isLoading, error } = useQuery({
        queryKey: ['roll', rollId, 'recording'],
        queryFn: async () => {
            if (rollId === undefined) return null;

            const response = await fetch(`${import.meta.env.VITE_BACKEND_URL}/rolls/${rollId}/graphs`);
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.json();
        },
    });
    const { data: roll, isLoading: rollLoading, error: rollError } = useQuery({
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

    if (isLoading) {
        return <div>Loading...</div>
    }
    if (error) {
        return <div>Error loading recording data.</div>
    }

    return (
        <div className="flex flex-col h-full p-2">
            <div className="mb-4 pb-2 border-b border-gray-300 flex justify-between items-center">
                <RollHeader roll={roll} />
                <div className="flex gap-2">
                    <button onClick={() => console.log(1)} className="px-4 py-1.5 bg-green-300 rounded hover:bg-green-400">
                        Save
                    </button>
                    <Link from={Route.fullPath} to=".." className="px-4 py-1.5 bg-red-300 rounded hover:bg-red-400">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-6">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </Link>
                </div>
            </div>
            <pre>{JSON.stringify(graphs, null, 2)}</pre>
        </div>
    );
}