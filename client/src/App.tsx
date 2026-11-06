import { Route, Routes } from 'react-router'
import { Layout } from './components/Layout'
import { DashboardPage } from './pages/DashboardPage'
import { DiscoverPage } from './pages/DiscoverPage'
import { SessionProvider } from './session'

function App() {
  return (
    <SessionProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<DiscoverPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="*" element={<p className="muted page-pad">Page not found.</p>} />
        </Routes>
      </Layout>
    </SessionProvider>
  )
}

export default App
