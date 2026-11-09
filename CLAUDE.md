# StockLedger

## UI rules

- Use components from `apps/web/src/components/ui` (shadcn/ui on Base UI). Add missing ones with the shadcn CLI (see `apps/web/UI.md`).
- Do not hand-style raw `<button>`, `<input>` or `<table>`; use `Button`, `Input`, `Checkbox`, etc.
- New UI uses Tailwind utilities and the design tokens (`bg-primary`, `text-muted-foreground`, `border-border`...). Do not add new global classes to `src/styles.css`.
- Migrate one screen at a time and delete that screen's old CSS from `styles.css` in the same change.
- Do not import Tailwind preflight; legacy pages depend on `styles.css` as-is.
