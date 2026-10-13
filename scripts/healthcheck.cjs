const bind=process.env.LMB_HOST||'127.0.0.1';
let host=bind==='0.0.0.0'?'127.0.0.1':bind==='::'?'::1':bind;
if(host.includes(':'))host='['+host+']';
fetch(`http://${host}:${process.env.LMB_PORT||8080}/healthz`,{signal:AbortSignal.timeout(4000)})
 .then(response=>process.exit(response.ok?0:1)).catch(()=>process.exit(1));
