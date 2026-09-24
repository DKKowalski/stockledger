# StockLedger UI and brand style guide

Status: active
Last updated: 24 September 2026

This document is the visual source of truth for StockLedger. Use it before changing product UI, creating marketing material, or drawing the final logo.

## Brand idea

StockLedger gives warehouse teams a trustworthy record of what came in, what went out, and what remains.

The product should feel:

- Precise, without feeling clinical
- Calm under operational pressure
- Modern, without looking like a generic startup template
- Dense enough for real work, but never crowded

Working brand line: **Stock certainty for teams that move inventory.**

## Art direction

The primary reference is [Logistics & Fleet Management Dashboard UI by Ronas IT](https://dribbble.com/shots/26849863-Logistics-Fleet-Management-Dashboard-UI). It establishes the strongest direction for StockLedger: strict monochrome structure, compact controls, dark analytical areas, and a restrained yellow-green accent.

The secondary reference is [Warehouse Inventory Dashboard UI by Ksenia Mizgina](https://dribbble.com/shots/25702575-Warehouse-Inventory-Dashboard-UI-Logistics-Stock-Management). It supports the use of pale industrial neutrals, strong black typography, thin dividers, and small amounts of cooler color in data visualization.

Borrow the visual logic, not the layouts or marks.

### Keep

- Large, regular-weight neo-grotesk headings
- Mostly black, white, and warm gray interfaces
- One high-visibility accent used for decisions and exceptions
- Thin rules, compact icon controls, and flat panels
- Dense tables with generous row height
- Dark chart areas connected into one analytical region

### Avoid

- Gradients, glass effects, glows, and inflated shadows
- Decorative dashboards or invented metrics
- Excessive rounded cards nested inside other rounded cards
- Cute warehouse illustrations
- Generic blue SaaS styling
- Animation that delays frequent operational work

## Color system

The references publish two useful palettes. StockLedger uses the olive palette from the primary reference and keeps the secondary reference's cobalt as a data-only color.

| Token | Value | Use |
| --- | --- | --- |
| Ink | `#11120F` | Primary text, navigation, buttons, dark charts |
| Forest | `#151710` | Alternate dark analytical panel |
| Canvas | `#F0F0EB` | App background |
| Surface | `#FFFFFF` | Tables, forms, and primary panels |
| Soft surface | `#FAFAF7` | Secondary panels and subtle separation |
| Border | `#D9DCD2` | Rules, input outlines, table dividers |
| Muted text | `#7A7E75` | Supporting copy and metadata |
| Olive | `#A2AA46` | Primary accent and selected states |
| Olive field | `#DCE38D` | Large highlighted KPI or brand field |
| Sand | `#CFCCB2` | Secondary chart series |
| Cobalt | `#6B93CB` | Data visualization only |
| Warning | `#D77918` | Low-stock warning |
| Danger | `#B74C36` | Damage, destructive actions, negative variance |

Use neutrals for most of the screen. Olive should explain priority, selection, or status. It is not decoration. Never place olive on every card.

All text and interactive states must meet WCAG AA contrast. Do not use olive for small text on a white background.

## Typography

StockLedger uses **Satoshi** for display and interface text. Its open proportions and low-contrast shapes match the references without copying their commercial typefaces.

| Role | Size | Weight | Tracking |
| --- | --- | --- | --- |
| Page title | `30–39px` | 500 | `-0.055em` |
| Login statement | `38–64px` | 500 | `-0.06em` |
| Panel title | `18px` | 500 | `-0.035em` |
| Body | `13–15px` | 400 | `-0.012em` |
| Label | `12–13px` | 500–600 | Normal |
| Eyebrow | `12px` | 700 | `0.1em` |
| Large number | `36–48px` | 300 | `-0.06em` |

Use sentence case. Reserve uppercase for short eyebrows and compact statuses. Numbers in tables and charts should use tabular figures.

### Login typography studies

The selected direction is image-led: one inset warehouse photograph, the brand at the top, and a short message at the bottom. Earlier text-led explorations were retired after this direction was selected.

## Layout and shape

- Desktop content width: `1450px` maximum
- Page padding: `24–52px`
- Panel radius: `16–18px`
- Control radius: `9–11px`
- Small icon control radius: `8–10px`
- Primary spacing rhythm: `8px`
- Panel border: one pixel, low contrast
- Shadows: none on normal panels; use one restrained shadow for floating navigation, toasts, or menus

Rounded corners should soften the industrial system, not turn every object into a pill. Pills belong to statuses, compact filters, and selected navigation only.

## Components

### Navigation

Use a white top bar. Inactive destinations are compact icon controls. The active destination expands into a black label. Keep the account block quiet and right-aligned. Clicking the avatar opens one compact menu for profile settings and sign out; do not place a separate sign-out icon beside it.

### Panels

Primary panels are white with a thin border. Analytical panels may connect into one near-black region. Do not stack multiple card treatments inside one panel unless the data requires a clear grouping.

### Buttons

- Primary: near-black fill, white text
- Secondary: white fill, quiet border, dark text
- Destructive: white or pale red background with a muted red icon
- Press state: `scale(0.97)` for 100–160ms

### Form controls

Inputs and selects share height, border, radius, and focus ring. A select uses one quiet chevron as a non-interactive indicator. The whole field is the target. Do not style the chevron as a separate button.

### Authentication

On desktop, use the split-screen login with an inset warehouse photograph on the left and the form on a light surface on the right. Place the brand at the top of the photograph and limit the bottom copy to one short headline and one supporting sentence. Add a dark gradient behind the copy for contrast. Do not place charts, metrics, testimonials, or floating cards over the image.

### Tables

Keep headers light and small. Use horizontal rules instead of boxed cells. Align numeric columns right and use color only for status or signed quantities.

## Data visualization

- Put dense charts on near-black backgrounds
- Use olive for the primary series
- Use sand, gray, and cobalt for supporting series
- Show direct labels where space allows
- Keep grid lines subtle
- Avoid gradients, neon colors, thick axes, and decorative animation
- Never invent data to make a screen look active

## Motion

Motion should confirm an action or explain a change.

- Hover and color changes: 140–180ms
- Buttons: subtle press scale, 100–160ms
- Menus and tooltips: 150–200ms with strong ease-out
- Page entrances: optional, no more than 8px of movement
- Respect `prefers-reduced-motion`

Do not animate controls used repeatedly with the keyboard. Do not use bounce in operational screens.

## Iconography

Use Lucide icons at `1.75–2px` stroke weight. Typical sizes are 16px for controls and 18px for navigation. Icons support labels; they do not replace unfamiliar actions.

StockLedger uses the custom Ledger Fold mark. Its continuous line forms three ledger rows and a subtle `S`, connecting stock movement with the product name without using a literal package.

## Logo direction

The logo needs to work at 16px in the navbar and as a one-color mark on reports, labels, and warehouse paperwork. It should feel constructed, flat, and exact. Avoid a literal parcel, warehouse roof, barcode, truck, speed arrow, or 3D cube. Those marks are common enough to make the product disappear into its category.

### Direction A: ledger fold, selected

Build a compact mark from three horizontal ledger rows. Offset or cut the rows so the negative space suggests an `S`, while one vertical edge suggests an `L`. The result should read first as a precise abstract symbol, then reveal the initials.

Why it fits: it joins inventory movement with the ledger concept and does not rely on warehouse clip art. It also echoes the horizontal rules used throughout the interface.

### Direction B: count grid

Use a four-cell inventory grid with one cell shifted or filled in olive. The changed cell represents an exception, movement, or item that needs attention. Keep the outside silhouette asymmetric so it does not resemble an app launcher icon.

Why it fits: the mark connects directly to stock positions and the dashboard's modular construction. It will remain clear at favicon size.

### Direction C: balance gate

Construct two opposing brackets around a central ledger line. The brackets stand for stock entering and leaving; the center line is the recorded balance. A subtle `S` can appear through the negative space.

Why it fits: it expresses the stock equation without using arrows or a package.

| Direction | Distinctive | Small-size clarity | Product meaning | Recommendation |
| --- | --- | --- | --- | --- |
| Ledger fold | High | High | Stock movement and ledger | Selected |
| Count grid | Medium-high | Very high | Positions and exceptions | Strong alternative |
| Balance gate | High | Medium | In, out, and balance | Explore after A |

### Wordmark

Set `StockLedger` in Satoshi Medium with custom spacing. Keep the two words joined and use one color. The symbol and wordmark should also work independently. Do not color `Stock` and `Ledger` differently.

### Logo colorways

1. Ink mark on white or canvas
2. White mark on ink
3. Ink mark on olive field

Use the mark without a container in the product interface. The olive rounded square is reserved for the favicon and other operating-system contexts that require a contained app icon.

### Construction tests

Before approving a mark, verify it at:

- 16px favicon
- 24px mobile header
- 36px desktop navigation
- One-color laser print
- White on black
- Black on olive

Reject any option that needs an outline, gradient, or tiny internal details to remain recognizable.

## Logo inspiration board

These references are useful for construction and restraint, not for copying:

- [VALMAX logistics identity](https://dribbble.com/shots/27220717-Logistics-Brand-Identity-Design): black, cream, acid green, and a bold geometric mark
- [Speedigo logistics identity](https://dribbble.com/shots/26904558-Brand-Identity-Design-for-Logistics-Startups): modular construction and a checkerboard `S`
- [MONO shipping and logistics identity](https://www.behance.net/gallery/247072447/MONO-Shipping-Logistics-Brand-Identity): typography, grid discipline, and generous negative space
- [NEXCUBE logistics identity](https://www.behance.net/gallery/246253373/NEXCUBE-Logistics-Brand-Identity): useful modular construction, though StockLedger should avoid its literal cube language

## Review checklist

- Does the screen still work in grayscale?
- Does accent color communicate something specific?
- Is the hierarchy clear without extra cards?
- Are numeric values easy to scan?
- Do controls have hover, focus, pressed, disabled, and error states?
- Is every animation under 300ms and tied to a purpose?
- Does the logo remain recognizable at 16px in one color?
- Could this design be mistaken for a generic AI-generated SaaS screen? If yes, remove the decorative device causing it.
