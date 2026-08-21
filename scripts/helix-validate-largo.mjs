import { mintAppSession } from "./audit/lib/app-session.mjs";
import { fetchRetry } from "./audit/lib/fetch-retry.mjs";
const BASE = "https://blackouttrades.com";
const QS = [
  "What is the overall call/put premium skew on the HELIX tape this session for SPX? Give me the single authoritative number and which tool it comes from.",
  "Does HELIX flow agree with the thermal read on SPX right now? Give the HELIX flow bias and its dollar figure, and whether it's carried by one large print.",
  "How many contracts in total are stacking across the whole HELIX tape right now, not just the top few?",
];
const s = await mintAppSession({ appUrl: BASE });
if (s.skip){console.error("skip",s.reason);process.exit(2);}
let cookie=s.cookieHeader, minted=Date.now();
async function ck(){ if(Date.now()-minted>55000&&s.refresh){const n=await s.refresh().catch(()=>null); if(n?.cookieHeader){cookie=n.cookieHeader;minted=Date.now();}} return cookie; }
for (const q of QS){
  let r=null;
  for(let i=0;i<4;i++){
    const res=await fetchRetry(`${BASE}/api/market/largo/query`,{method:"POST",headers:{"Content-Type":"application/json",Cookie:await ck()},body:JSON.stringify({question:q,session_id:`hv-${process.pid}-${i}`})},{retries:1,timeoutMs:120000});
    r={status:res.status,...(await res.json().catch(()=>({})))};
    if(res.status===200)break; if(res.status===401){minted=0;continue;} if(res.status===429){await new Promise(x=>setTimeout(x,2500*(i+1)));continue;} break;
  }
  console.log(`\n${"=".repeat(80)}\nQ: ${q}\n[${r.status}]\n${"-".repeat(80)}\n${r.answer||"(empty)"}`);
  await new Promise(x=>setTimeout(x,1200));
}
console.log("\nWROTE-DONE");
await s.cleanup?.();
