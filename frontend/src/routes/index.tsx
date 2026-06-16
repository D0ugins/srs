import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: App,
})

function App() {
  return (
    <div className="m-8 text-lg">
      Click Rolls in the header to get started <br />
      <a className='text-blue-600 hover:underline'
        href="https://docs.google.com/document/d/1IEYC55YR-bWA3fONGtN9pSZBQ_bkSnVQFTVOl_ltdnI/edit">Explanation Doc</a>
    </div>
  )
}
