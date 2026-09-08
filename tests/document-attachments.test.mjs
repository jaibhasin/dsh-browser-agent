import assert from "node:assert/strict";
import { parseBridgeMessage } from "../shared/protocol.ts";
import { DocumentInputError, prepareDocumentFiles, documentPromptContent } from "../extension/sidepanel/src/document-attachments.ts";

const csv = new File(["name,score\nAda,10\n"], "scores.csv", { type: "text/csv" });
const documents = await prepareDocumentFiles([csv], []);

assert.equal(documents[0].name, "scores.csv");
assert.equal(documents[0].extension, "csv");
assert.equal(atob(documents[0].data), "name,score\nAda,10\n");
assert.deepEqual(documentPromptContent(documents), [{
  type: "document",
  name: "scores.csv",
  mediaType: "text/csv",
  data: documents[0].data,
}]);

const parsed = parseBridgeMessage({
  type: "chat",
  id: "chat-1",
  text: "Summarize this",
  sessionId: "session-1",
  resume: false,
  content: documentPromptContent(documents),
});
assert.equal(parsed?.type, "chat");
assert.equal(parseBridgeMessage({ ...parsed, content: [{ type: "document", name: "", data: "AQID" }] }), undefined);
assert.equal(parseBridgeMessage({ ...parsed, content: [{ type: "document", name: "scores.csv", data: "not base64!" }] }), undefined);

await assert.rejects(
  () => prepareDocumentFiles([new File(["x"], "notes.exe")], []),
  (error) => error instanceof DocumentInputError && error.code === "unsupported-type",
);

await assert.rejects(
  () => prepareDocumentFiles([new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.pdf")], []),
  (error) => error instanceof DocumentInputError && error.code === "file-too-large",
);

console.log("document attachment scenarios passed");
