import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Recording } from "@/components/Recording";

export const Route = createFileRoute('/recording/$rollId')({
    component: RouteComponent,
});

function RouteComponent() {
    const rollId = +Route.useParams()['rollId'];
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

    if (isLoading) {
        return <div>Loading...</div>;
    }

    if (error) {
        return <div>Error loading roll data</div>;
    }

    return <Recording roll={roll} />;
}