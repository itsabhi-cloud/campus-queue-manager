/** Plain-language descriptions of audit actions, phrased to follow the actor's name. */
const ACTION_TEXT: Record<string, string> = {
  "queue.priority_assigned": "gave a token priority",
  "queue.priority_removed": "removed a token's priority",
  "queue.merged": "merged a counter's queue",
  "queue.traffic_updated": "changed traffic",
  "queue.token_cancelled": "cancelled a token",
  "counter.paused": "paused a counter",
  "counter.resumed": "reopened a counter",
  "counter.offline": "took a counter offline",
  "counter.created": "added a counter",
  "counter.updated": "edited a counter",
  "queue_group.created": "added a queue group",
  "queue_group.updated": "edited a queue group",
  "service.created": "added a service",
  "service.updated": "edited a service",
  "camera_station.created": "added a camera station",
  "camera_station.updated": "edited a camera station",
  "user.bulk_import": "imported students",
  "user.student_created": "added a student",
  "user.staff_created": "added a staff member",
  "user.updated": "edited an account",
  "user.role_changed": "changed a role",
  "user.suspended": "suspended an account",
  "user.disabled": "disabled an account",
  "user.enabled": "re-enabled an account",
  "user.activation_code_issued": "issued an activation code",
  "user.reset_code_issued": "issued a password reset code",
  "auth.account_activated": "activated their account",
  "auth.password_reset": "reset their password",
  "auth.password_changed": "changed their password",
  "auth.locked_out": "was locked out after failed sign-ins",
  "assignment.changed": "changed counter assignments",
  "settings.updated": "changed settings",
};

/** "gave a token priority" for a known action; the raw action name otherwise. */
export function actionText(action: string): string {
  return ACTION_TEXT[action] ?? action;
}

/** Sentence-case version for use on its own, e.g. in a table cell. */
export function actionLabel(action: string): string {
  const text = actionText(action);
  return text === action ? action : text[0].toUpperCase() + text.slice(1);
}
