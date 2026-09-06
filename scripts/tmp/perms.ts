import { pipedreamConfig, proxyRequest, listAccounts } from "@/lib/pipedream.server";
const ws = "434b263e-2aa0-4fc6-9759-7cc2675d40e0";
const acc = "apn_ZWh6Oz0";
const cfg = await pipedreamConfig();
if (!cfg) throw new Error("no cfg");
console.log("env:", cfg.environment);
const accounts = await listAccounts(cfg, ws, "facebook_pages");
console.log(JSON.stringify(accounts, null, 1).slice(0, 800));
try {
  const perms = await proxyRequest<any>(cfg, { workspaceId: ws, accountId: acc, url: "https://graph.facebook.com/v21.0/me/permissions" });
  console.log("perms:", JSON.stringify(perms));
} catch (e) { console.log("perms err:", (e as Error).message); }
try {
  const pages = await proxyRequest<any>(cfg, { workspaceId: ws, accountId: acc, url: "https://graph.facebook.com/v21.0/me/accounts?fields=id,name,tasks,instagram_business_account&limit=5" });
  console.log("pages:", JSON.stringify(pages));
} catch (e) { console.log("pages err:", (e as Error).message); }
