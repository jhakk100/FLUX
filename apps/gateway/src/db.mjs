import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

export function openStore(dataDirectory) {
  fs.mkdirSync(dataDirectory, { recursive: true });
  const database = new DatabaseSync(path.join(dataDirectory, "flux.sqlite"));
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id),
      title TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'web',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      risk TEXT NOT NULL,
      target TEXT NOT NULL,
      preview TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      decided_at TEXT
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      details TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const now = () => new Date().toISOString();
  const id = () => randomUUID();
  const audit = (eventType, resourceType, resourceId, details) => {
    database.prepare("INSERT INTO audit_events VALUES (?, ?, ?, ?, ?, ?)")
      .run(id(), eventType, resourceType, resourceId, JSON.stringify(details), now());
  };

  function createProject({ name, workspacePath }) {
    const project = { id: id(), name, workspacePath, createdAt: now() };
    database.prepare("INSERT INTO projects VALUES (?, ?, ?, ?)")
      .run(project.id, project.name, project.workspacePath, project.createdAt);
    audit("project.created", "project", project.id, { name, workspacePath });
    return project;
  }

  function listProjects() {
    return database.prepare("SELECT id, name, workspace_path AS workspacePath, created_at AS createdAt FROM projects ORDER BY created_at ASC").all();
  }

  function getProject(projectId) {
    return database.prepare("SELECT id, name, workspace_path AS workspacePath, created_at AS createdAt FROM projects WHERE id = ?").get(projectId);
  }

  function createSession({ projectId = null, title = "새 대화", source = "web" }) {
    const session = { id: id(), projectId, title, source, createdAt: now(), updatedAt: now() };
    database.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?)")
      .run(session.id, session.projectId, session.title, session.source, session.createdAt, session.updatedAt);
    audit("session.created", "session", session.id, { projectId, source });
    return session;
  }

  function listSessions() {
    return database.prepare("SELECT id, project_id AS projectId, title, source, created_at AS createdAt, updated_at AS updatedAt FROM sessions ORDER BY updated_at DESC").all();
  }

  function getSession(sessionId) {
    return database.prepare("SELECT id, project_id AS projectId, title, source, created_at AS createdAt, updated_at AS updatedAt FROM sessions WHERE id = ?").get(sessionId);
  }

  function addMessage({ sessionId, role, content }) {
    const message = { id: id(), sessionId, role, content, createdAt: now() };
    database.prepare("INSERT INTO messages VALUES (?, ?, ?, ?, ?)")
      .run(message.id, message.sessionId, message.role, message.content, message.createdAt);
    database.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(message.createdAt, sessionId);
    audit("message.created", "message", message.id, { sessionId, role, length: content.length });
    return message;
  }

  function listMessages(sessionId) {
    return database.prepare("SELECT id, session_id AS sessionId, role, content, created_at AS createdAt FROM messages WHERE session_id = ? ORDER BY created_at ASC").all(sessionId);
  }

  function createApproval({ action, risk, target, preview, payload }) {
    const approval = { id: id(), action, risk, target, preview, payload, status: "pending", createdAt: now() };
    database.prepare("INSERT INTO approvals VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(approval.id, action, risk, target, preview, JSON.stringify(payload), approval.status, approval.createdAt, null);
    audit("approval.requested", "approval", approval.id, { action, risk, target });
    return approval;
  }

  function listApprovals() {
    return database.prepare("SELECT id, action, risk, target, preview, status, created_at AS createdAt, decided_at AS decidedAt FROM approvals ORDER BY created_at DESC").all();
  }

  function getApproval(approvalId) {
    const approval = database.prepare("SELECT * FROM approvals WHERE id = ?").get(approvalId);
    return approval ? { ...approval, payload: JSON.parse(approval.payload) } : null;
  }

  function decideApproval(approvalId, status) {
    const approval = database.prepare("SELECT * FROM approvals WHERE id = ?").get(approvalId);
    if (!approval) return null;
    if (approval.status !== "pending") throw new Error("This approval was already decided.");
    const decidedAt = now();
    database.prepare("UPDATE approvals SET status = ?, decided_at = ? WHERE id = ?").run(status, decidedAt, approvalId);
    audit(`approval.${status}`, "approval", approvalId, { action: approval.action, target: approval.target });
    return { ...approval, payload: JSON.parse(approval.payload), status, decidedAt };
  }

  function listAuditEvents(limit = 100) {
    return database.prepare("SELECT id, event_type AS eventType, resource_type AS resourceType, resource_id AS resourceId, details, created_at AS createdAt FROM audit_events ORDER BY created_at DESC LIMIT ?").all(limit)
      .map((item) => ({ ...item, details: JSON.parse(item.details) }));
  }

  function getSetting(key) {
    const row = database.prepare("SELECT value FROM settings WHERE key = ?").get(key);
    return row ? JSON.parse(row.value) : null;
  }

  function setSetting(key, value) {
    const updatedAt = now();
    database.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
      .run(key, JSON.stringify(value), updatedAt);
    audit("setting.updated", "setting", key, { key });
  }

  return { createProject, listProjects, getProject, createSession, listSessions, getSession, addMessage, listMessages, createApproval, listApprovals, getApproval, decideApproval, listAuditEvents, getSetting, setSetting };
}
