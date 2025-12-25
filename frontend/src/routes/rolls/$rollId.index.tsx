import RollHeader from "@/components/RollHeader";
import RollView from "@/components/RollView";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute('/rolls/$rollId/')({
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

    if (isLoading) return <div>Loading...</div>;
    else if (error) return <div>Error loading roll data</div>;

    return <div className="flex flex-col h-full p-2">
        <div className="mb-4 pb-2 border-b border-gray-300 flex justify-between items-center">
            <RollHeader roll={roll} />
            <Link from={Route.fullPath} to="./edit" className="px-1.5 py-1.5 bg-gray-300 rounded hover:bg-gray-400">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-6">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                </svg>
            </Link>
        </div>
        <RollView roll={roll} />
    </div>
}
