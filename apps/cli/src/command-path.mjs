import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import process from "node:process";
import { isSea } from "node:sea";

const execFileAsync = promisify(execFile);
const REGISTRATION_FILE = "cli-path-registration.json";

function comparablePath(value) {
  return String(value ?? "").trim().replace(/^"|"$/g, "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function addPathEntry(currentPath, entry) {
  const entries = String(currentPath ?? "").split(";").map((value) => value.trim()).filter(Boolean);
  if (entries.some((value) => comparablePath(value) === comparablePath(entry))) return entries.join(";");
  return [...entries, entry].join(";");
}

export function createWindowsCommandShim(executablePath) {
  if (!path.isAbsolute(executablePath)) throw new Error("FLUX executable path must be absolute.");
  if (executablePath.includes('"')) throw new Error("FLUX executable path cannot contain a quote.");
  return `@echo off\r\nset "NODE_NO_WARNINGS=1"\r\n"${executablePath}" cli %*\r\n`;
}

async function readUserPath() {
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "[Environment]::GetEnvironmentVariable('Path', 'User')"], { windowsHide: true });
  return stdout.trim();
}

async function writeUserPath(value) {
  // Keep the path value in the process environment rather than interpolating it
  // into PowerShell source. Spaces and Korean folder names remain safe this way.
  await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "[Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('FLUX_CLI_PATH_VALUE', 'Process'), 'User')"], {
    windowsHide: true,
    env: { ...process.env, FLUX_CLI_PATH_VALUE: value },
  });
}

export async function ensureFluxCommand({ dataDirectory, executablePath = process.execPath, packaged = isSea(), platform = process.platform } = {}) {
  if (platform !== "win32") return { installed: false, reason: "Windows에서만 PATH 등록을 지원합니다." };
  if (!packaged) return { installed: false, reason: "개발용 Node 실행은 PATH에 등록하지 않습니다." };
  if (!dataDirectory) throw new Error("FLUX data directory is required to install the CLI command.");

  const binDirectory = path.join(path.resolve(dataDirectory), "bin");
  const commandPath = path.join(binDirectory, "flux.cmd");
  await fs.mkdir(binDirectory, { recursive: true });
  await fs.writeFile(commandPath, createWindowsCommandShim(path.resolve(executablePath)), "utf8");

  const currentPath = await readUserPath();
  const nextPath = addPathEntry(currentPath, binDirectory);
  if (nextPath !== currentPath) await writeUserPath(nextPath);
  return { installed: true, commandPath, binDirectory, pathUpdated: nextPath !== currentPath };
}

function registrationPath(dataDirectory) {
  return path.join(path.resolve(dataDirectory), REGISTRATION_FILE);
}

export async function getFluxCommandRegistration(dataDirectory) {
  try {
    const result = JSON.parse(await fs.readFile(registrationPath(dataDirectory), "utf8"));
    return { automaticAttempted: Boolean(result.automaticAttempted), state: result.state ?? "unknown", message: result.message ?? "" };
  } catch (error) {
    if (error.code === "ENOENT") return { automaticAttempted: false, state: "not-attempted", message: "첫 실행 시 자동 등록을 아직 시도하지 않았습니다." };
    return { automaticAttempted: true, state: "failed", message: "CLI PATH 등록 상태를 읽지 못했습니다." };
  }
}

async function saveFluxCommandRegistration(dataDirectory, result) {
  await fs.mkdir(path.resolve(dataDirectory), { recursive: true });
  await fs.writeFile(registrationPath(dataDirectory), JSON.stringify(result, null, 2), "utf8");
}

export async function registerFluxCommandOnFirstLaunch({ dataDirectory, register = ensureFluxCommand } = {}) {
  const previous = await getFluxCommandRegistration(dataDirectory);
  if (previous.automaticAttempted) return previous;
  try {
    const result = await register({ dataDirectory });
    const state = result.installed ? "ready" : "failed";
    const registration = { automaticAttempted: true, state, message: result.installed ? "flux 명령이 사용자 PATH에 등록되었습니다. 새 터미널에서 사용할 수 있습니다." : result.reason ?? "CLI PATH 자동 등록에 실패했습니다." };
    await saveFluxCommandRegistration(dataDirectory, registration);
    return registration;
  } catch (error) {
    const registration = { automaticAttempted: true, state: "failed", message: `CLI PATH 자동 등록에 실패했습니다: ${error.message}` };
    await saveFluxCommandRegistration(dataDirectory, registration);
    return registration;
  }
}

export async function registerFluxCommandManually({ dataDirectory } = {}) {
  try {
    const result = await ensureFluxCommand({ dataDirectory });
    const registration = { automaticAttempted: true, state: result.installed ? "ready" : "failed", message: result.installed ? "flux 명령을 사용자 PATH에 등록했습니다. 새 터미널에서 사용할 수 있습니다." : result.reason ?? "CLI PATH 등록에 실패했습니다.", commandPath: result.commandPath ?? null, pathUpdated: Boolean(result.pathUpdated) };
    await saveFluxCommandRegistration(dataDirectory, registration);
    return registration;
  } catch (error) {
    const registration = { automaticAttempted: true, state: "failed", message: `CLI PATH 등록에 실패했습니다: ${error.message}`, commandPath: null, pathUpdated: false };
    await saveFluxCommandRegistration(dataDirectory, registration);
    return registration;
  }
}
