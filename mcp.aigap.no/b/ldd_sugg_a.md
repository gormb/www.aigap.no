# LifeDemandedDeath --- MCP Server & Experience Concept

## Working product brief, 20 October 2026

## 1. Core idea

**Do not turn the book into a chatbot that explains it. Turn it into a
living, navigable experience that helps each reader encounter it on
their own terms.**

*LifeDemandedDeath* is already more than a linear manuscript. It is an
evolving book: new chapters are written frequently, then placed within
the larger structure; songs are selected as perspectives on chapters; a
self-hosted URL shortener and QR codes connect the physical reading
experience to music; and downloaded lyrics act as another interpretive
lens.

The MCP server should preserve that author-led, evolving character while
making the book useful to readers, creative tools, and eventually
immersive environments such as Unreal Engine.

The book remains the source. The server makes its structure,
relationships, and experiences discoverable.

## 2. Product principles

1.  **The author stays in control.** New chapters, ordering, song
    associations, and approved interpretations are authored or approved
    by the writer.
2.  **Interpretation is plural.** The system should offer possibilities,
    not declare the one correct meaning of a chapter or song.
3.  **Keep source and AI distinct.** Clearly label manuscript text,
    author notes, reader reflections, AI-generated interpretations, and
    licensed/external material.
4.  **Music is structural, not decorative.** Songs can act as chapter
    entrances, emotional counterpoints, thematic links, and alternate
    perspectives.
5.  **Personalization without flattening.** Readers can shape their
    journey without the system reducing the book to a profile or feeding
    them only what they already agree with.
6.  **A book can change.** Every published version should have a stable
    version identifier, while the living manuscript can continue to
    evolve.
7.  **Privacy by default.** Personal reflections should be private
    unless the reader explicitly chooses to save, export, or share them.
8.  **Make room for ambiguity.** The server should be able to say "there
    are several plausible readings" or "the text does not settle this."

## 3. What the MCP server is for

MCP (Model Context Protocol) is the interface through which compatible
AI clients can discover resources, prompts, and tools. It is not the
whole product: it is the **book's structured access layer**. A website,
e-reader companion, mobile experience, or VR app can use the same
underlying content and APIs.

### Main audiences

-   **Readers:** explore chapters, music, themes, contradictions, and
    personal responses.
-   **The author/editor:** organize new chapters, curate links, review
    reader feedback, and publish versions.
-   **Other AI agents:** retrieve grounded passages and thematic
    relationships for writing, research, discussion, or creative
    projects.
-   **Immersive clients:** Unreal Engine or other environments that turn
    chapters and themes into spatial experiences.
-   **Partners:** publishers, book clubs, educators, cultural venues, or
    licensed adaptation teams.

## 4. MCP resources: what the server exposes

Resources are stable, addressable pieces of information clients can
inspect. Suggested resource families:

-   `book://metadata` --- title, description, language, current release,
    author-approved framing.
-   `book://versions/{version}` --- snapshot metadata for a published
    edition.
-   `book://chapters` --- ordered chapter index and placement.
-   `book://chapters/{chapter_id}` --- chapter text or an authorized
    excerpt, metadata, and links.
-   `book://songs` --- song index and the chapter associations.
-   `book://songs/{song_id}` --- title, artist, short author note,
    permitted link, and relationship to chapters.
-   `book://themes` --- author-defined themes plus explicitly labeled
    machine-suggested themes.
-   `book://themes/{theme_id}` --- linked chapters, songs, and passages,
    with explanations of why each link exists.
-   `book://connections` --- curated links between chapters, motifs,
    songs, questions, and tensions.
-   `book://reading-paths` --- author-curated paths and opt-in
    reader-created paths.
-   `book://policies` --- copyright, privacy, citation, and use rules.
-   `book://change-log` --- additions and revisions between published
    versions.

Each chapter record should keep the author's chosen position, date
written, publication status, and current music association. A chapter's
position can change without changing its stable ID.

### Suggested chapter metadata

``` yaml
id: chapter-unique-id
title: "Chapter title"
status: draft | published | archived
written_at: YYYY-MM-DD
published_in: edition-or-version-id
author_order: 12
themes:
  - mortality
  - freedom
songs:
  - song-id
author_note: "Why this song belongs here, if the author wishes to explain."
reader_access: public | excerpt | private
```

This is an illustrative schema, not a requirement to rewrite the
manuscript in YAML. The server can generate metadata from Markdown front
matter or a separate index.

## 5. MCP tools: what clients can do

Start with a small, reliable set. Tool names below are proposals.

### Reading and discovery

-   `search_book(query, filters)` --- search chapters, passages, themes,
    and songs; return matches with stable IDs and citations.
-   `get_chapter(chapter_id, version?)` --- retrieve a chapter or
    permitted excerpt.
-   `get_song_context(song_id)` --- retrieve the song metadata,
    official/self-hosted link, associated chapters, and author note.
-   `trace_theme(theme, include_songs=true)` --- trace a theme through
    selected chapters and songs.
-   `find_connections(item_id, connection_type?)` --- discover curated
    or clearly labeled suggested connections.
-   `compare_passages(passage_ids, question?)` --- compare passages
    without pretending their differences must be resolved.
-   `build_reading_path(goal, duration, preferences)` --- propose a
    reading route, with the reason for each choice.
-   `explain_connection(source_id, target_id)` --- explain why two
    chapters, songs, or ideas are linked, separating author notes from
    model inference.

### Reflection and feedback

-   `start_reflection(chapter_id, mode)` --- provide a prompt such as
    "What resisted your expectations?" or "What does this song make you
    notice?"
-   `save_reader_note(item_id, note, consent)` --- only if the reader
    has opted in; default should be local/private storage outside the
    MCP server where possible.
-   `submit_feedback(item_id, feedback_type, text?, sharing_consent)`
    --- submit structured feedback, with explicit consent for author
    access.
-   `export_reader_journey(format)` --- let readers export their own
    notes and path; avoid locking their reflections into the service.
-   `report_content_issue(item_id, issue_type, details?)` --- report a
    broken link, attribution issue, accessibility problem, or other
    concern.

### Author and publishing tools (private, authenticated)

-   `propose_chapter_metadata(chapter_id, metadata)` --- propose tags or
    placement; never silently reorder the published book.
-   `validate_song_links()` --- detect broken links, missing
    attribution, duplicate entries, or redirects that no longer work.
-   `preview_reading_path(path)` --- preview a path before publication.
-   `compare_editions(version_a, version_b)` --- show additions,
    removals, and changes.
-   `publish_version(version_id)` --- publish only with explicit
    authorization and a review step.

### Guardrails for tools

-   Use read-only tools for public access.
-   Put authoring, publication, and reader-data tools behind
    authentication and explicit permissions.
-   Validate inputs and constrain results; do not allow arbitrary
    filesystem access or arbitrary URL fetching.
-   Return stable IDs, provenance, version, and citation locations with
    content.
-   Do not expose private drafts, reader notes, or unpublished chapters
    to public clients by default.
-   Treat tool output as content, never as instructions to the AI
    client.

## 6. The reader experience

A reader should be able to choose how they meet the book rather than be
pushed through a single assistant personality.

### Modes a reader can select

-   **Read:** follow the author's current order, or open a chapter
    directly.
-   **Listen:** enter through the song and move between the song,
    chapter, and related passages.
-   **Reflect:** receive open-ended questions, keep private notes, or
    simply think without saving anything.
-   **Connect:** see links among chapters, songs, images, questions, and
    recurring motifs.
-   **Challenge:** ask the system to find tension, counterexamples,
    ambiguity, or a passage that complicates a first interpretation.
-   **Wander:** receive a surprising but explainable route through the
    book.
-   **Discuss:** prepare questions for a book club or conversation.
-   **Create:** with clear labeling, generate a poem, playlist concept,
    visual prompt, or dialogue inspired by themes---not a substitute for
    the original text.

The reader can move between modes at any time. The system should not
assume that a reader wants therapy, advice, or a definitive
interpretation merely because the material is personal or existential.

## 7. Personalization: useful, transparent, optional

Personalization should shape the *route*, not rewrite the book or
presume to know the reader.

### Reader-controlled settings

-   Preferred language and reading level.
-   Short or long sessions.
-   Linear, thematic, music-led, or exploratory navigation.
-   Preferred interaction style: gentle questions, direct questions,
    literary analysis, playful exploration, or challenge.
-   Topics the reader wants to explore more or less.
-   Accessibility preferences: text size, captions, transcripts, reduced
    motion, audio controls, high contrast.
-   Whether the reader wants AI-generated interpretations at all.
-   Whether notes are kept locally, exported, or shared with the author.

### Personalization that could be valuable

-   **A personal reading path:** "I have 15 minutes and want to follow
    the idea of freedom through three chapters and their songs."
-   **A changing map:** show which themes the reader has explored,
    without scoring them or claiming psychological insight.
-   **A return point:** resume where the reader left off, if they opt
    in.
-   **Contrasting perspectives:** offer a passage that challenges the
    reader's current interpretation rather than only confirming it.
-   **A private reading journal:** notes and questions that belong to
    the reader.
-   **Group paths:** a book club can create a shared path without
    exposing everyone's private notes.

### What not to personalize

-   Do not infer sensitive traits or mental-health status from reading
    choices.
-   Do not quietly create a psychological profile.
-   Do not use private reflections for advertising or model training
    without separate, informed consent.
-   Do not rank readers by depth, emotional maturity, or agreement with
    the author.
-   Do not change or paraphrase the author's text in a way that looks
    like the original.
-   Do not use engagement tricks to keep readers interacting longer than
    they intended.

A good default is **session-only personalization**. Ask before saving
preferences or notes, and provide a clear reset/export option.

## 8. Music, links, QR codes, and lyrics

The song layer is one of the most distinctive parts of the project.
Preserve the chain:

**chapter → song choice → short URL → QR code → listening → lyrics as
another perspective → reader's interpretation.**

### Recommended song record

Store: - stable song ID; - track title and artist; - chapter IDs it
relates to; - author's reason for choosing it, if provided; - the
author's short URL; - destination URL and link health; - QR-code asset
or the data needed to generate it; - lyrics source and rights status; -
date last checked.

The author's short URL should be the stable public link. If a
destination changes, update the redirect rather than reprinting every QR
code. Consider recording redirect changes and checking links
periodically.

### Lyrics and copyright

Downloaded lyrics are not automatically cleared for redistribution.
Lyrics are copyrighted text in many jurisdictions, and permissions can
differ from permissions to link to a song or stream it. Before exposing
lyrics through a public MCP resource, website, or VR experience:

-   confirm that you have the rights or a suitable license to store and
    display the lyrics;
-   otherwise store metadata and a lawful source link, not the full
    lyrics;
-   avoid returning full lyrics or substantial excerpts to AI clients;
-   distinguish the artist's lyrics from your commentary and from
    AI-generated analysis;
-   keep a rights field such as `unknown`, `licensed`, `link_only`, or
    `not_for_public_display`.

The lyrics can remain a powerful perspective even if the server links to
a lawful lyrics source rather than reproducing the text.

### Music experience ideas

-   Open the chapter and its song side by side.
-   Ask "What changes in the chapter when heard through this song?"
-   Compare the author's song choice with an optional reader-selected
    counter-song.
-   Let readers trace a musical motif across the book.
-   Offer a quiet "listen first, then read" path and a "read first, then
    listen" path.
-   Make clear when a link opens an external service and when audio is
    unavailable.

Do not assume that streaming services permit playback inside every app
or VR experience. Check the provider's terms and licensing before
embedding audio.

## 9. VR and future Unreal Engine MCP

Think of VR as a new *presentation layer* over the same structured book,
not a separate version that duplicates the content model. The book MCP
should provide content and relationships; a future Unreal integration
can decide how to render them.

### Possible spatial metaphors

-   **A landscape of chapters:** each chapter is a place; walking
    between them follows author-curated or reader-selected links.
-   **A constellation of themes:** chapters and songs become nodes;
    recurring themes form visible connections.
-   **A listening room:** the song, chapter excerpt, and author note
    share one focused space.
-   **A room of contradictions:** two passages sit opposite one another,
    inviting the reader to move between them.
-   **A path that changes with the reader:** the route adapts to a
    chosen theme or session length, while the underlying text stays
    fixed.
-   **A quiet reflection space:** a reader can pause, listen, or record
    a private note without being prompted to disclose it.

### Useful Unreal-facing capabilities

-   `get_spatial_scene(scene_id)` --- scene description, objects,
    labels, and referenced content IDs.
-   `get_node_content(node_id)` --- text, song context, and accessible
    alternatives.
-   `get_navigation_edges(node_id)` --- which chapters or themes can be
    reached next.
-   `suggest_next_node(current_node, reader_choices)` --- suggest a
    route with a short explanation.
-   `record_session_event(event_type, item_id, consent)` --- only
    collect analytics when necessary and disclosed.

These could be exposed through a separate adapter or service that
consumes the book's internal API. Do not couple the core MCP server to
Unreal-specific classes or scene assets.

### VR design cautions

-   Offer seated and non-VR alternatives.
-   Provide subtitles, text equivalents, adjustable motion, and comfort
    settings.
-   Avoid requiring physical movement to access essential content.
-   Keep navigation predictable and allow an immediate exit.
-   Do not use spatial intensity, sound, or emotionally charged material
    to manipulate a reader.
-   Keep private notes out of public spaces unless the reader
    deliberately shares them.
-   Treat music playback rights and platform rules as a separate
    workstream.

## 10. Feedback: what to ask and what to learn

Feedback should improve the book and experience without turning every
reader into a product-analytics subject.

### In-the-moment feedback (optional)

Use a small number of specific prompts: - "Did this connection feel
meaningful, surprising, or forced?" - "Was the song a useful perspective
on the chapter?" - "Did this question open something up, or close it
down?" - "Was the AI's interpretation clearly distinguished from the
author's text?" - "Was anything inaccurate, intrusive, or confusing?" -
"What would you like more or less of?"

Allow "skip" and free-text responses. Do not demand a rating after every
chapter.

### Separate kinds of feedback

1.  **Content feedback:** reaction to a chapter or song association.
2.  **Interpretation feedback:** whether an AI-suggested connection felt
    grounded.
3.  **Usability feedback:** broken links, confusing navigation,
    accessibility.
4.  **Commercial feedback:** whether a reader would pay for a specific
    experience.
5.  **Safety/privacy feedback:** concern about how notes or personal
    information are handled.

### What the author dashboard could show

-   Most opened chapters and song links, in aggregate.
-   Which connections readers find meaningful or forced.
-   Broken URLs and QR redirects.
-   Search queries that return no useful result.
-   Reader-submitted comments the reader explicitly agreed to share.
-   Changes in feedback between versions.

Avoid presenting this as a measure of a chapter's literary worth. High
click counts do not equal depth or quality. Set minimum aggregation
thresholds, avoid exposing individual reader journeys, and do not
collect more than the project needs.

## 11. Commercial possibilities

The commercial model should follow demonstrated reader value. Start
small; do not build every platform before validating that people want
the experience.

### Possible offers

**Free public companion** - Chapter index, song links, QR access,
selected theme paths. - Basic search and limited exploration. - Useful
as discovery and a bridge from print to digital.

**Paid reader edition** - Expanded reading paths, saved private notes,
personal reading journal, curated theme journeys, and richer
chapter/song connections. - One-time purchase or paid edition, if the
value is durable enough to justify it.

**Membership** - New-chapter notes, author-curated paths, periodic
listening sessions, community events, and behind-the-scenes process. -
Avoid making access to essential manuscript content dependent on
constant engagement.

**Book-club / educator package** - Facilitator guides, discussion paths,
group questions, session plans, and a shared display mode. - Charge per
group, institution, or event where appropriate.

**Immersive edition** - A premium VR experience, installation, gallery
version, or ticketed listening/reading event. - Likely a later phase
because development, accessibility, platform support, and music rights
add cost.

**Creative/licensing partnerships** - Licensed adaptations, exhibitions,
performances, commissioned experiences, or use by cultural
organizations. - Keep approval rights and attribution explicit.

**Developer access** - A documented, rate-limited public MCP endpoint
for third-party AI clients, with paid tiers only if there is real demand
for higher limits, commercial usage, or licensed content. - Do not
charge for basic discovery before proving that external agents provide
meaningful value.

### Commercial design principles

-   Make the free version genuinely useful.
-   Charge for added experiences, curation, convenience, or licensed
    use---not for a reader's private reflections.
-   Never sell reader notes or inferred profiles.
-   Do not make AI-generated text look like unpublished or approved
    author writing.
-   Separate book sales, membership, events, and licensing in the
    business model.
-   Budget for hosting, maintenance, link monitoring, rights clearance,
    support, accessibility, and ongoing chapter curation---not only
    initial development.

### Validate before investing

Ask readers to choose among concrete offers rather than "Would you pay
for this?" - A one-time digital companion. - A monthly reading/listening
membership. - A guided group session. - An immersive event. - A paid VR
edition.

A small landing page, a few interviews, and a manual prototype can test
willingness to pay before a full build.

## 12. Suggested technical architecture

Keep the content model independent of any one AI client.

``` text
Markdown manuscript + chapter/song index
                  |
           Content pipeline
     (parse, validate, version, rights)
                  |
        Canonical content store
      + search index + link checker
                  |
          Internal content API
                  |
       MCP server / MCP endpoint
        /          |          \
   AI clients   Web/mobile    Unreal adapter
                    |
             Reader preferences
             and private notes
             (opt-in, minimal)
```

### Practical first implementation

-   Keep writing chapters in Markdown.
-   Give every chapter a stable ID and store ordering separately from
    file names.
-   Keep song metadata in a simple YAML, JSON, or Markdown index.
-   Store short URLs as canonical destinations and test them
    automatically.
-   Generate a machine-readable chapter/song graph from the index.
-   Build read-only search, retrieval, theme tracing, and comparison
    tools first.
-   Add a small web companion before VR.
-   Add feedback only after privacy and consent flows are clear.
-   Add authoring/publishing tools only behind authentication.
-   Add Unreal integration after the content IDs and navigation graph
    have proven stable.

The specific server framework, database, and deployment target should be
chosen after deciding which MCP clients need to connect and whether the
service is local, private, or public. Avoid tying the project to a
particular vendor before that decision.

## 13. Roadmap

### Phase 0 --- Structure the living book

-   Define stable IDs for chapters and songs.
-   Keep author order and publication version explicit.
-   Inventory song URLs, QR codes, and lyric rights status.
-   Decide which material is public, excerpt-only, or private.
-   Write down how AI may quote and attribute the manuscript.

### Phase 1 --- Useful MCP MVP

-   Resources for metadata, chapters, songs, themes, and version
    history.
-   Tools for search, retrieve chapter, trace theme, compare passages,
    and find connections.
-   Citations back to chapter IDs and passage locations.
-   Read-only public access and basic link validation.

### Phase 2 --- Reader companion

-   Modes: Read, Listen, Reflect, Connect, Challenge, Wander.
-   User-controlled reading paths and accessible design.
-   Optional private notes and explicit feedback sharing.
-   A small author dashboard with aggregate feedback.

### Phase 3 --- Sustainable business test

-   Landing page and reader interviews.
-   Test one paid offer at a time.
-   Measure sign-ups, return use, reader-reported value, and willingness
    to pay.
-   Review copyright, privacy, tax, consumer, and platform obligations
    for the relevant markets.

### Phase 4 --- Spatial/VR prototype

-   Create one small scene: perhaps a chapter, its song, and two related
    passages.
-   Test comfort, comprehension, accessibility, and whether spatial form
    adds meaning.
-   Use stable content IDs and a separate Unreal adapter.
-   Expand only if users report that the experience adds something the
    web companion cannot.

### Phase 5 --- Ecosystem

-   Public documentation and example MCP clients.
-   Partner or institutional packages.
-   Licensed immersive, performance, or exhibition versions.
-   More advanced tools only where users have demonstrated a need.

## 14. Questions to resolve

1.  **Publication boundary:** Is the whole manuscript public, or are
    some chapters drafts/private until the author places them?
2.  **Lyrics rights:** Are full lyrics licensed for display, or should
    the system link to lawful sources and offer the author's commentary?
3.  **Reader identity:** Should the experience work anonymously, with
    optional accounts only for sync and saved paths?
4.  **Personalization:** Should preferences live only in a session, in
    the reader's browser/device, or in an account they control?
5.  **Feedback:** Does the author want private reader feedback, public
    discussion, or only aggregate signals?
6.  **Business model:** Is the primary goal book sales, membership,
    events, institutional use, licensing, or a mix?
7.  **VR purpose:** Is VR mainly a new way to read, an
    artwork/installation, a social experience, or a premium edition?
8.  **AI voice:** Should the assistant be a neutral guide, a provocative
    interlocutor, a set of selectable modes, or a clearly fictional
    voice?

## 15. A concise product definition

**LifeDemandedDeath MCP is an author-controlled, versioned interface to
an evolving book whose chapters, songs, and themes form a navigable
network. It lets readers follow the author's order, wander through music
and ideas, reflect privately, challenge interpretations, and eventually
experience the work spatially---while keeping the original text, AI
interpretation, reader response, and licensed media clearly separate.**

The first milestone is not VR and not a fully autonomous literary agent.
It is a trustworthy structured edition of the book that can be searched,
cited, connected, and extended without losing the author's intent.
