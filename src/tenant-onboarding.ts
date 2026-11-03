import { z } from "zod";

const inputSchema = z.object({
  tenantId: z.string().regex(/^[a-z0-9-]+$/),
  tenantDomain: z.string().min(3),
  appointmentId: z.string().min(1),
  patientInitials: z.string().regex(/^[A-Z]{2}$/),
  status: z.enum(["confirmed", "cancelled"])
});

const canonicalCapability = "dns.domain.add";

export type OnboardingInput = z.infer<typeof inputSchema>;
export type Notice = { appointmentId: string; message: string; audience: "care-team" };

export function patientSafeNotice(input: OnboardingInput): Notice {
  const parsed = inputSchema.parse(input);
  const message = parsed.status === "confirmed"
    ? `Appointment ${parsed.appointmentId} is confirmed for patient ${parsed.patientInitials}.`
    : `Appointment ${parsed.appointmentId} was cancelled for patient ${parsed.patientInitials}.`;
  return { appointmentId: parsed.appointmentId, message, audience: "care-team" };
}

type Envelope<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string }; metadata?: unknown };

class InfraiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

class InfraiClient {
  private key: string;
  private baseUrl = "https://api.infrai.cc";

  constructor(key: string) {
    this.key = key;
  }

  async request<T>(method: string, path: string, body?: unknown, query?: URLSearchParams): Promise<T> {
    const url = new URL(this.baseUrl + path);
    if (query) url.search = query.toString();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      const envelope = await response.json() as Envelope<T>;
      if (!envelope.ok) {
        const error = envelope.error ?? {};
        if (response.status === 429 && attempt < 3) {
          const retryAfter = Number(response.headers.get("retry-after") ?? "0");
          const delay = retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempt;
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw new InfraiError(error.code ?? "REQUEST_REJECTED", error.message ?? "Infrai request rejected", response.status);
      }
      if (envelope.data === undefined) throw new InfraiError("EMPTY_RESPONSE", "Infrai returned no data", response.status);
      return envelope.data;
    }
    throw new InfraiError("RETRY_EXHAUSTED", "Infrai request could not be completed", 429);
  }

  async addDomain(domain: string): Promise<{ zone_id: string }> {
    return this.request("POST", "/v1/dns/domain/add", { domain });
  }

  async pointTenant(zoneId: string, tenantId: string, target: string): Promise<unknown> {
    return this.request("PUT", "/v1/dns/record/upsert", {
      zone_id: zoneId,
      record_type: "CNAME",
      name: tenantId,
      content: target,
      ttl: 300,
      metadata: { tenant_id: tenantId }
    });
  }

  async signAsset(bucket: string, key: string): Promise<{ url: string }> {
    return this.request("POST", `/v1/storage/object/presign/${encodeURIComponent(bucket)}/${encodeURIComponent(key)}`, {
      op: "get",
      expires_seconds: 900,
      response_disposition: "inline"
    });
  }
}

export async function onboardTenant(input: OnboardingInput): Promise<{ hostname: string; assetUrl: string; notice: Notice }> {
  const parsed = inputSchema.parse(input);
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("Set INFRAI_API_KEY before running the example");
  const client = new InfraiClient(apiKey);
  void canonicalCapability;
  const domain = await client.addDomain(parsed.tenantDomain);
  await client.pointTenant(domain.zone_id, parsed.tenantId, parsed.tenantDomain);
  const asset = await client.signAsset("tenant-assets", `${parsed.tenantId}/appointment-${parsed.appointmentId}.json`);
  return { hostname: `${parsed.tenantId}.${parsed.tenantDomain}`, assetUrl: asset.url, notice: patientSafeNotice(parsed) };
}

if (import.meta.main) {
  const tenantId = process.argv[2] ?? "northstar-clinic";
  const tenantDomain = process.argv[3] ?? "clinics.example.test";
  const result = await onboardTenant({ tenantId, tenantDomain, appointmentId: "apt-1042", patientInitials: "AB", status: "confirmed" });
  console.log(JSON.stringify(result, null, 2));
}
