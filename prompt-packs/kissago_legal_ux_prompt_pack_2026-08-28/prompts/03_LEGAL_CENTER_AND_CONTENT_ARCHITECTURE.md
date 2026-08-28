# Prompt 03 — Replace Footer Legal Links with a Fast Help & Legal Center

Use the audit and seed policies in this pack. The goal is to remove the current fragmented footer navigation and the slow dependency on runtime admin/CMS content for core legal pages.

## Information architecture

### Remove from the existing auth/footer legal nav
Retire the current scattered entries such as:
- Policies
- Terms
- Support
- News
- AI and Rights

Do not simply hide routes without checking inbound links and SEO. Add redirects where necessary.

### Signed-in menu
Add one profile-menu entry:
**Help & Legal**

The Help & Legal screen should contain clearly separated cards/rows:
1. Help & Support
2. Terms of Service & End User Licence Agreement
3. Privacy & Data Notice
4. AI, Content & Rights Policy
5. Safety, Community & Grievance Policy

Display `Last updated` and version for legal documents.

### Logged-out access
Do not make legal information available only behind authentication.
Provide minimal public routes/modal entry points for:
- Terms & EULA
- Privacy & Data Notice
- Help/Contact

Auth screens should link directly to the relevant document.

### News
Remove `News` from legal/navigation unless it is actively used. If retained, relocate it to an About/Updates area, not Help & Legal.

## Legal content source architecture
Core legal documents must render quickly and predictably.

### Preferred approach
Store canonical policy content as versioned local Markdown/MDX (or equivalent static content format already supported by the stack), for example:

```
/legal/
  terms-eula/
    1.0.0.md
  privacy/
    1.0.0.md
  ai-content-rights/
    1.0.0.md
  safety-grievance/
    1.0.0.md
  manifest.json
```

Each document should contain machine-readable metadata:
- document key;
- semantic version;
- title;
- effective date;
- published date;
- locale;
- whether re-acceptance is required;
- superseded version, if any.

### Runtime behaviour
- Bundle the current published legal copy with the application or serve it from a highly cacheable static endpoint/CDN.
- Do not require the admin backend/database to successfully respond before the current legal document can render.
- If the project still needs admin editing, treat admin content as a **publishing workflow**, not the live rendering dependency: approved content should be exported/published to the versioned static source.
- Provide a bundled fallback for the current legal version.
- Cache aggressively because legal documents change infrequently.
- Preserve a version history where practical.

## Rendering
Use one reusable legal-document renderer with:
- readable typography;
- table-of-contents/section anchors for long documents;
- headings, lists, tables and callouts;
- responsive modal/page mode;
- print/share/copy-link support only if easy and safe;
- accessible link and focus styling;
- no layout dependence on raw HTML from an admin WYSIWYG.

Sanitize any remotely sourced rich text.

## Seed-content reconciliation
Take the four seed documents in `/seed_content` and replace every bracketed placeholder only with verified facts from:
- code/config;
- company-controlled settings;
- actual production vendors;
- actual subscription/refund behaviour;
- actual content-sharing/moderation behaviour.

Do not overclaim security, encryption, deletion timing, AI-training restrictions, moderation capability or child-safety controls.

## Legacy route plan
Document redirects for old URLs such as `/terms`, `/policies`, `/ai-and-rights`, etc. Do not create redirect loops.

## Deliverables
- Help & Legal screen;
- public legal routes/modal support;
- static/versioned content architecture;
- migrated current policy content after factual reconciliation;
- redirect map;
- content manifest/version metadata;
- loading/performance comparison before/after;
- documentation in `/docs/legal-content-architecture.md`.
