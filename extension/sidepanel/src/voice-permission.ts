// A side panel cannot reliably display Chrome's initial microphone prompt.
// Ask from a visible page on the same extension origin instead.
export async function ensureVoicePermission(): Promise<boolean> {
  const permission = await navigator.permissions.query({ name: "microphone" as PermissionName });
  if (permission.state === "granted") return true;
  const url = chrome.runtime.getURL("sidepanel/microphone.html");
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((tab) => tab.url === url);
  if (existing?.id !== undefined) {
    await chrome.tabs.update(existing.id, { active: true });
  } else {
    await chrome.tabs.create({ url, active: true });
  }
  return false;
}
