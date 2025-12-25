import { Recording } from "@/components/Recording";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute('/rolls/$rollId')({
    component: RouteComponent,
})

function RouteComponent() {
    const { rollId } = Route.useParams(); //TODO: add start time in params

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

    return <Recording roll={roll} />;
}