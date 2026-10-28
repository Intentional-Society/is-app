# IS Wishes — Feature Specification & Design

**Status:** Draft  
**Related GitHub Issue:** [Link]  
**Owner:** Alexis  
**Last Updated:** 2026-10-28

## 1. Overview

### Purpose

Allow IS users to create, revisit, and manage personal wishes, and discover and interact with other people's wishes.

### MVP Scope

- Create, view, edit, delete, archive, and restore wishes
- Mark wishes as fulfilled
- Standalone `/wishes` page for creating and managing wishes
- Discover other people's wishes through random matching
- Emoji reactions and comments
- Integration with existing user profiles (Wishes tab)

### Out of Scope (Future)

- Private wishes
- Wish-to-project conversion
- Collaboration features
- Notifications
- Similarity-based matching for Discover Wishes

## 2. User Flows

### 2.1 Make a Wish / My Wishes

Users can create and manage wishes from the same page.

1. User navigates to `/wishes`.
2. User sees their existing wishes.
3. User selects "Make a Wish."
4. User enters:
   - **Title:** Name or summary of the wish.
   - **Description:** What is the wish about? How could others help?
5. User submits the wish.
6. The wish is saved and appears immediately in their current wishes section.
7. User receives visual confirmation that the wish was successfully created.

### 2.2 Manage Current Wishes

1. User opens `/wishes`.
2. User sees their current wishes.
3. User selects an existing wish.
4. User can:
   - View its title and description
   - Edit the wish
   - Delete the wish
   - Archive the wish
   - Mark the wish as fulfilled
5. Changes are saved and reflected in the interface.

### 2.3 Past / Fulfilled Wishes

A **Past / Fulfilled Wishes** section appears below Current Wishes on the same page.

1. User scrolls down to Past / Fulfilled Wishes.
2. User sees previously archived or fulfilled wishes.
3. User selects a wish.
4. User can:
   - View the wish
   - Edit its title or description
   - Delete it
   - Restore it to Current Wishes
5. Restored wishes appear again in Current Wishes.

Archived and fulfilled wishes retain their content and history unless deleted.

### 2.4 Wishes on Individual Profiles

Each user has a profile page at `/members/[id]`. This page will be refactored to add a `TabBar` (the `Tab`/`TabBar` components already exist — used in `/me`).

1. A visitor opens someone's profile.
2. The profile includes two tabs:
   - **About:** Existing profile information.
   - **Wishes:** The person's active wishes.
3. A visitor can select a wish to view its details, leave emoji reactions, or comment.
4. When viewing their own profile, the user sees a link to `/wishes` to make or manage wishes.

The Wishes tab is read-only for visitors. `/wishes` is the primary place for creating and managing wishes.

### 2.5 Discover Wishes

1. User navigates to `/wishes`.
2. User selects "Discover Wishes."
3. The system presents a small, randomly selected set of member profiles that have at least one active wish (excluding the current user).
4. User selects a profile.
5. User is directed to that person's profile, where they can open the Wishes tab.
6. User can view and interact with that person's wishes.

Similarity-based matching is deferred.

### 2.6 Interact with Others' Wishes

1. User visits another person's Wishes tab.
2. User selects a wish.
3. User can:
   - Read the wish title and description
   - React using available emojis
   - Read existing comments
   - Add a comment
4. Reactions and comments are displayed on the wish.

## 3. [TODO] UI/UX Design

### Screens

- My Wishes (`/wishes`) — create and manage wishes
- Current Wishes section
- Past / Fulfilled Wishes section
- Discover Wishes
- Profile — Wishes tab

### Navigation

- `/wishes` is the central place to make and manage wishes.
- The Wishes tab on user profiles displays wishes for visitors.
- Discover Wishes leads users to a selection of member profiles.

## 4. [TODO] Functional Requirements

Define precise behavior for:

- Creating and editing wishes
- Required and optional wish fields
- Wish lifecycle: `active`, `archived`, `fulfilled`
- Restoring past wishes (sets status back to `active`)
- Deleting wishes (hard delete or soft delete — see §9)
- Emoji reactions and comments
- Public visibility (all wishes are public by default at MVP)
- Random matching for Discover Wishes (pool: members with ≥1 active wish, excluding self)
- Visual theme for the `/wishes` page (see §9)

## 5. [TODO] Data Model

Specify the required entities and fields.

- **Wish:** ID, author ID, title, description, status (`active` | `archived` | `fulfilled`), timestamps
- **Reaction:** ID, wish ID, user ID, emoji
- **Comment:** ID, wish ID, author ID, content, timestamps

Define relationships and constraints.

## 6. [TODO] Technical Design

To be completed after reviewing the existing IS architecture.

- Frontend components and routes
- Backend services (Hono RPC, consistent with the rest of the API at `src/server/api.ts`)
- Database changes and migrations (Drizzle; new tables for wishes, reactions, comments)
- API endpoints
- Authentication and authorization
- Profile page refactor to add `TabBar` (About + Wishes tabs)
- Emoji reactions and comments are net-new infrastructure; scope them as a separate phase

## 7. [TODO] Edge Cases

- User has no wishes
- User has many wishes
- Wish creation fails
- A wish is deleted while someone is viewing it
- A user attempts to edit another person's wish
- Comments or reactions fail to save
- A wish is restored from Past / Fulfilled Wishes
- No eligible profiles found for Discover Wishes (all members have zero active wishes)
- A selected Discover Wishes profile has no active wishes

## 8. [TODO] Acceptance Criteria

- [ ] An authenticated user can create a wish with a title and description.
- [ ] A newly created wish appears in Current Wishes.
- [ ] A user receives confirmation after successfully creating a wish.
- [ ] A user can edit and delete their own wishes.
- [ ] A user can archive or mark a wish fulfilled.
- [ ] Past / Fulfilled Wishes appear below Current Wishes.
- [ ] A user can edit, delete, or restore a past wish.
- [ ] User profiles display active wishes via a Wishes tab.
- [ ] Visitors can view active wishes on a person's profile.
- [ ] Visitors can react to and comment on wishes.
- [ ] Discover Wishes displays a random selection of members with active wishes.
- [ ] The interface works on desktop and mobile.

## 9. [TODO] Open Questions

- Should the `/wishes` page have a visual theme (e.g., wishing well, wishing tree)? If so, does each user choose their own, or is it a single shared aesthetic?
- Should archived wishes be visible to profile visitors, or only active ones?
- Should fulfilled wishes appear in the profile Wishes tab?
- Should restored wishes return to `active` status, or a separate `restored` status?
- What emoji reactions should be available? Fixed set or open input?
- Hard delete or soft delete for wishes?
- How many profiles should Discover Wishes display?
- Should Discover Wishes offer a refresh/shuffle button?

## 10. [TODO] Implementation Plan

Break the feature into independently reviewable tasks:

1. Data model and migrations (wishes table)
2. Wish creation, editing, deletion, and lifecycle management (API + `/wishes` page)
3. Current Wishes UI
4. Past / Fulfilled Wishes section
5. Profile page refactor — add `TabBar` with About + Wishes tabs
6. Discover Wishes
7. Emoji reactions and comments
8. Testing and release
