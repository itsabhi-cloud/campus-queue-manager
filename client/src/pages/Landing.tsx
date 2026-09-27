import { useEffect } from "react";
import { Link } from "wouter";
import {
  ArrowRight,
  ArrowUpDown,
  Bell,
  Building2,
  Check,
  ChevronDown,
  Coffee,
  Eye,
  MapPin,
  Printer,
  Radio,
  ShieldCheck,
  Ticket,
  Users,
} from "lucide-react";
import { BrandMark } from "@/components/AppShell";
import { HOME_FOR_ROLE, useAuth } from "@/hooks/useAuth";

const journey = [
  { icon: Ticket, title: "Get a token", detail: "Pick a service and counter" },
  {
    icon: MapPin,
    title: "Leave the line",
    detail: "Your place is held for you",
  },
  { icon: Radio, title: "Watch your position", detail: "Live, on your phone" },
  { icon: Bell, title: "Get alerted", detail: "When your turn approaches" },
  { icon: Check, title: "Arrive & finish", detail: "Right when you're needed" },
];

const serviceTiles = [
  {
    icon: Building2,
    name: "Administration",
    detail: "Accounts, certificates and admissions desks.",
  },
  {
    icon: Printer,
    name: "Printing",
    detail:
      "Xerox, colour and bulk report printing — with counter merging when one goes down.",
  },
  {
    icon: Coffee,
    name: "Cafeteria",
    detail:
      "Hold your place for dine-in or takeaway. Ordering stays at the counter.",
  },
  {
    icon: ArrowUpDown,
    name: "Elevator / Lift",
    detail:
      "Traffic estimates and a virtual boarding queue. We don't control the lifts.",
  },
];

function PublicHeader() {
  const { user } = useAuth();
  return (
    <header className="public-header">
      <BrandMark />
      <nav aria-label="Page sections">
        <a href="#how-it-works">How it works</a>
        <a href="#services">Services</a>
        <a href="#privacy">Privacy</a>
      </nav>
      <div className="public-actions">
        {user ? (
          <Link
            href={HOME_FOR_ROLE[user.role]}
            className="button button-dark button-small"
          >
            Open dashboard <ArrowRight size={15} aria-hidden />
          </Link>
        ) : (
          <Link href="/login" className="button button-dark button-small">
            Sign in <ArrowRight size={15} aria-hidden />
          </Link>
        )}
      </div>
    </header>
  );
}

export default function Landing() {
  const { user } = useAuth();
  useEffect(() => {
    document.title = "QueueSense · Don't stand in line. Know your turn.";
  }, []);
  const primaryHref = user ? HOME_FOR_ROLE[user.role] : "/login";
  return (
    <div className="landing-page">
      <PublicHeader />
      <main>
        <section className="hero-section">
          <div className="hero-copy">
            <div className="announce-pill">
              <span className="announce-dot" /> Smart campus queues · realtime
            </div>
            <h1>
              Don&apos;t stand in line.
              <br />
              <span>Know your turn.</span>
            </h1>
            <p className="hero-lede">
              QueueSense holds your place at busy campus services. Take a
              digital token, get on with your day, and come back when your turn
              is near — with a live position and an honest wait estimate.
            </p>
            <div className="hero-ctas">
              <Link href={primaryHref} className="button button-primary">
                {user ? "Open dashboard" : "Sign in to join a queue"}{" "}
                <ArrowRight size={17} aria-hidden />
              </Link>
              <a href="#how-it-works" className="button button-ghost">
                See how it works <ChevronDown size={16} aria-hidden />
              </a>
            </div>
            <p className="hero-footnote">
              First time? <Link href="/activate">Activate your account</Link>{" "}
              with the code from your administration office.
            </p>
          </div>
          <div className="hero-visual" aria-hidden>
            <div className="hero-orbit orbit-one" />
            <div className="hero-orbit orbit-two" />
            <div className="hero-dashboard-card">
              <div className="mini-window-top">
                <span />
                <span />
                <span />
                <small>
                  Accounts & Fees <b>LIVE</b>
                </small>
              </div>
              <div className="mini-stats">
                <div>
                  <small>PEOPLE AHEAD</small>
                  <strong>
                    2 <em>people</em>
                  </strong>
                </div>
                <div>
                  <small>ESTIMATED WAIT</small>
                  <strong>
                    06:20 <em>est.</em>
                  </strong>
                </div>
              </div>
              <div className="mini-token-row">
                <div className="mini-token-icon">
                  <Ticket size={15} />
                </div>
                <div>
                  <small>YOUR DIGITAL TOKEN</small>
                  <strong>
                    F104 <span>waiting</span>
                  </strong>
                </div>
                <ArrowRight size={17} />
              </div>
              <div className="mini-progress">
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
            </div>
            <div className="float-card float-notification">
              <div className="float-icon float-icon-green">
                <Check size={16} />
              </div>
              <div>
                <strong>Almost your turn</strong>
                <small>F104 · 1 person ahead</small>
              </div>
            </div>
            <div className="float-card float-live">
              <span className="live-dot" />
              <div>
                <strong>Live updates</strong>
                <small>Pushed from the server</small>
              </div>
            </div>
          </div>
        </section>

        <section className="trust-strip" id="services">
          <span>Four campus services, one queue platform</span>
          <div>
            <span>Administration</span>
            <span>Printing</span>
            <span>Cafeteria</span>
            <span>Elevator</span>
          </div>
        </section>

        <section className="workflow-section" id="how-it-works">
          <div className="center-heading">
            <div className="eyebrow">From standing to knowing</div>
            <h2>
              The queue keeps moving.
              <br />
              <span>You keep living.</span>
            </h2>
            <p>
              Your place is held on the server, so it's safe even if you close
              the app.
            </p>
          </div>
          <ol className="workflow-line">
            {journey.map((step, index) => {
              const Icon = step.icon;
              return (
                <li className="workflow-step" key={step.title}>
                  <div
                    className={`workflow-icon ${index === 0 ? "highlight" : ""}`}
                    aria-hidden
                  >
                    <Icon size={20} />
                  </div>
                  <div className="workflow-step-copy">
                    <strong>{step.title}</strong>
                    <small>{step.detail}</small>
                  </div>
                  {index < journey.length - 1 && (
                    <div className="workflow-arrow" aria-hidden>
                      <ArrowRight size={15} />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>

        <section className="landing-services">
          {serviceTiles.map(tile => {
            const Icon = tile.icon;
            return (
              <article key={tile.name} className="landing-service-card">
                <span className="service-icon service-icon-violet" aria-hidden>
                  <Icon size={18} />
                </span>
                <h3>{tile.name}</h3>
                <p>{tile.detail}</p>
              </article>
            );
          })}
        </section>

        <section className="benefit-section">
          <div className="benefit-visual" aria-hidden>
            <div className="benefit-orb" />
            <div className="benefit-ring ring-one" />
            <div className="benefit-ring ring-two" />
            <div className="benefit-figure">
              <Users size={44} />
              <span className="figure-label label-one">1 · Digital place</span>
              <span className="figure-label label-two">2 · Live estimate</span>
              <span className="figure-label label-three">3 · Your turn</span>
            </div>
          </div>
          <div className="benefit-copy">
            <div className="eyebrow">Why QueueSense</div>
            <h2>Make waiting a background task.</h2>
            <p>
              Staff run the queue from a console; every call, pause, priority
              and merge updates your screen instantly.
            </p>
            <ul>
              <li>
                <span aria-hidden>
                  <Radio size={17} />
                </span>
                <div>
                  <strong>Explainable estimates</strong>
                  <small>
                    Based on people ahead, recent service times and current
                    traffic. An estimate, not an appointment.
                  </small>
                </div>
              </li>
              <li>
                <span aria-hidden>
                  <Bell size={17} />
                </span>
                <div>
                  <strong>Alerts that matter</strong>
                  <small>
                    Almost-your-turn, called, moved to another counter, or a big
                    change in wait — not noise.
                  </small>
                </div>
              </li>
              <li>
                <span aria-hidden>
                  <Eye size={17} />
                </span>
                <div>
                  <strong>Crowd-aware</strong>
                  <small>
                    Optional camera stations estimate congestion at lifts and
                    busy halls.
                  </small>
                </div>
              </li>
            </ul>
          </div>
        </section>

        <section className="privacy-section" id="privacy">
          <div className="privacy-inner">
            <div className="privacy-badge" aria-hidden>
              <ShieldCheck size={20} />
            </div>
            <div>
              <div className="eyebrow">Privacy, always</div>
              <h2>Intelligence without identification.</h2>
              <p>
                Camera stations count people in the browser and send only a
                number. No video, no faces, and never a link between a person on
                camera and a token.
              </p>
            </div>
            <div className="privacy-checks">
              <span>
                <Check size={15} aria-hidden /> No facial recognition
              </span>
              <span>
                <Check size={15} aria-hidden /> No video storage
              </span>
              <span>
                <Check size={15} aria-hidden /> No person-to-token mapping
              </span>
            </div>
          </div>
        </section>

        <section className="landing-cta">
          <div>
            <div className="eyebrow">A better line is waiting</div>
            <h2>
              Give your next queue
              <br />
              <span>a little more space.</span>
            </h2>
            <p>
              Students sign in with the account issued by the administration
              office.
            </p>
          </div>
          <Link href={primaryHref} className="button button-light">
            {user ? "Open dashboard" : "Sign in"}{" "}
            <ArrowRight size={17} aria-hidden />
          </Link>
        </section>
      </main>
      <footer className="public-footer">
        <div className="footer-bottom">
          <span>© 2026 QueueSense</span>
          <span>
            Wait times are estimates. QueueSense does not identify individuals,
            take food orders, or control elevators.
          </span>
        </div>
      </footer>
    </div>
  );
}
