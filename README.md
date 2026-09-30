# Private, editable homepage

GitHub Pages serves only the login UI and application code. The original `style.css` is unchanged. Homepage text lives in the isolated `ttd_pages` table in the connected Supabase project, not in this repository. Existing research-workbench tables are not modified.

## Use

Sign in with the existing account bound to the homepage (the password is unchanged). No registration or public read fallback is offered. Choose **编辑内容** and click text to edit Chinese/original text and English. Choose **新增内容** for paragraphs, publications by year, courses, reviewer records, cards, or new sections. New sections are added to navigation. **保存并同步** saves to the cloud; other signed-in devices refresh automatically or via **刷新**. Version checks prevent concurrent edits from silently overwriting each other. Network/translation errors keep the editor open.

## English updates

Changed Chinese is translated on save; English citations, numbers, and DOI strings are not independently translated. Manually revised English takes precedence. Compatible desktop browsers can enable their built-in Translator API. Other browsers, including phones, need a cloud translation key configured once in **翻译设置**. Choose DeepSeek or OpenAI and enter that provider's API key there, not in GitHub or chat. Translation sends the edited text to that provider and may incur its normal API charges. No provider key is preconfigured. A failed translation never silently leaves old English presented as current: the explicit original-only fallback marks English as pending. Existing saved English remains available without any translation subscription.

## Security and deployment

- `config.js` contains only a publishable connection key. No service-role or provider secret belongs in frontend code.
- `ttd_pages`: RLS owner-only SELECT and UPDATE; browser column grants permit only title/body updates. INSERT, DELETE, owner transfer, and direct version changes are not permitted. The version/timestamp trigger is SECURITY INVOKER.
- `ttd_translation_credentials`: RLS enabled, no browser grants or policies. The Edge Function encrypts provider keys with AES-GCM, authenticates via the live Auth user endpoint, and checks ownership via the caller's RLS-scoped query before any service-role access. Status responses never return keys or ciphertext.
- The Edge Function is deployed with gateway `verify_jwt=false` because it performs its own live user and ownership verification, including for asymmetric access tokens. This is not an unauthenticated endpoint. Do not remove those checks.
- The function uses built-in Supabase environment secrets. Optional `TTD_ENCRYPTION_KEY` can provide a dedicated encryption secret. When using the fallback, rotating the service-role key requires entering the provider key again. Do not change the encryption secret without migrating stored keys.
- The browser keeps its authentication session, but not the homepage body, in localStorage. Logout clears page/editor contents and invalidates the local session. Saved HTML passes an allowlist sanitizer; scripts, event attributes, embedded resources, and unsafe links are excluded.
- Static assets use relative paths compatible with `/ttd/`. Existing sharing/QR and visitor-counter behavior is retained after login. Shared URLs never grant authorization or contain a token.
- No private seed, account password, or homepage backup is included in this repository. Do not add such files in future commits.

**Historical visibility:** this repository was public before migration. Removing text from the current site does not remove earlier commits, caches, forks, or copies. This update does not rewrite Git history or change repository visibility. New cloud edits are not written to GitHub history.

## Verification

`node --check app.js`, `node --check cloud.js`, `node --check editor.js` and `node --test tests/translation.test.mjs` require Node.js 22+. The Edge tests use synthetic mocked services, not live account passwords or billable translation calls. Separate local Chromium DOM checks cover editing, multiline project pairs, year-group insertion, translation fallback, save conflicts, logout clearing, and mobile dialogs. Those checks mock network/storage; they are not a claim of live password-login or paid-provider verification. Database-role tests were run against the live isolated tables in a rollback-only transaction.
