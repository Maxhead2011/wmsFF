// FIX: one read-only polling loop per open FBO monitor; hidden tabs do not load the server.
export function startFboPolling(refresh: () => void, visible: () => boolean) {
  const timer = setInterval(() => { if (visible()) refresh(); }, 5000);
  return () => clearInterval(timer);
}
