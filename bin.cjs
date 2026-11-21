#!/usr/bin/env node
'use strict';
/*
 * stillos-notary-mcp CLI / MCP entry.
 *   stillos-notary-mcp mcp                      -> run as an MCP stdio server (for agents/clients)
 *   stillos-notary-mcp verify <hash>            -> verify a receipt hash
 *   stillos-notary-mcp claim <agent> <claim> <resolver-json>  -> submit a claim-verdict ($0.25 x402, no free tier)
 *   stillos-notary-mcp dispute <agent> <receipt-hash> <filing-json>  -> file a bonded dispute (currently unpaywalled)
 *   stillos-notary-mcp screen <agent> <entity>                -> OFAC SDN name screen ($0.001 x402, no free tier)
 *   stillos-notary-mcp distress <agent> <ticker>              -> distress ranker, AUC 0.769 ($0.25 x402, no free tier)
 */
const { callTool } = require('./index.cjs');

// 2026-09-10: this used to print "attach payment and retry" for a mechanism that did
// not exist anywhere in this package. It exists now (index.cjs paidCall), so the hint
// tells the caller how to actually use it instead of naming a dead end.
function payHint(out, price) {
  if (out.paid) return '';
  const lines = ['\nPaid endpoint (' + price + ' USDC, Base, x402). No free tier.'];
  if (out.code === 'PAYMENT_REQUIRED') {
    lines.push('This client can pay automatically — it just has no credential yet. Either:');
    lines.push('  export STILLOS_NOTARY_WALLET_KEY=0x...   (raw key, simplest)');
    lines.push('  or pass opts.account / opts.fetch when calling callTool() from code.');
    lines.push('Then re-run this exact command; the payment is attached and the call retried once.');
  } else if (out.code === 'PAYMENT_CAPABILITY_MISSING') {
    lines.push('Payment libraries missing in this runtime: npm install x402-fetch viem');
  } else if (out.code) {
    lines.push('Payment not completed [' + out.code + ']: ' + (out.error || ''));
  }
  return lines.join('\n');
}

const args = process.argv.slice(2);

if (args[0] === 'mcp') { require('./mcp.cjs'); return; }

function print(out) { console.log(JSON.stringify(out, null, 2)); }

if (args[0] === 'verify' && args[1]) {
  callTool('verify_receipt', { hash: args[1] }).then(print).catch(e => { console.error(e.message); process.exit(1); });
} else if (args[0] === 'claim' && args[1] && args[2] && args[3]) {
  let resolver; try { resolver = JSON.parse(args[3]); } catch { console.error('resolver must be JSON, e.g. \'{"type":"http_status","url":"...","expect_code":200}\''); process.exit(1); }
  callTool('claim_verdict', { agent: args[1], claim: args[2], resolver }).then((out) => {
    print(out);
    // claim-verdict is a paid route with no free tier; it prints the same pay hint as the
    // others now that it routes through paidCall. It previously printed a raw 402 as if it
    // were a verdict.
    if (out.payment_required) console.log(payHint(out, '$0.25'));
  }).catch(e => { console.error(e.message); process.exit(1); });
} else if (args[0] === 'dispute' && args[1] && args[2]) {
  // The live handler requires the verdict object and the resolver spec that produced it,
  // and neither is recoverable from the hash, so they come in as one JSON argument.
  let filing;
  try { filing = JSON.parse(args[3] || ''); } catch {
    console.error('dispute needs a 4th JSON argument: \'{"verdict_object":{...},"original_resolver_spec":{...},"reason":"..."}\'');
    console.error('Those come from the claim_verdict response you are disputing — the server rejects a verdict_object that does not hash to the receipt.');
    process.exit(1);
  }
  callTool('file_dispute', { agent: args[1], receipt_hash: args[2], ...filing }).then((out) => {
    print(out);
    if (out.payment_required) console.log(payHint(out, '$0.25'));
  }).catch(e => { console.error(e.message); process.exit(1); });
} else if (args[0] === 'screen' && args[1] && args[2]) {
  callTool('screen_entity', { agent: args[1], entity: args[2] }).then((out) => {
    print(out);
    if (out.payment_required) console.log(payHint(out, '$0.001'));
  }).catch(e => { console.error(e.message); process.exit(1); });
} else if (args[0] === 'distress' && args[1] && args[2]) {
  callTool('distress_score', { agent: args[1], ticker: args[2] }).then((out) => {
    print(out);
    if (out.payment_required) console.log(payHint(out, '$0.25'));
  }).catch(e => { console.error(e.message); process.exit(1); });
} else {
  console.log('stillos-notary-mcp — verification infrastructure for the agentic economy.\n');
  console.log('  stillos-notary-mcp mcp                                        run as MCP server');
  console.log('  stillos-notary-mcp verify <hash>                              verify a receipt');
  console.log('  stillos-notary-mcp claim <agent> <claim> <resolver-json>      submit a claim-verdict ($0.25 x402, no free tier)');
  console.log('  stillos-notary-mcp dispute <agent> <receipt-hash> <filing-json>  file a bonded dispute (currently unpaywalled)');
  console.log('       filing-json: {\"verdict_object\":{...},\"original_resolver_spec\":{...},\"reason\":\"...\"} from the disputed claim_verdict response');
  console.log('  stillos-notary-mcp screen <agent> <entity>                    OFAC SDN name screen ($0.001 x402, no free tier)');
  console.log('  stillos-notary-mcp distress <agent> <ticker>                  distress ranker, AUC 0.769 ($0.25 x402, no free tier)\n');
  console.log('example resolver: {"type":"http_status","url":"https://example.com","expect_code":200}');
  process.exit(2);
}
