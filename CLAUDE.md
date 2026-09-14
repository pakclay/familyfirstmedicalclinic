@AGENTS.md

## UI conventions

The design authority is `SPEC.md` §9 (screens per role, mobile-first, 360px target,
consultation screen and queue board one-handed) and §11 ("clean and legible over
decorative — large tap targets, high contrast, readable at arm's length on the
display screen"). UI decisions already made are in `DECISIONS.md`; read the
relevant entry before redesigning something.

- **Stack:** Tailwind v4 + shadcn (`radix-nova` style, see `components.json`),
  `lucide-react` icons, `next-themes` with the `.dark` class, `sonner` toasts,
  `react-hook-form` + `zod` through `components/ui/form.tsx`, `recharts` charts.
- **Reuse before adding.** Check `components/ui` first; add a missing primitive
  with `npx shadcn add <name>`, don't hand-roll one.
- **Color comes only from the tokens in `app/globals.css`** (`brand`, `marigold`,
  `priority`, `signal`, `sidebar-*`, and the shadcn set). Add a token there
  rather than a hex value in a component. `priority` is red and `marigold` is
  the accent; they must never be mistaken for each other.
- **Navigation** is the shared `components/nav/app-header.tsx` for the staff,
  doctor and console shells; items per role come from `lib/nav.ts`. Below `sm`
  the links live in a slide-over drawer (Escape closes, focus returns to the
  trigger). Change the menu there, not per shell.
- **Every screen must work at 360px wide and in dark mode.** Fixed
  `grid-cols-N` gets a responsive breakpoint; wide data tables scroll inside
  their own `overflow-x-auto` wrapper rather than shrinking columns.
- `/display/[slug]` is a room-scale TV view with large fixed digits, not a phone
  screen, and never shows patient names.
- **Verify visually before reporting done:** open the preview and screenshot the
  changed screen at 375px and 1280px, in light and dark.
