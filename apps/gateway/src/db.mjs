import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

function migrateLegacyStore(dataDirectory, legacyDataDirectories) {
  const destination = path.join(dataDirectory, "flux.sqlite");
  if (fs.existsSync(destination)) return;
  const sourceDirectory = legacyDataDirectories.find((directory) => directory && path.resolve(dataDirectory) !== path.resolve(directory) && fs.existsSync(path.join(directory, "flux.sqlite")));
  if (!sourceDirectory) return;
  const source = path.join(sourceDirectory, "flux.sqlite");
  fs.mkdirSync(dataDirectory, { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    const legacyFile = `${source}${suffix}`;
    if (fs.existsSync(legacyFile)) fs.copyFileSync(legacyFile, `${destination}${suffix}`);
  }
}

export function openStore(dataDirectory, { legacyDataDirectory, legacyDataDirectories = [] } = {}) {
  migrateLegacyStore(dataDirectory, [...legacyDataDirectories, legacyDataDirectory]);
  fs.mkdirSync(dataDirectory, { recursive: true });
  const database = new DatabaseSync(path.join(dataDirectory, "flux.sqlite"));
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      instructions TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_agents (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT '',
      provider_override TEXT NOT NULL,
      model_override TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      turn_order INTEGER NOT NULL DEFAULT 0,
      timeout_seconds INTEGER NOT NULL DEFAULT 300,
      wait_seconds INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS project_agents_project_idx ON project_agents (project_id, turn_order, created_at);
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id),
      title TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'web',
      created_at TEXT NOT NULL,
      project_lead INTEGER NOT NULL DEFAULT 0,
      role TEXT NOT NULL DEFAULT '',
      requests_per_minute INTEGER NOT NULL DEFAULT 0,
      min_interval_seconds INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      sender_kind TEXT,
      sender_name TEXT,
      project_member_id TEXT,
      collaboration_run_id TEXT
    );
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      storage_path TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS attachments_session_message_idx ON attachments (session_id, message_id, created_at);
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
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'fact',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session_context (
      session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      summary TEXT NOT NULL DEFAULT '',
      covered_count INTEGER NOT NULL DEFAULT 0,
      tags TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS discord_sessions (
      channel_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (channel_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS collaboration_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      lead_session_id TEXT NOT NULL,
      request_content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      started_at TEXT NOT NULL,
      completed_at TEXT,
      elapsed_ms INTEGER,
      summary TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS collaboration_runs_lead_idx ON collaboration_runs (lead_session_id, started_at DESC);
    CREATE TABLE IF NOT EXISTS collaboration_tasks (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES collaboration_runs(id) ON DELETE CASCADE,
      child_session_id TEXT NOT NULL,
      child_name TEXT NOT NULL,
      child_role TEXT NOT NULL DEFAULT '',
      provider TEXT,
      model TEXT,
      instruction_message_id TEXT,
      response_message_id TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      error TEXT NOT NULL DEFAULT '',
      started_at TEXT,
      completed_at TEXT,
      elapsed_ms INTEGER
    );
    CREATE INDEX IF NOT EXISTS collaboration_tasks_run_idx ON collaboration_tasks (run_id, child_session_id);
    CREATE TABLE IF NOT EXISTS file_change_provenance (
      id TEXT PRIMARY KEY,
      approval_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      action TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'user',
      session_id TEXT,
      collaboration_run_id TEXT,
      provider TEXT,
      model TEXT,
      debug_marker INTEGER NOT NULL DEFAULT 0,
      resulting_hash TEXT,
      applied_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS file_change_provenance_project_idx ON file_change_provenance (project_id, applied_at DESC);
  `);
  const sessionColumns = database.prepare("PRAGMA table_info(sessions)").all();
  if (!sessionColumns.some((column) => column.name === "archived_at")) {
    database.exec("ALTER TABLE sessions ADD COLUMN archived_at TEXT");
  }
  if (!sessionColumns.some((column) => column.name === "provider_override")) {
    database.exec("ALTER TABLE sessions ADD COLUMN provider_override TEXT");
  }
  if (!sessionColumns.some((column) => column.name === "model_override")) {
    database.exec("ALTER TABLE sessions ADD COLUMN model_override TEXT");
  }
  if (!sessionColumns.some((column) => column.name === "project_lead")) {
    database.exec("ALTER TABLE sessions ADD COLUMN project_lead INTEGER NOT NULL DEFAULT 0");
  }
  if (!sessionColumns.some((column) => column.name === "role")) {
    database.exec("ALTER TABLE sessions ADD COLUMN role TEXT NOT NULL DEFAULT ''");
  }
  if (!sessionColumns.some((column) => column.name === "requests_per_minute")) {
    database.exec("ALTER TABLE sessions ADD COLUMN requests_per_minute INTEGER NOT NULL DEFAULT 0");
  }
  if (!sessionColumns.some((column) => column.name === "min_interval_seconds")) {
    database.exec("ALTER TABLE sessions ADD COLUMN min_interval_seconds INTEGER NOT NULL DEFAULT 0");
  }
  database.exec("CREATE UNIQUE INDEX IF NOT EXISTS project_lead_session_idx ON sessions (project_id) WHERE project_lead = 1");
  const projectAgentColumns = database.prepare("PRAGMA table_info(project_agents)").all();
  if (!projectAgentColumns.some((column) => column.name === "turn_order")) database.exec("ALTER TABLE project_agents ADD COLUMN turn_order INTEGER NOT NULL DEFAULT 0");
  if (!projectAgentColumns.some((column) => column.name === "timeout_seconds")) database.exec("ALTER TABLE project_agents ADD COLUMN timeout_seconds INTEGER NOT NULL DEFAULT 300");
  if (!projectAgentColumns.some((column) => column.name === "wait_seconds")) database.exec("ALTER TABLE project_agents ADD COLUMN wait_seconds INTEGER NOT NULL DEFAULT 0");
  const messageColumns = database.prepare("PRAGMA table_info(messages)").all();
  if (!messageColumns.some((column) => column.name === "sender_kind")) database.exec("ALTER TABLE messages ADD COLUMN sender_kind TEXT");
  if (!messageColumns.some((column) => column.name === "sender_name")) database.exec("ALTER TABLE messages ADD COLUMN sender_name TEXT");
  if (!messageColumns.some((column) => column.name === "project_member_id")) database.exec("ALTER TABLE messages ADD COLUMN project_member_id TEXT");
  if (!messageColumns.some((column) => column.name === "collaboration_run_id")) database.exec("ALTER TABLE messages ADD COLUMN collaboration_run_id TEXT");
  const projectColumns = database.prepare("PRAGMA table_info(projects)").all();
  if (!projectColumns.some((column) => column.name === "instructions")) {
    database.exec("ALTER TABLE projects ADD COLUMN instructions TEXT NOT NULL DEFAULT ''");
  }

  const now = () => new Date().toISOString();
  const id = () => randomUUID();
  const audit = (eventType, resourceType, resourceId, details) => {
    database.prepare("INSERT INTO audit_events VALUES (?, ?, ?, ?, ?, ?)")
      .run(id(), eventType, resourceType, resourceId, JSON.stringify(details), now());
  };

  function createProject({ name, workspacePath, instructions = "" }) {
    const project = { id: id(), name, workspacePath, instructions, createdAt: now() };
    database.prepare("INSERT INTO projects (id, name, workspace_path, instructions, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(project.id, project.name, project.workspacePath, project.instructions, project.createdAt);
    audit("project.created", "project", project.id, { name, workspacePath });
    return project;
  }

  function listProjects() {
    return database.prepare("SELECT id, name, workspace_path AS workspacePath, instructions, created_at AS createdAt FROM projects ORDER BY created_at ASC").all();
  }

  function getProject(projectId) {
    return database.prepare("SELECT id, name, workspace_path AS workspacePath, instructions, created_at AS createdAt FROM projects WHERE id = ?").get(projectId);
  }

  function updateProjectInstructions(projectId, instructions) {
    const project = getProject(projectId);
    if (!project) return null;
    database.prepare("UPDATE projects SET instructions = ? WHERE id = ?").run(instructions, projectId);
    audit("project.instructions_updated", "project", projectId, { length: instructions.length });
    return getProject(projectId);
  }

  function listProjectAgents(projectId) {
    return database.prepare("SELECT id, project_id AS projectId, name, role, provider_override AS providerOverride, model_override AS modelOverride, enabled, turn_order AS turnOrder, timeout_seconds AS timeoutSeconds, wait_seconds AS waitSeconds, created_at AS createdAt, updated_at AS updatedAt FROM project_agents WHERE project_id = ? ORDER BY turn_order ASC, created_at ASC, rowid ASC").all(projectId)
      .map((agent) => ({ ...agent, enabled: Boolean(agent.enabled) }));
  }

  function getProjectAgent(projectId, agentId) {
    const agent = database.prepare("SELECT id, project_id AS projectId, name, role, provider_override AS providerOverride, model_override AS modelOverride, enabled, turn_order AS turnOrder, timeout_seconds AS timeoutSeconds, wait_seconds AS waitSeconds, created_at AS createdAt, updated_at AS updatedAt FROM project_agents WHERE project_id = ? AND id = ?").get(projectId, agentId);
    return agent ? { ...agent, enabled: Boolean(agent.enabled) } : null;
  }

  function createProjectAgent({ projectId, name, role = "", providerOverride, modelOverride = null, enabled = true, turnOrder = null, timeoutSeconds = 300, waitSeconds = 0 }) {
    const nextOrder = Number.isInteger(turnOrder) ? turnOrder : database.prepare("SELECT COUNT(*) AS count FROM project_agents WHERE project_id = ?").get(projectId).count;
    const agent = { id: id(), projectId, name, role, providerOverride, modelOverride, enabled: Boolean(enabled), turnOrder: nextOrder, timeoutSeconds, waitSeconds, createdAt: now(), updatedAt: now() };
    database.prepare("INSERT INTO project_agents (id, project_id, name, role, provider_override, model_override, enabled, turn_order, timeout_seconds, wait_seconds, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(agent.id, agent.projectId, agent.name, agent.role, agent.providerOverride, agent.modelOverride, agent.enabled ? 1 : 0, agent.turnOrder, agent.timeoutSeconds, agent.waitSeconds, agent.createdAt, agent.updatedAt);
    audit("project_agent.created", "project_agent", agent.id, { projectId, name, providerOverride, modelOverride, enabled: agent.enabled, turnOrder: agent.turnOrder });
    return agent;
  }

  function updateProjectAgent(projectId, agentId, { name, role, providerOverride, modelOverride, enabled, turnOrder, timeoutSeconds, waitSeconds }) {
    const agent = getProjectAgent(projectId, agentId);
    if (!agent) return null;
    const next = {
      name: name ?? agent.name,
      role: role ?? agent.role,
      providerOverride: providerOverride ?? agent.providerOverride,
      modelOverride: modelOverride === undefined ? agent.modelOverride : modelOverride,
      enabled: enabled ?? agent.enabled,
      turnOrder: turnOrder ?? agent.turnOrder,
      timeoutSeconds: timeoutSeconds ?? agent.timeoutSeconds,
      waitSeconds: waitSeconds ?? agent.waitSeconds,
      updatedAt: now(),
    };
    database.prepare("UPDATE project_agents SET name = ?, role = ?, provider_override = ?, model_override = ?, enabled = ?, turn_order = ?, timeout_seconds = ?, wait_seconds = ?, updated_at = ? WHERE id = ?")
      .run(next.name, next.role, next.providerOverride, next.modelOverride, next.enabled ? 1 : 0, next.turnOrder, next.timeoutSeconds, next.waitSeconds, next.updatedAt, agentId);
    audit("project_agent.updated", "project_agent", agentId, { projectId, name: next.name, providerOverride: next.providerOverride, modelOverride: next.modelOverride, enabled: Boolean(next.enabled), turnOrder: next.turnOrder });
    return getProjectAgent(projectId, agentId);
  }

  function deleteProjectAgent(projectId, agentId) {
    const agent = getProjectAgent(projectId, agentId);
    if (!agent) return null;
    database.prepare("DELETE FROM project_agents WHERE id = ?").run(agentId);
    audit("project_agent.deleted", "project_agent", agentId, { projectId, name: agent.name });
    return agent;
  }


  function deleteProject(projectId) {
    const project = getProject(projectId);
    if (!project) return null;
    // Removing a FLUX project never touches its real workspace. Conversations
    // remain available, but lose only the association with this project.
    database.exec("BEGIN");
    try {
      database.prepare("UPDATE sessions SET project_id = NULL WHERE project_id = ?").run(projectId);
      database.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    audit("project.deleted", "project", projectId, { name: project.name, workspacePath: project.workspacePath, workspaceDeleted: false });
    return project;
  }
  function createSession({ projectId = null, projectLead = false, role = "", title = "새 대화", source = "web", providerOverride = null, modelOverride = null }) {
    const session = { id: id(), projectId, projectLead: Boolean(projectLead), role, requestsPerMinute: 0, minIntervalSeconds: 0, title, source, providerOverride, modelOverride, createdAt: now(), updatedAt: now() };
    database.prepare("INSERT INTO sessions (id, project_id, project_lead, role, title, source, provider_override, model_override, created_at, updated_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(session.id, session.projectId, session.projectLead ? 1 : 0, session.role, session.title, session.source, session.providerOverride, session.modelOverride, session.createdAt, session.updatedAt, null);
    audit("session.created", "session", session.id, { projectId, projectLead: session.projectLead, role: Boolean(session.role), source });
    return session;
  }

  function listSessions({ archived = false } = {}) {
    return database.prepare("SELECT id, project_id AS projectId, project_lead AS projectLead, role, requests_per_minute AS requestsPerMinute, min_interval_seconds AS minIntervalSeconds, title, source, provider_override AS providerOverride, model_override AS modelOverride, created_at AS createdAt, updated_at AS updatedAt, archived_at AS archivedAt FROM sessions WHERE (archived_at IS NOT NULL) = ? ORDER BY updated_at DESC")
      .all(archived ? 1 : 0);
  }

  function countProjectChildSessions(projectId, { archived = false } = {}) {
    return database.prepare("SELECT COUNT(*) AS count FROM sessions WHERE project_id = ? AND project_lead = 0 AND (archived_at IS NOT NULL) = ?")
      .get(projectId, archived ? 1 : 0).count;
  }

  function getProjectLeadSession(projectId) {
    return database.prepare("SELECT id, project_id AS projectId, project_lead AS projectLead, role, requests_per_minute AS requestsPerMinute, min_interval_seconds AS minIntervalSeconds, title, source, provider_override AS providerOverride, model_override AS modelOverride, created_at AS createdAt, updated_at AS updatedAt, archived_at AS archivedAt FROM sessions WHERE project_id = ? AND project_lead = 1").get(projectId) ?? null;
  }

  function ensureProjectLeadSession(project) {
    const existing = getProjectLeadSession(project.id);
    if (existing) return existing.archivedAt ? archiveSession(existing.id, false) : existing;
    return createSession({ projectId: project.id, projectLead: true, title: `${project.name} · superior` });
  }

  function getSession(sessionId) {
    return database.prepare("SELECT id, project_id AS projectId, project_lead AS projectLead, role, requests_per_minute AS requestsPerMinute, min_interval_seconds AS minIntervalSeconds, title, source, provider_override AS providerOverride, model_override AS modelOverride, created_at AS createdAt, updated_at AS updatedAt, archived_at AS archivedAt FROM sessions WHERE id = ?").get(sessionId);
  }

  function renameSession(sessionId, title) {
    const session = getSession(sessionId);
    if (!session) return null;
    const updatedAt = now();
    database.prepare("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?").run(title, updatedAt, sessionId);
    audit("session.renamed", "session", sessionId, { title });
    return getSession(sessionId);
  }

  function archiveSession(sessionId, archived) {
    const session = getSession(sessionId);
    if (!session) return null;
    const updatedAt = now();
    const archivedAt = archived ? updatedAt : null;
    database.prepare("UPDATE sessions SET archived_at = ?, updated_at = ? WHERE id = ?").run(archivedAt, updatedAt, sessionId);
    audit(archived ? "session.archived" : "session.unarchived", "session", sessionId, {});
    return getSession(sessionId);
  }

  function updateSessionModel(sessionId, { providerOverride = null, modelOverride = null }) {
    const session = getSession(sessionId);
    if (!session) return null;
    const updatedAt = now();
    database.prepare("UPDATE sessions SET provider_override = ?, model_override = ?, updated_at = ? WHERE id = ?")
      .run(providerOverride, modelOverride, updatedAt, sessionId);
    audit("session.model_updated", "session", sessionId, { providerOverride, modelOverride });
    return getSession(sessionId);
  }

  function updateSessionRole(sessionId, role) {
    const session = getSession(sessionId);
    if (!session) return null;
    const updatedAt = now();
    database.prepare("UPDATE sessions SET role = ?, updated_at = ? WHERE id = ?").run(role, updatedAt, sessionId);
    audit("session.role_updated", "session", sessionId, { configured: Boolean(role) });
    return getSession(sessionId);
  }

  function updateSessionRateLimit(sessionId, { requestsPerMinute, minIntervalSeconds }) {
    const session = getSession(sessionId);
    if (!session) return null;
    const updatedAt = now();
    database.prepare("UPDATE sessions SET requests_per_minute = ?, min_interval_seconds = ?, updated_at = ? WHERE id = ?")
      .run(requestsPerMinute, minIntervalSeconds, updatedAt, sessionId);
    audit("session.rate_limit_updated", "session", sessionId, { requestsPerMinute, minIntervalSeconds });
    return getSession(sessionId);
  }
  function searchSessions(query, { archived = false } = {}) {
    const like = `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    return database.prepare(`
      SELECT sessions.id, sessions.project_id AS projectId, sessions.project_lead AS projectLead, sessions.role, sessions.requests_per_minute AS requestsPerMinute, sessions.min_interval_seconds AS minIntervalSeconds, sessions.title, sessions.source, sessions.provider_override AS providerOverride, sessions.model_override AS modelOverride,
             sessions.created_at AS createdAt, sessions.updated_at AS updatedAt, sessions.archived_at AS archivedAt,
             substr(messages.content, 1, 180) AS matchedContent
      FROM sessions LEFT JOIN messages ON messages.session_id = sessions.id
      WHERE (sessions.archived_at IS NOT NULL) = ? AND (sessions.title LIKE ? ESCAPE '\\' OR messages.content LIKE ? ESCAPE '\\')
      GROUP BY sessions.id
      ORDER BY sessions.updated_at DESC
      LIMIT 50
    `).all(archived ? 1 : 0, like, like);
  }

  function addMessage({ sessionId, role, content, senderKind = null, senderName = null, projectMemberId = null, collaborationRunId = null }) {
    const message = { id: id(), sessionId, role, content, senderKind, senderName, projectMemberId, collaborationRunId, createdAt: now() };
    database.prepare("INSERT INTO messages (id, session_id, role, content, created_at, sender_kind, sender_name, project_member_id, collaboration_run_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(message.id, message.sessionId, message.role, message.content, message.createdAt, message.senderKind, message.senderName, message.projectMemberId, message.collaborationRunId);
    database.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(message.createdAt, sessionId);
    audit("message.created", "message", message.id, { sessionId, role, senderKind, projectMemberId, length: content.length });
    return message;
  }

  function listMessages(sessionId) {
    const messages = database.prepare("SELECT id, session_id AS sessionId, role, content, created_at AS createdAt, sender_kind AS senderKind, sender_name AS senderName, project_member_id AS projectMemberId, collaboration_run_id AS collaborationRunId FROM messages WHERE session_id = ? ORDER BY created_at ASC, rowid ASC").all(sessionId);
    const attachments = database.prepare("SELECT id, session_id AS sessionId, message_id AS messageId, file_name AS fileName, mime_type AS mimeType, byte_size AS byteSize, storage_path AS storagePath, created_at AS createdAt FROM attachments WHERE session_id = ? AND message_id IS NOT NULL ORDER BY created_at ASC").all(sessionId);
    const byMessage = new Map();
    for (const attachment of attachments) {
      const items = byMessage.get(attachment.messageId) ?? [];
      items.push(attachment);
      byMessage.set(attachment.messageId, items);
    }
    return messages.map((message) => ({ ...message, attachments: byMessage.get(message.id) ?? [] }));
  }

  function createPendingAttachment({ sessionId, fileName, mimeType, byteSize, storagePath }) {
    const attachment = { id: id(), sessionId, messageId: null, fileName, mimeType, byteSize, storagePath, createdAt: now() };
    database.prepare("INSERT INTO attachments (id, session_id, message_id, file_name, mime_type, byte_size, storage_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(attachment.id, attachment.sessionId, null, attachment.fileName, attachment.mimeType, attachment.byteSize, attachment.storagePath, attachment.createdAt);
    audit("attachment.uploaded", "attachment", attachment.id, { sessionId, fileName, mimeType, byteSize });
    return attachment;
  }

  function getAttachment(attachmentId) {
    return database.prepare("SELECT id, session_id AS sessionId, message_id AS messageId, file_name AS fileName, mime_type AS mimeType, byte_size AS byteSize, storage_path AS storagePath, created_at AS createdAt FROM attachments WHERE id = ?").get(attachmentId) ?? null;
  }

  function attachPendingAttachments({ sessionId, messageId, attachmentIds = [] }) {
    const ids = [...new Set(attachmentIds)];
    for (const attachmentId of ids) {
      const attachment = getAttachment(attachmentId);
      if (!attachment || attachment.sessionId !== sessionId || attachment.messageId) throw new Error("Attachment is missing or already attached.");
    }
    for (const attachmentId of ids) database.prepare("UPDATE attachments SET message_id = ? WHERE id = ?").run(messageId, attachmentId);
    if (ids.length) audit("attachment.attached", "message", messageId, { sessionId, attachmentIds: ids });
    return ids.map(getAttachment);
  }

  function deletePendingAttachment(attachmentId) {
    const attachment = getAttachment(attachmentId);
    if (!attachment || attachment.messageId) return null;
    database.prepare("DELETE FROM attachments WHERE id = ?").run(attachmentId);
    audit("attachment.deleted", "attachment", attachmentId, { sessionId: attachment.sessionId, reason: "cancelled" });
    return attachment;
  }

  function deleteMessage(messageId) {
    const message = database.prepare("SELECT id, session_id AS sessionId, role, content, created_at AS createdAt FROM messages WHERE id = ?").get(messageId);
    if (!message) return null;
    database.prepare("DELETE FROM messages WHERE id = ?").run(messageId);
    database.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(now(), message.sessionId);
    audit("message.deleted", "message", messageId, { sessionId: message.sessionId, role: message.role, reason: "regenerated" });
    return message;
  }


  function deleteSession(sessionId) {
    const session = getSession(sessionId);
    if (!session) return null;
    const attachments = database.prepare("SELECT storage_path AS storagePath FROM attachments WHERE session_id = ?").all(sessionId);
    database.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
    audit("session.deleted", "session", sessionId, { title: session.title, attachmentCount: attachments.length });
    return { session, attachments };
  }

  function getOrCreateDiscordSession({ channelId, userId, title }) {
    const linked = database.prepare("SELECT session_id AS sessionId FROM discord_sessions WHERE channel_id = ? AND user_id = ?").get(channelId, userId);
    if (linked) {
      const session = getSession(linked.sessionId);
      if (session && !session.archivedAt) return session;
    }
    const session = createSession({ title, source: "discord" });
    database.prepare("INSERT INTO discord_sessions (channel_id, user_id, session_id, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(channel_id, user_id) DO UPDATE SET session_id = excluded.session_id, updated_at = excluded.updated_at")
      .run(channelId, userId, session.id, now());
    audit("discord.session_linked", "session", session.id, { channelId, userId });
    return session;
  }

  function getSessionContext(sessionId) {
    const row = database.prepare("SELECT summary, covered_count AS coveredCount, tags, updated_at AS updatedAt FROM session_context WHERE session_id = ?").get(sessionId);
    return row ? { ...row, tags: JSON.parse(row.tags) } : { summary: "", coveredCount: 0, tags: [], updatedAt: null };
  }

  function saveSessionContext(sessionId, { summary, coveredCount, tags }) {
    const updatedAt = now();
    database.prepare("INSERT INTO session_context (session_id, summary, covered_count, tags, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET summary = excluded.summary, covered_count = excluded.covered_count, tags = excluded.tags, updated_at = excluded.updated_at")
      .run(sessionId, summary, coveredCount, JSON.stringify(tags), updatedAt);
    audit("session.context_compacted", "session", sessionId, { coveredCount, tags });
    return getSessionContext(sessionId);
  }

  function listMemories(query = "", limit = 100) {
    const normalized = query.trim();
    if (!normalized) {
      return database.prepare("SELECT id, content, kind, created_at AS createdAt, updated_at AS updatedAt FROM memories ORDER BY updated_at DESC LIMIT ?").all(limit);
    }
    const like = `%${normalized.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    return database.prepare("SELECT id, content, kind, created_at AS createdAt, updated_at AS updatedAt FROM memories WHERE content LIKE ? ESCAPE '\\' OR kind LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT ?")
      .all(like, like, limit);
  }

  function createMemory({ content, kind = "fact" }) {
    const memory = { id: id(), content, kind, createdAt: now(), updatedAt: now() };
    database.prepare("INSERT INTO memories VALUES (?, ?, ?, ?, ?)").run(memory.id, memory.content, memory.kind, memory.createdAt, memory.updatedAt);
    audit("memory.created", "memory", memory.id, { kind, length: content.length });
    return memory;
  }

  function updateMemory(memoryId, { content, kind }) {
    const existing = database.prepare("SELECT id FROM memories WHERE id = ?").get(memoryId);
    if (!existing) return null;
    const updatedAt = now();
    database.prepare("UPDATE memories SET content = ?, kind = ?, updated_at = ? WHERE id = ?").run(content, kind, updatedAt, memoryId);
    audit("memory.updated", "memory", memoryId, { kind, length: content.length });
    return database.prepare("SELECT id, content, kind, created_at AS createdAt, updated_at AS updatedAt FROM memories WHERE id = ?").get(memoryId);
  }

  function deleteMemory(memoryId) {
    const existing = database.prepare("SELECT id FROM memories WHERE id = ?").get(memoryId);
    if (!existing) return false;
    database.prepare("DELETE FROM memories WHERE id = ?").run(memoryId);
    audit("memory.deleted", "memory", memoryId, {});
    return true;
  }

  function listGoals() {
    return database.prepare("SELECT id, title, details, status, created_at AS createdAt, updated_at AS updatedAt FROM goals ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, updated_at DESC").all();
  }

  function createGoal({ title, details = "", status = "active" }) {
    const goal = { id: id(), title, details, status, createdAt: now(), updatedAt: now() };
    database.prepare("INSERT INTO goals VALUES (?, ?, ?, ?, ?, ?)").run(goal.id, goal.title, goal.details, goal.status, goal.createdAt, goal.updatedAt);
    audit("goal.created", "goal", goal.id, { status });
    return goal;
  }

  function updateGoal(goalId, { title, details, status }) {
    const existing = database.prepare("SELECT id FROM goals WHERE id = ?").get(goalId);
    if (!existing) return null;
    const updatedAt = now();
    database.prepare("UPDATE goals SET title = ?, details = ?, status = ?, updated_at = ? WHERE id = ?").run(title, details, status, updatedAt, goalId);
    audit("goal.updated", "goal", goalId, { status });
    return database.prepare("SELECT id, title, details, status, created_at AS createdAt, updated_at AS updatedAt FROM goals WHERE id = ?").get(goalId);
  }

  function deleteGoal(goalId) {
    const existing = database.prepare("SELECT id FROM goals WHERE id = ?").get(goalId);
    if (!existing) return false;
    database.prepare("DELETE FROM goals WHERE id = ?").run(goalId);
    audit("goal.deleted", "goal", goalId, {});
    return true;
  }

  function publicCollaborationTask(task) {
    return {
      id: task.id,
      runId: task.runId,
      childSessionId: task.childSessionId,
      childName: task.childName,
      childRole: task.childRole,
      provider: task.provider,
      model: task.model,
      instructionMessageId: task.instructionMessageId,
      responseMessageId: task.responseMessageId,
      status: task.status,
      error: task.error,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      elapsedMs: task.elapsedMs,
    };
  }

  function getCollaborationRun(runId) {
    const run = database.prepare("SELECT id, project_id AS projectId, lead_session_id AS leadSessionId, request_content AS requestContent, status, started_at AS startedAt, completed_at AS completedAt, elapsed_ms AS elapsedMs, summary FROM collaboration_runs WHERE id = ?").get(runId);
    if (!run) return null;
    const tasks = database.prepare("SELECT id, run_id AS runId, child_session_id AS childSessionId, child_name AS childName, child_role AS childRole, provider, model, instruction_message_id AS instructionMessageId, response_message_id AS responseMessageId, status, error, started_at AS startedAt, completed_at AS completedAt, elapsed_ms AS elapsedMs FROM collaboration_tasks WHERE run_id = ? ORDER BY rowid ASC").all(runId).map(publicCollaborationTask);
    return { ...run, tasks };
  }

  function createCollaborationRun({ projectId, leadSessionId, requestContent }) {
    const run = { id: id(), projectId, leadSessionId, requestContent, status: "running", startedAt: now() };
    database.prepare("INSERT INTO collaboration_runs (id, project_id, lead_session_id, request_content, status, started_at, completed_at, elapsed_ms, summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(run.id, run.projectId, run.leadSessionId, run.requestContent, run.status, run.startedAt, null, null, "");
    audit("collaboration.run_started", "collaboration_run", run.id, { projectId, leadSessionId });
    return getCollaborationRun(run.id);
  }

  function createCollaborationTask({ runId, childSessionId, childName, childRole = "", provider = null, model = null, instructionMessageId = null }) {
    const task = { id: id(), runId, childSessionId, childName, childRole, provider, model, instructionMessageId, status: "queued" };
    database.prepare("INSERT INTO collaboration_tasks (id, run_id, child_session_id, child_name, child_role, provider, model, instruction_message_id, response_message_id, status, error, started_at, completed_at, elapsed_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(task.id, task.runId, task.childSessionId, task.childName, task.childRole, task.provider, task.model, task.instructionMessageId, null, task.status, "", null, null, null);
    audit("collaboration.task_queued", "collaboration_task", task.id, { runId, childSessionId, childName });
    return getCollaborationRun(runId).tasks.find((item) => item.id === task.id);
  }

  function updateCollaborationTask(taskId, { status, error, responseMessageId } = {}) {
    const existing = database.prepare("SELECT id, run_id AS runId, status, started_at AS startedAt FROM collaboration_tasks WHERE id = ?").get(taskId);
    if (!existing) return null;
    const nextStatus = status ?? existing.status;
    const starts = nextStatus === "running" && !existing.startedAt ? now() : existing.startedAt;
    const finishes = ["completed", "failed", "cancelled", "timed_out"].includes(nextStatus) ? now() : null;
    const elapsed = finishes && starts ? Math.max(0, Date.parse(finishes) - Date.parse(starts)) : null;
    database.prepare("UPDATE collaboration_tasks SET status = ?, error = ?, response_message_id = ?, started_at = ?, completed_at = ?, elapsed_ms = ? WHERE id = ?")
      .run(nextStatus, error ?? "", responseMessageId ?? null, starts, finishes, elapsed, taskId);
    audit(`collaboration.task_${nextStatus}`, "collaboration_task", taskId, { runId: existing.runId, error: Boolean(error) });
    return getCollaborationRun(existing.runId).tasks.find((item) => item.id === taskId);
  }

  function completeCollaborationRun(runId, { status, summary = "" }) {
    const existing = getCollaborationRun(runId);
    if (!existing) return null;
    const completedAt = now();
    const elapsedMs = Math.max(0, Date.parse(completedAt) - Date.parse(existing.startedAt));
    database.prepare("UPDATE collaboration_runs SET status = ?, completed_at = ?, elapsed_ms = ?, summary = ? WHERE id = ?")
      .run(status, completedAt, elapsedMs, summary, runId);
    audit(`collaboration.run_${status}`, "collaboration_run", runId, { taskCount: existing.tasks.length, elapsedMs });
    return getCollaborationRun(runId);
  }

  function listCollaborationRuns(leadSessionId, limit = 20) {
    return database.prepare("SELECT id FROM collaboration_runs WHERE lead_session_id = ? ORDER BY started_at DESC LIMIT ?").all(leadSessionId, limit)
      .map((row) => getCollaborationRun(row.id));
  }
  function recordFileProvenance({ approvalId, projectId, relativePath, action, source = "user", sessionId = null, collaborationRunId = null, provider = null, model = null, debugMarker = false, resultingHash = null }) {
    const record = { id: id(), approvalId, projectId, relativePath, action, source, sessionId, collaborationRunId, provider, model, debugMarker: Boolean(debugMarker), resultingHash, appliedAt: now() };
    database.prepare("INSERT INTO file_change_provenance (id, approval_id, project_id, relative_path, action, source, session_id, collaboration_run_id, provider, model, debug_marker, resulting_hash, applied_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(record.id, record.approvalId, record.projectId, record.relativePath, record.action, record.source, record.sessionId, record.collaborationRunId, record.provider, record.model, record.debugMarker ? 1 : 0, record.resultingHash, record.appliedAt);
    audit("file.provenance_recorded", "file_change_provenance", record.id, { projectId, relativePath, action, source, sessionId, collaborationRunId, debugMarker: record.debugMarker });
    return record;
  }

  function listFileProvenance(projectId, limit = 100) {
    return database.prepare("SELECT id, approval_id AS approvalId, project_id AS projectId, relative_path AS relativePath, action, source, session_id AS sessionId, collaboration_run_id AS collaborationRunId, provider, model, debug_marker AS debugMarker, resulting_hash AS resultingHash, applied_at AS appliedAt FROM file_change_provenance WHERE project_id = ? ORDER BY applied_at DESC LIMIT ?").all(projectId, limit)
      .map((record) => ({ ...record, debugMarker: Boolean(record.debugMarker) }));
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

  function expireApproval(approvalId, reason) {
    const approval = database.prepare("SELECT * FROM approvals WHERE id = ?").get(approvalId);
    if (!approval || approval.status !== "pending") return null;
    const decidedAt = now();
    database.prepare("UPDATE approvals SET status = ?, decided_at = ? WHERE id = ?").run("expired", decidedAt, approvalId);
    audit("approval.expired", "approval", approvalId, { action: approval.action, target: approval.target, reason });
    return { ...approval, payload: JSON.parse(approval.payload), status: "expired", decidedAt };
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

  return { close: () => database.close(), createProject, listProjects, getProject, updateProjectInstructions, listProjectAgents, getProjectAgent, createProjectAgent, updateProjectAgent, deleteProjectAgent, deleteProject, createSession, listSessions, countProjectChildSessions, getProjectLeadSession, ensureProjectLeadSession, getSession, renameSession, archiveSession, updateSessionModel, updateSessionRole, updateSessionRateLimit, searchSessions, addMessage, listMessages, createPendingAttachment, getAttachment, attachPendingAttachments, deletePendingAttachment, deleteMessage, deleteSession, getOrCreateDiscordSession, getSessionContext, saveSessionContext, listMemories, createMemory, updateMemory, deleteMemory, listGoals, createGoal, updateGoal, deleteGoal, createCollaborationRun, createCollaborationTask, updateCollaborationTask, completeCollaborationRun, getCollaborationRun, listCollaborationRuns, recordFileProvenance, listFileProvenance, createApproval, listApprovals, getApproval, decideApproval, expireApproval, listAuditEvents, getSetting, setSetting };
}
