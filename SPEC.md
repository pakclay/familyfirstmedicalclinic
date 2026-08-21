# SPEC.md — Family First Medical Clinic Management System (MVP)

## 0. How to use this document (instructions to Claude Code)

You are building a working MVP/prototype, not a production deployment. Follow these rules:

1. Read this entire spec before writing code. Then restate your build plan and flag anything you think is wrong or missing before starting.
2. Build in the milestone order in Section 12. After each milestone, stop and show me what works.
3. Every decision marked `DECISION:` has a default. Use the default unless I have told you otherwise. Do not invent alternatives silently — if you deviate, say so.
4. Do not stub out core logic with `TODO`. If something can't be built, say why instead of faking it.
5. External providers (SMS, Facebook Messenger) must run in **mock mode** by default: log the message payload to a database table and print it to console. Real provider integration goes behind a single interface, swappable by env var.
6. Prefer boring, obvious code. This will be maintained by a small team, possibly by someone less experienced than you.

---

## 1. Business context

Family First Medical Clinic is a general medical clinic in the Philippines serving patients aged 0–99 for general checkups with general practitioners. Patients discover and message the clinic through Facebook.

**Today, everything is on paper:**

| Step | Current state |
|---|---|
| Booking | Customer calls, messages Facebook, or walks in |
| Queue | Handwritten list in a notebook, prioritized manually |
| New patient record | Patient fills out a paper index card |
| Returning patient | Staff searches a physical cabinet for the index card |
| Consultation | Doctor writes findings and medicine given on the index card |
| Payment | Patient hands cash directly to the doctor |

**Consequences the system must fix:** records are lost or unfindable, queue position is invisible to patients, no consolidated revenue picture, cash is unreconciled, no follow-up mechanism, and nothing survives staff turnover.

---

## 2. Objective

Ship a mobile-first web application that replaces the notebook and the index card cabinet with:

- a public self-service booking link that Facebook staff can paste into a chat,
- a live queue visible to patients and controlled by staff,
- a digital patient record with consultation and medicine history,
- cash collection capture with per-doctor reconciliation,
- multi-clinic reporting rolled up to a holding company.

**Success test for the MVP:** a patient books through the link on a phone, receives a queue number and status updates, is called and consulted, has medicine and payment recorded, and appears correctly in that day's clinic revenue report — with zero paper.

---

## 3. Non-goals (explicitly out of scope for MVP)

Do not build these. Mention them in the README as future work only.

- Insurance / HMO / PhilHealth claim processing
- Full EMR: lab orders, imaging, ICD coding, e-prescription printing standards
- Purchase orders, supplier management, and automated reordering (MVP tracks stock and deducts on dispensing — see Section 7.5 — but a human decides when and from whom to restock)
- Batch/lot tracking with FIFO expiry costing (MVP tracks one stock level and one expiry warning per medicine)
- Native mobile apps
- Doctor payroll and commission calculation
- Telemedicine / video consultation
- Accounting-grade double-entry bookkeeping (MVP produces a revenue and expense summary, not GAAP financials)

---

## 4. Users and roles

| Role | Scope | Can do |
|---|---|---|
| **Patient** | Self | Book a slot, view own queue position, view own visit summary via a tokenized link. No login/password. |
| **Front Desk / Staff** | One clinic | Register walk-ins, search patients, manage queue order, call next, record payment, send follow-up messages |
| **Doctor** | One clinic (may be assigned to several) | See own queue, open patient record, write consultation notes, record medicine given, record payment received |
| **Clinic Admin** | One clinic | Everything staff can do, plus manage doctors/staff accounts, clinic hours, services and prices, view full clinic reports |
| **Holding Admin (Owner)** | All clinics under the holding company | Create clinics, view consolidated and per-clinic reports, manage all users, view audit log |

`DECISION:` Default to role-based permissions checked on the server for every request, not just hidden in the UI. Patients never authenticate — they access their own status through an unguessable token in the URL.

---

## 5. Multi-clinic / holding company model

This is a core requirement, not an afterthought. Get it right in the schema on day one.

- A **HoldingCompany** owns many **Clinics**.
- A **Clinic** has its own name, address, contact number, operating hours, doctors, staff, patients, queues, and transactions.
- A Clinic may exist standalone (no holding company) — the model must allow a null parent.
- Reporting rolls **up**: a clinic report shows one clinic; a holding report aggregates all its clinics with a per-clinic breakdown.

**Hard rule:** every query that touches patient, queue, or money data must be scoped by `clinic_id`, derived from the authenticated user's assignment — never from a client-supplied parameter. Write a shared scoping helper and use it everywhere. Add a test proving a staff user from Clinic A cannot read Clinic B's patient by ID.

`DECISION:` Patients belong to a single clinic in the MVP. Cross-clinic patient sharing is future work — but design the patient table so it isn't painful to add later.

---

## 6. Data model

Generate migrations for the following. Use UUIDs for public-facing IDs, timestamps on every table, and soft deletes on patient and clinical records.

**holding_companies** — id, name, contact info

**clinics** — id, holding_company_id (nullable), name, address, city, phone, facebook_page_url, timezone (default Asia/Manila), operating_hours (JSON per weekday), is_active

**users** — id, clinic_id (nullable for holding admin), holding_company_id (nullable), name, email, phone, password_hash, role, is_active

**doctors** — id, user_id, clinic_id, license_number, specialization (default "General Practitioner"), consultation_fee, is_available_today

**patients** — id, clinic_id, first_name, last_name, middle_name, birthdate, sex, phone, email (nullable), address, emergency_contact_name, emergency_contact_phone, facebook_psid (nullable), notes, created_by
- Derive age from birthdate at display time; never store age.
- `DECISION:` Support minors — if the patient is under 18, guardian name and guardian phone are required.

**queue_entries** — id, clinic_id, patient_id, doctor_id (nullable until assigned), queue_number, queue_date, status, priority, source, reason_for_visit, checked_in_at, called_at, started_at, completed_at, access_token
- `status`: `booked` → `checked_in` → `waiting` → `called` → `in_consultation` → `completed`, plus `no_show` and `cancelled`
- `priority`: `normal` | `priority` (senior citizen, PWD, pregnant, infant, emergency) — Philippine clinics are legally expected to prioritize seniors and PWDs, so make this a visible, one-tap flag
- `source`: `facebook` | `walk_in` | `phone` | `online`
- `queue_number` resets daily per clinic. Generate it inside a transaction so two simultaneous bookings can't collide.

**consultations** — id, queue_entry_id, patient_id, doctor_id, clinic_id, chief_complaint, vitals (JSON: bp, temp, weight, height, pulse), findings, diagnosis, treatment_plan, follow_up_date (nullable), created_at
- This is the digital replacement for the index card. Append-only in spirit: edits create a new revision row rather than overwriting, so clinical history is never silently rewritten.

**medicines** — id, clinic_id, name, generic_name, form (`tablet` | `capsule` | `syrup` | `injection` | `ointment` | `other`), strength, unit (`piece` | `bottle` | `vial` | `sachet` | `box`), current_stock, reorder_level, unit_cost, selling_price, expiry_date (nullable), is_active
- Stock is **per clinic** — each clinic keeps its own inventory. Two clinics stocking Paracetamol 500mg have two separate rows with independent counts.
- `current_stock` is a cached running total for fast display. It must only ever change through a `stock_movements` row written in the same transaction — never by direct update.

**stock_movements** — id, clinic_id, medicine_id, movement_type, quantity_change (signed integer), balance_after, reference_type (nullable), reference_id (nullable), reason, performed_by_user_id, created_at
- `movement_type`: `receipt` (stock in), `dispense` (stock out to patient), `adjustment` (manual correction after a physical count), `return` (dispensing reversed), `expired`, `damaged`
- This table is the ledger and the source of truth. `current_stock` must always equal the sum of `quantity_change` for that medicine — write a test that proves it after a mixed sequence of receipts, dispenses, and reversals.
- Every movement records who did it and why. Adjustments require a non-empty `reason`.

**medicines_dispensed** — id, consultation_id, medicine_id (nullable), medicine_name, dosage, quantity, instructions, unit_price (nullable), notes, stock_movement_id (nullable)
- `medicine_name` is denormalized on purpose: the clinical record must still read correctly if the medicine is later renamed or deactivated.
- `medicine_id` is nullable so a doctor can record a medicine the patient buys elsewhere (advised, not dispensed). When `medicine_id` is null, no stock is touched — the form must make this distinction explicit with a "dispensed from clinic stock" vs "prescribed only" toggle.

**payments** — id, clinic_id, consultation_id (nullable), patient_id, amount, payment_method (default `cash`), collected_by_user_id, received_at, or_number (nullable), notes
- `collected_by_user_id` is essential: today doctors take cash directly, so the system must record *who is holding the money*.

**remittances** — id, clinic_id, user_id, shift_date, expected_amount, actual_amount, variance, remitted_at, confirmed_by_user_id, notes
- Closes the cash loop. At end of shift the doctor/staff remits collected cash; the system compares to the sum of their recorded payments and shows the variance.

**expenses** — id, clinic_id, category, description, amount, expense_date, recorded_by_user_id
- Minimal, but required for P&L to mean anything.

**notifications** — id, clinic_id, patient_id, queue_entry_id (nullable), channel (`sms` | `messenger`), template_key, payload, status (`queued` | `sent` | `failed` | `mocked`), provider_message_id, error, sent_at

**audit_logs** — id, clinic_id, user_id, action, entity_type, entity_id, changes (JSON), ip_address, created_at
- Log every read and write of clinical and financial records. Non-negotiable — see Section 10.

---

## 7. Core flows

### 7.1 Booking from Facebook
1. Staff replies in Messenger with the clinic's booking link: `/book/{clinic_slug}`.
2. Public form (no login): name, birthdate, sex, mobile number, address, reason for visit, preferred date, whether they qualify for priority.
3. On submit: match to an existing patient by phone + last name + birthdate. If matched, attach to that record; if not, create a new patient.
4. Create a `queue_entry` with `source = facebook`, status `booked`, and a generated `access_token`.
5. Show a confirmation screen with the queue number and a **status link** (`/q/{access_token}`), and send the same link by SMS.

`DECISION:` Booking is same-day or next-day only, into a simple number-based queue — not fixed appointment time slots. Fixed slots are a much larger build and the clinic currently runs first-come-first-served. Confirm if you want true time slots instead.

### 7.2 Walk-in
Front desk uses `/staff/register` — same fields, one screen, phone-number search first to avoid duplicates. Creates a queue entry with `source = walk_in`, status `checked_in`.

### 7.3 The queue
- One unified queue per clinic per day. Online bookings and walk-ins share the same numbering — do not run two separate lines.
- Ordering: all `priority` entries ahead of `normal` entries, then by check-in time. Staff can manually reorder by drag or by an up/down control, and every manual reorder is written to the audit log.
- **Staff queue board** (`/staff/queue`): live list, current serving number large at the top, buttons — Call Next, Recall, Mark No-Show, Assign Doctor, Start Consultation.
- **Doctor queue** (`/doctor/queue`): only patients assigned to that doctor, plus Start Consultation.
- **Public display** (`/display/{clinic_slug}`): a large-type, auto-refreshing screen for a waiting-room TV or tablet showing now-serving and the next few numbers. Show queue numbers only, never full patient names.
- **Patient status page** (`/q/{access_token}`): their number, the current serving number, how many ahead, estimated wait. Auto-refresh.

`DECISION:` Use polling every 5–10 seconds for live updates, not WebSockets. Simpler, survives flaky mobile connections, and adequate at clinic scale.

### 7.4 Consultation
Doctor opens the patient from the queue and sees, on one screen:
- Patient identity and age, priority flags, allergies/notes
- **Full prior visit history** — collapsed list of past consultations with date, doctor, diagnosis, and medicines given (this is the cabinet, replaced)
- Entry form: chief complaint, vitals, findings, diagnosis, treatment plan, follow-up date
- Medicine section: add multiple rows. Each row is a **searchable picker over that clinic's in-stock medicines**, showing name, strength, form, and remaining quantity next to each option. Fields: medicine, dosage, quantity, instructions, and a `dispensed from clinic stock` / `prescribed only` toggle.
  - Typing a name not in the catalog is allowed and saves as free text with `medicine_id = null` and no stock effect.
  - Show remaining stock live as the doctor types a quantity (e.g. `24 left → 4 after`), turning amber below the reorder level.
- Payment section: amount received, method, collected by (defaults to the logged-in user)

Saving marks the queue entry `completed` and, if a follow-up date was set, schedules a follow-up reminder.

### 7.5 Medicine inventory

**Stock in.** Clinic admin or staff opens `/staff/inventory/receive`, picks or creates a medicine, enters quantity received, unit cost, and expiry date. Writes a `receipt` movement and raises `current_stock`.

**Stock out.** Saving a consultation deducts stock automatically — one `dispense` movement per dispensed row, all inside the same database transaction as the consultation itself. If the transaction fails, nothing is deducted and nothing is saved. There is no separate "confirm dispensing" step; recording the medicine on the index-card replacement *is* the dispensing event.

**Insufficient stock.** If requested quantity exceeds `current_stock`, block the save and show what's available.
`DECISION:` Allow an override — a checkbox reading "dispense anyway (stock count is wrong)" that permits the save, drives stock to the true figure, and writes an audit log entry naming the user. Real clinics do dispense from miscounted shelves, and a system that makes the honest path impossible gets bypassed entirely.

**Corrections.** Editing or deleting a dispensed row after saving must write a compensating `return` movement rather than editing the original. Stock history is append-only.

**Physical count.** `/staff/inventory/count` lists all medicines with system quantity and an input for counted quantity. Submitting writes one `adjustment` movement per discrepancy with a required reason, and shows the total variance in pesos.

**Low stock and expiry.** The staff and admin dashboards show a Low Stock panel (`current_stock <= reorder_level`) and an Expiring Soon panel (expiry within 60 days, and separately already expired). Expired medicines are excluded from the consultation picker by default.

`DECISION:` No batch or lot tracking in the MVP — one stock level and one expiry date per medicine. If a new delivery has a later expiry than the remaining stock, the receipt screen asks whether to update the expiry date. Full batch tracking with FIFO is future work; note it in the README.

### 7.6 Notifications
Trigger points:
| Event | Message |
|---|---|
| Booking confirmed | Queue number + status link + clinic address |
| ~3 patients ahead | "Almost your turn, please proceed to the clinic" |
| Number called | "Now serving your number — please proceed to Room X" |
| No-show | "We missed you — reply or call to rebook" |
| Follow-up due | "Reminder: follow-up checkup with Dr. X on {date}" |

Implement a `NotificationChannel` interface with `MockChannel` (default), `SmsChannel`, and `MessengerChannel`. All templates live in one config file so clinic staff can edit wording without touching code. Every send writes a `notifications` row regardless of channel or outcome.

`DECISION:` SMS is the primary channel — it reaches every Filipino patient regardless of whether they messaged on Facebook. Messenger is secondary and only possible for patients who initiated contact on Facebook. Note in the README that Meta restricts business-initiated messages outside a limited window after the user's last message, so **Messenger cannot be relied on as the sole queue-update channel** — verify Meta's current messaging window and message-tag policy before wiring the real integration.

`DECISION:` For real SMS later, target a Philippine provider (Semaphore, Movider, or iTexMo) rather than Twilio — better local deliverability and pricing. Keep the interface provider-agnostic.

### 7.7 Cash reconciliation
At end of shift, `/staff/remittance` shows each collector their total recorded payments for the day, they enter cash actually handed over, and the system records the variance for the clinic admin to confirm. Without this, digitizing payments just moves an unverified number into a database.

---

## 8. Reporting

**Clinic level** (clinic admin): daily/weekly/monthly patient count, new vs returning, revenue total and by doctor, average wait time, average consultation duration, no-show rate, top diagnoses, top medicines dispensed, expenses, net.

**Inventory** (staff and clinic admin): current stock valuation at unit cost, consumption per medicine over a date range, low-stock list, expiring and expired list, and a per-medicine movement ledger showing every receipt, dispense, and adjustment with the user who made it. Medicine consumption and stock purchases should be reconcilable — a clinic admin must be able to ask "we bought 500 tablets, dispensed 380, so where are the other 120?" and get an answer from the ledger.

**Holding level** (owner): all clinics side by side with the same metrics, consolidated P&L (revenue − expenses per clinic and combined), and clinic ranking by revenue and volume.

Every report has a date range filter and CSV export. Show a simple bar or line chart for revenue over time; do not build a charting framework.

---

## 9. Screens to build

**Public:** `/book/{clinic_slug}` · booking confirmation · `/q/{access_token}` · `/display/{clinic_slug}`

**Staff:** login · queue board · walk-in registration · patient search · patient profile with history · remittance · inventory list with search and low-stock/expiry filters · receive stock · physical count · medicine movement ledger · follow-up list (patients with a follow-up date due or overdue, with one-tap send reminder)

**Doctor:** login · my queue · consultation screen · my patients today · my collections today

**Clinic Admin:** dashboard (including low-stock and expiring panels) · manage doctors and staff · manage medicine catalog (add, edit, set reorder level and prices, deactivate) · clinic settings (hours, services, prices) · reports · expenses

**Holding Admin:** consolidated dashboard · manage clinics · manage all users · consolidated reports · audit log viewer

Mobile-first throughout. Staff will use phones and cheap tablets on 4G. Target usable interaction on a 360px-wide screen; the consultation screen and queue board must work one-handed.

---

## 10. Security, privacy, and compliance

Medical records are **sensitive personal information** under the Philippine Data Privacy Act of 2012 (RA 10173). Build accordingly even in the prototype:

- Hash passwords with bcrypt or argon2. No plaintext credentials anywhere, including seeds — print generated demo passwords to console instead.
- Enforce role checks server-side on every route. Clinic scoping is applied in the data layer, not the controller.
- Write to `audit_logs` on every access to patient clinical data and every financial record change — who, what, when.
- Patient access tokens must be cryptographically random, single-purpose, and expire at end of day.
- Never expose patient names on the public waiting-room display.
- Store the minimum necessary. Do not add fields "just in case."
- Add a consent checkbox to the booking form covering collection and use of health information, and record consent timestamp on the patient row.
- Put a `SECURITY.md` in the repo listing what is prototype-grade and what must be hardened before real patient data is entered (TLS, backups, encryption at rest, breach procedure, retention policy).

---

## 11. Technical stack

`DECISION:` Default stack — override if you have a preference:

- **Framework:** Next.js (App Router) with TypeScript, or Laravel if the maintaining team is PHP-native
- **Database:** PostgreSQL, accessed through an ORM with real migrations
- **Auth:** email + password sessions, server-side. No third-party auth provider.
- **UI:** Tailwind CSS with a small component set. Clean and legible over decorative — large tap targets, high contrast, readable at arm's length on the display screen.
- **Deployment:** single container, `docker compose up` brings up app + database
- **Testing:** integration tests for the flows in Section 12's acceptance criteria; skip exhaustive unit tests

**Repo must include:** `README.md` (setup in under 5 commands), `.env.example` with every variable documented, seed script, and a `DEMO.md` walkthrough script.

**Seed data:** 1 holding company, 3 clinics, 1 holding admin, per clinic — 1 clinic admin, 2 staff, 3 doctors, 60 patients with realistic Filipino names and a spread of ages 0–99, a catalog of ~30 common Philippine clinic medicines (paracetamol, amoxicillin, mefenamic acid, cetirizine, salbutamol, ORS, etc.) with realistic stock levels — including two below reorder level and one expiring within 30 days — and 6 months of backdated consultations, dispensing movements, payments, and expenses so reports and the stock ledger have something to show on first run.

---

## 12. Build order and acceptance criteria

Stop after each milestone and demonstrate it.

**M1 — Foundation**
Schema, migrations, seeds, auth, role-based routing, clinic scoping helper.
✅ Accept when: a staff user of Clinic A receives a 403 attempting to open a Clinic B patient by direct URL, and the attempt appears in the audit log.

**M2 — Patients**
Registration, duplicate-aware search, patient profile with history.
✅ Accept when: front desk registers a walk-in in under 60 seconds, and searching an existing patient by phone surfaces their prior visits.

**M3 — Queue**
Unified queue, priority handling, staff board, doctor queue, public display, patient status page.
✅ Accept when: booking and walk-in entries interleave correctly by priority and time, Call Next advances state, and the patient status page and display screen both reflect it within 10 seconds.

**M4 — Consultation, medicine, payment**
Consultation screen with full history, medicine picker over live stock, payment capture with collector.
✅ Accept when: a completed consultation appears in the patient's history immediately and in today's revenue figure attributed to the correct collector.

**M4b — Inventory**
Medicine catalog, receive stock, movement ledger, automatic deduction on dispensing, insufficient-stock block with override, physical count, low-stock and expiry panels.
✅ Accept when: dispensing 5 tablets from a stock of 24 leaves 19 with a matching `dispense` movement; deleting that dispensed row returns stock to 24 via a `return` movement rather than an edit; a failed consultation save leaves stock untouched; and `current_stock` equals the sum of the movement ledger for every medicine after a mixed sequence of operations.

**M5 — Notifications**
Channel interface, mock channel, all five templates, notification log viewer.
✅ Accept when: booking, almost-your-turn, and now-serving events each write a notification row with fully rendered message text.

**M6 — Reporting and reconciliation**
Clinic reports, holding consolidated reports, remittance, expenses, CSV export.
✅ Accept when: holding admin sees three clinics with a combined P&L whose per-clinic revenue totals reconcile exactly to the sum of payment rows, and a remittance variance displays correctly.

**M7 — Polish**
Public booking page styling, mobile pass on every screen, empty and error states, `DEMO.md`, `SECURITY.md`.

---

## 13. Before you start

Confirm or correct the following, then restate your plan:

1. The stack in Section 11
2. Number-based queue vs. true appointment time slots (7.1)
3. Whether medicine is charged to the patient separately from the consultation fee, or bundled into one amount (this changes whether `selling_price` drives the payment total or is reference-only)
4. Whether doctors keep cash or remit to front desk at point of payment
5. The real Facebook page URL and clinic name/branding to use on the public booking page
