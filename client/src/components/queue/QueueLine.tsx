import { Flag } from "lucide-react";
import { unitNoun } from "@/lib/format";

const MAX_DOTS = 8;

/** The counter, the people ahead of you, and you — the queue as you'd see it standing in it. */
export function QueueLine({
  peopleAhead,
  unit,
  called = false,
}: {
  peopleAhead: number;
  unit: string;
  called?: boolean;
}) {
  const shown = Math.min(peopleAhead, MAX_DOTS);
  const text = called
    ? "You're at the front"
    : peopleAhead === 0
      ? "You're next"
      : `${peopleAhead} ${unitNoun(unit, peopleAhead)} ahead of you`;
  return (
    <div className="queue-line" role="img" aria-label={text}>
      <span className="ql-counter" aria-hidden>
        <Flag size={14} />
      </span>
      {Array.from({ length: shown }, (_, i) => (
        <span key={i} className="ql-person" aria-hidden />
      ))}
      {peopleAhead > MAX_DOTS && (
        <span className="ql-more" aria-hidden>
          +{peopleAhead - MAX_DOTS}
        </span>
      )}
      <span className="ql-you" aria-hidden>
        You
      </span>
    </div>
  );
}
