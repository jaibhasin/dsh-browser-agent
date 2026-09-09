import assert from "node:assert/strict";
import test from "node:test";
import { THEME_MENU_OPTIONS, THEME_STORAGE_KEY, themePreferenceFromCommand, themePreferenceFromMenuCommand, themePreferenceFromStorageChange } from "../extension/sidepanel/src/theme.ts";

test("ignores storage changes for chat history and other settings", () => {
  assert.equal(themePreferenceFromStorageChange({
    dshBrowserChatHistoryV1: { newValue: { version: 1, chats: [] } },
  }), undefined);
  assert.equal(themePreferenceFromStorageChange({
    dshBrowserToolsV1: { newValue: { version: 3 } },
  }), undefined);
});

test("reads a changed theme preference", () => {
  assert.equal(themePreferenceFromStorageChange({
    [THEME_STORAGE_KEY]: { oldValue: "light", newValue: "dark" },
  }), "dark");
});

test("falls back to system when the theme preference is removed or invalid", () => {
  assert.equal(themePreferenceFromStorageChange({
    [THEME_STORAGE_KEY]: { oldValue: "dark", newValue: undefined },
  }), "system");
  assert.equal(themePreferenceFromStorageChange({
    [THEME_STORAGE_KEY]: { oldValue: "dark", newValue: "sepia" },
  }), "system");
});

test("parses the /theme command argument", () => {
  assert.equal(themePreferenceFromCommand(["dark"]), "dark");
  assert.equal(themePreferenceFromCommand(["light"]), "light");
  assert.equal(themePreferenceFromCommand(["system"]), "system");
  assert.equal(themePreferenceFromCommand([]), undefined);
  assert.equal(themePreferenceFromCommand(["dark", "now"]), undefined);
  assert.equal(themePreferenceFromCommand(["sepia"]), undefined);
});

test("provides light and dark options for the /theme menu", () => {
  assert.deepEqual(THEME_MENU_OPTIONS.map(({ id, label }) => ({ id, label })), [
    { id: "theme-light", label: "Light" },
    { id: "theme-dark", label: "Dark" },
  ]);
  assert.equal(themePreferenceFromMenuCommand("theme-light"), "light");
  assert.equal(themePreferenceFromMenuCommand("theme-dark"), "dark");
  assert.equal(themePreferenceFromMenuCommand("theme"), undefined);
});
