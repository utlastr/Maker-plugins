const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const cp = require("node:child_process");
const root = path.resolve(__dirname, "..");
cp.execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "scripts/build-launcher.ps1")], { stdio: "inherit" });
const secrets = path.join(process.env.USERPROFILE, ".maker-workflow-publisher");
fs.mkdirSync(secrets, { recursive: true });
const privateFile = path.join(secrets, "signing.pem");
if (!fs.existsSync(privateFile)) {
  const keys = crypto.generateKeyPairSync("rsa", { modulusLength: 3072, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  fs.writeFileSync(privateFile, keys.privateKey, { mode: 0o600 });
}
const privateKey = fs.readFileSync(privateFile);
const publicKey = crypto.createPublicKey(privateKey);
const jwk = publicKey.export({ format: "jwk" });
const xml = `<RSAKeyValue><Modulus>${Buffer.from(jwk.n, "base64url").toString("base64")}</Modulus><Exponent>${Buffer.from(jwk.e, "base64url").toString("base64")}</Exponent></RSAKeyValue>`;
const extensionKey = publicKey.export({ type: "spki", format: "der" }).toString("base64");
const extensionId = crypto.createHash("sha256").update(Buffer.from(extensionKey, "base64")).digest("hex").slice(0, 32).replace(/[0-9a-f]/g, char => String.fromCharCode(97 + parseInt(char, 16)));
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));
const version = manifest.version;
const out = path.join(root, "dist");
const staging = path.join(out, "package-" + version);
fs.mkdirSync(staging, { recursive: true });
const legacy = Number(version.split(".")[0]) < 5;
for (const file of ["Install.cmd", "Setup.ps1", "Updater.ps1", "NativeHost.cmd", "NativeHost.exe", "NOTICE.md",
  ...(legacy ? ["WorkflowHost.cjs", "Bridge.cjs", "StartBridge.ps1"] : [])])
  fs.copyFileSync(path.join(root, "distribution", file), path.join(staging, file));
fs.mkdirSync(path.join(staging, "extension"), { recursive: true });
for (const file of new Set(["manifest.json", manifest.background.service_worker,
  ...manifest.content_scripts.flatMap(value => value.js), ...(manifest.web_accessible_resources || []).flatMap(value => value.resources)]))
  fs.copyFileSync(path.join(root, "extension", file), path.join(staging, "extension", file));
manifest.key = extensionKey;
fs.writeFileSync(path.join(staging, "extension/manifest.json"), JSON.stringify(manifest, null, 2));
const repository = process.argv[2] || "";
fs.writeFileSync(path.join(staging, "update-config.json"), JSON.stringify({ repository, extensionId, extensionKey, publicKeyXml: xml }, null, 2));
fs.copyFileSync(path.join(root, "README.md"), path.join(staging, "README.md"));
const asset = `MakerWorkflow-${version}-Windows.zip`;
const archive = path.join(out, asset);
const ps = `Compress-Archive -Path '${staging.replace(/'/g, "''")}/*' -DestinationPath '${archive.replace(/'/g, "''")}' -Force`;
cp.execFileSync("powershell.exe", ["-NoProfile", "-Command", ps], { stdio: "inherit" });
const metadata = Buffer.from(JSON.stringify({ version, asset, sha256: crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex") }, null, 2));
fs.writeFileSync(path.join(out, "update.json"), metadata);
fs.writeFileSync(path.join(out, "update.sig"), crypto.sign("RSA-SHA256", metadata, privateKey).toString("base64"));
if (process.argv.includes("--windows-only")) {
  console.log(JSON.stringify({ archive, version, extensionId, repository: repository || "NOT_CONFIGURED" }));
  process.exit(0);
}
const source = path.join(out, `source-${version}-${Date.now()}`);
fs.mkdirSync(path.join(source, "scripts"), { recursive: true });
for (const folder of ["extension", "distribution", "native", "shared", "test"])
  fs.cpSync(path.join(root, folder), path.join(source, folder), { recursive: true });
for (const file of ["package-release.cjs", "publish.ps1", "install.cjs", "build-launcher.ps1", "build-workflow.cjs", "verify-refinement-cloud.cjs"])
  fs.copyFileSync(path.join(root, "scripts", file), path.join(source, "scripts", file));
for (const file of ["README.md", "package.json", "package-lock.json", ".gitignore", "NOTICE.md"])
  fs.copyFileSync(path.join(root, file), path.join(source, file));
const sourceArchive = path.join(out, `MakerWorkflow-${version}-Source.zip`);
cp.execFileSync("powershell.exe", ["-NoProfile", "-Command",
  `Compress-Archive -Path '${source.replace(/'/g, "''")}/*' -DestinationPath '${sourceArchive.replace(/'/g, "''")}' -Force`], { stdio: "inherit" });
console.log(JSON.stringify({ archive, sourceArchive, version, extensionId, repository: repository || "NOT_CONFIGURED", signingKey: "outside repository" }));
