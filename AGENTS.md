<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Scanning
- Every scan entry (waybill/carton/pallet/batch/order/domestic tracking) must normalize input with `normalizeScanCode` (client) and resolve it server-side via `resolveScanInput` / DB `scan_key`, never raw `.trim()` + exact match — scanners and staff introduce spaces, case and full-width differences.
