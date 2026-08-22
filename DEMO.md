# DEMO.md — walkthrough script

A step-by-step script for seeing each milestone's accept criteria (§12)
work end-to-end. Follow in order — later steps reuse patients and queue
entries created by earlier ones.

## Setup

```bash
npm install
npx prisma migrate dev
npm run db:seed
npm run dev
```

Open http://localhost:3000. `npm run db:seed` prints every seeded login;
they're also listed below. Every seeded account shares one dev password:
**`FamilyFirst2026!`**. Each seeded user has `mustChangePassword: true` —
harmless for this walkthrough, since the forced-change flow isn't built
(see DECISIONS.md); log in and proceed as normal.

**Seeded accounts** (one holding company, three clinics: `quezon-city`,
`makati`, `cebu` — swap the slug to run the same steps against another
clinic):

| Role | Email | Scope |
|---|---|---|
| Holding admin | `owner@familyfirst.example` | All three clinics |
| Clinic admin | `admin.quezon-city@familyfirst.example` | Quezon City only |
| Front desk | `staff1.quezon-city@familyfirst.example` | Quezon City only |
| Doctor | `doctor1.quezon-city@familyfirst.example` | Quezon City only |

Two demo patients are pre-seeded per clinic (one adult, one minor) so
duplicate-search and history steps below have real data to find without
registering anyone first.

---

## M1 — Foundation: role-based routing and clinic scoping

**Accept:** a staff user of Clinic A receives a 403 attempting to open a
Clinic B patient by direct URL, and the attempt is audit-logged.

1. Log in as `staff1.quezon-city@familyfirst.example`. You land on
   `/staff/queue` — front desk's home. Try navigating to
   `/console/dashboard` directly; you're redirected back, since that
   section is clinic-admin/holding-admin only.
2. On `/staff/patients`, open any Quezon City patient and copy their id
   from the URL (`/staff/patients/<id>`).
3. Log in as `staff1.makati@familyfirst.example` instead and paste that
   same `/staff/patients/<id>` URL directly into the address bar.
4. You get a **403 — Forbidden** page (`app/forbidden.tsx`), not a blank
   404 and not someone else's clinic data. The attempt is written to
   `audit_logs` — confirm with:
   ```sql
   select action, user_id, entity_id from audit_logs
   order by created_at desc limit 1;
   ```
   `action` reads `patient.read.denied` against the Makati user's id and
   the Quezon City patient's id.

---

## M2 — Patients: registration and duplicate-aware search

**Accept:** front desk registers a walk-in in under 60 seconds; searching
an existing patient by phone surfaces their prior visits.

1. As `staff1.quezon-city@familyfirst.example`, go to **Register
   walk-in**. Search a seeded patient's phone number formatted
   *differently* than how it's stored (e.g. drop the spaces/dashes) — the
   match still comes back, since search normalizes punctuation on both
   sides rather than relying on a database-level substring match.
2. Search a phone number that matches nobody, fill in the new-patient
   form, and submit. You land on a queue-number confirmation screen — a
   walk-in registration always creates a queue entry too, not just a
   patient row.
3. Open that new patient's profile (`/staff/patients/<id>`) — their visit
   (today, source "walk-in") is already listed under history.

---

## M3 — Queue: unified board, priority, live status

**Accept:** booking and walk-in entries interleave correctly by priority
and time; Call Next advances state; the patient status page and public
display both reflect it within 10 seconds (they poll every 7s).

1. Open `/book/quezon-city` in a private/incognito window (no login —
   patients never authenticate). Book a visit for **today**, checking "I
   qualify for priority." On success you get a queue number and a
   **Check your status** link (`/q/<token>`) — open it in a new tab and
   leave it open.
2. Open `/display/quezon-city` in a third tab — the public waiting-room
   screen. Leave it open too.
3. Back as front desk on `/staff/queue`, the booking appears under
   **Upcoming bookings**. Click **Check in** — it moves to the active
   queue, ordered ahead of any normal-priority walk-ins already waiting
   (priority tier sorts first, then time).
4. Click **Call Next**. Within ~7 seconds, both the patient's status tab
   ("You're being called now") and the display screen's "Now serving"
   number update on their own — no manual refresh.
5. Assign a doctor from the dropdown, then **Start consultation**.

---

## M4 — Consultation, medicine, payment

**Accept:** a completed consultation appears in the patient's history
immediately, and in today's revenue attributed to the correct collector.

1. Log in as the doctor you assigned in M3 (e.g.
   `doctor1.quezon-city@familyfirst.example`). **My queue** shows the
   patient from step 5 above — click **Start consultation**.
2. Fill in chief complaint, vitals, findings, diagnosis. Under
   **Medicines**, click **Add medicine** and search a few letters of a
   seeded medicine name (e.g. "Para" for Paracetamol) — the live-stock
   picker shows matches with current stock. Pick one, set a quantity, and
   watch the row's preview read `X left → Y after`.
3. The payment amount has already auto-filled to consultation fee + the
   medicine's selling price × quantity — itemized, per the §13 billing
   decision. Submit **Complete consultation**.
4. Two places confirm it landed: **My collections today** (doctor's own
   screen) now includes this payment attributed to you, and the
   patient's profile (`/staff/patients/<id>`) immediately shows the new
   diagnosis and dispensed medicine under history.

---

## M4b — Inventory: stock ledger and corrections

**Accept:** dispensing 5 tablets from a stock of 24 leaves 19 with a
matching `dispense` movement; deleting that row returns stock to 24 via a
`return` movement (never an edit); a failed save leaves stock untouched;
`current_stock` always equals the sum of the movement ledger.

1. As clinic admin, go to `/staff/inventory` and open any medicine's
   detail page — the **movement ledger** lists every receipt/dispense/
   adjustment/return with a running balance.
2. **Receive stock**: add 50 units to a medicine, confirm `current_stock`
   jumps by exactly 50 and a new `RECEIPT` row appears.
3. **Correction, not edit**: from a patient's profile, find a consultation
   where a medicine was dispensed from stock and click **Correct** to
   delete that dispensed row. Stock goes back up by the dispensed
   quantity via a new `RETURN` movement — the original `DISPENSE` row is
   untouched, not rewritten.
4. **Insufficient-stock override**: as a doctor, try to dispense more
   units than a medicine's current stock. Save is blocked with the exact
   shortfall shown. Check **Dispense anyway (stock count is wrong)** and
   resubmit — stock goes negative, and the audit log records which
   doctor overrode the check.
5. **Physical count**: `/staff/inventory/count`, enter an actual count
   different from the system's number for one medicine, submit with a
   reason. You get back a discrepancy summary and a matching `ADJUSTMENT`
   movement.

---

## M5 — Notifications

**Accept:** booking, almost-your-turn, and now-serving events each write
a notification row with fully rendered message text.

1. Book a new visit through `/book/quezon-city` again. As clinic admin,
   open `/staff/notifications` — a `booking_confirmed` row appears with
   the real queue number and `/q/<token>` link rendered into the message
   text (not a template placeholder).
2. Check that patient in, then get 2–3 people ahead of them in the active
   queue and call through them. Once they're within a few places of the
   front, an `almost_your_turn` row appears — calling again for the same
   patient doesn't duplicate it.
3. Call them next — a `now_serving` row appears with their real name and
   queue number.
4. From `/staff/follow-ups`, pick a completed consultation with a
   follow-up date and click **Send reminder** — a `follow_up_due` row
   appears, addressed with the doctor's name exactly as stored (no
   double "Dr. Dr." — a real bug this build hit twice and fixed both
   times).

---

## M6 — Reporting and reconciliation

**Accept:** the holding admin sees three clinics with a combined P&L
whose per-clinic revenue reconciles exactly to the sum of payment rows;
a remittance variance displays correctly.

1. Log in as `owner@familyfirst.example` and open **Reports**. All three
   clinics are listed with visits/revenue/expenses/net, plus a combined
   total. Cross-check one clinic's revenue figure directly:
   ```sql
   select sum(amount) from payments
   where clinic_id = (select id from clinics where slug = 'quezon-city')
     and received_at >= <range start> and received_at < <range end>;
   ```
   It matches the report exactly, in centavos → pesos.
2. Download the CSV export from the same page and confirm it opens with
   the same summary numbers.
3. Log in as the doctor from M4 and go to **Remittance**. Enter an amount
   *different* from the expected total shown (e.g. ₱20 short) with a
   note explaining why, and submit.
4. Log in as clinic admin, open `/staff/remittance` — the submission is
   listed under **Pending confirmation** with the variance shown in red
   (short) or highlighted (over), plus the doctor's note. Confirm it.
5. Record an expense from `/console/expenses` and reload the clinic
   report — net income drops by exactly that amount; revenue is
   unaffected.

---

## M7 — Polish

No separate accept line in §12 — verify by feel:

- Resize the browser (or use a phone) to 375px width and repeat the
  **consultation** (M4) and **queue board** (M3) steps above — every
  control stays reachable and legible one-handed, per §9's explicit
  requirement for those two screens.
- `/book/quezon-city` on the same narrow width: fill the form, then
  deliberately submit with one field wrong (e.g. a too-short emergency
  contact number) — the error shows and everything you already typed is
  still there, not wiped.
- Visit a nonexistent URL (e.g. `/nope`) while logged in — a styled 404
  page, not Next's default.
- Every list screen (queue, patients, inventory, notifications,
  follow-ups, remittance) shows a real "nothing here yet" message on a
  fresh clinic with no data, not a blank space.

---

## Resetting between runs

`npm run db:seed` is idempotent — it clears its own prior output and
recreates the fixed dataset, so rerunning it any time gives you a clean
slate without a full `prisma migrate reset`.
