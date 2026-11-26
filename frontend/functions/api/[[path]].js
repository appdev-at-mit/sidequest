export async function onRequest({ request, env }) {
  if (!env.BACKEND_ORIGIN) {
    return Response.json({ msg: "The SideQuest API proxy is not configured." }, { status: 503 });
  }

  let backendOrigin;
  try {
    backendOrigin = new URL(env.BACKEND_ORIGIN);
    if (backendOrigin.protocol !== "https:") throw new Error("HTTPS required");
  } catch {
    return Response.json({ msg: "The SideQuest API proxy has an invalid backend origin." }, { status: 503 });
  }

  const incoming = new URL(request.url);
  const target = new URL(incoming.pathname + incoming.search, backendOrigin);
  const headers = new Headers(request.headers);
  headers.set("x-forwarded-host", incoming.host);
  headers.set("x-forwarded-proto", incoming.protocol.slice(0, -1));
  const method = request.method.toUpperCase();
  const upstreamRequest = new Request(target, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? null : request.body,
    redirect: "manual",
  });

  return fetch(upstreamRequest);
}
