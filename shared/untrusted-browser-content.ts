export const UNTRUSTED_BROWSER_CONTENT_START = "<<<UNTRUSTED_BROWSER_CONTENT>>>";
export const UNTRUSTED_BROWSER_CONTENT_END = "<<<END_UNTRUSTED_BROWSER_CONTENT>>>";

/** Mark browser-controlled text as evidence and escape marker copies supplied by the page. */
export function wrapUntrustedBrowserContent(content: string, sourceUrl: string): string {
  const safeContent = escapeBoundaryMarkers(content);
  const safeSource = escapeBoundaryMarkers(sourceUrl).replace(/[\r\n]/g, " ");
  return `${UNTRUSTED_BROWSER_CONTENT_START}\nSource URL: ${safeSource}\n${safeContent}\n${UNTRUSTED_BROWSER_CONTENT_END}`;
}

function escapeBoundaryMarkers(value: string): string {
  return value
    .split(UNTRUSTED_BROWSER_CONTENT_START).join("&lt;&lt;&lt;UNTRUSTED_BROWSER_CONTENT&gt;&gt;&gt;")
    .split(UNTRUSTED_BROWSER_CONTENT_END).join("&lt;&lt;&lt;END_UNTRUSTED_BROWSER_CONTENT&gt;&gt;&gt;");
}
