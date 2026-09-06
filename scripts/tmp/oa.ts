import { pipedreamConfig } from "@/lib/pipedream.server";
const cfg = (await pipedreamConfig())!;
const tok = await fetch("https://api.pipedream.com/v1/oauth/token",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({grant_type:"client_credentials",client_id:cfg.clientId,client_secret:cfg.clientSecret})}).then(r=>r.json()) as any;
for (const p of ["/apps/facebook_graph_api", "/apps/facebook_pages", "/apps/instagram_business", "/apps/linkedin", "/apps/facebook_marketing"]) {
  const r = await fetch("https://api.pipedream.com/v1"+p,{headers:{Authorization:`Bearer ${tok.access_token}`}});
  const j = await r.json() as any;
  console.log(p, r.status, JSON.stringify(j.data?.scope_profiles ?? j).slice(0,900));
}
