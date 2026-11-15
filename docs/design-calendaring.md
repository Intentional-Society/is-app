# Design — Calendaring

Status: **draft**, captured 2026-09-26 from a design conversation; nothing implemented. Depends on the [Events design](design-events.md) (also draft). Author: collaborative interview between James and Claude.

## Purpose

Participants in a program should find that program's events on their own calendar without doing anything. Joining a program puts its upcoming events on your calendar; adding an event to a program puts it on every current participant's calendar; changes and cancellations follow automatically.

Calendaring owns _delivery_: getting each event onto the right people's calendars as a real calendar invite, and keeping those invites in step with the app. It reads events and program participation, and never writes to either. What an event _is_ — title, description, time, location/link, which program it belongs to, and how it is created and edited in the app — belongs to the [Events design](design-events.md).

## Basic design

The app is the source of truth for which events exist, their details, and who participates in each program (`profile_programs`, `leftAt IS NULL` = current). Google Calendar handles delivery: invite emails, updates, cancellations, and each attendee's RSVP.

A sync keeps Google matching the app. Every upcoming program event exists on the IS organizer calendar with the program's current participants as its attendees and details that match the app. The sync writes events and attendee lists to Google and reads RSVPs back. This follows the same pattern as the [Buttondown sync](design-buttondown.md).

## Delivery mechanism: a Google Calendar organizer account

IS runs a Google Calendar account whose only job is to organize IS events. The app creates events on that account's calendar via the Calendar API and adds participants as attendees; Google sends the invites.

Rationale:

- Invites arrive as native calendar invitations in every major client (Gmail/Google Calendar, Outlook, Apple), with Yes / Maybe / No, updates in place, and cancellations — the same experience as an invite from a colleague.
- Google handles the calendaring standards (iCalendar, iMIP, time zones, recurrence, update sequencing) and invite deliverability. The app implements none of it.
- RSVPs from every recipient flow back into Google, where the app can read them per attendee.

## Alternatives

### iCalendar invites sent through Resend

- The app emails `METHOD:REQUEST` iCalendar invites itself, and every major client renders them as native invites.
- The app owns the iCalendar lifecycle: stable UIDs, a SEQUENCE bump on every update, `METHOD:CANCEL` for removals, and recurrence exceptions.
- RSVPs return as `METHOD:REPLY` emails to the organizer address, so the app needs inbound mail handling and a parser.
- A new sending address has the same [known-sender](#sender-and-known-senders) cold start as a new Workspace account.

### Per-participant subscription feeds

- Each participant gets a private, tokened ICS URL covering their programs' events, and subscribes to it once.
- No organizer account and no invite emails; leaving a program drops its events from the feed.
- Google Calendar refreshes subscribed feeds on its own unpublished schedule, often hours later, which is too slow for last-minute changes.
- Subscribed events take no RSVP, and a leaked URL exposes the feed until its token rotates.

### Add-to-calendar links

- Each event page offers an "Add to Google Calendar" template link and an `.ics` download.
- No infrastructure, so it ships with the first event UI whatever the delivery mechanism.
- Changes and cancellations never reach the copy on the participant's calendar.

### Nylas Agent Accounts

- A Nylas-hosted mailbox and calendar on a domain IS controls, such as `calendar@events.intentionalsociety.org`, driven through the Nylas API, which sends standard iCalendar invites ([docs](https://developer.nylas.com/docs/v3/agent-accounts/)).
- Replaces Workspace as the organizer: no Google account, delegation, or GCP project.
- The free plan includes 3 agent accounts on a Nylas trial domain; a custom sending domain needs Essentials, $15/month ([pricing](https://www.nylas.com/pricing/), November 2026).
- Not stated in Nylas's docs: whether outside attendees' RSVPs flow back to the event, recurring-event support, and whether the product is generally available.

### Cronofy Smart Invites

- Cronofy generates the iCalendar invite, the app sends it (through Resend), and Cronofy reports each recipient's response to a webhook. No calendar account is involved ([docs](https://docs.cronofy.com/api-reference/calendar-control/smart-invites/index.md)).
- This is the Resend alternative with Cronofy handling UIDs, sequencing, and reply parsing.
- Removing a recipient or cancelling returns updated ICS attachments, which the app sends itself.
- Cronofy's API plans start at $819/month ([pricing](https://www.cronofy.com/pricing), November 2026); whether Smart Invites come on a cheaper plan is not published.

### Writing to each member's own calendar

- Nylas, Cronofy, Merge and similar unified APIs connect each member's Google or Microsoft calendar with that member's consent, and write events into it directly.
- Events appear without invites or known-sender filtering, and members' free/busy becomes readable.
- Every member must connect a calendar, the vendor stores calendar data, and pricing is per connected account (Nylas: $1.35–2.25 per account per month).
- Building it without a vendor means passing Google's verification for the sensitive Calendar scope and a separate Microsoft integration.

## Workspace or a free account

The organizer can be IS's existing free Google account, which sends today's manual invites, or a new Google Workspace account. Both deliver identical invites through the same API calls. They differ in how the app authenticates, who the invites appear to come from, who owns the account, and cost. This doc proposes Workspace ([setup](#google-account-setup)).

|                   | Free account                                                                   | Workspace, Business Starter                                                                             |
| ----------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| App credential    | OAuth refresh token for the account, stored as a Vercel secret                 | Service account with domain-wide delegation; keyless from Vercel, or a JSON key                         |
| Google app review | None: a personal-use app under 100 users is exempt; one "unverified app" click | None: service-account access needs no consent screen                                                    |
| Sender            | The existing address, which members already have history with                  | `calendar@events.intentionalsociety.org`, new to every recipient                                        |
| Owner             | Whoever holds the password and recovery factors                                | IS, through the super admin, with recovery through the domain                                           |
| Cost (US list)    | $0                                                                             | $7/month on an annual plan, $8.40 flexible; $0 through Google for Nonprofits if IS qualifies            |
| Setup             | GCP project, consent screen, one consent                                       | Workspace signup, subdomain DNS, GCP project, service account, delegation, Workload Identity Federation |

### Credential durability

**Free.** The OAuth consent screen must be published as "In production": an External app left in "Testing" issues refresh tokens that expire after 7 days. A production app requesting the sensitive Calendar scope would normally need Google's verification, but [personal-use apps with fewer than 100 users are exempt](https://support.google.com/cloud/answer/13464323); the account owner clicks through the "unverified app" warning once. After that, the [documented ways the refresh token stops working](https://developers.google.com/identity/protocols/oauth2#expiration) are: the owner revokes access, the token goes unused for six months, the account exceeds 100 live refresh tokens for the client, or the owner granted time-limited access at consent. A password change revokes only tokens carrying Gmail scopes, so it leaves a Calendar-only token alone. The reconcile cron keeps the token in use. When the token does fail, sync stops until someone re-consents, so the cron must report auth errors, not swallow them.

**Workspace.** Domain-wide delegation mints a short-lived token per request from the service account; there is no user token to expire or revoke. The keyless path leaves no long-lived Google secret in Vercel at all. The JSON-key fallback is blocked by default in a new GCP organization: the [secure-by-default policies](https://cloud.google.com/resource-manager/docs/secure-by-default-organizations) on organizations created since May 2024 forbid service account key creation until an admin lifts `iam.managed.disableServiceAccountKeyCreation`.

Both credentials reach the organizer's whole calendar. On a free account that is also someone's personal calendar, the app's token reaches that person's own events too.

### Sender and known senders

Google Calendar [auto-adds an invitation only from a known sender](https://support.google.com/calendar/answer/13159188) when the recipient's setting is "Only if the sender is known": someone in their contacts, in their organization, or someone they have interacted with. Other invitations arrive as email only, until the recipient responds. Google moved most personal accounts to a restrictive default in 2023 ([report](https://www.theregister.com/2023/05/11/google_calendar_default_settings/)); the help page does not state the current default. Workspace recipients get whatever their admin set.

The free account starts with history: members who receive today's manual invites have interacted with it. A new Workspace address starts with none, so the first invites reach many Gmail users as email only, which breaks "without doing anything" for them. Mitigations: a welcome-flow step asking members to add the organizer address to their contacts, and an announcement before the switch telling members to accept the first invite. Switching organizers later is not cheap either way: Google events keep their organizer, so a switch cancels and re-issues every upcoming invite.

### Account ownership

A free account belongs to whoever controls its password, recovery phone, and recovery email. If that person leaves IS or loses access, recovery goes through Google's consumer account recovery, with no admin to appeal to. Workspace ties the account to the domain: a super admin resets the organizer's password, and control of DNS proves ownership if the admin is lost. The super admin is the organizer user itself unless IS pays for a second seat, so the organizer's credentials and 2FA still need a documented owner.

### Limits

Google publishes Calendar limits for Workspace ([use limits](https://knowledge.workspace.google.com/admin/calendar/avoid-calendar-use-limits)): about 10,000 invites to external guests in a short period, and 2,000 guest emails a day. IS sends a few hundred. Trial accounts, accounts within 60 days of their first payment, and Google for Nonprofits accounts get stricter, unpublished limits, so the first full sync should not run on a trial account. The same page does not cover free accounts.

### Decision inputs

- Is the existing free account dedicated to IS, and who controls its recovery factors? A shared or personal account rules it out.
- Is IS eligible for [Google for Nonprofits](https://support.google.com/nonprofits/answer/3215869) (registered charity, verified by Goodstack)? Eligibility makes Workspace free, at the cost of the stricter calendar limits.
- How many members rely on auto-added invites today? A large count raises the cost of a new sender address.

## Google account setup

IS email runs on Zoho (`intentionalsociety.org` MX → `mx.zoho.com`), so the organizer account lives on a **subdomain** with its own MX records pointing at Google:

- **Workspace:** Google Workspace Business Starter, one seat. Primary domain: `events.intentionalsociety.org`.
- **Organizer user:** `calendar@events.intentionalsociety.org`, display name "Intentional Society". This is also the Workspace super admin, so its credentials and 2FA need a documented owner.
- **Organizer inbox:** unmonitored, with no auto-reply. RSVPs need no human: Google Calendar processes them automatically, including the reply emails from Outlook and Apple clients, as long as the subdomain's mail lands at Google. Free-text replies to invites go unread; each event's description points people to the app or a contact instead ([Events](design-events.md#event-content)).
- **DNS:** MX, SPF and DKIM records for the subdomain only. The apex domain's Zoho setup is untouched.
- **API access:** a GCP service account with **domain-wide delegation** for the `https://www.googleapis.com/auth/calendar` scope, impersonating `calendar@`. Delegation is required: a service account on its own gets `403 Service accounts cannot invite attendees without Domain-Wide Delegation of Authority`.
- **Credentials from Vercel:** keyless, via Vercel OIDC → GCP Workload Identity Federation. The federated identity calls IAM `signJwt` on the service account to mint the delegated (`sub = calendar@…`) token ([pattern](https://blog.salrashid.dev/articles/2021/impersonation_and_domain_delegation/)). A JSON key in an env var is the simpler fallback, once an admin lifts the organization's default ban on key creation ([credential durability](#credential-durability)).

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
- How an invite from the new organizer lands at a Gmail account that has never contacted it: on the calendar, or email only.
