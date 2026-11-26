---
name: ui-ux-performance
description: >-
  Supplier Portal UI/UX and performance. Use for supplier/staff pages, forms,
  redirects and flash messages, dialogs, mobile layout, accessibility, motion,
  brand styling, supplier-minimal UX, or bundle/performance work. Preserve
  Electric Green, Brilliant Black, and White; keep supplier UX mobile-first with
  reduced-motion support.
---

# UI/UX and performance

## Canonical references

- Brand and interaction patterns in `src/app/**` and `src/components/**`
- Reserve vs deadline copy: [docs/supplier-requests-availability.md](../../../docs/supplier-requests-availability.md)
- Orders UI notes: [docs/orders-allocation.md](../../../docs/orders-allocation.md)
- Domain role split: `supplier-portal-architecture`
- Prefer existing UI primitives (`button`, `badge`, etc.) over new dependencies

## Permanent product principle

**Supplier does the minimum. Company handles the complexity.**

Supplier-facing UX must:

- Require as few clicks and fields as practical.
- Be mobile-first and easy to understand.
- Show one obvious next action.
- Use plain language instead of technical statuses.
- Avoid unnecessary confirmation dialogs (keep only workflow-required confirms).
- Keep optional or advanced controls secondary.
- Prefer simple cards and accessible controls.
- Preserve autosave and **draft vs final submission** distinctions — never imply a draft was submitted.
- Never require suppliers to confirm physical goods receipt.
- Leave receipt verification and GRN issuance to authorized company users.

Business validation and audit requirements must remain intact. UI work must not silently change domain behavior.

## Brand system (approved)

| Token | Use |
|------|-----|
| Brilliant Black `#050505` | Background / base |
| Electric Green `#39FF14` | Primary accent |
| White `#FFFFFF` | Primary text / high contrast |

Do not replace with purple gradients, cream/serif defaults, or unrelated theme packs.

## UX hard rules

1. **Mobile-first** supplier flows; touch targets ~`min-h-11`.
2. **Accessible** controls: labels, `role="alert"` / `role="status"`, dialog labeling, disabled+`aria-busy` while pending.
3. **Reduced motion:** avoid mandatory motion; use existing subtle enter classes sparingly; respect `motion-reduce` where animations exist.
4. Pending actions **disable** submit controls to prevent duplicate submissions.
5. Successful final submit may redirect + flash; **validation failures stay on the form**.
6. Reserve UI: label as active only when reserve is **live** (`SUBMITTED` and `reserveExpiresAt` in the future). Never equate reserve expiry with response deadline.
7. Keep animations subtle and performant; avoid heavy icon libraries unless already justified.

## Mobile browser consistency

Mobile usability is a primary requirement. Supplier screens must look and behave consistently in responsive previews and on real Android and iPhone browsers.

- Use responsive CSS and existing design tokens for consistent layout, spacing, readable typography, compact navigation, and touch-friendly controls. Prevent horizontal overflow and keep primary buttons in predictable positions with clear feedback.
- Verify viewport configuration and account for device safe areas where needed. Keep focused fields, validation messages, and primary actions reachable when the virtual keyboard is open. Check that fixed or sticky elements do not cover them.
- Request native numeric or decimal keyboards as appropriate for quantity and price inputs. Document OS and browser differences in keyboards and date pickers and let those native controls behave normally.
- Prefer a shared responsive UI. Use device-specific variants only when necessary.

### Mobile validation

- Test responsive layouts at 320px, 360px, 375px, 390px, and 430px, plus tablet and desktop widths.
- For significant supplier-facing changes, also test real Android Chrome and iPhone Safari when devices are available. Report the OS, browser, and any native differences observed. Record unavailable device checks as unverified. Browser emulation verifies responsive layout and cannot establish a real-device pass.

## Supplier UX review checklist

Before shipping supplier UI changes, ask:

1. Can this action be completed with fewer steps?
2. Can the supplier understand the next action immediately?
3. Is unnecessary business complexity exposed?
4. Does this pass the mobile validation above, including keyboard-open form checks where applicable?
5. Are draft and final submission meanings clear?

## Performance

- Prefer server components by default; client only for interactive forms.
- Measure before adding memoization or new client deps.
- Do not ship unused UI packages.

## Related skills

- Domain copy/rules → `supplier-portal-architecture`
- Auth-gated pages → `auth-supplier-isolation`
- QA → `feature-dev-qa`
