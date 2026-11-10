import type { Metadata } from "next";

import { LegalPage } from "@/components/legal-page";
import { titleFor } from "@/lib/page-titles";

// Public page — opt back in to indexing (root layout is noindex by default).
export const metadata: Metadata = { title: titleFor("/privacy"), robots: { index: true, follow: true } };

// Privacy policy (issue #196). DRAFT — not reviewed by the org or by counsel.
// Bump UPDATED_AT whenever the text changes. Human-facing sections come
// first; "The legal details" at the end carries the GDPR disclosures.
//
// Open questions before this ships:
// - Contact address: devteam@ is a stand-in; a privacy@ or hello@ alias
//   would be better. The legal details also need a postal address.
// - Deletion ("When you leave") states the intended policy, which the code
//   doesn't yet match. deleteMemberAccount cascades away relationships other
//   members recorded with the deleted member and their message-box posts,
//   and unlinks the invite they redeemed; the policy keeps such shared
//   records under the member's display name, with everything else about
//   them deleted, and removes the name on a weighed request. Counsel
//   should confirm that default survives a GDPR Art. 21 objection. Only an
//   admin can delete, and members can't delete their own posts. Confirm
//   the 30-day turnaround is one we can keep.
// - Message-box posts after deletion: kept unattributed (the policy's
//   choice) or deleted with the account?
// - Backups: the page states no backup window. Deleted data persists in
//   Supabase backups for the plan's retention period; know that figure
//   before answering a member who asks.
// - International transfers: confirm each provider's data processing
//   agreement covers transfers (SCCs or the EU-US Data Privacy Framework).
// - EU representative (GDPR Art. 27): ask counsel whether the "occasional
//   processing" exemption applies or we need one.
// - Session replay: Sentry replay is off unless debugReplay is set
//   (instrumentation-client.ts). If it can run in production, name it under
//   "How the app is used".
//
// Washington's "protecting children online" bills (SB 5708, HB 1834,
// SB 6111) had not passed as of 2026-10-26; revisit the age section if
// one becomes law.
const UPDATED_AT = new Date("2026-11-09T00:00:00Z");

const BODY = `
## The short version

- We collect what the app needs to help members find and know each other, and nothing for advertising.
- What you share is visible to other signed-in members, except for details meant only for you and the app's admins.
- We never sell your information or share it with advertisers.
- You can change or remove most of what you've shared yourself, any time, in the app. For anything you can't, write to us.
- If you leave, we delete what's yours. What's part of other members' history stays with them, under the name you used in the app.
- If your information is ever caught up in a security breach, we'll tell you.

The rest of this page is the longer version.

## Who we are

The IS Web App is the members' app of Intentional Society, a small, globally distributed network of people who care about living intentionally, together. It is operated by Intentional Society, LLC, a limited liability company registered in Washington State, USA, and built and run by a volunteer team. When this page says "we," it means Intentional Society, LLC and the people who run the app on its behalf.

This policy covers the app at app.intentionalsociety.org. The public website at intentionalsociety.org has its own practices.

## What we collect, and why

**Your account details,** so you can sign in and we can reach you.

**What you choose to share,** such as your profile, your connections with other members, and the programs you join. Helping members find and know each other is what the app is for. Share what you're comfortable sharing.

**What other members share about you.** A community app holds some information about you that came from someone else, such as how another member knows you. When you add information about someone else, add only what they'd agree to.

**How the app is used,** such as when you sign in and reports of errors, so we can keep the app working.

## Who can see what

The app is a private space for members. What you share there, from your profile to your connections, is visible only to other signed-in members, so they can get to know you. Nothing you add is public on the open web.

Some information is further restricted, so that only you and the app's admins can see it.

The admins are a small group who can see everything stored in the app, and they use that access only to run it and help members.

## Services we rely on

We use trusted service providers to run the app, for things such as data storage, hosting, email, newsletters, error tracking, and logging. Each one handles your information only to provide its service to us.

We will never sell your personal information or share it with advertisers. We share information with anyone else only if the law requires it, and we'd tell you if we could.

## Keeping it safe

Your information is encrypted on its way to and from the app, and access to it is limited to the admins and the services above. No system is perfectly secure. If a breach ever exposes your information, we'll tell you promptly, say what happened and what we're doing about it, and notify the authorities where the law requires.

## Cookies and browser storage

The app uses cookies to keep you signed in, and stores some preferences in your browser. We use no advertising or cross-site tracking cookies.

## When you leave

We keep your information while you're a member. When you want to step away, you have two options.

**Deactivate your account,** any time. Other members can no longer see you, and your information stays, so you can come back.

**Ask us to delete your account,** and we'll do it within 30 days. Because the app is shared, deletion comes in two parts.

**What's yours, we delete:** your account, your profile, your picture, and everything you added that concerns only you.

**What's part of other members' history stays, under your name.** Some information isn't only yours. A member's record of knowing you, or something you posted where others read it, is part of their own story in the community. Deleting it would quietly rewrite their memory of time spent with you. So we keep these records, labelled with the name you used in the app, and nothing else about you. To be remembered by a different name, change it before you leave.

**If keeping your name would harm you,** for example by putting your safety at risk, write to us. We'll weigh your reasons and can remove your name, or a specific record such as a post you regret.

## Your choices and rights

You can see and change most of your information yourself in the app. You can also ask us to:

- send you a copy of everything we hold about you, in a format you can take elsewhere
- correct something you can't edit yourself
- delete your account, as described above
- stop using your information for a particular purpose

Where you've opted in to something, such as a newsletter, you can opt out at any time. Write to us and we'll respond within 30 days. We may ask you to confirm the request comes from you.

## Minimum age

Due to consideration of legal frameworks such as COPPA (US) and GDPR Article 8 (EU), you must be 16 or older to use the app. If we learn a member is under 16, we'll delete their account.

## Changes to this policy

As the app grows, this policy will change. When it changes in a way that matters, we'll tell members in the app or by email before the change takes effect. The date at the top of this page shows the last update.

## Questions

Write to the dev team at [devteam@mail.intentionalsociety.org](mailto:devteam@mail.intentionalsociety.org). A person will read it.

## The legal details

This section covers what data protection laws, such as the EU and UK GDPR, ask every privacy policy to state.

### Who is responsible for your information

Intentional Society, LLC, Washington State, USA, is responsible for your information (the "controller," in GDPR terms). Contact us at the address under "Questions."

### Why we're allowed to use it

- **To run the app you joined:** your account, your profile, and showing what you share to other members.
- **For the community's legitimate interests:** keeping the app secure and working, and keeping the records described under "When you leave" that are part of other members' history.
- **With your consent:** newsletters, and anything else you opt in to. You can withdraw consent at any time.

### Where your information is stored

Your information is stored in the United States. If you live elsewhere, it travels there when you use the app. Our service providers protect it under data protection agreements that include the safeguards the law requires for such transfers, such as the EU's Standard Contractual Clauses.

### What you have to give us

Only what's needed to create your account. Everything else is optional.

### Automated decisions

The app doesn't make decisions about you by automated means alone.

### Complaints

If you're in the EU or UK and feel we haven't handled your information well, you have the right to complain to your local data protection authority. We'd appreciate the chance to put it right first.
`;

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      updatedAt={UPDATED_AT}
      body={BODY}
      other={{ href: "/terms", label: "terms of use" }}
    />
  );
}
