import { ENV } from "../_core/env";

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: ENV.CAMPUS_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Calendar date (YYYY-MM-DD) on campus. Token numbers restart each campus day. */
export function campusDate(at = new Date()): string {
  return dateFormatter.format(at);
}

const hourFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: ENV.CAMPUS_TIMEZONE, hour: "2-digit", hour12: false });

export function campusHour(at: Date): number {
  return Number(hourFormatter.format(at)) % 24;
}

/** UTC instant of 00:00 campus time for the campus day containing `at` (DST-safe to within an hour). */
export function startOfCampusDay(at = new Date()): Date {
  const day = campusDate(at);
  const guess = new Date(`${day}T00:00:00Z`);
  // Offset between UTC midnight and campus midnight on that day.
  const hoursAtGuess = campusHour(guess);
  const minutesFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: ENV.CAMPUS_TIMEZONE, minute: "2-digit" });
  const minutesAtGuess = Number(minutesFormatter.format(guess));
  let offsetMinutes = hoursAtGuess * 60 + minutesAtGuess;
  if (offsetMinutes > 12 * 60) offsetMinutes -= 24 * 60;
  return new Date(guess.getTime() - offsetMinutes * 60_000);
}
