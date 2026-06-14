import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute('/rolls/$rollId/compare/$compareIds')({
    component: RouteComponent,
})

function RouteComponent() {
    const { rollId, compareIds } = Route.useParams();
    return <> </>;
}