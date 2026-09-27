import { useMemo, useState } from "react";
import { ArrowRight, Bell, CheckCircle2, Clock3, Info, MapPin, MoreHorizontal, PauseCircle, Ticket, UserRound, Users, XCircle } from "lucide-react";
import { toast } from "sonner";
import { AppShell, Callout, ClockLabel, LivePill, MetricCard, PeopleLabel, QueueProgress, SectionHeader, ServiceAccent, StatusBadge, TokenNumber } from "@/components/QueueSenseShell";
import { getPeopleAhead, getTokenWait, useQueueStore } from "@/lib/demoStore";

export default function StudentDashboard() {
  const { state, actions, derived } = useQueueStore();
  const [selectedId, setSelectedId] = useState("admissions");
  const selectedSummary = derived.serviceSummary(selectedId)!;
  const myToken = state.entries.find((entry) => entry.serviceId === selectedId && entry.userLabel === "Demo student" && ["WAITING", "CALLED", "SERVING"].includes(entry.status));
  const history = state.entries.filter((entry) => entry.serviceId === selectedId && entry.userLabel === "Demo student" && !["WAITING", "CALLED", "SERVING"].includes(entry.status));
  const peopleAhead = myToken ? getPeopleAhead(state, myToken) : 0;
  const tokenWait = myToken ? getTokenWait(state, myToken) : selectedSummary.estimatedWait;
  const progress = myToken ? Math.max(8, 100 - peopleAhead * 18) : 0;

  const selectService = (id: string) => setSelectedId(id);
  const join = () => {
    const token = actions.joinQueue(selectedId, "Demo student");
    if (token) toast.success(`You’re in the queue: ${token.tokenNumber}`, { description: "You can leave the physical line and monitor your place here." });
  };
  const cancel = () => {
    if (!myToken) return;
    actions.cancelToken(myToken.id);
    toast("Token cancelled", { description: `${myToken.tokenNumber} has been removed from the queue.` });
  };

  return <AppShell active="/student" onReset={actions.resetDemo}>
    <div className="page-intro-row"><div><div className="eyebrow">Student workspace</div><h1>Good morning, Sam.</h1><p className="page-subtitle">Find a service, take your place, and get back to your day.</p></div><div className="intro-actions"><LivePill label="Realtime demo" /><button className="button button-outline button-small"><Bell size={15} /> Alerts on</button></div></div>
    <div className="dashboard-banner"><div className="banner-signal"><span className="signal-pulse" /><span className="signal-wave" /><span className="signal-wave wave-two" /></div><div><strong>QueueSense is live across campus</strong><p>Physical estimates and digital tokens update automatically as staff moves the line.</p></div><ArrowRight size={19} /></div>

    <div className="student-layout">
      <section>
        <div className="section-mini-heading"><div><div className="eyebrow">Choose a destination</div><h2>Live services</h2></div><span className="muted-note"><span className="live-dot" /> Updated just now</span></div>
        <div className="service-grid">{state.services.map((service) => { const summary = derived.serviceSummary(service.id)!; const hasToken = state.entries.some((entry) => entry.serviceId === service.id && entry.userLabel === "Demo student" && ["WAITING", "CALLED", "SERVING"].includes(entry.status)); return <button key={service.id} className={`service-card ${selectedId === service.id ? "selected" : ""}`} onClick={() => selectService(service.id)}><div className="service-card-head"><ServiceAccent service={service} /><StatusBadge status={service.status} /></div><h3>{service.name}</h3><p>{service.description}</p><div className="service-card-metrics"><span><Users size={14} /> {summary.activeCount + (summary.current?.status === "SERVING" ? 1 : 0)} waiting</span><span><Clock3 size={14} /> ~{summary.estimatedWait} min</span></div><div className="service-card-bottom"><span>{hasToken ? <><Ticket size={14} /> Your token is active</> : <>View queue details</>}</span><ArrowRight size={16} /></div></button>; })}</div>
      </section>

      <section className="token-section"><div className="section-mini-heading"><div><div className="eyebrow">Your journey</div><h2>{myToken ? "Your place is saved" : "Take a digital token"}</h2></div><span className="demo-label">DEMO MODE</span></div>
        {myToken ? <div className={`token-card token-card-${myToken.status.toLowerCase()}`}><div className="token-card-top"><div><span className="token-kicker">{selectedSummary.service.name}</span><TokenNumber token={myToken.tokenNumber} large /></div><StatusBadge status={myToken.status} /></div><div className="token-message">{myToken.status === "CALLED" || myToken.status === "SERVING" ? <><Bell size={18} /><strong>Your token is being called.</strong><span>Please return to the {selectedSummary.service.name.toLowerCase()} now.</span></> : myToken.status === "COMPLETED" ? <><CheckCircle2 size={18} /><strong>Service completed.</strong><span>Thanks for using QueueSense.</span></> : <><MapPin size={18} /><strong>You can leave the physical queue.</strong><span>We&apos;ll keep your place updated here.</span></>}</div><div className="token-stats"><div><span>Now serving</span><strong>{selectedSummary.current?.tokenNumber ?? "—"}</strong></div><div><span>People ahead</span><strong>{peopleAhead}</strong></div><div><span>Estimated wait</span><strong>~{tokenWait} <small>min</small></strong></div></div><QueueProgress progress={progress} /><div className="progress-labels"><span>Joined</span><span>{peopleAhead > 0 ? `${peopleAhead} ahead of you` : "You’re next"}</span><span>Your turn</span></div><div className="token-card-actions"><button className="button button-outline" onClick={cancel}><XCircle size={16} /> Cancel token</button><button className="icon-btn"><MoreHorizontal size={18} /></button></div></div> : <div className="join-card"><div className="join-card-icon"><Ticket size={25} /></div><h3>Skip the physical wait</h3><p>Get a digital place in the <strong>{selectedSummary.service.name}</strong> queue. You&apos;ll see your position and an approximate wait time here.</p><div className="join-facts"><span><CheckCircle2 size={15} /> No account needed for demo</span><span><CheckCircle2 size={15} /> Leave and return anytime</span><span><CheckCircle2 size={15} /> Live status updates</span></div><button className="button button-primary button-full" onClick={join} disabled={selectedSummary.service.status === "PAUSED"}>{selectedSummary.service.status === "PAUSED" ? <><PauseCircle size={16} /> Queue paused</> : <>Get digital token <ArrowRight size={16} /></>}</button><small className="estimate-disclaimer"><Info size={13} /> Wait times are approximate and may vary.</small></div>}
        {history.length > 0 && <div className="history-row"><span><CheckCircle2 size={15} /> Previous token {history[history.length - 1].tokenNumber}</span><StatusBadge status={history[history.length - 1].status} /></div>}
      </section>
    </div>

    <div className="student-bottom-grid"><MetricCard label="People in physical queue" value={selectedSummary.service.physicalCount} helper="inside the camera ROI" icon={Users} accent="violet" /><MetricCard label="Estimated wait" value={`~${selectedSummary.estimatedWait} min`} helper="May vary with service speed" icon={Clock3} accent="teal" /><MetricCard label="Queue status" value={selectedSummary.service.status === "OPEN" ? "Open" : "Paused"} helper={selectedSummary.service.status === "OPEN" ? "Join while it’s moving" : "Check back soon"} icon={selectedSummary.service.status === "OPEN" ? CheckCircle2 : PauseCircle} accent="orange" /></div>
    <Callout tone="teal"><strong>Privacy note:</strong>&nbsp; the camera only reports aggregate people counts. It never identifies or tracks individuals.</Callout>
  </AppShell>;
}
