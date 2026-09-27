import { Link } from "wouter";
import { ArrowRight, Camera, Check, ChevronDown, Eye, Radio, ShieldCheck, Ticket, Users, Wifi } from "lucide-react";
import { PublicHeader } from "@/components/QueueSenseShell";

const steps = [
  { icon: Camera, title: "Camera", detail: "Local-only people detection" },
  { icon: Eye, title: "Queue detection", detail: "ROI-filtered estimate" },
  { icon: Radio, title: "Live estimate", detail: "Approximate wait time" },
  { icon: Ticket, title: "Digital token", detail: "Reserve your place" },
  { icon: Wifi, title: "Remote waiting", detail: "Track every update" },
];

export default function Landing() {
  return <div className="landing-page">
    <PublicHeader />
    <main>
      <section className="hero-section">
        <div className="hero-copy">
          <div className="announce-pill"><span className="announce-dot" /> Built for calmer campus days <ArrowRight size={13} /></div>
          <h1>Don&apos;t stand in line.<br /><span>Know your turn.</span></h1>
          <p className="hero-lede">QueueSense combines browser-based computer vision with digital tokens, so people can leave the physical queue and return when their turn is near.</p>
          <div className="hero-ctas"><Link href="/student" className="button button-primary">Join a queue <ArrowRight size={17} /></Link><a href="#how-it-works" className="button button-ghost">See how it works <ChevronDown size={16} /></a></div>
          <div className="hero-proof"><div className="proof-avatars"><span>AS</span><span>RK</span><span>MP</span><span>+2k</span></div><div><strong>Made for the moments between places</strong><small>Students, staff, and service teams</small></div></div>
        </div>
        <div className="hero-visual">
          <div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" />
          <div className="hero-dashboard-card">
            <div className="mini-window-top"><span /><span /><span /><small>Admissions Office <b>LIVE</b></small></div>
            <div className="mini-camera-panel"><div className="camera-grid" /><div className="mini-roi"><span>QUEUE ROI</span><i /><i /><i /></div><div className="mini-camera-label"><span className="live-dot" /> Camera Station <em>local processing</em></div></div>
            <div className="mini-stats"><div><small>PHYSICAL QUEUE</small><strong>4 <em>people</em></strong></div><div><small>ESTIMATED WAIT</small><strong>~12 <em>min</em></strong></div></div>
            <div className="mini-token-row"><div className="mini-token-icon"><Ticket size={15} /></div><div><small>YOUR DIGITAL TOKEN</small><strong>A018 <span>waiting</span></strong></div><ArrowRight size={17} /></div>
            <div className="mini-progress"><span /><span /><span /><span /><span /></div>
          </div>
          <div className="float-card float-notification"><div className="float-icon float-icon-green"><Check size={16} /></div><div><strong>Your turn is near</strong><small>A018 · 2 people ahead</small></div></div>
          <div className="float-card float-live"><span className="live-dot" /><div><strong>Realtime sync</strong><small>All dashboards connected</small></div></div>
        </div>
      </section>

      <section className="trust-strip"><span>Designed for high-demand service counters</span><div><span>Admissions</span><span>Accounts</span><span>Library</span><span>Certificates</span></div></section>

      <section className="workflow-section" id="how-it-works">
        <div className="center-heading"><div className="eyebrow">From standing to knowing</div><h2>The queue keeps moving.<br /><span>You keep living.</span></h2><p>Computer vision provides the signal. Digital tokens provide the freedom.</p></div>
        <div className="workflow-line">{steps.map((step, index) => { const Icon = step.icon; return <div className="workflow-step" key={step.title}><div className={`workflow-icon ${index === 3 ? "highlight" : ""}`}><Icon size={20} /></div><div className="workflow-step-copy"><strong>{step.title}</strong><small>{step.detail}</small></div>{index < steps.length - 1 && <div className="workflow-arrow"><ArrowRight size={15} /></div>}</div>; })}</div>
      </section>

      <section className="benefit-section">
        <div className="benefit-visual"><div className="benefit-orb" /><div className="benefit-ring ring-one" /><div className="benefit-ring ring-two" /><div className="benefit-figure"><Users size={44} /><span className="figure-label label-one">1 · Queue signal</span><span className="figure-label label-two">2 · Digital place</span><span className="figure-label label-three">3 · Your turn</span></div></div>
        <div className="benefit-copy"><div className="eyebrow">Why QueueSense</div><h2>Make waiting a background task.</h2><p>Whether it&apos;s admissions, accounts, or a help desk, QueueSense turns an unpredictable wait into a visible, manageable journey.</p><ul><li><span><Eye size={17} /></span><div><strong>See the real queue</strong><small>Get an honest, camera-assisted picture of what&apos;s happening now.</small></div></li><li><span><Ticket size={17} /></span><div><strong>Take a digital token</strong><small>Reserve your place without being tied to the counter.</small></div></li><li><span><Radio size={17} /></span><div><strong>Return at the right moment</strong><small>Realtime updates and “almost your turn” alerts keep you in control.</small></div></li></ul><Link href="/student" className="text-link">Explore live queues <ArrowRight size={16} /></Link></div>
      </section>

      <section className="privacy-section" id="privacy"><div className="privacy-inner"><div className="privacy-badge"><ShieldCheck size={20} /></div><div><div className="eyebrow">Privacy, always</div><h2>Intelligence without identification.</h2><p>QueueSense detects people, not identities. Video processing happens in the browser, and the system stores aggregate queue metrics—not faces, footage, or biometric profiles.</p></div><div className="privacy-checks"><span><Check size={15} /> No facial recognition</span><span><Check size={15} /> No video storage</span><span><Check size={15} /> No person-to-token mapping</span></div></div></section>

      <section className="landing-cta"><div><div className="eyebrow">A better line is waiting</div><h2>Give your next queue<br /><span>a little more space.</span></h2><p>Try the QueueSense demo with a student dashboard, staff console, and camera station.</p></div><Link href="/student" className="button button-light">Open live demo <ArrowRight size={17} /></Link></section>
    </main>
    <footer className="public-footer"><PublicHeader /><div className="footer-bottom"><span>© 2026 QueueSense · Hackathon prototype</span><span>Computer vision detects people locally. QueueSense does not identify individuals.</span></div></footer>
  </div>;
}
