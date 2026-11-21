// Known-answer test: stillos-notary-mcp must surface the server's free trial door in
// `remediation` (the string an agent reads), not only inside the raw body. 2026-09-25.
const assert = require('assert');
const http = require('http');
const { spawn } = require('child_process');
const serve = h => new Promise(r => { const s=http.createServer(h); s.listen(0,'127.0.0.1',()=>r(s)); });
const ACCEPTS = [{maxAmountRequired:'100000',network:'base',asset:'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',extra:{name:'USD Coin',version:'2'}}];
const CODE = `const {paidCall}=require('/home/marcus/still-os-consciousness/mcp/stillos-notary-mcp/index.cjs');
paidCall('/commit',{agent:'kat',claim:'x'},{}).then(r=>console.log(JSON.stringify(r))).catch(e=>console.log(JSON.stringify({_throw:e.message})));`;

const CLAIM_CODE = `const {callTool}=require('${__dirname}/../index.cjs');
callTool('claim_verdict',{agent:'kat',claim:'x',resolver:{type:'http_status',url:'https://example.com',expect_code:200}}).then(r=>console.log(JSON.stringify(r))).catch(e=>console.log(JSON.stringify({_throw:e.message})));`;

function run(port, code){ // async spawn: spawnSync would block this process's own test server
  return new Promise((res,rej)=>{
    const p=spawn(process.execPath,['-e',code||CODE],{env:{...process.env,STILLOS_NOTARY:`http://127.0.0.1:${port}`},encoding:'utf8'});
    let o=''; p.stdout.on('data',d=>o+=d); p.stderr.on('data',()=>{});
    p.on('close',()=>{ try{ res(JSON.parse(o.trim().split('\n').filter(Boolean).pop())); }catch(e){ rej(new Error('bad output: '+o.slice(0,200))); } });
  });
}

// 2026-11-21: the live key is `need_more_free_calls`, captured verbatim from
// POST https://stillosdigitalholdings.com/notary/claim-verdict (402). `building_on_this`
// appears on NO notary 402 and was this test's own invention -- the first version of this
// file mocked it, so it proved only that the code matched the mock. Both names are now
// asserted, the live one first.
const LIVE_DOOR = {path:'POST /notary/request-trial',body:{agent:'string (required, same id you already used)',contact:'string (optional -- email or webhook if you want a reply)'},note:'No wallet or payment required for this call. A founder reviews requests and may grant an extended free tier.'};

(async () => {
  let pass = 0;
  for (const [label, key, door] of [
    ['live key need_more_free_calls', 'need_more_free_calls', LIVE_DOOR],
    ['legacy key building_on_this', 'building_on_this', {path:'POST /notary/request-trial',why:'you hit this more than once'}],
  ]) {
    const s = await serve((q,res)=>{ res.writeHead(402,{'content-type':'application/json'});
      res.end(JSON.stringify({error:'this is a paid resource — no free tier',accepts:ACCEPTS,[key]:door})); });
    const r = await run(s.address().port); s.close();
    assert(r.payment_required, 'FAIL: not flagged payment_required — got '+JSON.stringify(r).slice(0,200));
    assert(/request-trial/.test(r.remediation||''), `FAIL: trial door missing from remediation (${key})`);
    assert(/no payment, no signup/.test(r.remediation||''), 'FAIL: trial framing missing');
    assert(r.request_trial && r.request_trial.path, 'FAIL: request_trial not exposed');
    assert.strictEqual(r.contact,'stillmarcus24@gmail.com','FAIL: no contact path');
    assert(/payment-capable fetch/.test(r.remediation), 'FAIL: lost the pay remediation');
    console.log(`  PASS  402 + ${label} -> remediation names it, contact present, pay path kept`);
    pass++;
  }

  // Control: a 402 shaped like the live /notary/screen-entity one, which carries NO door
  // at all (only how_to_fix). Nothing may be invented.
  let s = await serve((q,res)=>{ res.writeHead(402,{'content-type':'application/json'});
    res.end(JSON.stringify({error:'exhausted',accepts:ACCEPTS,how_to_fix:{endpoint:'/screen-entity',price:'$0.001 USDC (Base) via x402, no free tier.'}})); });
  let r = await run(s.address().port); s.close();
  assert(!/request-trial/.test(r.remediation||''), 'FAIL: invented a trial path the server never offered');
  assert(!r.request_trial, 'FAIL: exposed request_trial with no door in the body');
  assert(/payment-capable fetch/.test(r.remediation||''), 'FAIL: lost the pay remediation');
  console.log('  PASS  control: no trial offered -> nothing invented, pay path intact');
  pass++;

  // claim_verdict is a paid route with no free tier. It used plain req(), so a 402 came
  // back as ok:true with no verdict. It must now report payment_required like the others.
  s = await serve((q,res)=>{ res.writeHead(402,{'content-type':'application/json'});
    res.end(JSON.stringify({error:'this is a paid resource — no free tier',free_tier:'none',accepts:ACCEPTS,need_more_free_calls:LIVE_DOOR})); });
  // Must be a child process: index.cjs resolves STILLOS_NOTARY at module load, so the
  // port has to be in the env before the require, and it is not known until listen().
  const cv = await run(s.address().port, CLAIM_CODE); s.close();
  assert.strictEqual(cv.ok, false, 'FAIL: claim_verdict reported a 402 as ok:true — got '+JSON.stringify(cv).slice(0,200));
  assert(cv.payment_required, 'FAIL: claim_verdict did not flag payment_required');
  assert(/request-trial/.test(cv.remediation||''), 'FAIL: claim_verdict 402 lost the trial door');
  console.log('  PASS  claim_verdict routes through paidCall: 402 is a refusal, not a verdict');
  pass++;

  // A non-payment 4xx must not read as a success. Measured live 2026-11-21: the real
  // /notary/dispute returned HTTP 400 and this package reported {ok: true, status: 400}.
  s = await serve((q,res)=>{ res.writeHead(400,{'content-type':'application/json'});
    res.end(JSON.stringify({error:'requires {verdict_receipt_hash, verdict_object, original_resolver_spec, agent, reason}'})); });
  r = await run(s.address().port); s.close();
  assert.strictEqual(r.ok, false, 'FAIL: HTTP 400 reported as ok:true — got '+JSON.stringify(r).slice(0,200));
  assert.strictEqual(r.status, 400, 'FAIL: lost the upstream status');
  assert(/requires \{verdict_receipt_hash/.test(r.error||''), 'FAIL: dropped the server reason');
  console.log('  PASS  non-402 4xx is a refusal: ok:false with the upstream status and reason');
  pass++;

  console.log(`\n  ${pass} passed, 0 failed`);
})().catch(e=>{ console.error('  FAILED:', e.message); process.exit(1); });
