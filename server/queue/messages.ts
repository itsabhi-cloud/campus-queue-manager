import type { ServiceKind } from "../../shared/domain";

/** Human copy for queue notifications. Wording varies by service kind; behaviour does not. */

export function aheadText(peopleAhead: number, unit = "people") {
  if (peopleAhead <= 0) return "You're next";
  const noun = peopleAhead === 1 ? (unit === "people" ? "person" : unit.replace(/s$/, "")) : unit;
  return `${peopleAhead} ${noun} ahead of you`;
}

export function almostNextMessage(kind: ServiceKind, token: string, counterName: string, peopleAhead: number, unit: string) {
  const ahead = aheadText(peopleAhead, unit);
  switch (kind) {
    case "CAFETERIA":
      return `Your cafeteria token ${token} is almost ready (${ahead}). Please proceed to ${counterName} and place your order.`;
    case "ELEVATOR":
      return `${ahead} for ${counterName}. Please make your way to the lift lobby with token ${token}.`;
    case "PRINTING":
      return `Your print token ${token} is almost up (${ahead}). Please head to ${counterName} with your files ready.`;
    default:
      return `Your token ${token} is almost up (${ahead}). Please head to ${counterName}.`;
  }
}

export function calledMessage(kind: ServiceKind, token: string, counterName: string) {
  switch (kind) {
    case "CAFETERIA":
      return `Token ${token}: it's your turn at ${counterName}. Please place your order now.`;
    case "ELEVATOR":
      return `Token ${token}: please board ${counterName} now.`;
    default:
      return `Token ${token} is being called at ${counterName}. Please proceed now.`;
  }
}

export function counterStatusMessage(status: "PAUSED" | "OFFLINE" | "OPEN", counterName: string, token: string, reason?: string | null) {
  const because = reason ? ` (${reason})` : "";
  switch (status) {
    case "PAUSED":
      return `${counterName} is temporarily paused${because}. Your place with token ${token} is kept.`;
    case "OFFLINE":
      return `${counterName} is offline${because}. Your place with token ${token} is kept; staff may move it to another counter.`;
    case "OPEN":
      return `${counterName} is open again. Token ${token} is moving.`;
  }
}
