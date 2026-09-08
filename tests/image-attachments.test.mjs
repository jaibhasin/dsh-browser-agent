import assert from "node:assert/strict";
import { parseBridgeMessage } from "../shared/protocol.ts";
import { ImageInputError, prepareImageFiles, promptContent } from "../extension/sidepanel/src/image-attachments.ts";

const image = new File([new Uint8Array([1, 2, 3])], "diagram.png", { type: "image/png" });
const drafts = await prepareImageFiles([image], [], async () => ({ width: 320, height: 200 }));

assert.equal(drafts[0].data, "AQID");
assert.deepEqual(promptContent("Explain this", drafts), [
  { type: "text", text: "Explain this" },
  { type: "image", mediaType: "image/png", data: "AQID", name: "diagram.png" },
]);
assert.deepEqual(promptContent("", drafts).map((part) => part.type), ["image"]);

await assert.rejects(
  () => prepareImageFiles([new File(["x"], "vector.svg", { type: "image/svg+xml" })], []),
  (error) => error instanceof ImageInputError && error.code === "unsupported-type",
);

const parsed = parseBridgeMessage({
  type: "chat",
  id: "chat-1",
  text: "Explain this",
  sessionId: "session-1",
  resume: false,
  content: promptContent("Explain this", drafts),
});
assert.equal(parsed?.type, "chat");
assert.equal(parseBridgeMessage({ ...parsed, content: [{ type: "image", mediaType: "image/svg+xml", data: "AQID" }] }), undefined);
assert.equal(parseBridgeMessage({ ...parsed, content: [] }), undefined);

console.log("image attachment scenarios passed");
