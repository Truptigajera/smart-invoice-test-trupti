import { Outlet } from "@remix-run/react";

// Layout wrapper for /app/customize/* routes.
// Child routes (e.g. app.customize.$templateId.tsx) render via <Outlet />.
export default function CustomizeLayout() {
  return <Outlet />;
}
