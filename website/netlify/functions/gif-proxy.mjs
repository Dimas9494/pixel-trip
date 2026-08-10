/**
 * CORS proxy for NFT GIF bytes (Trip Card animated export).
 * GET /.netlify/functions/gif-proxy?url=https://pixeltripnft.website/images/123.gif
 */

const ALLOWED =
  /^https:\/\/pixeltripnft\.website\/(images|stage2\/images|stage3\/images)\/[A-Za-z0-9_.-]+\.gif(\?.*)?$/i;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method !== "GET") {
    return new Response("GET only", { status: 405, headers: cors });
  }

  const url = new URL(req.url).searchParams.get("url") || "";
  if (!ALLOWED.test(url)) {
    return new Response("URL not allowed", { status: 403, headers: cors });
  }

  try {
    const upstream = await fetch(url);
    if (!upstream.ok) {
      return new Response("Upstream error", { status: upstream.status, headers: cors });
    }
    const bytes = await upstream.arrayBuffer();
    return new Response(bytes, {
      status: 200,
      headers: {
        ...cors,
        "Content-Type": "image/gif",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (err) {
    return new Response(err.message || "Proxy failed", { status: 502, headers: cors });
  }
};
