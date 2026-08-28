# Kissago Auth & Legal Microcopy — Seed

## Sign in
### Heading
Welcome back

### Supporting line
Sign in to continue your stories or begin a new one.

### Primary CTA
Sign in

### Legal line under CTA
By continuing, you agree to the current **Terms & EULA** and acknowledge the **Privacy Notice**.

### Secondary links
Create account instead  
Forgot password?

---

## Create account
### Heading
Create your account

### Supporting line
Save stories, come back later, and keep making magic together.

### Required agreement checkbox
**Unchecked by default**

I agree to the **Terms & End User Licence Agreement** and acknowledge the **Privacy & Data Notice**.

### Adult-account note — use only if product architecture confirms it
Accounts are for adults. Children can use Kissago under a parent, guardian or authorised educator.

### Primary CTA
Create account

### Missing acceptance validation
Please agree to the Terms & EULA before creating your account.

### Existing account link
Already have an account? **Sign in**

---

## Google/OAuth first-time user gate
### Heading
One last step

### Body
Before we create your Kissago profile, please review and accept the terms that govern your account.

### Required checkbox
I agree to the **Terms & End User Licence Agreement** and acknowledge the **Privacy & Data Notice**.

### CTA
Agree & continue

---

## Terms modal
### Header
Terms & End User Licence Agreement

### Metadata
Version {version} · Effective {date}

### Footer actions
Close  
Agree

When `Agree` is intentionally clicked from sign-up, check the sign-up agreement checkbox and close the modal.

---

## Privacy modal
### Header
Privacy & Data Notice

### Metadata
Version {version} · Effective {date}

### Footer action
Close

Avoid a generic `I consent` button on the Privacy Notice unless a specific processing purpose actually requires consent.

---

## Updated Terms re-consent
### Heading
We updated our Terms

### Body
We’ve made changes that affect how Kissago is used. Please review the updated Terms & EULA before continuing.

### Actions
Review Terms  
Agree & continue

Do not use a pre-checked checkbox or a dismiss/skip action if re-acceptance is genuinely required.

---

## Help & Legal menu
### Profile menu item
Help & Legal

### Screen intro
Support, policies, rights and important information about using Kissago.

### Items
- Help & Support
- Terms of Service & EULA
- Privacy & Data Notice
- AI, Content & Rights
- Safety, Community & Grievance

---

## Minimal logged-out footer / auth-bottom treatment
Prefer unobtrusive inline text, not a large footer navigation:

© {year} Kissago · Terms · Privacy · Help

On small auth modals, Terms and Privacy can be provided through the agreement/continuation copy so the global footer does not need to compete with the form.
