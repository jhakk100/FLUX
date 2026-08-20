import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

if (process.platform !== "win32") {
  throw new Error("build:win must be run on Windows because it produces a Windows executable.");
}

const root = process.cwd();
const require = createRequire(import.meta.url);
const dist = path.join(root, "dist");
const entry = path.join(root, "apps", "gateway", "src", "index.mjs");
const dashboard = path.join(root, "apps", "dashboard", "index.html");
const bundle = path.join(dist, "flux.cjs");
const blob = path.join(dist, "flux-prep.blob");
const seaConfig = path.join(dist, "sea-config.json");
const executable = path.join(dist, "Flux.exe");
const icon = path.join(root, "assets", "flux.ico");
const iconGenerator = path.join(root, "scripts", "create-flux-icon.mjs");
const esbuildCli = require.resolve("esbuild/bin/esbuild");
const postjectCli = require.resolve("postject/dist/cli.js");
const rceditEntry = require.resolve("rcedit");
const rceditCli = path.join(path.dirname(rceditEntry), "..", "bin", process.arch === "ia32" ? "rcedit.exe" : "rcedit-x64.exe");
const fuse = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

function run(command, args, { timeoutMs } = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: false, timeout: timeoutMs });
  if (result.error) {
    if (result.error.code === "ETIMEDOUT") throw new Error(`${path.basename(command)} exceeded its ${Math.round(timeoutMs / 1000)} second time limit.`);
    throw result.error;
  }
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed with exit code ${result.status}.`);
}

for (const requirement of [entry, dashboard, iconGenerator, esbuildCli, postjectCli, rceditCli]) {
  if (!existsSync(requirement)) throw new Error(`Missing build requirement: ${requirement}`);
}

mkdirSync(dist, { recursive: true });
// Never recursively delete dist: older executable versions may still keep legacy user data there.
for (const artifact of [bundle, blob, seaConfig, executable, path.join(dist, ".env.example"), path.join(dist, "README.txt")]) {
  rmSync(artifact, { force: true });
}
run(process.execPath, [esbuildCli, entry, "--bundle", "--platform=node", "--format=cjs", "--target=node24", `--outfile=${bundle}`]);
writeFileSync(seaConfig, JSON.stringify({
  main: bundle,
  output: blob,
  assets: { "dashboard.html": dashboard },
}, null, 2));
run(process.execPath, ["--experimental-sea-config", seaConfig]);
copyFileSync(process.execPath, executable);
run(process.execPath, [postjectCli, executable, "NODE_SEA_BLOB", blob, "--sentinel-fuse", fuse]);
run(process.execPath, [iconGenerator, icon]);
// node-rcedit's async wrapper can keep pnpm/node alive indefinitely on some Windows systems.
// Invoke its bundled executable directly with a bounded wait so every build process terminates.
try {
  run(rceditCli, [executable, "--set-icon", icon], { timeoutMs: 15_000 });
} catch (error) {
  // The single executable is already complete at this point. An icon is cosmetic,
  // so leave it usable instead of allowing a stuck resource editor to orphan Node.
  console.warn(`Icon update skipped: ${error.message}`);
}
copyFileSync(path.join(root, ".env.example"), path.join(dist, ".env.example"));
writeFileSync(path.join(dist, "README.txt"), [
  "FLUX 실행 파일",
  "",
  "1. Flux.exe를 더블클릭합니다.",
  "2. 브라우저가 자동으로 열리지 않으면 http://127.0.0.1:4317 을 엽니다.",
  "3. Ollama 또는 OpenAI 호환 API를 사용하려면 .env.example을 .env로 복사한 뒤 값을 설정합니다.",
  "4. 최초 GUI 실행 뒤 새 터미널에서 `flux --help`를 입력합니다. `flux -chat \"질문\"`으로 명령줄 채팅을 시작할 수 있습니다.",
  "",
  "대화와 설정은 FLUX 폴더의 user-data에 저장됩니다.",
  "API 키와 user-data 폴더는 Git에 올리지 마세요.",
].join("\r\n"));
console.log(`Created ${executable}`);
