/** Fetch with AbortController timeout — avoids hanging on slow metadata server. */
export async function fetchWithTimeout(url, options = {}, ms = 8_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error(`Fetch timed out (${ms}ms)`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
