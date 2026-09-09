import { useEffect, useState } from "react";
import { applyTheme, saveThemePreference, themePreferenceFromStorageChange, type ThemePreference } from "../theme";

export function useThemePreference(initialThemePreference: ThemePreference) {
  const [themePreference, setThemePreference] = useState<ThemePreference>(initialThemePreference);
  useEffect(() => {
    applyTheme(themePreference);
    const mediaQuery = window.matchMedia("(prefers-color-scheme: light)");
    const onSystemThemeChange = () => {
      if (themePreference === "system") applyTheme("system");
    };
    const onStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName !== "local") return;
      const next = themePreferenceFromStorageChange(changes);
      if (next !== undefined) setThemePreference(next);
    };
    mediaQuery.addEventListener("change", onSystemThemeChange);
    chrome.storage.onChanged.addListener(onStorageChange);
    return () => {
      mediaQuery.removeEventListener("change", onSystemThemeChange);
      chrome.storage.onChanged.removeListener(onStorageChange);
    };
  }, [themePreference]);

  function changeThemePreference(preference: ThemePreference) {
    setThemePreference(preference);
    applyTheme(preference);
    void saveThemePreference(preference);
  }

  return { themePreference, changeThemePreference };
}
