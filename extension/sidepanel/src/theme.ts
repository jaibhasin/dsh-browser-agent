export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "dshBrowserThemeV1";
const VALID_PREFERENCES = new Set<ThemePreference>(["system", "light", "dark"]);

export async function loadThemePreference(): Promise<ThemePreference> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const value = stored[STORAGE_KEY];
  return isThemePreference(value) ? value : "system";
}

export async function saveThemePreference(preference: ThemePreference): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: preference });
}

export function themePreferenceFromStorageChange(changes: { [key: string]: chrome.storage.StorageChange }): ThemePreference | undefined {
  if (!Object.prototype.hasOwnProperty.call(changes, STORAGE_KEY)) return undefined;
  const next = changes[STORAGE_KEY]?.newValue;
  return isThemePreference(next) ? next : "system";
}

export function themePreferenceFromCommand(args: string[]): ThemePreference | undefined {
  if (args.length !== 1) return undefined;
  return isThemePreference(args[0]) ? args[0] : undefined;
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && VALID_PREFERENCES.has(value as ThemePreference);
}

export function resolveTheme(preference: ThemePreference, prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches): ResolvedTheme {
  if (preference === "system") return prefersLight ? "light" : "dark";
  return preference;
}

export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.themePreference = preference;
  root.style.colorScheme = resolved;
  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (themeColor) themeColor.content = resolved === "light" ? "#f7f8fb" : "#080a0f";
  return resolved;
}

export function themePreferenceLabel(preference: ThemePreference): string {
  return preference[0].toUpperCase() + preference.slice(1);
}

export { STORAGE_KEY as THEME_STORAGE_KEY };
