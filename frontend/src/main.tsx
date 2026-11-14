import React from "react";
import { createRoot } from "react-dom/client";
import Startup from "./Startup";
import "./styles.css";
import "./controls.css";
if (new URLSearchParams(location.search).has("publication")) {
  (window as any).alderPublication = import("./PublicationRenderer").then(
    (module) => module.renderPublication,
  );
} else
  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <Startup />
    </React.StrictMode>,
  );
