import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthGate } from "./components/AuthGate";
import KrushnaApp from "./krushna/App";
import "./styles.css";

const isKrushna = window.location.pathname.startsWith("/krushna");
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isKrushna ? <KrushnaApp /> : <AuthGate><App /></AuthGate>}
  </React.StrictMode>
);
