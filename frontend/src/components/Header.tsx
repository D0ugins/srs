import { Link } from '@tanstack/react-router'

export default function Header() {
  return (
    <>
      <header className="p-4 flex items-center bg-gray-800 text-white shadow-lg">
        <h1 className="ml-4 text-xl">
          <Link to="/">
            Home
          </Link>
        </h1>
        <h1 className="ml-4 text-xl">
          <Link to="/rolls">
            Rolls
          </Link>
        </h1>
      </header>
    </>
  )
}
