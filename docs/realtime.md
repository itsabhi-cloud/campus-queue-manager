# Realtime

## Transport

Server-Sent Events at `GET /api/realtime`, authenticated with the same HTTP-only session cookie as
the API. Chosen over WebSockets because updates are one-way (all writes go through tRPC), SSE works
over ordinary HTTP/1.1 and HTTP/2, and browsers reconnect automatically.

- Unauthenticated → `401` (the client backs off and re-checks its session).
- The stream starts with `retry: 3000` and a `hello` event carrying `serverTime`.
- `: ping` comments every 25 s keep proxies from closing idle connections.
- The session is re-validated every 5 minutes; suspended/revoked accounts receive `session.revoked`
  and the stream closes. Suspension also pushes `session.revoked` immediately.

## Events

Defined in [`shared/domain.ts`](../shared/domain.ts). They carry **identifiers only**:

| Event | Audience | Client reaction |
| --- | --- | --- |
| `hello` | connection | sync clock; on a *re*connect, refetch everything |
| `queue.changed { counterIds, queueGroupIds, reason }` | all signed-in users | refetch catalogue, own tokens, staff boards, admin overview |
| `entry.changed { entryIds }` | owning student | refetch own tokens |
| `notification.created { title, message, type }` | recipient only | refetch notifications, show toast / browser notification |
| `camera.updated` | all | refetch catalogue, camera and admin views |
| `catalog.changed` | all | refetch catalogue and staff counter lists |
| `session.revoked` | that user | re-check session → sign-in page |

Events are published **after the database transaction commits** (collected in
`server/lib/effects.ts`), so clients never see rolled-back state. Bursts are coalesced on the client
into one refetch per query family (200 ms window).

## Failure handling

- Connection state is shown in the top bar and sidebar: *Live*, *Connecting…*, *Reconnecting…*,
  *Offline* — non-alarming, and the last known data stays on screen.
- Transient errors: EventSource's own retry. Fatal errors (e.g. 401 or server down): exponential
  backoff 1 s → 30 s; the browser's `online` event triggers an immediate retry.
- While not live, key queries poll every 20 s as a fallback.
- **After any reconnect, the client refetches all queries**, because events may have been missed.
  Verified manually against the production build: a counter was paused directly in the database
  while the server was down; after restart the open student page showed the pause without a reload.

## Scaling beyond one instance

`server/realtime/broker.ts` is an in-process EventEmitter. For multiple API instances, publish events
through a shared bus (e.g. Redis pub/sub) and have each instance forward to its own SSE clients;
behind a load balancer, keep SSE responses unbuffered (`X-Accel-Buffering: no` is already set) and
allow long-lived connections.
