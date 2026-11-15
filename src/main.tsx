import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthGate } from "./components/AuthGate";
import KrushnaApp from "./krushna/App";
import { KrushnaAuthGate } from "./krushna/Auth";
import "./styles.css";

const isKrushna = window.location.pathname.startsWith("/krushna");
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isKrushna ? <KrushnaAuthGate><KrushnaApp /></KrushnaAuthGate> : <AuthGate><App /></AuthGate>}
  </React.StrictMode>
);
