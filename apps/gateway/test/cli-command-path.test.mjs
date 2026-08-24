import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { addPathEntry, createLinuxCommandShim, createWindowsCommandShim, ensureFluxCommand, getFluxCommandRegistration, registerFluxCommandOnFirstLaunch } from "../../cli/src/command-path.mjs";

test("Windows CLI PATH registration adds FLUX bin only once", () => {
  assert.equal(addPathEntry("C:\\Windows;C:\\Tools", "F:\\FLUX\\user-data\\bin"), "C:\\Windows;C:\\Tools;F:\\FLUX\\user-data\\bin");
  assert.equal(addPathEntry("C:\\Windows;F:\\FLUX\\user-data\\bin", "f:/flux/user-data/bin/"), "C:\\Windows;F:\\FLUX\\user-data\\bin");
});

test("Windows CLI shim forwards every argument to the packaged executable", () => {
  assert.equal(createWindowsCommandShim("F:\\FLUX\\dist\\Flux.exe"), "@echo off\r\nset \"NODE_NO_WARNINGS=1\"\r\n\"F:\\FLUX\\dist\\Flux.exe\" cli %*\r\n");
  assert.throws(() => createWindowsCommandShim("relative/Flux.exe"), /must be absolute/);
});

test("automatic PATH registration is attempted only on the first application launch", async () => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "flux-cli-registration-"));
  let calls = 0;
  try {
    const register = async () => { calls += 1; return { installed: true }; };
    assert.equal((await getFluxCommandRegistration(dataDirectory)).state, "not-attempted");
    assert.equal((await registerFluxCommandOnFirstLaunch({ dataDirectory, register })).state, "ready");
    assert.equal((await registerFluxCommandOnFirstLaunch({ dataDirectory, register })).state, "ready");
    assert.equal(calls, 1);
  } finally { await fs.rm(dataDirectory, { recursive: true, force: true }); }
});

test("Linux CLI registration creates an executable user shim and adds a safe profile entry", async () => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "flux-linux-cli-data-"));
  const homeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "flux-linux-cli-home-"));
  try {
    assert.equal(createLinuxCommandShim("/opt/flux/Flux"), "#!/bin/sh\nexec '/opt/flux/Flux' cli \"$@\"\n");
    const result = await ensureFluxCommand({ dataDirectory, executablePath: "/opt/flux/Flux", packaged: true, platform: "linux", homeDirectory, environmentPath: "/usr/local/bin:/usr/bin" });
    assert.equal(result.installed, true);
    assert.equal(result.commandPath, path.join(homeDirectory, ".local", "bin", "flux"));
    assert.equal(await fs.readFile(result.commandPath, "utf8"), createLinuxCommandShim(path.resolve("/opt/flux/Flux")));
    assert.match(await fs.readFile(path.join(homeDirectory, ".profile"), "utf8"), /# FLUX CLI PATH/);
  } finally {
    await fs.rm(dataDirectory, { recursive: true, force: true });
    await fs.rm(homeDirectory, { recursive: true, force: true });
  }
});