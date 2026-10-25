import { BrowserRouter } from "react-router";
import { AuthProvider } from "./app/AuthProvider";
import { AppRoutes } from "./app/AppRoutes";

export { AppRoutes };

// Auto-correct legacy Render host traffic by redirecting to canonical custom domain
if (typeof window !== "undefined" && window.location.hostname === "camping-club.onrender.com") {
  window.location.replace(
    `https://private-camping-club.com${window.location.pathname}${window.location.search}${window.location.hash}`
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
