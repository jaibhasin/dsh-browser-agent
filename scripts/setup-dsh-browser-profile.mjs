import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const projectRoot = process.cwd();
const profileRoot = resolve(homedir(), ".dsh", "profiles", "browser-agent");
const extensionEnv = resolve(projectRoot, "extension", ".env.local");
const tokenFile = resolve(profileRoot, ".bridge-token");
const extensionKeyFile = resolve(profileRoot, ".extension-public-key");

mkdirSync(profileRoot, { recursive: true });
const token = existsSync(tokenFile) ? readFileSync(tokenFile, "utf8").trim() : randomBytes(32).toString("hex");
const extensionKey = existsSync(extensionKeyFile) ? readFileSync(extensionKeyFile, "utf8").trim() : generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ type: "spki", format: "der" }).toString("base64");
writeFileSync(extensionKeyFile, `${extensionKey}\n`, { mode: 0o600 });
const digest = createHash("sha256").update(Buffer.from(extensionKey, "base64")).digest().subarray(0, 16);
const extensionId = [...digest].map(byte => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15))).join("");
writeFileSync(tokenFile, `${token}\n`, { mode: 0o600 });
chmodSync(tokenFile, 0o600);
writeFileSync(resolve(profileRoot, "cordis.yml"), "[]\n");
writeFileSync(resolve(profileRoot, "cordis.patch.yml"), [
  "- id: dsh-browser-agent",
  "  config:",
  `    token: \"${token}\"`,
  `    extensionId: \"${extensionId}\"`,
  "    port: 7331",
  "",
].join("\n"));
writeFileSync(resolve(profileRoot, "package.json"), `${JSON.stringify({
  name: "dsh-profile-browser-agent",
  private: true,
  dependencies: { "@jaibhasin/dsh-browser-agent": `link:${resolve(projectRoot, "dsh-plugin")}` },
  dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@jaibhasin/dsh-browser-agent"] } },
}, null, 2)}\n`);
writeFileSync(extensionEnv, `VITE_DSH_BRIDGE_TOKEN=${token}\nVITE_DSH_EXTENSION_ID=${extensionId}\n`, { mode: 0o600 });
const manifestPath = resolve(projectRoot, "extension/manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.key = extensionKey;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
chmodSync(extensionEnv, 0o600);
console.log(`Configured DSH profile: ${profileRoot}`);
console.log("The extension build now carries the same local bridge token.");
