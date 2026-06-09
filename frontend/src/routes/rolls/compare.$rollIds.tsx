import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute('/rolls/compare/$rollIds')({
    component: RouteComponent,
})

function RouteComponent() {
    const { rollIds } = Route.useParams();
    return <> </>;
}