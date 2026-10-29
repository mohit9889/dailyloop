import "./theme.css";
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { PublicPage, PendingSaveNotice } from "./features/Workspace";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PendingSaveNotice />
    {["/privacy", "/support", "/account-deletion"].includes(
      window.location.pathname,
    ) ? (
      <PublicPage path={window.location.pathname} />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
