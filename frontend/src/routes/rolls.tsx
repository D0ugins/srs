import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import RollsTable from '../components/RollsTable.tsx'

export const Route = createFileRoute('/rolls')({
  component: RouteComponent,
})

function RouteComponent() {
  const { data, isPending, isError } = useQuery({
    queryKey: ['rolls'],
    queryFn: async () => {
      const response = await fetch(`${import.meta.env.VITE_BACKEND_URL}/rolls`)
      if (!response.ok) {
        throw new Error('Network response was not ok')
      }
      const data = await response.json();
      return data.sort((a: any, b: any) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    },
  })

  if (isPending) {
    return <div>Loading...</div>
  }

  if (isError) {
    return <div>Error loading rolls.</div>
  }

  return <RollsTable rolls={data} />
}
