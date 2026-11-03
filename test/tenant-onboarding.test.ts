import assert from "node:assert/strict";
import { patientSafeNotice } from "../src/tenant-onboarding.ts";

const notice = patientSafeNotice({
  tenantId: "northstar-clinic",
  tenantDomain: "clinics.example.test",
  appointmentId: "apt-1042",
  patientInitials: "AB",
  status: "confirmed"
});

assert.deepEqual(notice, {
  appointmentId: "apt-1042",
  message: "Appointment apt-1042 is confirmed for patient AB.",
  audience: "care-team"
});
console.log("patient-safe notification decision passed");
