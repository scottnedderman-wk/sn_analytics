/** Probe endpoints required by the wk helm chart (readiness, liveness, status). */
export function healthRoutes() {
  const ok = () => new Response("ok");
  return {
    "/_wk/ready": ok,
    "/_wk/alive": ok,
    "/_wk/status": () => Response.json({ status: "ok" }),
  };
}
