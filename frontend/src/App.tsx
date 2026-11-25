import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { LogoMark } from "./components/Logo";
import { AppLayout } from "./components/layout";
import { useAuth } from "./context/AuthContext";
import { AlertsPage } from "./pages/AlertsPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { AnomaliesPage } from "./pages/AnomaliesPage";
import { InfrastructurePage } from "./pages/InfrastructurePage";
import { LiveMonitoringPage } from "./pages/LiveMonitoringPage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { OverviewPage } from "./pages/OverviewPage";
import { ReportsPage } from "./pages/ReportsPage";
import { ServicesPage } from "./pages/ServicesPage";
import { SettingsPage } from "./pages/SettingsPage";

function AuthGate() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="flex flex-col items-center gap-3">
          <LogoMark size={44} />
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-muted">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            Validating session
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }

  return <AppLayout />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AuthGate />}>
        <Route index element={<OverviewPage />} />
        <Route path="infrastructure" element={<InfrastructurePage />} />
        <Route path="monitoring" element={<LiveMonitoringPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="alerts" element={<AlertsPage />} />
        <Route path="anomalies" element={<AnomaliesPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="services" element={<ServicesPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
