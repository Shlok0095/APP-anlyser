import { HashRouter, Navigate, Route, Routes, useParams } from 'react-router-dom'
import { AppShell } from '../layouts/AppShell'
import { AnalyzePage } from '../pages/AnalyzePage'
import { HistoryPage } from '../pages/HistoryPage'
import { JobDetailPage } from '../pages/JobDetailPage'
import { ReportPage } from '../pages/ReportPage'
import { SettingsPage } from '../pages/SettingsPage'
import { useTheme } from '../hooks/useTheme'

function LegacyJobRedirect() {
  const { jobId } = useParams()
  return <Navigate to={jobId ? `/report/${jobId}` : '/report'} replace />
}

export function App() {
  useTheme()

  return (
    <HashRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true
      }}
    >
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<AnalyzePage />} />
          <Route path="/jobs" element={<HistoryPage />} />
          <Route path="/jobs/:jobId" element={<JobDetailPage />} />
          <Route path="/report" element={<ReportPage />} />
          <Route path="/report/:jobId" element={<ReportPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/history" element={<Navigate to="/jobs" replace />} />
          <Route path="/history/:jobId" element={<LegacyJobRedirect />} />
          <Route path="/reports" element={<Navigate to="/report" replace />} />
          <Route path="/dashboard" element={<Navigate to="/jobs" replace />} />
          <Route path="/engines" element={<Navigate to="/settings" replace />} />
          <Route path="/android/devices" element={<Navigate to="/" replace />} />
          <Route path="/explorer/*" element={<Navigate to="/jobs" replace />} />
          <Route path="/inspector/*" element={<Navigate to="/jobs" replace />} />
          <Route path="/findings/*" element={<Navigate to="/jobs" replace />} />
          <Route path="/runtime" element={<Navigate to="/jobs" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
