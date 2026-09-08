import assert from "node:assert/strict";
import { convertDocuments, DocumentConversionError } from "../dsh-plugin/dist/dsh-plugin/document-converter.js";

function part(name, value) {
  return { type: "document", name, data: Buffer.from(value).toString("base64") };
}

function bytePart(name, bytes) {
  return { type: "document", name, data: Buffer.from(bytes).toString("base64") };
}

const csv = await convertDocuments([part("scores.csv", "name,score\nAda,10\n")]);
assert.match(csv, /name/);
assert.match(csv, /Ada/);
assert.match(csv, /BEGIN ATTACHMENT/);
assert.match(csv, /END ATTACHMENT/);

const markdown = await convertDocuments([part("notes.md", "# Notes\n\nKeep this local.\n")]);
assert.match(markdown, /# Notes/);
assert.match(markdown, /Keep this local/);

const docx = await convertDocuments([{
  type: "document",
  name: "report.docx",
  data: "UEsDBBQAAAAIAHx7KF15bjPX6AAAAK0BAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH1QyU7DMBD9FWuuKHHggBCK0wPLETiUDxjZk8SqN3nc0v49Tlt6QIXjzFv1+tXeO7GjzDYGBbdtB4KCjsaGScHn+rV5AMEFg0EXAyk4EMNq6NeHRCyqNrCCuZT0KCXrmTxyGxOFiowxeyz1zJNMqDc4kbzrunupYygUSlMWDxj6Zxpx64p42df3qUcmxyCeTsQlSwGm5KzGUnG5C+ZXSnNOaKvyyOHZJr6pBJBXExbk74Cz7r0Ok60h8YG5vKGvLPkVs5Em6q2vyvZ/mys94zhaTRf94pZy1MRcF/euvSAebfjpL49zD99QSwMEFAAAAAgAfHsoXZv9N+qtAAAAKQEAAAsAAABfcmVscy8ucmVsc43POw7CMAwG4KtE3mlaBoRQ0y4IqSsqB7ASN61oHkrCo7cnAwNFDIy2f3+W6/ZpZnanECdnBVRFCYysdGqyWsClP232wGJCq3B2lgQsFKFt6jPNmPJKHCcfWTZsFDCm5A+cRzmSwVg4TzZPBhcMplwGzT3KK2ri27Lc8fBpwNpknRIQOlUB6xdP/9huGCZJRydvhmz6ceIrkWUMmpKAhwuKq3e7yCzwpuarF5sXUEsDBBQAAAAIAHx7KF19s8+ZxgAAACoBAAARAAAAd29yZC9kb2N1bWVudC54bWxtj8Fqw0AMRH9l0b2Wm0MpxuscEkJvLSSFXrdeNTHsSmZXjeO/j+026aWXGcQ8hlG9vsRgzpRyJ2zhsSjBELfiOz5aeD/sHp7BZHXsXRAmCyNlWDf1UHlpvyOxmqmAczVYOKn2FWJuTxRdLqQnnrIvSdHpdKYjDpJ8n6SlnKf+GHBVlk8YXccwV36KH2fvF3lLi+11DGSG6uyChUOngQCbGu/AItq8UAhitq+bjznThUg/3L3yF93elitdtPgHx9sU/HuzuQJQSwECFAMUAAAACAB8eyhdeW4z1+gAAACtAQAAEwAAAAAAAAAAAAAAgAEAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAxQAAAAIAHx7KF2b/TfqrQAAACkBAAALAAAAAAAAAAAAAACAARkBAABfcmVscy8ucmVsc1BLAQIUAxQAAAAIAHx7KF19s8+ZxgAAACoBAAARAAAAAAAAAAAAAACAAe8BAAB3b3JkL2RvY3VtZW50LnhtbFBLBQYAAAAAAwADALkAAADkAgAAAAA="
}]);
assert.match(docx, /Hello DOCX/);
assert.match(docx, /Document text/);

function pdfPart() {
  const stream = "BT /F1 18 Tf 72 720 Td (Hello PDF) Tj ET\n";
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n",
    `4 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += object;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return part("report.pdf", pdf);
}

const pdf = await convertDocuments([pdfPart()]);
assert.match(pdf, /Hello PDF/);

await assert.rejects(
  () => convertDocuments([part("report.exe", "not a document")]),
  (error) => error instanceof DocumentConversionError && error.code === "unsupported",
);

await assert.rejects(
  () => convertDocuments([bytePart("broken.md", [0xff, 0xfe])]),
  (error) => error instanceof DocumentConversionError && /valid for encoding/.test(error.message),
);

console.log("document converter scenarios passed");
