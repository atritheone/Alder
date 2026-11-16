# Working on Alder without desktop windows

Use backend and unit tests first. Run only checks relevant to the change. For
renderer layout, interaction, native-menu dispatch and PDF checks, launch an
isolated Electron instance with `--headless-test`, a temporary `--user-data-dir`
and a separate temporary `ALDER_DATA_DIR`. Keep Electron's sandbox enabled.

The headless entry point requires explicit, separate absolute profile/data paths
and rejects the normal Alder locations (including filesystem aliases) before
requesting a single-instance lock. A malformed test launch therefore cannot
activate the ordinary Alder instance. Use a fresh temporary root for each run.

`electron/hiddenTests.ts` prevents activation, showing, maximizing or fullscreen
operations from revealing test windows, including print-proof windows. Tests
cannot open DevTools, an external browser, application or file-manager window. Native
file and message dialogs fail with a descriptive error unless the test supplies
a response through Playwright's Electron main-process API. Startup errors go to
the test log. Production launches retain their normal behaviour.

The renderer still runs real Chromium layout, ProseMirror, pagination and input.
Playwright can inspect DOM geometry, dispatch input, capture screenshots and
invoke native menu commands while the window remains hidden. Element focus in
the renderer is distinct from activating a desktop window. Do not use visible
launches, OS mouse/keyboard automation or the user's existing Alder session.

`scripts/test-authoring-controls-desktop.mjs` is a reference harness. It checks
that attempts to show or maximize the window remain hidden and that an
unexpected native Open dialog is blocked. Use the existing managed developer
resources when the test requires the backend; do not install into user data.

Always close fixture instances in `finally` with
`closeTestDesktop(app, fixtureDataDirectory)`. It verifies the test flag and
matching data directory, intercepts only the exact save-before-closing prompt,
then uses Alder's normal shutdown path to discard the test fixture. It does not
send OS clicks, disable production save prompts or terminate a user's session.
For other native dialogs, stub only the expected dialog and return fixture
paths or deliberate cancellation; never accept arbitrary dialogs.

Hidden checks cannot establish how a visible native window looks on other
operating systems, or qualify Word's own application behaviour. Record those
as outstanding rather than claiming they passed. UI artefacts can be reviewed
as saved screenshots without putting Alder on the desktop.
