import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { addPathEntry, createWindowsCommandShim, getFluxCommandRegistration, registerFluxCommandOnFirstLaunch } from "../../cli/src/command-path.mjs";

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
