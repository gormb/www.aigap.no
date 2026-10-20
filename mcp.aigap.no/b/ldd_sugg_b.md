# LifeDemandedDeath --- Book Creation MCP

## Architecture and implementation brief

**Revision:** 2\
**Date:** 2026-10-20\
**Status:** Proposed design based on the author's described workflow.
Existing scripts, Google Sheet layout, and Supabase schema still need to
be inspected before implementation.

------------------------------------------------------------------------

## 1. MCP must create and maintain books

This is not just an MCP server that exposes an already-finished
manuscript to readers.

The system already has a book-production workflow:

1.  The author writes chapters frequently.
2.  The author decides where each chapter belongs in the book.
3.  The author chooses music for the chapter.
4.  Music links go through the author's own URL shortener; QR codes
    connect the book to the songs.
5.  Lyrics are downloaded as another perspective on the book, subject to
    applicable rights.
6.  The book master lives in a Google Sheet designed to look like an old
    book.
7.  Existing scripts convert that master into PDF, Markdown, and other
    outputs, and split the content into multiple languages.
8.  Supabase holds structured data such as music, word clouds, and other
    book structures.

**The MCP server should orchestrate and extend this existing production
system. It should not silently replace the Google Sheet, rewrite the
export scripts, or invent a parallel source of truth.**

The server should support both: - **Authoring and production:** create
books, create versions, edit/organize content through approved
workflows, validate, build outputs, compare versions, and publish. -
**Reader and agent access:** search and explore published books,
chapters, songs, themes, and related structures.

These are different permission levels and should be separated.

## 2. Proposed source-of-truth model

Treat each existing system according to the role it already plays.

  -----------------------------------------------------------------------
  System                  Proposed responsibility Important constraint
  ----------------------- ----------------------- -----------------------
  Google Sheets book      Human-friendly          Preserve its layout,
  master                  canonical               formulas, conventions,
                          authoring/master        and scripts
                          representation          

  Existing conversion     Generate PDF, Markdown, Reuse and invoke them;
  scripts                 language splits, and    don't recreate them
                          other established       without a reason
                          artifacts               

  Supabase                Structured supporting   Inspect current schema
                          data: music, word       and relationships
                          clouds, and other       before designing
                          existing tables         migrations

  Author's URL shortener  Stable public music/QR  Prefer stable short
                          entry points            URLs; validate
                                                  redirects and
                                                  destinations

  MCP server              Permissioned            Not a second hidden
                          orchestration, search,  master copy
                          validation,             
                          version/build           
                          workflows, and agent    
                          interface               

  Generated artifacts     Versioned outputs from  Every artifact should
                          a particular source     identify the book and
                          snapshot                version that produced
                                                  it

  Future reader app /     Experience and          Consume stable book IDs
  Unreal Engine adapter   presentation            and APIs; do not own
                                                  canonical manuscript
                                                  text
  -----------------------------------------------------------------------

### Important distinction

The Sheet can remain the author's master while the MCP server maintains
a **catalog of books, versions, build records, and artifact locations**.
That catalog is metadata and workflow state, not a competing manuscript.

Before implementation, inspect: - the Google Sheet's tabs, named ranges,
formulas, formatting conventions, and Apps Script or external scripts; -
how chapters, order, languages, and book identity are represented
today; - the existing PDF/Markdown/export commands and their
inputs/outputs; - the Supabase table names, columns, keys,
relationships, and row ownership; - how the current URL shortener and QR
codes are generated.

Do not infer the actual schema from this proposal. It deliberately uses
logical names until the real schema is inspected.

## 3. The central model: books, versions, builds

Support multiple books and multiple versions without confusing them.

### Book

A **book** is a distinct work or product, for example
`LifeDemandedDeath`. It has a stable `book_id`, title, default language,
and links to its master Sheet and supporting data.

### Version

A **version** is a deliberate state of a book. Examples: - current
evolving working version; - a frozen publication edition; - a
translation release; - an alternate arrangement or experimental
edition; - a second edition with revisions; - a branch for testing a new
chapter order.

A version should define whether it is: - a **snapshot** --- fixed
content, reproducible outputs; - a **working branch** --- changes can
continue; - a **derived edition** --- based on another version but with
specified changes, such as language or arrangement.

### Build

A **build** is one execution of the established conversion pipeline for
a specific book/version/input snapshot. It may produce PDF, Markdown,
language-specific files, and other existing formats.

A build record should capture: - book ID and version ID; - source Sheet
ID and source revision/snapshot, if available; - source hash or
equivalent change fingerprint; - script/version identifier; - requested
output formats and languages; - start/end time and status; - logs and
validation results; - artifact locations and checksums.

### Release

A **release** is an explicitly approved version/build made available to
readers or external agents. A successful build is not automatically a
release.

### Relationship

``` text
Book
 ├── Version A (published snapshot)
 │    ├── Build 1 → PDF, Markdown, language outputs
 │    └── Build 2 → reproducibility check / rebuild
 ├── Version B (working branch)
 │    └── Build 3 → preview artifacts
 └── Version C (alternate edition / second arrangement)
      └── Build 4 → preview artifacts
```

Never overwrite the last published artifacts in place before the new
build passes validation and receives approval.

## 4. Creation workflows the MCP server must support

### A. Create a new book

The MCP client should be able to ask for a new book and initiate a
controlled workflow:

1.  Create a book record in the catalog.
2.  Choose how to initialize it: copy a template, duplicate an existing
    book structure, or link an existing Sheet.
3.  Create or link its Google Sheet master using the existing
    conventions.
4.  Set up required metadata and language configuration.
5.  Link the appropriate Supabase records/tables or create only the
    required supporting structures after schema review.
6.  Configure the export pipeline.
7.  Run validation.
8.  Create an initial preview build.
9.  Ask the author to review and explicitly approve any release.

**Do not automatically duplicate all music, lyrics, reader data, or
private material when cloning a book.** The author should choose which
structures and records to copy.

### B. Create a new version of an existing book

Offer clear choices: - **Freeze current state:** create a reproducible
snapshot. - **Create working branch:** start a new editable version from
a selected version. - **Create alternate edition:** derive a new
arrangement, language, or editorial version while preserving its
parent. - **Create new major edition:** create a publication candidate
with explicit change notes.

A new version must have its own ID and relationship to its parent. It
should not overwrite the current published edition.

### C. Change an existing book

The server should support proposals such as: - add a chapter; - change
chapter placement; - change title or metadata; - associate or replace a
song; - update a stable music short URL; - change language-specific
content; - update tags or other structured relationships; - regenerate a
selected output format; - rebuild all outputs; - compare the result with
the prior version.

For every mutation, return a preview or change summary before committing
when practical. Destructive or broad changes require explicit
confirmation.

### D. Build outputs

The MCP server should call the existing conversion scripts through a
safe, known interface. It should not execute arbitrary commands or
accept arbitrary shell strings from a model.

A build workflow should: 1. validate inputs; 2. record the source
snapshot/fingerprint; 3. run the chosen existing script or supported
command; 4. capture logs and exit status; 5. check that expected
artifacts exist; 6. validate language splits and internal links where
possible; 7. run relevant PDF/Markdown and structural checks; 8. store
artifacts under a versioned location; 9. report a build summary and any
warnings.

A failed build must not change the current release.

### E. Publish

Publishing should be a separate, authenticated action. Before
publication: - verify the chosen book/version/build; - show the artifact
list and change summary; - show validation failures and warnings; -
confirm language and rights settings; - require an explicit author
approval; - record who approved and when.

A reader-facing MCP endpoint should expose only released versions and
content explicitly marked public.

## 5. MCP tool design

MCP resources describe content. MCP tools perform actions. The following
are proposed logical tool names; their actual argument schemas should be
defined after inspecting the current Sheet and scripts.

### Read-only catalog and discovery tools

-   `list_books()` --- list books the caller is allowed to see.
-   `get_book(book_id)` --- book metadata and current version pointers.
-   `list_book_versions(book_id)` --- versions, parent relationships,
    and release status.
-   `get_version_manifest(book_id, version_id)` --- source snapshot,
    languages, build history, and artifacts.
-   `get_chapter(book_id, chapter_id, version_id?)` --- retrieve
    authorized chapter content.
-   `search_book(book_id, query, version_id?)` --- search chapters and
    structured content.
-   `trace_theme(book_id, theme, version_id?)` --- trace a theme through
    content and supporting structures.
-   `get_music_context(book_id, song_id, version_id?)` --- song
    metadata, chapter associations, permitted links, and author notes.
-   `compare_versions(book_id, version_a, version_b)` --- summarize
    structural and content differences.
-   `get_build_status(build_id)` --- build status, outputs, logs
    summary, and validation.

### Authoring and version-management tools

These must require author/editor permissions.

-   `create_book(title, source_template?, language_config?, copy_options?)`
-   `register_existing_book(title, google_sheet_id, pipeline_config)`
-   `create_version(book_id, from_version_id, version_type, label)`
-   `propose_book_changes(book_id, version_id, change_set)`
-   `preview_book_changes(book_id, version_id, change_set)`
-   `apply_book_changes(book_id, version_id, approved_change_set_id)`
-   `set_chapter_order(book_id, version_id, ordered_chapter_ids)`
-   `associate_song(book_id, version_id, chapter_id, song_id, author_note?)`
-   `validate_book(book_id, version_id, checks?)`
-   `build_book(book_id, version_id, formats, languages?)`
-   `compare_builds(build_id_a, build_id_b)`
-   `publish_release(book_id, version_id, build_id, approval_token)`
-   `rollback_release(book_id, release_id)` --- restore a prior release
    pointer, without deleting history.

### Supporting-data tools

These should operate on the real Supabase schema after inspection.

-   `search_music(book_id?, query, filters?)`
-   `validate_music_links(book_id?, version_id?)`
-   `get_word_cloud(book_id, version_id?, language?)`
-   `refresh_derived_structures(book_id, version_id, structures?)`
-   `inspect_data_consistency(book_id, version_id?)`

"Refresh derived structures" should only regenerate the structures known
to be derived, such as word clouds, after confirming how they are
currently produced. It should not overwrite curated music or
author-managed tables.

### Future experience tools

-   `build_reading_path(book_id, reader_goal, duration, preferences?)`
-   `find_connections(book_id, item_id, version_id?)`
-   `start_reflection(book_id, chapter_id, mode)`
-   `get_spatial_navigation(book_id, version_id, current_node)` --- for
    a future Unreal adapter.

### Naming and scope

Use book-scoped operations even if there is only one book today. Avoid
global calls like `build_current_book()` because they become ambiguous
as soon as a second book or edition exists.

## 6. MCP resources

Suggested logical resource URIs:

-   `books://catalog`
-   `books://{book_id}/metadata`
-   `books://{book_id}/versions`
-   `books://{book_id}/versions/{version_id}/manifest`
-   `books://{book_id}/versions/{version_id}/chapters`
-   `books://{book_id}/versions/{version_id}/chapters/{chapter_id}`
-   `books://{book_id}/versions/{version_id}/music`
-   `books://{book_id}/versions/{version_id}/themes`
-   `books://{book_id}/versions/{version_id}/word-clouds/{language}`
-   `books://{book_id}/versions/{version_id}/change-log`
-   `books://{book_id}/releases/{release_id}/artifacts`

The exact URI syntax can be adjusted to the MCP framework, but it should
encode book and version identity. Reader clients should not accidentally
mix a chapter from a draft with music metadata from a published edition.

## 7. Google Sheets integration

The Sheet is not merely an import source. It is the author's
established, visually meaningful book master.

### Integration requirements

-   Preserve the existing Sheet structure and formatting.
-   Identify the specific tab/range conventions used by the conversion
    scripts.
-   Use the existing script interface wherever possible.
-   Do not treat cell positions as stable IDs unless the current system
    already does so reliably.
-   Add a stable chapter identifier only if it can be introduced without
    breaking existing scripts; otherwise maintain a mapping layer.
-   Record source revision/fingerprint before and after a build.
-   Detect if the Sheet changes during a build; if so, mark the build as
    potentially inconsistent and retry or require review.
-   Separate "propose edit" from "write to Sheet."
-   Keep an audit log of MCP-initiated edits.
-   Use least-privilege Google credentials and never expose credentials
    to the model.

### Preferred editing model

For early implementation, have the MCP server **propose changes and show
a diff**, then apply approved changes through a controlled adapter. This
reduces the risk of an AI changing the wrong cells or damaging
formatting.

Do not have the model directly manipulate arbitrary ranges. Implement
typed operations such as "move chapter X before chapter Y" or "set the
song association for chapter X," and translate those operations into the
real Sheet layout in code.

### Build invocation

Wrap the existing scripts with a small, stable interface, for example:

``` text
validate(book_id, version_id)
build(book_id, version_id, formats, languages)
get_build_status(build_id)
list_artifacts(book_id, version_id, build_id)
```

This is an interface proposal, not a claim about the current script
commands. Map it to the actual scripts after inspecting them.

## 8. Supabase integration

Supabase already contains music, word clouds, and other structures.
Reuse these rather than creating duplicate tables prematurely.

### First step: schema discovery

Inspect: - table names and column types; - primary keys and foreign
keys; - relationships between music, chapters, languages, and book
identity; - which data is author-curated versus generated; - whether
tables already support multiple books or versions; - row-level security
and current permissions; - triggers, functions, and scheduled jobs; -
how word clouds are produced and refreshed; - whether lyrics are stored
and what rights/status metadata exists.

### Multi-book/version strategy

If the existing schema is single-book, plan a migration that adds
explicit book/version scoping or a mapping table. Do not blindly add
`book_id` and `version_id` to every table: some records, such as
canonical song metadata, may be reusable across books, while
associations between a song and a chapter are version-specific.

A likely conceptual separation is:

-   **Canonical entities:** a song or artist record that can be reused.
-   **Book associations:** which chapter in which book/version is linked
    to a song, including the author's rationale.
-   **Derived data:** word clouds and indexes computed from a particular
    version and language.
-   **Curated data:** author-managed structures that must not be
    overwritten by automatic refreshes.

These are design categories, not assumed current table names.

### Consistency

The Google Sheet may remain the content master, while Supabase stores
related structured information. The build/validation workflow should
detect orphaned chapter IDs, missing songs, language mismatches, stale
derived structures, and references to unpublished versions.

## 9. Multiple languages

Language is an explicit dimension, not an afterthought.

The system should distinguish: - source/original language; - available
translated languages; - whether a translation is manually curated or
generated; - version and publication status per language; -
language-specific music notes or chapter variants, if applicable; -
language-specific output artifacts.

A build request should be able to say which languages to produce.
Validation should report missing or stale translations instead of
silently filling gaps.

Do not assume that every language edition has the same chapter order or
identical text. The model should support either shared structure with
localized content or distinct arrangements, depending on the existing
workflow.

## 10. Music, URLs, QR codes, and lyrics in the production pipeline

Music is part of the book's editorial structure.

For each song association, track whatever the current system supports,
and add missing fields only after review: - stable song ID; - title and
artist; - associated book/version/chapter; - author's note or reason for
the choice; - author's short URL; - destination URL and link-check
status; - QR code asset or generation inputs; - lyric-source URL and
rights status.

### Operational rules

-   Prefer a stable short URL for each public entry point, so a
    destination can be updated without replacing printed QR codes.
-   Validate the short URL and destination before publication.
-   Make QR generation repeatable and version-aware if the QR payload
    differs by edition.
-   Do not duplicate music records merely because the book has a new
    version; version the association where appropriate.
-   Keep lyric rights and distribution status explicit. Downloading
    lyrics does not itself grant permission to republish them.
-   If lyrics cannot be lawfully displayed, expose permitted metadata
    and a link to an authorized source instead of the full text.

## 11. Safe change management

A writing assistant should help the author work quickly without becoming
an unreviewed publisher.

### Change lifecycle

``` text
Author request
    ↓
Interpret as typed change proposal
    ↓
Check book/version permissions and constraints
    ↓
Show planned diff and affected outputs
    ↓
Author approves
    ↓
Apply change to intended master/branch
    ↓
Validate Sheet + Supabase references
    ↓
Build artifacts
    ↓
Review build and warnings
    ↓
Author explicitly publishes
```

### Required safeguards

-   Every mutation names a specific `book_id` and `version_id`.
-   No edits to published snapshots; create a new version or branch.
-   No silent reordering or deletion.
-   No arbitrary SQL from the model.
-   No arbitrary shell execution from the model.
-   Use parameterized database operations and typed adapters.
-   Require explicit approval for publication and destructive
    operations.
-   Keep a change log and provide rollback through version/release
    pointers.
-   Public clients cannot see drafts or authoring tools.
-   Reader notes and private feedback must never be mixed into
    manuscript source data.

## 12. Reader and commercial layer

The same catalog/version model supports reader experiences and
commercial products without mixing them into book creation.

### Reader-facing features

-   browse published books and versions;
-   read a chapter and follow its song;
-   explore music, word clouds, themes, and cross-chapter links;
-   choose a linear, music-led, thematic, reflective, or challenging
    path;
-   save optional private notes and paths;
-   compare interpretations while distinguishing author text from AI
    inference.

### Commercial possibilities

-   free published-book companion with chapter/music links;
-   paid digital companion with curated paths, saved journeys, and
    richer exploration;
-   membership for new-chapter notes, listening sessions, or events;
-   book-club and educator packages;
-   licensed installations, performances, or immersive editions;
-   future Unreal Engine experience;
-   developer access or licensed use for third-party AI applications if
    demand emerges.

The creation MCP should not itself be the paywall. Entitlements belong
in the product/service layer and should be checked before returning
protected resources or allowing premium operations.

### Feedback

Collect optional, purpose-specific feedback: - Did the song offer a
useful perspective? - Did a connection feel meaningful or forced? - Was
the AI's interpretation grounded in the cited text? - Was the interface
confusing or inaccessible? - Would the reader pay for a specific,
clearly described experience?

Keep reader reflections private by default. Use aggregate analytics
where possible and avoid treating clicks as a measure of literary
quality.

## 13. Future Unreal Engine / VR

The Unreal integration should consume the same versioned book catalog
and navigation graph.

A future adapter could use: -
`get_spatial_navigation(book_id, version_id, current_node)` -
`get_node_content(book_id, version_id, node_id)` -
`get_node_connections(book_id, version_id, node_id)` -
`get_song_context(book_id, version_id, song_id)`

Potential scenes include a landscape of chapters, a constellation of
themes, a listening room, or a space where contrasting passages can be
explored. Begin with a small prototype only after the IDs, versioning,
and content retrieval are reliable.

VR must be an additional presentation layer, not a new source of truth.
Keep accessible non-VR alternatives, captions, reduced motion, and clear
privacy controls.

## 14. Proposed architecture

``` text
                 AUTHOR
                   |
        Google Sheets book master
                   |
        Existing export/conversion scripts
                   |
           Versioned build artifacts
                   |
    +--------------+----------------+
    |                               |
Catalog / version metadata      Supabase
    |                      music / word clouds /
    |                      other current structures
    +---------------+---------------+
                    |
            Internal book API
                    |
          MCP server and adapters
          /          |           \
   Authoring tools  Reader tools  Unreal adapter
   (authenticated)  (published)   (future)
```

Keep the internal book API and domain logic independent of a particular
MCP transport or AI client. The MCP layer should call known operations,
not embed the entire production pipeline inside tool handlers.

## 15. Implementation plan: start with the actual MCP creation work

### Step 1 --- Inventory the current production system

Deliverables: - map of the Google Sheet tabs and ranges used as book
master; - inventory of conversion scripts and how they are invoked; -
sample input/output artifacts; - map of language-splitting logic; -
Supabase schema and relationship map; - current music/QR/short-URL
workflow; - list of operations that are safe to automate and operations
that require confirmation.

**This step requires access to the actual Sheet, scripts/repository, and
Supabase schema.** The architecture above is based on the workflow
described by the author, not an inspection of those assets.

### Step 2 --- Wrap, do not replace, existing scripts

Build a small adapter with typed operations: - validate source; - build
requested formats/languages; - check build status; - list artifacts; -
retrieve logs/validation results.

Run it without modifying the master first.

### Step 3 --- Add book and version catalog

Implement book IDs, version IDs, parent relationships, build records,
artifact records, and release pointers. Initially, register the existing
book rather than migrating or rewriting it.

### Step 4 --- Implement read-only MCP

Expose catalog, version manifest, chapter retrieval, music context,
search, and build status. Confirm that citations and IDs match the real
source.

### Step 5 --- Implement authoring proposals

Support previewed typed changes, such as chapter order and song
association. Apply only approved changes through the existing
Sheet/Supabase adapters.

### Step 6 --- Implement create-book and create-version

Support template-based book creation, cloning selected structures,
branches, alternate editions, and new publication versions. Include
rollback and validation.

### Step 7 --- Add reader features, feedback, and commercial experiments

Keep private authoring separate from public reading access.

### Step 8 --- Add Unreal/VR adapter

Reuse the same versioned APIs and IDs.

## 16. Decisions and unknowns to resolve before writing production code

1.  What is the Google Sheet ID and which tabs/ranges define the master?
2.  Where do the existing scripts live, and what exact commands or Apps
    Script functions run the conversions?
3.  How are chapters identified today: stable IDs, row numbers, titles,
    filenames, or another method?
4.  How are languages represented and split?
5.  Does Supabase already have book/version identifiers, or is its
    schema currently for one book?
6.  Which Supabase structures are curated versus automatically
    generated?
7.  How are short URLs and QR codes created, and are those records in
    Supabase?
8.  Should a new version copy the Sheet, create a new tab, or use
    another established pattern?
9.  Should a new book copy only structure, or also selected
    music/word-cloud data?
10. Which operations may the MCP server perform directly, and which must
    produce a proposed diff for approval?

## 17. Definition of done for the first useful creation MCP

The first creation-oriented MCP release is successful when it can:

-   register the existing book without changing it;
-   identify the source master and its export pipeline;
-   create a version record without overwriting the current version;
-   run the existing PDF/Markdown/language conversion pipeline;
-   record exactly which source/version produced each artifact;
-   report failed builds and validation warnings;
-   retrieve published chapter/music data with stable IDs;
-   preview a structural change before applying it;
-   preserve the existing authoring workflow and support rollback.

Only after that should the project expand into a full autonomous editor,
personalized reader companion, or immersive VR world.

------------------------------------------------------------------------

## Summary

**The creation MCP is a controlled orchestration layer over the existing
book factory.** Google Sheets remains the author-facing master; current
scripts remain the export engine; Supabase remains the structured data
store, subject to schema discovery; and MCP exposes safe, version-aware
operations to AI clients.

The key capabilities are not just "read chapter" and "find theme." They
are **create book, create version, propose change, validate, build,
compare, and publish with approval**. That is what makes the project
capable of supporting a living manuscript, multiple languages,
alternative editions, and eventually more than one book.
