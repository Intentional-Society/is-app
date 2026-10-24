# Design — Calendaring

Status: **draft**, captured 2026-09-26 from a design conversation; nothing implemented. Depends on the [Events design](design-events.md) (also draft). Author: collaborative interview between James and Claude.

## Purpose

Participants in a program should find that program's events on their own calendar without doing anything. Joining a program puts its upcoming events on your calendar; adding an event to a program puts it on every current participant's calendar; changes and cancellations follow automatically.

Calendaring owns *delivery*: getting each event onto the right people's calendars as a real calendar invite, and keeping those invites in step with the app. It reads events and program participation, and never writes to either. What an event *is* — title, description, time, location/link, which program it belongs to, and how it is created and edited in the app — belongs to the [Events design](design-events.md).

## Basic design

The app is the source of truth for which events exist, their details, and who participates in each program (`profile_programs`, `leftAt IS NULL` = current). Google Calendar handles delivery: invite emails, updates, cancellations, and each attendee's RSVP.

A sync keeps Google matching the app. Every upcoming program event exists on the IS organizer calendar with the program's current participants as its attendees and details that match the app. The sync writes events and attendee lists to Google and reads RSVPs back. This follows the same pattern as the [Buttondown sync](design-buttondown.md).

## Delivery mechanism: a Google Calendar organizer account

IS runs a Google Calendar account whose only job is to organize IS events. The app creates events on that account's calendar via the Calendar API and adds participants as attendees; Google sends the invites.

Rationale:

- Invites arrive as native calendar invitations in every major client (Gmail/Google Calendar, Outlook, Apple), with Yes / Maybe / No, updates in place, and cancellations — the same experience as an invite from a colleague.
- Google handles the calendaring standards (iCalendar, iMIP, time zones, recurrence, update sequencing) and invite deliverability. The app implements none of it.
- RSVPs from every recipient flow back into Google, where the app can read them per attendee.

Alternatives considered:

- iCalendar invites sent through Resend
- per-participant subscription feeds
- a free Google account

## Google account setup

IS email runs on Zoho (`intentionalsociety.org` MX → `mx.zoho.com`), so the organizer account lives on a **subdomain** with its own MX records pointing at Google:

- **Workspace:** Google Workspace Business Starter, one seat. Primary domain: `events.intentionalsociety.org`.
- **Organizer user:** `calendar@events.intentionalsociety.org`, display name "Intentional Society". This is also the Workspace super admin, so its credentials and 2FA need a documented owner.
- **Organizer inbox:** unmonitored, with no auto-reply. RSVPs need no human: Google Calendar processes them automatically, including the reply emails from Outlook and Apple clients, as long as the subdomain's mail lands at Google. Free-text replies to invites go unread; each event's description points people to the app or a contact instead ([Events](design-events.md#event-content)).
- **DNS:** MX, SPF and DKIM records for the subdomain only. The apex domain's Zoho setup is untouched.
- **API access:** a GCP service account with **domain-wide delegation** for the `https://www.googleapis.com/auth/calendar` scope, impersonating `calendar@`. Delegation is required: a service account on its own gets `403 Service accounts cannot invite attendees without Domain-Wide Delegation of Authority`.
- **Credentials from Vercel:** keyless, via Vercel OIDC → GCP Workload Identity Federation. The federated identity calls IAM `signJwt` on the service account to mint the delegated (`sub = calendar@…`) token ([pattern](https://blog.salrashid.dev/articles/2021/impersonation_and_domain_delegation/)). A JSON key in an env var is the simpler fallback.

Keeping Workspace off the apex domain also avoids Google "conflicting accounts" for any existing consumer Google accounts registered with `@intentionalsociety.org` addresses (inferred, not verified).

## Sync model (proposed)

### Mapping

Each standalone event or series in the app maps to one Google event (a series to a recurring one — see [Recurring events](#recurring-events)). The Google event `id` is derived deterministically from the app row's id (Calendar API event ids accept lowercase base32hex, so a UUID's hex digits qualify). Deterministic ids make creation idempotent: a retried insert conflicts instead of duplicating.

### Triggers

- **On change:** creating/editing/cancelling an event, a participant joining/leaving a program, or a participant's invite address changing enqueues a sync of the affected events.
- **Reconcile cron:** periodically compares every upcoming event against Google and repairs drift (failed writes, manual edits on the Google side).

### Writes

- Attendee list = current participants in the event's program, each by their invite address (see [Calendar email](#calendar-email)), minus participants who opted out where the program allows it.
- Description = the event's description, including its app link and/or contact info.
- `sendUpdates=all` on writes that should notify people; removing an attendee sends them a cancellation.
- `guestsCanSeeOtherGuests=false` so participants' emails stay private from each other.
- Only **upcoming** events are touched. Leaving a program removes you from future events; past events keep their attendee history.

## Calendar email

Invites land automatically only on the calendar belonging to the invited address, and a participant's sign-in email is often not the address their calendar lives at. The profile carries an optional **calendar email**:

- **Invite address** = the verified calendar email if set, else `auth.users.email`.
- **Verification:** setting or changing the calendar email sends a confirmation link (via Resend) to the new address. Invites switch over only once it is confirmed, so a typo never sends IS invites to a stranger.
- **Changes** — to either address — are ordinary attendee diffs: the old address gets cancellations for upcoming events, and the new address gets invites to all of them.
- The calendar email is private, like the sign-in email.

Joining a program is consent to its invites. Opting out happens per program, where the program allows it.

## Collecting RSVPs

Calendaring reads each attendee's Google `responseStatus` and writes it into the calendar response of the app's [RSVPs](design-events.md#rsvps). It never touches the app response, and it never writes responses to Google.

- **Where:** the reconcile cron, which already lists each Google event's instances, reads attendee responses from every upcoming instance. Reading per instance covers both a series-wide response ("yes to all") and a per-session one.
- **Mapping:** `accepted` → yes, `declined` → no, `tentative` → maybe. `needsAction` (no response) writes nothing.
- **Matching:** an attendee's email maps to a participant through their current invite address.
- **Writes:** upsert the RSVP when the response differs from the stored one. Once a session has ended, its RSVPs are final and no longer read.

To verify: a series-wide response appears as the attendee's `responseStatus` on each instance returned by `events.instances`.

## Recurring events

The app's series/occurrence model is in [design-events.md](design-events.md#recurrence). Each series syncs as one **Google-native recurring event**: participants get one invite and one RSVP for the whole series, the experience they expect for a weekly call. Syncing each occurrence as its own event would send an invite email per session.

- **Series → recurring event.** The Google event carries the series' RRULE, start, duration, and IANA time zone.
- **Occurrence → instance.** Google identifies an instance by the series event id plus the instance's original start, so each app occurrence maps to its Google instance by computation, with no stored mapping.
- **Overrides** (moved time, changed link) patch that one Google instance.
- **Cancelled occurrence** sets that Google instance's status to `cancelled`.
- **Extra session** is a standalone event and syncs as one.
- **Rule change** (extending or shortening the series) patches the recurring event's RRULE.
- **Reconcile** lists the recurring event's instances (`events.instances`) and compares them with the app's occurrence rows, which catches any disagreement between the two expansions.
- **Mid-series joiners** are added to the series attendee list, which also places past instances on their calendar (cosmetic). **Mid-series leavers** are removed from the series; Google drops them from past instances too, while the app keeps its own history.

To verify: how series-level attendee changes propagate to instances that carry overrides.

## To verify before signing up

- Domain-wide delegation works on Business Starter (no edition restriction found; confirm during the free trial).
- The Workload Identity Federation + `signJwt` delegation path works from a Vercel function.
