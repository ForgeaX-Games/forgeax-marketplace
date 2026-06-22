import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/index.css";

const pane = new URLSearchParams(location.search).get("pane");
if (pane === "left" || pane === "center") {
  document.body.setAttribute("data-pane", pane);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
