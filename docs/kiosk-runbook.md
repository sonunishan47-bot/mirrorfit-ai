# Kiosk operator runbook

Day-to-day guide for the in-store mirror. Only describes behaviour that exists
in the product today (pose landmarks + PNG overlay — **not** photorealistic
try-on).

## Privacy reminder

- Camera frames stay on the mirror. Do not ask customers to upload photos.
- Do not discuss or guess ethnicity, health, or other sensitive attributes.
- Pairing QR codes encode only a short-lived session link (`/s?t=…`), never a
  device secret.
- Recommendations on the phone are suggestions, not objective truth.

---

## 1. Initial mirror setup

1. Hardware: display + camera facing the fitting area; network to the shop
   HTTPS origin and Supabase.
2. Browser: open `https://<production-host>/mirror` (not the local-dev CA flow).
3. Prefer a dedicated kiosk profile / fullscreen so staff tools are not mixed in.
4. Confirm `/api/health` is reachable from the store network before go-live.

## 2. Enrollment

1. Staff (admin) signs in → `/displays` → issue an enrollment code for the
   display.
2. On the mirror, enter the code when prompted (unenrolled panel).
3. Success stores the device credential locally and starts heartbeats.
4. One live credential per display: re-enrolling revokes the previous secret.

## 3. Pairing phone

1. Mirror shows a QR when a WAITING session is open.
2. Customer scans with their phone camera.
3. Phone opens `/s?t=…` on the **same HTTPS host** as the mirror.
4. Customer claims the session; mirror moves WAITING → PAIRED → ACTIVE as
   implemented.

## 4. Selecting a garment

1. On the phone catalog, pick a garment/variant that has an overlay asset.
2. Mirror fetches a short-lived overlay URL via the device API and composites
   it with on-device pose.
3. If nothing appears: confirm the garment has a `garment-assets` overlay for
   that shop, network is up, and the session is still ACTIVE.

## 5. Ending a session

1. Use the on-mirror end/reset control when the customer is done.
2. Mirror returns to the attract / QR state for the next customer.
3. Idle ACTIVE and expired pairing windows are also cleaned up by the server
   expiry job — do not rely on that alone for a busy floor.

## 6. Phone disconnects

1. If the phone loses network mid-session, ask the customer to reopen the same
   `/s` link **only if it is still within the pairing/session window**; otherwise
   end on the mirror and start a fresh QR.
2. Mirror poll errors must **not** be treated as “session ended” by operators —
   wait for recovery or end explicitly if the floor needs a reset.
3. Do not share device secrets or ask the customer to open staff URLs.

## 7. Camera permission fails

1. Check browser site settings for `https://<host>` → allow **Camera**.
2. Confirm no other app holds the camera exclusive.
3. Reload `/mirror`. Permissions-Policy allows camera for this origin only.
4. If still failing, try another Chromium-based kiosk browser; document the
   OS permission prompt for the next shift.

## 8. QR does not appear

1. Confirm the device is enrolled (not showing the enrollment panel).
2. Confirm network / heartbeat (display should not be stuck offline).
3. Wait a moment for session create; power-save screensaver can cover the glass
   — wake with presence/pointer if needed.
4. If the session is ended or expired, the attract flow should mint a new
   WAITING QR; if not, reload `/mirror` once.
5. Never paste pairing tokens into chat or email.

## 9. Revoke / re-enroll

1. Staff admin → `/displays` → revoke credential for that mirror.
2. Mirror API calls with the old secret fail (401). Display status is `REVOKED`.
3. Issue a new enrollment code; enter it on `/mirror`.
4. Old secret in local storage is replaced on successful enroll.

## 10. Browser restart

1. Reopen `/mirror` on the same origin.
2. Enrolled devices restore the secret from local storage and resume heartbeats.
3. If storage was cleared (browser reset / new profile), treat as unenrolled and
   use a new code.

## 11. Network failure

1. Mirror cannot enroll, heartbeat, or poll sessions without reachability to the
   app origin (and Supabase as configured).
2. When the network returns, reload `/mirror` if the UI is wedged; enrolled
   devices should resume without a new code.
3. Customer phones need the same public HTTPS host; captive portals will break
   `/s`.

## 12. Display recovery

| Symptom | Action |
| --- | --- |
| Unenrolled panel | Get a fresh code from `/displays` |
| REVOKED / 401 after staff revoke | Re-enroll |
| Stale / offline in ops | Check power, network, browser still on `/mirror` |
| Stuck ACTIVE garment | End session on mirror; start new QR |
| Black / frozen UI | Hard refresh; then browser restart; then re-enroll if storage lost |

Staff can use `/ops` (authenticated) for fleet health including explicit
`REVOKED` displays.

## 13. Basic privacy reminder (floor script)

> The mirror uses the camera only on this device to align a product overlay.
> Nothing is uploaded for try-on. Scan the QR on your own phone to browse;
> you can end anytime.
