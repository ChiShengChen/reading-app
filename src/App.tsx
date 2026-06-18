import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import Layout from './components/Layout'
import Library from './pages/Library'
import BookView from './pages/BookView'
import PageView from './pages/PageView'
import Reader from './pages/Reader'
import Notebook from './pages/Notebook'
import Settings from './pages/Settings'

const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <Layout />,
      children: [
        { index: true, element: <Library /> },
        { path: 'book/:bookId', element: <BookView /> },
        { path: 'book/:bookId/page/:pageIndex', element: <PageView /> },
        { path: 'reader', element: <Reader /> },
        { path: 'notebook', element: <Notebook /> },
        { path: 'settings', element: <Settings /> },
      ],
    },
  ],
  // Honour the Vite base path (GitHub Pages project subpath).
  { basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/' },
)

export default function App() {
  return <RouterProvider router={router} />
}
