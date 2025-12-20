import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import RollsTable from '../components/RollsTable.tsx'
import RollSidebar from '@/components/RollSidebar.tsx'

export const Route = createFileRoute('/rolls')({
  component: RouteComponent,
})

function RouteComponent() {

  return <RollSidebar />
}
