# React / Frontend Rules

Read together with `typescript.md`.

- Functional components only; no `FC` type, no `IOwnProps`
- Named exports only; absolute imports; proper import sorting
- `useNotification` for notifications, `useTranslation` for i18n
- No direct DOM manipulation — use refs or state
- Memoization (`useMemo`, `useCallback`) used appropriately, not excessively
- Accessibility basics (semantic HTML, alt text, keyboard navigation)
