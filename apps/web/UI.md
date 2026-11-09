# StockLedger web UI foundation

New UI is built with **shadcn/ui on Base UI** and **Tailwind CSS v4**. Legacy pages still use the global `src/styles.css` and are migrated one screen at a time.

## How it is wired

- `src/tailwind.css` is imported before `styles.css` in `main.tsx`. It imports only Tailwind's `theme` and `utilities` layers. **Preflight is deliberately not imported**, so legacy pages do not change. A small scoped base (`[data-slot]` border/button reset) stands in for preflight for shadcn parts only.
- Tailwind layers lose to unlayered CSS, so `styles.css` always wins on legacy markup.
- Design tokens are mapped in `@theme inline` in `src/tailwind.css`: shadcn names (`background`, `primary`, `border`, `ring`, `sidebar-*`...) point at the existing custom properties in `styles.css` (`--canvas`, `--violet`, `--border`...). Do not redefine those properties; change the mapping instead. Note legacy `--muted` is a text colour, so `bg-muted` maps to a separate surface colour and `text-muted-foreground` to `--muted`.
- `@/` aliases `src/`. `components.json` configures the shadcn CLI (`base-nova`, Base UI).

## Adding components

```
cd apps/web && npx shadcn@4.23.0 add <component>
```

Components land in `src/components/ui`. Existing hand-written files there (`select-control`, `date-picker`, ...) are kept; do not overwrite them. After adding, fix any `import { cn } from "cn"` to `@/lib/utils`.

## Navigation layout

`src/components/app-shell.tsx` + `app-nav.tsx`. The sidebar (expanded) is the default; users can pick Header in the account menu and that explicit choice is kept. The choice and the sidebar collapsed state live in `localStorage` (`src/lib/nav-layout.ts`, keys `stockledger.nav-layout.v1`, `stockledger.nav-collapsed.v1`), per device. No user-preferences API exists; moving this to the server would need an API change. Below 768px both layouts use one top bar plus a Sheet.
