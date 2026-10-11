import { useEffect } from "react";
import { Link } from "wouter";
import {
  ArrowUpDown,
  Building2,
  Coffee,
  Flag,
  Printer,
  ShieldCheck,
} from "lucide-react";
import { BrandMark } from "@/components/AppShell";
import { HOME_FOR_ROLE, useAuth } from "@/hooks/useAuth";

const BOARD = [
  { counter: "Accounts Desk 1", token: "F102", state: "Serving" },
  { counter: "Report Counter A", token: "RA014", state: "Called" },
  { counter: "Dine-in", token: "D031", state: "Serving" },
  { counter: "Lift 1", token: "LA008", state: "Boarding" },
];

const STEPS = [
  {
    title: "Get a token",
    text: "Pick a service and counter, or let QueueSense choose the shortest line.",
  },
  {
    title: "Leave the line",
    text: "Your place is held on the server, even if you close the app.",
  },
  {
    title: "Watch your position",
    text: "See people ahead and an estimated wait that updates live.",
  },
  {
    title: "Get notified",
    text: "We tell you when you're almost up, and if anything changes.",
  },
  {
    title: "Arrive when needed",
    text: "Walk up when you're called. No standing around.",
  },
];

const SERVICES = [
  {
    icon: Building2,
    name: "Administration",
    text: "Fees, certificates and admissions desks. When there are two desks, we put you in the shorter line.",
  },
  {
    icon: Printer,
    name: "Printing",
    text: "Xerox, colour and report printing. If a printer jams, your job moves to another counter without losing its place.",
  },
  {
    icon: Coffee,
    name: "Cafeteria",
    text: "Hold your spot for dine-in or takeaway. You still order and pay at the counter.",
  },
  {
    icon: ArrowUpDown,
    name: "Lifts",
    text: "See how busy each lift is and join a boarding queue. QueueSense doesn't control the lifts.",
  },
];

export default function Landing() {
  const { user } = useAuth();
  useEffect(() => {
    document.title = "QueueSense · Don't stand in line. Know your turn.";
  }, []);
  const home = user ? HOME_FOR_ROLE[user.role] : "/login";

  return (
    <div className="landing">
      <header className="landing-header">
        <BrandMark />
        <nav aria-label="Page sections" className="landing-nav">
          <a href="#how">How it works</a>
          <a href="#services">Services</a>
          <a href="#privacy">Privacy</a>
        </nav>
        <Link href={home} className="button button-dark button-small">
          {user ? "Open QueueSense" : "Sign in"}
        </Link>
      </header>

      <main>
        <section className="landing-hero">
          <div className="landing-copy">
            <h1>
              <span>Don't stand in line.</span> <span>Know your turn.</span>
            </h1>
            <p className="landing-lede">
              Join campus queues on your phone, leave the line, and come back
              when your turn is close. QueueSense shows your live position and
              an honest wait estimate.
            </p>
            <div className="page-actions">
              <Link href={home} className="button button-primary button-large">
                {user ? "Open QueueSense" : "Sign in to get a token"}
              </Link>
              {!user && (
                <Link
                  href="/activate"
                  className="button button-outline button-large"
                >
                  Activate your account
                </Link>
              )}
            </div>
            <p className="fine-print">
              Accounts are issued by your administration office. Wait times are
              estimates, not appointments.
            </p>
          </div>

          <figure
            className="landing-demo"
            aria-label="Example of what a student sees"
          >
            <div className="ticket landing-ticket" aria-hidden>
              <div className="ticket-top">
                <div className="ticket-where">
                  <div className="ticket-where-text">
                    <span className="service-icon">
                      <Building2 size={18} />
                    </span>
                    <div>
                      <small>Administration, Accounts and fees</small>
                      <strong>Accounts Desk 1</strong>
                    </div>
                  </div>
                  <span className="chip chip-waiting">Waiting</span>
                </div>
                <p className="ticket-number">F104</p>
                <p className="ticket-message">
                  You can leave the line
                  <span>We'll alert you as your turn gets close.</span>
                </p>
              </div>
              <div className="ticket-perf" />
              <dl className="ticket-stub">
                <div className="ticket-figure">
                  <dt>Estimated wait</dt>
                  <dd>06:20</dd>
                </div>
                <div className="ticket-figure">
                  <dt>People ahead</dt>
                  <dd>2</dd>
                </div>
                <div className="ticket-line">
                  <div className="queue-line">
                    <span className="ql-counter">
                      <Flag size={14} />
                    </span>
                    <span className="ql-person" />
                    <span className="ql-person" />
                    <span className="ql-you">You</span>
                  </div>
                </div>
              </dl>
            </div>
            <div className="board landing-board" aria-hidden>
              <div className="board-label">Now serving</div>
              <table>
                <tbody>
                  {BOARD.map(row => (
                    <tr key={row.counter}>
                      <td>{row.counter}</td>
                      <td
                        className={`display ${row.state === "Called" ? "is-called" : ""}`}
                      >
                        {row.token}
                      </td>
                      <td>{row.state}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <figcaption className="sr-only">
              An example ticket, F104 at Accounts Desk 1, with two people ahead
              and about six minutes to wait, next to a board listing the tokens
              now being served.
            </figcaption>
          </figure>
        </section>

        <section
          className="landing-section"
          id="how"
          aria-labelledby="how-title"
        >
          <h2 id="how-title">How it works</h2>
          <ol className="landing-steps">
            {STEPS.map(step => (
              <li key={step.title}>
                <strong>{step.title}</strong>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section
          className="landing-section"
          id="services"
          aria-labelledby="services-title"
        >
          <h2 id="services-title">Four campus services</h2>
          <ul className="landing-services">
            {SERVICES.map(service => {
              const Icon = service.icon;
              return (
                <li key={service.name}>
                  <span className="service-icon is-large" aria-hidden>
                    <Icon size={24} />
                  </span>
                  <div>
                    <h3>{service.name}</h3>
                    <p>{service.text}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section
          className="landing-section landing-privacy"
          id="privacy"
          aria-labelledby="privacy-title"
        >
          <ShieldCheck size={28} aria-hidden />
          <div>
            <h2 id="privacy-title">
              Cameras count people. They never identify them.
            </h2>
            <p>
              Some counters use a camera to measure how crowded the area is. The
              video is analysed in the browser and thrown away; only a head
              count is sent. QueueSense doesn't store footage or faces, and it
              never connects someone on camera to a token.
            </p>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <span>QueueSense</span>
        <span>
          Wait times are estimates. We manage lines, not food orders, payments
          or lift hardware.
        </span>
      </footer>
    </div>
  );
}
