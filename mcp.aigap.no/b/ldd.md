# LifeDemandedDeath MCP

## Implementation plan

**Status:** Proposed, pending inventory of the existing book workflow  
**Updated:** 2026-10-20

## 1. Purpose

Build an author-controlled MCP interface for creating, maintaining, and
exploring *LifeDemandedDeath* and, eventually, other books. It should
orchestrate the established book workflow rather than replace it, while
making published content and its relationships available to readers and
compatible AI clients.

The first goal is a trustworthy, versioned book catalog and a safe way to
run the existing production pipeline. A reader companion, commercial
features, and Unreal/VR experiences are later extensions—not prerequisites
for the first useful release.

### Principles

1. **Keep the author in control.** Changes to content, order, associations,
   and publication require an authorized author/editor workflow.
2. **Preserve existing sources of truth.** Do not migrate or duplicate the
   manuscript until the current authoring and export systems are inspected.
3. **Separate source from interpretation.** Label manuscript text, author
   notes, reader reflections, external material, and AI-generated content.
4. **Version every release.** A published edition and its generated files
   must be reproducible and traceable to their inputs.
5. **Keep access and permissions explicit.** Public readers see only
   released content; private authoring and reader data require separate
   permissions.
6. **Respect ambiguity and rights.** Offer grounded possibilities rather
   than a definitive interpretation, and do not expose material without
   permission.
7. **Privacy by default.** Reader notes and preferences remain private
   unless a reader explicitly chooses to save or share them.

## 2. Existing workflow and source of truth

The current workflow is understood to include a Google Sheets book master,
scripts that produce PDF/Markdown and language-specific outputs, Supabase
data such as music and word clouds, and short URLs/QR codes connecting the
book to music. These details are a working description, not a verified
technical inventory.

Before implementation, inspect the actual assets and conventions:

- the Sheet's tabs, ranges, formulas, formatting, IDs, and revision history;
- the conversion scripts, supported commands, inputs, outputs, and language
  handling;
- the Supabase schema, relationships, and distinction between curated and
  generated data;
- the current song, short-URL, QR-code, and lyrics workflow;
- which material is public, excerpt-only, draft, or private.

Until that inspection is complete:

- Keep the Google Sheet as the author-facing master if that is its current
  role.
- Reuse the established conversion scripts; do not recreate them in MCP
  handlers.
- Treat Supabase as the existing structured data store, not as an assumed
  manuscript database.
- Store catalog and workflow metadata separately from manuscript content.
- Do not infer stable chapter IDs from row numbers or file names unless the
  existing system guarantees that they are stable.

## 3. Book, version, build, and release model

- **Book:** A distinct work with a stable `book_id`, title, default language,
  and references to its master and supporting data.
- **Version:** A uniquely identified state of a book. It may be a working
  branch, fixed snapshot, translation, alternate arrangement, or publication
  candidate. Derived versions retain a link to their parent.
- **Build:** An execution of the established export pipeline for a specific
  book/version and source snapshot.
- **Release:** An explicitly approved version/build made available to
  readers. A successful build is not automatically a release.

A build record should capture the book/version IDs, source fingerprint or
revision, pipeline version, requested formats and languages, timestamps,
status, logs, validation results, artifact locations, and checksums where
available. Never replace the last published artifacts before a new build
passes validation and receives approval.

Chapter and song IDs should remain stable when titles or ordering change.
Every lookup and citation should identify its book and version so clients
cannot accidentally mix draft content with published metadata.

## 4. Workflows

### Register or create a book

1. Register the existing book and its master without changing it.
2. For a new book, select an approved template, link an existing master, or
   duplicate a chosen structure using established conventions.
3. Set up metadata, languages, supporting data, and the export pipeline.
4. Validate the setup and create a preview build.
5. Require author review before any release.

When cloning, make copying music, lyrics, reader data, and private material
an explicit choice; do not copy them by default.

### Create a version

Support freezing the current state, branching for continued work, creating
an alternate arrangement or language edition, and preparing a new
publication edition. Each version has a new ID and parent relationship;
creating it must not overwrite a published version.

### Propose and apply changes

Potential typed changes include adding a chapter, changing order or
metadata, associating a song, updating a link, changing translated content,
or regenerating selected outputs. Show a preview/diff and affected outputs
before applying changes when practical. Require explicit confirmation for
destructive or broad changes.

### Build and publish

The build workflow should validate inputs, record the source snapshot, run
only a known supported pipeline operation, capture exit status and logs,
check expected artifacts, run available structural/link checks, and report
warnings. A failed build must not affect the current release.

Publishing is a separate authenticated action. Before it proceeds, show the
selected version/build, artifact list, change summary, validation results,
language and rights status, and require explicit author approval. Record
approval and preserve release history so the release pointer can be rolled
back without deleting history.

## 5. MCP interface

These are logical operations, not final schemas. Define concrete inputs and
outputs after inspecting the current data model and pipeline.

### Read-only catalog and discovery

- List books, versions, and releases visible to the caller.
- Get book metadata and a version manifest.
- Retrieve an authorized chapter or song context.
- Search a selected book/version and return stable IDs and citations.
- Trace themes or curated connections through chapters and songs.
- Compare versions or builds.
- Get build status, artifact details, and validation summaries.

### Authoring and production

Require author/editor permissions for registering or creating books,
creating versions, proposing and previewing changes, applying an approved
change set, validating a version, building outputs, and publishing or
rolling back a release.

Use book- and version-scoped operations. Prefer typed adapters over
arbitrary SQL, shell commands, filesystem access, or URL fetching.

### Resources

Use version-aware resources for the catalog, book metadata, version
manifests, chapters, music, themes, change logs, and release artifacts.
Exact URI syntax should follow the chosen MCP framework.

## 6. Reader experience and extensions

Once published content is reliably structured, reader tools may support:

- reading in author order or opening a chapter directly;
- following a chapter's music and related passages;
- exploring themes, contrasts, and multiple plausible interpretations;
- choosing linear, music-led, thematic, reflective, or exploratory paths;
- asking open-ended reflection questions without assuming the reader wants
  advice or therapy;
- optional private notes, saved paths, and explicitly shared feedback.

Keep author text distinct from AI interpretation, and return citations and
version provenance with retrieved content. Personalization should shape a
reader-selected route, not rewrite the book or infer sensitive traits.
Session-only preferences are the safest initial default.

### Music, QR codes, and lyrics

Preserve the editorial relationship between chapter, song, author note,
short URL, and QR code. Validate public links before release and keep the
short URL stable where possible. Track lyric rights explicitly. Unless
display rights are confirmed, provide permitted metadata and a lawful
source link rather than full lyrics or substantial excerpts.

### Future products

Test reader value before investing in paid companions, memberships,
educator/book-club packages, or licensing. Keep entitlements in the product
layer rather than making the creation MCP itself a paywall. Consider an
Unreal/VR adapter only after stable IDs, versioning, and navigation are
proven; it should be another presentation layer, with accessible
non-VR alternatives.

## 7. Safety, permissions, and data handling

- Every mutation names a specific book and version.
- Published snapshots are immutable; make changes on a new version or
  branch.
- Public clients cannot access drafts, private authoring tools, or private
  reader notes.
- Do not permit arbitrary SQL or shell execution from a model.
- Validate inputs and use parameterized database operations.
- Require explicit approval for destructive operations and publication.
- Maintain a change log and preserve rollback history.
- Keep reader reflections out of manuscript source data.
- Do not use private notes for advertising or model training without
  separate, informed consent.
- Clearly label external/licensed material and AI-generated content.

## 8. Delivery roadmap

### Phase 0 — Inventory

Document the current master, scripts, outputs, language conventions,
Supabase schema, music/QR workflow, rights status, and safe automation
boundaries. Confirm the publication boundary and which operations require
approval.

### Phase 1 — Register and build safely

Register the existing book without changing it. Wrap supported existing
pipeline operations; validate, build previews, report logs and artifacts,
and prove that failures cannot alter the published release.

### Phase 2 — Version catalog and read-only MCP

Add book/version/build/release metadata, then expose version-aware
manifests, authorized chapter and music retrieval, search, citations, and
build status.

### Phase 3 — Approved authoring and publishing

Add change proposals, previews, validation, approved application, version
comparison, and explicit release/rollback workflows behind authentication.

### Phase 4 — Reader companion

Add reading paths, theme and music exploration, reflection prompts,
accessibility options, and optional private notes or consent-based feedback.

### Phase 5 — Validate products and spatial experiences

Test concrete commercial offers with readers. Prototype a small spatial
experience only if the structured reader experience and stable APIs show
that it adds value.

## 9. Decisions to resolve

1. Which Sheet, tabs, and ranges are the actual master?
2. Where are the conversion scripts, and what supported interface invokes
   them?
3. How are chapters, versions, and languages identified today?
4. Which Supabase tables are curated, generated, or book-specific?
5. How are short URLs and QR codes created and maintained?
6. Which chapters and outputs may be public, and what are the lyric rights?
7. Should reader use be anonymous by default, with accounts only for
   optional synchronization?
8. Which authoring operations may be applied directly after approval, and
   which must remain manual?
9. Which MCP clients and deployment constraints should the implementation
   target?

## 10. First useful release: definition of done

The first creation-oriented MCP release is useful when it can:

- register the existing book without modifying its master;
- identify the master and established export pipeline;
- create a version record without overwriting the current release;
- run the supported PDF/Markdown/language build workflow;
- associate each artifact with its source snapshot and version;
- report build failures, validation results, and warnings explicitly;
- retrieve authorized published chapter/music data with stable IDs;
- preview a structural change before it is applied;
- preserve release history and support rollback.

Do not expand into autonomous editing, extensive personalization, or VR
until these foundations work reliably.

## Summary

LifeDemandedDeath MCP should be a controlled, version-aware interface to
the existing book-production system. It should first register the book,
reuse its established tools, and make builds and releases traceable. It
can then add safe authoring operations and reader discovery without
replacing the author's workflow or confusing source text with
interpretation.
