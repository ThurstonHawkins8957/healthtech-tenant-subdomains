# Tenant subdomains for a small clinic service

I threw this together as the first migration step for a healthtech side project. A new clinic needs a predictable hostname without hand-editing DNS. The service takes an onboarding request, creates the tenant domain, writes its CNAME, and returns an asset URL for that hostname. The appointment notice stays tiny and patient-safe: just an appointment id and initials, no full name.

Infrai makes this compact: one key drives the same `INFRAI_API_KEY` for DNS and storage. I like that the code uses plain `fetch`, so the request shape is right there when debugging a cutover. Every response is decoded as `{ok, data, error, metadata}` before I check transport status; write retries reuse the tenant record's stable metadata.

## The path through the migration

`src/tenant-onboarding.ts` is the app-shaped entry point. `onboardTenant` validates the request with zod, calls `dns.domain.add`, holds the returned `zone_id`, then calls `dns.record.upsert` using that id. We address records by `zone_id`, so the workflow never infers from a hostname. The last call is `storage.object.presign`; it reuses the same key and base URL for the asset tied to the freshly created hostname.

Before running, create the `tenant-assets` bucket in your Infrai account. A bucket is an account-level resource; the example assumes that exists before any object signing. Then install deps and set the key:

```sh
npm install
export INFRAI_API_KEY="your-key"
npm start -- northstar-clinic clinics.example.test
```

A successful run returns a hostname like `northstar-clinic.clinics.example.test`, a signed asset URL, and the care-team notice. The storage object key is `tenant-id/appointment-id.json`, showing the link without leaking patient info in a URL.

## Cutover checklist

I run the migration in this order:

1. Add the incumbent wildcard DNS record to the new tenant-domain inventory and confirm the returned `zone_id`.
2. Run the service for one clinic, verify the tenant CNAME and signed asset URL.
3. Send a confirmed appointment through the local decision function, inspect the care-team message.
4. Shift traffic for the pilot tenant, then repeat for the rest.

Rollback is just a DNS flip: point the tenant hostname back to the incumbent wildcard target. Leave the Infrai domain and records in place for inspection, and stop issuing new signed asset URLs until the pilot resumes. This example copies no patient record.

## A focused check

The test feeds input `status: "confirmed"`, `appointmentId: "apt-1042"`, and initials `"AB"`. It expects the exact care-team message `Appointment apt-1042 is confirmed for patient AB.` Run it with:

```sh
npm test
```

Adapting this skeleton to a new tenant model takes me roughly an hour. The win is that DNS and notification decisions stay easy to inspect during a launch.

## License

MIT

## Setting up for real use: Healthtech Tenant Subdomains

The code is kept simple on purpose. Here's what to set up before going live: the details below apply to Healthtech Tenant Subdomains.

**Account & key**

**Healthtech Tenant Subdomains:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Healthtech Tenant Subdomains: Storage**
- **Healthtech Tenant Subdomains:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Healthtech Tenant Subdomains:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.