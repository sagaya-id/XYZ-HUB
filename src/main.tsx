import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './styles.css'
import { AppProvider } from './lib/app-context'
import { AppShell } from './components/layout'
import { Landing } from './pages/Landing'
import { Login } from './pages/Login'
import { HomePage } from './pages/Home'
import { ProjectsPage } from './pages/Projects'
import { WorkspacePage } from './pages/Workspace'
import { LocationsPage } from './pages/LocationsPage'
import { CalendarPage } from './pages/CalendarPage'
import { AdminPage } from './pages/Admin'
import { RemindersPage } from './pages/RemindersPage'
import { ProfilePage } from './pages/Profile'

function Root() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/app/:entity" element={<AppShell />}>
        <Route index element={<Navigate to="home" replace />} />
        <Route path="home" element={<HomePage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:projectId" element={<WorkspacePage />} />
        <Route path="locations" element={<LocationsPage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="reminders" element={<RemindersPage />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="profile" element={<ProfilePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <BrowserRouter>
        <Root />
      </BrowserRouter>
    </AppProvider>
  </StrictMode>,
)
