import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isLoopbackUrl, validateUrl} from '../src/endpoint';

test('an endpoint on another machine is accepted',()=>{
 // The point of the change: the server need not be this PC.
 assert.equal(validateUrl('http://192.168.1.50:1234'),'http://192.168.1.50:1234');
 assert.equal(validateUrl('https://llm.example.internal:8443'),'https://llm.example.internal:8443');
 assert.equal(validateUrl('http://10.0.0.7:1234/'),'http://10.0.0.7:1234','a bare trailing slash is still just an origin');
 // And loopback keeps working exactly as before.
 for(const u of ['http://127.0.0.1:1234','http://localhost:1234','http://[::1]:1234'])assert.equal(validateUrl(u),new URL(u).origin);
});

test('loopback is reported accurately, because the window promises privacy on it',()=>{
 for(const u of ['http://127.0.0.1:1234','http://localhost:1234','http://[::1]:1234'])assert.equal(isLoopbackUrl(u),true);
 for(const u of ['http://192.168.1.50:1234','https://example.com','http://10.0.0.7:1234'])assert.equal(isLoopbackUrl(u),false);
 assert.equal(isLoopbackUrl('not a url'),false,'an unparseable address is not quietly called local');
});

test('anything that is not an origin is still refused',()=>{
 // Credentials belong in the token field, where they are encrypted and never reach the renderer.
 assert.throws(()=>validateUrl('http://user:pass@192.168.1.50:1234'),/API token field/);
 // A path, query or fragment would change what the address means.
 assert.throws(()=>validateUrl('http://192.168.1.50:1234/v1'),/no path, query or fragment/);
 assert.throws(()=>validateUrl('http://192.168.1.50:1234/?x=1'),/no path, query or fragment/);
 assert.throws(()=>validateUrl('http://192.168.1.50:1234/#f'),/no path, query or fragment/);
 assert.throws(()=>validateUrl('file:///etc/passwd'),/http:\/\/ or https:\/\//);
 assert.throws(()=>validateUrl('ftp://192.168.1.50'),/http:\/\/ or https:\/\//);
 assert.throws(()=>validateUrl('192.168.1.50:1234'),/full address/,'a bare host:port is not a URL');
 assert.throws(()=>validateUrl(''),/full address/);
});
