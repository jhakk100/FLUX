export function selectProjectChildSessions(sessions, projectId, maximum = 4) {
  return sessions.filter((session) => session.projectId === projectId && !session.projectLead).slice(0, maximum);
}