# Design — Events

Status: **draft**, started 2026-09-26; captures event content, recurrence, and RSVPs so far. Nothing implemented. Author: collaborative interview between James and Claude.

## Purpose

Programs meet. This document describes how the app models a program's events — what an event is, how recurring sessions are represented, and how schedules change. Getting events onto participants' calendars is a separate concern, covered in [design-calendaring.md](design-calendaring.md).

## Event content

Every event includes a link to the app and/or contact info for the program's organizers. Calendar invites come from an unmonitored address, so the event itself tells participants where to go with questions.

## Recurrence

Programs run **time-bounded series** — e.g. weekly for 3 months — with occasional irregularities: a session moved, a session skipped, an extra session added.

### Series

A series belongs to a program and carries:

- start date and time of the first session, and duration
- **time zone** as an IANA zone name (e.g. `America/Los_Angeles`). A named zone keeps "Tuesdays 6pm Pacific" at 6pm Pacific across daylight-saving changes; participants worldwide see it converted to their own local time.
- a recurrence rule in iCalendar RRULE form with a required end (`UNTIL` or `COUNT`), e.g. `FREQ=WEEKLY;BYDAY=TU;UNTIL=20261222T235959Z`

### Occurrences

Every session of a series is a row, materialized when the series is created (a bounded series is small — ~13 rows for weekly over 3 months). Each occurrence stores:

- its **original start** — the time the rule generated, which identifies the occurrence even after it moves
- a status: scheduled or cancelled
- optional per-session overrides: start/end, location or link, notes

Occurrence rows are where per-session data lives, and they are what the app renders.

### Irregularities

- **Moved session:** set that occurrence's start/end override.
- **Skipped session:** set that occurrence's status to cancelled.
- **Extra session:** a standalone event in the same program.
- **Extending or shortening the series:** change the rule's end, then add or cancel the affected occurrence rows.

## RSVPs

An RSVP records one participant's response to one session — an occurrence of a series, or a standalone event. Responses come from two places, each stored in its own field with its own timestamp:

- **Calendar response** — from the participant's calendar invite, written only by the [calendaring layer](design-calendaring.md#collecting-rsvps).
- **App response** — from the participant RSVPing in the app, written only by the app.

Each is yes, no, or maybe. The app displays the app response when present, else the calendar response. An app response stays in the app: the participant's own calendar keeps showing whatever they answered there.

Many participants never respond, so a missing RSVP means "no response."

## Open questions

- The shape of a standalone event — its own table, or a series with a single occurrence.
- Which fields an event carries (title, description, location vs video link, capacity).
- Who creates and edits events: admins only, or program leads.
- Editing the series rule itself (e.g. moving every session from Tuesday to Wednesday) — what happens to existing overrides.
