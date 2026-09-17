// Where this app sends prompts.
//
// Loopback is the default and the private case, but the endpoint is just an OpenAI-shaped HTTP API,
// so it can be LM Studio on another machine, a server on the LAN, or anything else speaking the same
// protocol. The host is therefore not restricted. What stays rejected is everything that would make
// the address mean something other than an origin: credentials embedded in the URL, a path, a query,
// a fragment.
//
// This lives in src/ rather than beside the LM Studio client because the window needs it too — it
// has to say plainly when prompts are leaving the machine — and that module reaches for node:fs and
// node:child_process, which cannot be bundled for the renderer.
export const loopbackHosts = ['127.0.0.1', 'localhost', '[::1]', '::1'];

// Reported, never enforced: the window uses it to replace a privacy claim it can no longer make.
export function isLoopbackUrl(url: string): boolean {
  try { return loopbackHosts.includes(new URL(url).hostname); } catch { return false; }
}

export function validateUrl(url: string): string {
  let u: URL;
  try { u = new URL(url); } catch { throw Error('Enter a full address, such as http://127.0.0.1:1234 or http://192.168.1.50:1234.'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw Error('The endpoint must be an http:// or https:// address.');
  if (!u.hostname) throw Error('The endpoint needs a host, such as 127.0.0.1 or 192.168.1.50.');
  // A token belongs in the token field, where it is encrypted at rest and never crosses to the window.
  if (u.username || u.password) throw Error('Put credentials in the API token field rather than in the address.');
  if (u.pathname !== '/' || u.search || u.hash) throw Error('Give only the server address, with no path, query or fragment — for example http://192.168.1.50:1234.');
  return u.origin;
}
