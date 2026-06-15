# Broken Arrow Consulting — Brand Style Guide

> Version 3.0 · March 2026
> This file is the canonical reference for all Broken Arrow visual identity decisions.
> Any AI tool, agent, or human producing branded output should follow these rules.

---

## 0. Agent Preamble

- Reference this file before producing ANY branded output
- Default to dark theme unless the output is a client report or printable document
- Use light theme for: reports, proposals, invoices, printable PDFs
- Pull chart colors in specified order, never tool defaults
- Monospace (JetBrains Mono) for data/coordinates only, never for body text
- When in doubt, understate. The brand is quiet until it needs to speak.

---

## 1. Brand Identity

Broken Arrow Consulting operates at the intersection of environmental science, remote sensing, and data analytics. The brand communicates precision, independence, and practical intelligence — grounded in prairie pragmatism and powered by satellite and computational tools.

### Design Principles

- **Slate base**: Dark, cool backgrounds. White headings. The brand is quiet until it needs to speak.
- **Gradient as signal**: The signature green→purple→orange bar appears sparingly — nav rules, header accents, dividers. Never as a background fill.
- **Color with purpose**: Each gradient stop maps to a domain. Color is information, not decoration.
- **Field-tested**: Prairie roots inform every choice. If a rancher with a stats degree wouldn't respect it, rethink it.

### Voice & Tone

Direct, confident, plainspoken. Write like you'd explain it to a smart rancher who also understands statistics. Avoid jargon for its own sake but don't dumb down the science. The signature line — "You Can Just Do Things" — captures the brand ethos: capability without permission.

**Do:** Use concrete numbers and examples. Lead with the insight, not the method. Be conversational in blogs, precise in reports. Reference field experience naturally.

**Don't:** Use buzzwords without substance. Oversell capabilities you can't deliver. Default to passive voice. Hide behind academic language.

### Tagline

"One visit is an opinion. A time-series is evidence."

### Signature Closing



---

## 2. The Signature Gradient

The gradient is the single most recognizable brand element. It flows **green → purple → orange** and each anchor maps to a domain of expertise.

### Gradient Stops (Muted — for all brand materials)

| Stop | Name | Hex | Role |
|------|------|-----|------|
| 1 | Green | `#5E9B72` | Vegetation, reclamation, field work |
| 2 | Teal | `#5E8B8A` | Transition stop — neutral data |
| 3 | Purple | `#7E6D94` | Technology, analysis, remote sensing |
| 4 | Mauve | `#947068` | Transition stop — earth tones |
| 5 | Orange | `#BF9555` | Prairie warmth, trust, CTA, headings |

### Vivid Site Originals (website CSS only)

These are the source colors from brokenarrow.pro. They are **not** used in documents, slides, or print — only on the website itself.

| Name | Hex |
|------|-----|
| Site Green | `#28c76f` |
| Site Purple | `#9b59d6` |
| Site Orange | `#f5a623` |

### CSS Implementation

```css
/* Broken Arrow signature gradient — muted (brand materials) */
background: linear-gradient(90deg, #5E9B72, #5E8B8A, #7E6D94, #947068, #BF9555);

/* Vivid version (website only) */
background: linear-gradient(90deg, #28c76f, #9b59d6, #f5a623);
```

### Gradient Usage Rules

**YES:**
- Thin rules and dividers (1–4px height) — nav underlines, section breaks, header bars
- Cover / title page accents on reports and slide decks
- Favicon / social avatar fill inside the arrow mark

**NO:**
- Never use as a full-area background fill. The gradient is a signal, not a surface.
- Never apply gradient to text. Pull individual stop colors instead.
- Never fill buttons, cards, or panels with the gradient.

### Using Individual Stops as Accents

When you need a single color (not the full bar), pull from these assignments:

- **Green `#5E9B72`** — Environmental content: NDVI, reclamation, vegetation, field reports
- **Teal `#5E8B8A`** — Neutral data: chart axes, metadata, secondary information
- **Purple `#7E6D94`** — Technology: code, satellite data, RPI methodology, analytical work
- **Orange `#BF9555`** — Warm accent: headings on dark, CTA buttons, links, key callouts
- **Mauve `#947068`** — Supporting: table alternation, de-emphasized elements, earth tones

---

## 3. Color System

### Slate Base — Dark Theme (default)

| Name | Hex | Usage |
|------|-----|-------|
| Slate Dark | `#14181E` | Primary background |
| Slate Mid | `#1E2430` | Cards, panels, elevated surfaces |
| Slate Border | `#2D3548` | Dividers, subtle borders |
| Slate Light | `#3D4A5C` | Tertiary, disabled states |
| Body Text | `#A0A8B8` | Body copy on dark |
| Muted Text | `#6B7588` | Captions, metadata on dark |
| White | `#FFFFFF` | Headings on dark |

### Light Theme (client reports, printable documents)

| Name | Hex | Usage |
|------|-----|-------|
| White | `#FFFFFF` | Page background |
| Warm Gray | `#F2EDE6` | Section fills, alternating rows |
| Slate (as text) | `#1E2430` | Body text on light |
| Orange | `#BF9555` | Headings, accent rules |
| Caption Gray | `#6B7280` | Captions, footnotes |

### CSS Custom Properties

```css
:root {
  /* Slate base */
  --ba-slate-dark: #14181E;
  --ba-slate-mid: #1E2430;
  --ba-slate-border: #2D3548;
  --ba-slate-light: #3D4A5C;
  --ba-body-text: #A0A8B8;
  --ba-muted-text: #6B7588;

  /* Gradient stops */
  --ba-green: #5E9B72;
  --ba-teal: #5E8B8A;
  --ba-purple: #7E6D94;
  --ba-mauve: #947068;
  --ba-orange: #BF9555;

  /* Light theme */
  --ba-warm-gray: #F2EDE6;
  --ba-caption: #6B7280;
}
```

### Contrast Notes

| Pair | Ratio | WCAG |
|------|-------|------|
| White on Slate Dark | 16.8:1 | AAA |
| Body Text on Slate Dark | 7.1:1 | AAA |
| Orange on Slate Dark | 5.7:1 | AA |
| Orange on White | 3.0:1 | Large text only |
| Green on Slate Dark | 4.8:1 | AA (large text) |
| Purple on Slate Dark | 3.6:1 | Large text only |

**Rule:** For body text on light backgrounds where contrast matters, use Slate Dark (`#1E2430`) instead of Orange. Orange is for headings and decorative accents on light.

### Chart / Data Visualization Color Order

When building charts in Excel, Google Sheets, Python (matplotlib/plotly), or any tool:

1. Green `#5E9B72`
2. Orange `#BF9555`
3. Teal `#5E8B8A`
4. Purple `#7E6D94`
5. Mauve `#947068`

Never use default chart colors from Excel or Google Sheets.

---

## 4. Logo System

Three approved logo files. All are monochrome (black or white). Color and text are added per context using this style guide.

### Logo Files

| File | Format | Usage |
|------|--------|-------|
| `Broken_Arrow_2026_Short` | PNG / SVG | **Mark only** — favicons, app icons, social avatars, tight spaces |
| `Broken_Arrow_2026` | PNG / SVG | **Full lockup** — mark + "BROKEN ARROW CONSULTING" wordmark. Website header, letterhead, title pages |
| `Broken_Arrow_Consulting_2026_Outline` | PNG | **Outline variant** — watermarks, subtle backgrounds, low-contrast decorative use |

### Logo Usage Rules

- Clear space: height of the chevron element on all sides of the mark
- Minimum digital size: 24px (mark only), 120px (full lockup)
- Minimum print size: 10mm (mark only), 35mm (full lockup)
- On light backgrounds: use black mark
- On dark backgrounds: use white mark (invert SVG fill to `#FFFFFF`)
- Never stretch, rotate, add shadows, or recolor outside the approved palette
- When space is tight, use the mark alone — drop the wordmark
- Gradient fill inside the mark is approved for social/favicon use only
- The outline variant is for watermarks and background elements only (10–20% opacity), never as the primary mark
- Always use the mark in horizontal orientation — never stack vertically

---

## 5. Typography

### Primary Typeface — Inter

- **Source:** Google Fonts (fonts.google.com/specimen/Inter)
- **Weight range:** Variable 100–900
- **License:** Open source (SIL Open Font License)
- **Use for:** Headings, body text, UI elements, documents, emails, presentations
- **System fallback:** Calibri (Windows), SF Pro (macOS/iOS)

```css
font-family: 'Inter', 'Calibri', 'SF Pro', sans-serif;
```

Inter is intentionally neutral — it disappears so the data speaks. Distinctiveness comes from the gradient and color system, not the typeface.

### Secondary Typeface — JetBrains Mono

- **Source:** jetbrains.com/lp/mono
- **Style:** Monospaced, ligatures supported
- **License:** Free (SIL Open Font License)
- **Use for:** Code samples, data tables, DLS coordinates, technical callouts, terminal output

```css
font-family: 'JetBrains Mono', 'Consolas', 'Courier New', monospace;
```

### Type Scale

| Level | Font | Size | Usage |
|-------|------|------|-------|
| Display | Inter Bold | 28–36pt | Cover titles, hero text |
| H1 | Inter SemiBold | 20–24pt | Section headings |
| H2 | Inter SemiBold | 15–18pt | Subsections |
| H3 | Inter Medium | 12–14pt | Card headers, labels |
| Body | Inter Regular | 10–11pt | Paragraphs, emails |
| Caption | Inter Regular | 8–9pt | Footnotes, metadata |
| Mono | JetBrains Mono | 9–10pt | Code, coordinates, data |

### Letter Spacing

- Uppercase labels (section headers, nav items): `+0.05em` tracking
- Body text: default tracking, never manually track lowercase body

---

## 6. Document Standards

### Client Reports & Proposals (Light Theme)

- White background with Warm Gray (`#F2EDE6`) section fills
- Gradient header bar at top of page + white reversed company name
- Body text: Slate (`#1E2430`), Inter 10–11pt
- Headings: Orange (`#BF9555`) or Slate bold — use Slate bold when contrast is critical
- Captions: Caption Gray (`#6B7280`), Inter 8pt
- 1" margins all sides, US Letter (8.5 × 11")
- Footer: gradient rule + "brokenarrow.pro" + page number
- Black logo mark on title page or in header
- Outline mark as watermark at 10% opacity on cover pages

### Presentations & Slide Decks (Dark Theme)

- Slate Dark (`#14181E`) background, 16:9 aspect ratio
- Gradient bar at top of each slide (3–4px)
- Orange titles, White body text, Body Text color for captions
- Chart colors in gradient order: Green → Orange → Teal → Purple → Mauve
- White logo mark in bottom-right corner, small
- Maximum 6 lines of text per slide
- Outline mark as background watermark at 5% opacity

### Email Signature

```
Jesse Lawrence, P.Biol, B.Sc.
Founder & Principal Consultant
Broken Arrow Consulting Inc.
───────────── [gradient rule in HTML]
P: 204-908-0810
E: jesse@brokenarrow.pro
brokenarrow.pro
```

In HTML email, use Orange (`#BF9555`) for the URL link color.

### Excel / Google Sheets

- Header row: Slate Dark (`#14181E`) fill + white text, or gradient-colored header
- Freeze top row
- Font: Inter or Calibri, 10pt body, 11pt bold headers
- Chart colors: follow the chart color order above. Never use default Excel/Sheets colors.
- Alternating rows: White / Warm Gray (`#F2EDE6`)

### LinkedIn & Social

- Profile avatar: black mark on white, or gradient-filled mark
- Banner: dark background with gradient rule
- Post style: conversational, insight-led, no hashtag spam

### Blog (brokenarrow.pro)

- Continues the dark theme from the website
- Gradient nav rule
- Orange for links
- Green for environmental content callouts
- Purple for technical/methodology callouts

---

## 7. File Naming Convention

All branded assets should follow this pattern:

```
broken_arrow_[type]_[descriptor]_[date].[ext]

Examples:
broken_arrow_report_tundra_rpi_2026-03.pdf
broken_arrow_deck_keneco_training_2026-04.pptx
broken_arrow_invoice_swat_001.pdf
```

---

## 8. Quick Reference — Copy-Paste Values

### Hex Codes (all at a glance)

```
SLATE BASE
  Slate Dark    #14181E   (bg)
  Slate Mid     #1E2430   (cards)
  Slate Border  #2D3548   (dividers)
  Slate Light   #3D4A5C   (tertiary)
  Body Text     #A0A8B8   (body copy)
  Muted Text    #6B7588   (captions)
  White         #FFFFFF   (headings)

GRADIENT STOPS (muted)
  Green         #5E9B72   (environmental)
  Teal          #5E8B8A   (neutral data)
  Purple        #7E6D94   (technology)
  Mauve         #947068   (earth/support)
  Orange        #BF9555   (warm accent)

GRADIENT STOPS (vivid — website only)
  Site Green    #28c76f
  Site Purple   #9b59d6
  Site Orange   #f5a623

LIGHT THEME
  White         #FFFFFF   (page bg)
  Warm Gray     #F2EDE6   (section fills)
  Slate         #1E2430   (body text)
  Orange        #BF9555   (headings)
  Caption Gray  #6B7280   (captions)
```

### Font CSS

```css
/* Primary */
font-family: 'Inter', 'Calibri', 'SF Pro', sans-serif;

/* Monospace */
font-family: 'JetBrains Mono', 'Consolas', 'Courier New', monospace;

/* Gradient */
background: linear-gradient(90deg, #5E9B72, #5E8B8A, #7E6D94, #947068, #BF9555);
```

### Chart Color Order

```
1. #5E9B72  Green
2. #BF9555  Orange
3. #5E8B8A  Teal
4. #7E6D94  Purple
5. #947068  Mauve
```
