import type { Run, Settings } from '../src/types';
import { endpointIdentity } from '../src/endpoint';
/** A retry reproduces the original server as well as its prompts and load settings. */
export function assertRetryEndpoint(run: Pick<Run,'environment'>, settings: Settings): void {
 const original=run.environment.endpoint;
 const provider=run.environment.provider??'lmstudio';
 if(typeof original!=='string'||provider!==(settings.provider??'lmstudio')||endpointIdentity({provider:settings.provider,baseUrl:original})!==endpointIdentity(settings)) {
  throw Error('Reconnect to the original endpoint and provider before retrying this run. Start a new benchmark to measure a different server.');
 }
}
