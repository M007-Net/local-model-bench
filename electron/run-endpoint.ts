import type { Run, Settings } from '../src/types';
import { validateUrl } from '../src/endpoint';
/** A retry reproduces the original server as well as its prompts and load settings. */
export function assertRetryEndpoint(run: Pick<Run,'environment'>, settings: Settings): void {
 const original=run.environment.endpoint;
 if(typeof original!=='string'||validateUrl(original)!==validateUrl(settings.baseUrl)||(run.environment.provider??'lmstudio')!==(settings.provider??'lmstudio')) {
  throw Error('Reconnect to the original endpoint and provider before retrying this run. Start a new benchmark to measure a different server.');
 }
}
