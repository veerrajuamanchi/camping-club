import { BrowserRouter } from "react-router";
import { AuthProvider } from "./app/AuthProvider";
import { AppRoutes } from "./app/AppRoutes";

export { AppRoutes };

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
