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
const esbuildCli = require.resolve("esbuild/bin/esbuild");
const postjectCli = require.resolve("postject/dist/cli.js");
const fuse = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed with exit code ${result.status}.`);
}

for (const requirement of [entry, dashboard, esbuildCli, postjectCli]) {
  if (!existsSync(requirement)) throw new Error(`Missing build requirement: ${requirement}`);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
run(process.execPath, [esbuildCli, entry, "--bundle", "--platform=node", "--format=cjs", "--target=node24", `--outfile=${bundle}`]);
writeFileSync(seaConfig, JSON.stringify({
  main: bundle,
  output: blob,
  assets: { "dashboard.html": dashboard },
}, null, 2));
run(process.execPath, ["--experimental-sea-config", seaConfig]);
copyFileSync(process.execPath, executable);
run(process.execPath, [postjectCli, executable, "NODE_SEA_BLOB", blob, "--sentinel-fuse", fuse]);
copyFileSync(path.join(root, ".env.example"), path.join(dist, ".env.example"));
writeFileSync(path.join(dist, "README.txt"), [
  "FLUX 실행 파일",
  "",
  "1. Flux.exe를 더블클릭합니다.",
  "2. 브라우저가 자동으로 열리지 않으면 http://127.0.0.1:4317 을 엽니다.",
  "3. Ollama 또는 OpenAI 호환 API를 사용하려면 .env.example을 .env로 복사한 뒤 값을 설정합니다.",
  "",
  "데이터베이스와 첨부 파일은 실행한 폴더의 data 폴더에 저장됩니다.",
  "API 키와 data 폴더는 Git에 올리지 마세요.",
].join("\r\n"));
console.log(`Created ${executable}`);
