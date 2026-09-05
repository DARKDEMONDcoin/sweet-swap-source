/**
 * طبقة Pipedream Connect — الوسيط الموحّد لكل تكاملات الموظفين.
 *
 * المبدأ: لا تلمس منصتنا أي توكن OAuth لأي منصة خارجية إطلاقاً.
 * المستخدم يربط حسابه عبر Pipedream، ونحن نحتفظ بمعرّف الحساب (apn_...) فقط،
 * ثم ننفّذ الطلبات إما عبر «إجراء جاهز» (actions/run) أو عبر «الوكيل» (proxy).
 *
 * المفاتيح تُقرأ من جدول app_secrets في Supabase (Supabase هو الباك إند الوحيد)
 * مع سقوط اختياري على متغيرات البيئة.
 */

const API = "https://api.pipedream.com/v1";

export type PipedreamConfig = {
  clientId: string;
  clientSecret: string;
  projectId: string;
  environment: "development" | "production";
};

type Cache = { at: number; value: PipedreamConfig };
let configCache: Cache | null = null;
let tokenCache: { at: number; ttl: number; token: string } | null = null;

const CONFIG_TTL = 5 * 60 * 1000;

const SECRET_NAMES = [
  "PIPEDREAM_CLIENT_ID",
  "PIPEDREAM_CLIENT_SECRET",
  "PIPEDREAM_PROJECT_ID",
  "PIPEDREAM_ENVIRONMENT",
] as const;

/** يقرأ إعدادات Pipedream عبر الطبقة الموحّدة للأسرار (جدول app_secrets في Supabase). */
export async function pipedreamConfig(): Promise<PipedreamConfig | null> {
  if (configCache && Date.now() - configCache.at < CONFIG_TTL) return configCache.value;

  const { getSecrets } = await import("./secrets.server");
  const found: Record<string, string> = await getSecrets(SECRET_NAMES);


  const clientId = found["PIPEDREAM_CLIENT_ID"] ?? "";
  const clientSecret = found["PIPEDREAM_CLIENT_SECRET"] ?? "";
  const projectId = found["PIPEDREAM_PROJECT_ID"] ?? "";
  if (!clientId || !clientSecret || !projectId) return null;

  const value: PipedreamConfig = {
    clientId,
    clientSecret,
    projectId,
    environment: found["PIPEDREAM_ENVIRONMENT"]?.trim().toLowerCase() === "production" ? "production" : "development",
  };
  configCache = { at: Date.now(), value };
  return value;
}

/** رسالة موحّدة عندما لا تكون مفاتيح Pipedream مضبوطة بعد. */
export function missingConfigError(): Error {
  return new Error(
    "لم تُضبط مفاتيح Pipedream بعد. أضف PIPEDREAM_CLIENT_ID و PIPEDREAM_CLIENT_SECRET و PIPEDREAM_PROJECT_ID في جدول app_secrets.",
  );
}

/** توكن خادم قصير العمر عبر client_credentials مع تخزين مؤقت. */
async function accessToken(config: PipedreamConfig): Promise<string> {
  if (tokenCache && Date.now() - tokenCache.at < tokenCache.ttl) return tokenCache.token;

  const res = await fetch(`${API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`تعذّر الاتصال بـ Pipedream [${res.status}]: ${text.slice(0, 200)}`);
  const json = JSON.parse(text) as { access_token: string; expires_in?: number };
  const ttl = Math.max(60_000, ((json.expires_in ?? 3600) - 120) * 1000);
  tokenCache = { at: Date.now(), ttl, token: json.access_token };
  return json.access_token;
}

async function call<T>(
  config: PipedreamConfig,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await accessToken(config);
  const res = await fetch(`${API}/connect/${config.projectId}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "x-pd-environment": config.environment,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`[pipedream] ${path} [${res.status}]: ${text.slice(0, 400)}`);
    if (res.status === 429) throw new Error("Pipedream مشغول مؤقتاً — أعد المحاولة بعد قليل.");
    // حساب مفقود لدى الوسيط = ربط قديم أو ملغى — نوضّحه بلغة المستخدم.
    if (text.includes("Auth provision not found")) {
      throw new Error("الحساب لم يعد مربوطاً — أعد ربطه من صفحة التكاملات ثم أعد المحاولة.");
    }
    // طلبات الوكيل تنقل خطأ المنصة نفسها، لا خطأ الوسيط — نوضّح ذلك للمستخدم.
    const source = path.startsWith("/proxy/") ? "المنصة رفضت الطلب" : "الوسيط رفض الطلب";
    throw new Error(`${source} [${res.status}]: ${text.slice(0, 200)}`);

  }
  return (text ? JSON.parse(text) : {}) as T;
}

/** معرّف المستخدم لدى Pipedream = مساحة العمل (كل ربط يخص العلامة لا الشخص). */
export function externalUserId(workspaceId: string): string {
  return `ws_${workspaceId}`;
}

export type ConnectToken = {
  token: string;
  expires_at?: string;
  connect_link_url?: string;
};

/** ينشئ توكن ربط قصير العمر لصفحة الربط (Connect Link أو الـ SDK). */
export async function createConnectToken(
  config: PipedreamConfig,
  workspaceId: string,
  allowedOrigins: string[],
): Promise<ConnectToken> {
  return call<ConnectToken>(config, "/tokens", {
    method: "POST",
    body: JSON.stringify({
      external_user_id: externalUserId(workspaceId),
      allowed_origins: allowedOrigins,
    }),
  });
}

export type PdAccount = {
  id: string;
  name?: string | null;
  healthy?: boolean;
  app?: { name_slug?: string; name?: string } | string;
};

/** حسابات مساحة العمل المربوطة (بدون أي بيانات اعتماد). */
export async function listAccounts(
  config: PipedreamConfig,
  workspaceId: string,
  appSlug?: string,
): Promise<PdAccount[]> {
  const params = new URLSearchParams({ external_user_id: externalUserId(workspaceId) });
  if (appSlug) params.set("app", appSlug);
  const res = await call<{ data?: PdAccount[] }>(config, `/accounts?${params.toString()}`);
  return res.data ?? [];
}

/** فصل حساب من Pipedream نهائياً. */
export async function deleteAccount(config: PipedreamConfig, accountId: string): Promise<void> {
  await call(config, `/accounts/${accountId}`, { method: "DELETE" });
}

/** تنفيذ إجراء جاهز من مكتبة Pipedream (نشر منشور، إرسال بريد، إنشاء جهة اتصال…). */
export async function runAction(
  config: PipedreamConfig,
  params: {
    workspaceId: string;
    componentId: string;
    configuredProps: Record<string, unknown>;
  },
): Promise<{ ret?: unknown; exports?: unknown; os?: unknown }> {
  return call(config, "/actions/run", {
    method: "POST",
    body: JSON.stringify({
      id: params.componentId,
      external_user_id: externalUserId(params.workspaceId),
      configured_props: params.configuredProps,
    }),
  });
}

/** استدعاء أي واجهة خارجية عبر وكيل Pipedream — بلا أي توكن على خوادمنا. */
export async function proxyRequest<T = unknown>(
  config: PipedreamConfig,
  params: {
    workspaceId: string;
    accountId: string;
    url: string;
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    body?: unknown;
    /** جسم نصي جاهز (مثل form-urlencoded) بدلاً من JSON. */
    rawBody?: string;
    headers?: Record<string, string>;
  },
): Promise<T> {
  const encoded = base64Url(params.url);
  const search = new URLSearchParams({
    external_user_id: externalUserId(params.workspaceId),
    account_id: params.accountId,
  });
  const body =
    params.rawBody !== undefined
      ? params.rawBody
      : params.body === undefined
        ? undefined
        : JSON.stringify(params.body);
  return call<T>(config, `/proxy/${encoded}?${search.toString()}`, {
    method: params.method ?? "GET",
    ...(body === undefined ? {} : { body }),
    headers: Object.fromEntries(
      Object.entries(params.headers ?? {}).map(([k, v]) => [`x-pd-proxy-${k}`, v]),
    ),
  });
}


function base64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
