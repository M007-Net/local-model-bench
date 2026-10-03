import type { Settings } from './types';
export type EndpointProvider = 'lmstudio'|'llamacpp'|'openai';
export const providerLabel=(provider?:EndpointProvider)=>provider==='llamacpp'?'llama.cpp':provider==='openai'?'OpenAI-compatible':'LM Studio';
export const isManagedEndpoint=(settings:Pick<Settings,'provider'>)=>!settings.provider||settings.provider==='lmstudio';
export const canManageLocally=(settings:Pick<Settings,'provider'|'baseUrl'>)=>isManagedEndpoint(settings)&&isLoopbackUrl(settings.baseUrl);
// Where this app sends prompts.
//
// Loopback is the default and the private case, but the endpoint is just an OpenAI-shaped HTTP API,
// so it can be LM Studio on another machine, a server on the LAN, or anything else speaking the same
// protocol. Compatible APIs may have a path prefix such as /v1 or /api.
// Credentials, queries and fragments are rejected so tokens stay in the encrypted token field.
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
  if (u.search || u.hash) throw Error('Give a server address and optional API path, with no query or fragment.');
  const rawPath=url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i,'').split(/[?#]/,1)[0];
  if (/%/.test(rawPath)||/(?:^|\/)\.{1,2}(?:\/|$)/.test(rawPath)||!/^\/(?:[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*)?\/?$/.test(u.pathname)) throw Error('Use a plain API path without encoded characters or traversal segments.');
  return u.origin+(u.pathname==='/'?'':u.pathname.replace(/\/$/,''));
}
export function compatibleBaseUrl(url:string):string {const normalized=validateUrl(url);return new URL(normalized).pathname==='/'?normalized+'/v1':normalized;}
export function endpointIdentity(settings:Pick<Settings,'provider'|'baseUrl'>):string {if(!isManagedEndpoint(settings))return compatibleBaseUrl(settings.baseUrl);const normalized=validateUrl(settings.baseUrl);return new URL(normalized).pathname==='/v1'?new URL(normalized).origin:normalized;}
