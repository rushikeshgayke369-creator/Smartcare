# SmartCare review — findings and required changes

## Files reviewed
`staff-login.js`, `script.js`, `smartcare_setup.sql`, `staff.html`, `staff.js`, `config.js`, `index.html`, `staff.css`, `staff-login.css`, `staff-login.html`, and the supplied Supabase screenshot.

## Critical code change (included in this patch)
- **`staff-login.html`:** It loaded `staff-login.js` but did not load `config.js`. Since `staff-login.js` reads `window.SMARTCARE_CONFIG`, the login page can fail before login. Add `config.js` between the Supabase CDN script and `staff-login.js`. The patched HTML does this.
- **`staff-login.css`:** refreshed styling to match SmartCare's newer teal/clean visual language; no database change is needed for styling.

## Code changes to make/check
1. **`index.html` references `style.css`, but `style.css` was not included in the uploaded files.** Upload/check that file. Without it, the patient website will lose its main layout and visual styling. Do not rename `staff.css` to `style.css`: the staff stylesheet targets dashboard-specific classes and will not style the patient page correctly.
2. **`staff.html` loads `staff.css`, `config.js`, and `staff.js` in the right order.** `staff.js` and `staff-login.js` both configure Supabase with `sessionStorage`, so the staff session can be shared between those pages in the same tab.
3. Keep `config.js` as the single source for the Supabase URL and publishable key. Never put a `service_role`/secret key in browser JavaScript.
4. Test that the IDs used by `staff.js` still match `staff.html` after any HTML edits. The uploaded versions appear aligned.
5. In `script.js`, the public queue intentionally uses `get_public_queue()` (masked names), while staff uses authenticated direct reads of `patients`. Preserve this split; do not expose patient details through the public queue function.
6. The SQL defines queue statuses as `Waiting`, `Serving`, and `Completed`; keep these exact strings in code and database data.

## Database checks/changes to do in Supabase (not applied by this patch)
1. **Check role assignment in `public.profiles`.** The SQL promotes accounts that exist when the setup script first runs to `staff`, and new accounts default to `patient`. Verify the intended staff account:
   ```sql
   select u.email, p.role
   from auth.users u
   left join public.profiles p on p.id = u.id
   order by u.created_at desc;
   ```
   If a specific account should be staff, set it explicitly (replace the email):
   ```sql
   update public.profiles
   set role = 'staff'
   where id = (select id from auth.users where email = 'staff@example.com');
   ```
   Confirm exactly one row was updated. Do not make every new user a staff member.
2. **Legacy patient records:** the screenshot shows patient rows in `public.patients`; older rows may have `user_id = NULL` because they predate account linking. Those rows can still be visible to staff, but cannot appear in a patient's personal visit list unless safely linked to the correct authenticated user. Do not bulk-assign them without verifying identities.
3. **Run the SQL setup only after reviewing its effects.** It enables RLS and drops all existing policies on `public.patients`, then installs replacement policies. Back up/export first and confirm existing application flows before running it in production.
4. The setup SQL creates unique indexes for token and one `Serving` patient per department. If duplicates already exist, index creation can fail. Check/fix duplicate tokens and multiple `Serving` rows per department before rerunning the final index statements.
5. The SQL's `get_registered_count()` currently counts all rows, while the queue/dashboard may be limited to the last 24 hours. Decide whether the statistic should mean lifetime registrations or today's/recent registrations; if recent, change the SQL function to use the same time window.

## Recommended test order
1. Open `staff-login.html`; verify there are no console errors about `SMARTCARE_CONFIG`.
2. Sign in with a known staff account; confirm it redirects to `staff.html`.
3. Open `staff.html` directly while signed out; it should redirect to staff login.
4. Verify a patient account is denied staff access.
5. Test queue actions (Call Next, Complete, Skip), announcement publishing, and patient registration.
6. In a second browser/private window, confirm public queue only shows masked names and patient accounts cannot read other patients' private records.

## Important scope limitation
The supplied files do not include `style.css`, and I cannot inspect the live Supabase database from these files alone. Database recommendations above are checks to run, not claims that the live database has already been changed.
