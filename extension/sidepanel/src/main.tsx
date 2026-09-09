import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { applyTheme, loadThemePreference } from "./theme";
import "../styles.css";

const rootElement = document.querySelector("#root");

if (!rootElement) {
  throw new Error("The side panel root element is missing.");
}

void loadThemePreference().then((preference) => {
  applyTheme(preference);
  createRoot(rootElement).render(
    <StrictMode>
      <App initialThemePreference={preference} />
    </StrictMode>,
  );
}).catch(() => {
  applyTheme("system");
  createRoot(rootElement).render(
    <StrictMode>
      <App initialThemePreference="system" />
    </StrictMode>,
  );
});
