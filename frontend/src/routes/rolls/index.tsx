import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/rolls/')({
    component: RouteComponent,
})

function RouteComponent() {
    return <div>Select a roll :)</div>
}
