# Notifications, Workspace and General settings (F-SHELL-3, F-SHELL-4, F-SHELL-7, F-R13-4)

## Goal

One place for every notification of the app, a bell with its history, toasts in the window, OS notifications over
other apps when the window is not in front, and the Settings tabs that were still "Coming in a later release".

## Design

- `shared/notify.ts`: `Notice` (`kind` chat | cron | gateway | cost | test, title, body, `target`), `deliver(kind,
  settings, {inFront, minutes})` → `{record, desktop, sound}`, `inQuietHours` (local `HH:MM`, crossing midnight),
  `desktopBody` (no reply text without preview), `previewText` (one line, markdown marks dropped, 140 characters).
- `main/notify/center.ts` `NotificationCenter.push`: cleans and cuts texts (120/300), sends `mc:ev:notice` when
  recorded, shows an Electron `Notification` (`silent` from the sound switch) when allowed and keeps it referenced
  until closed; a click focuses the window and sends `mc:ev:notice-open` with the target. `test()` explains why
  nothing was shown (no OS support, desktop off, quiet hours).
- Sources: `CronWatcher` (failed run after the baseline), `GatewayWatcher` (healthy → failed; rule
  `alerts.gateway.enabled`), `CostAlertService` (once per local day), and chat replies: the renderer already knows
  when a reply finished while that agent was not on screen (`countIfAway`), so it calls `mc:notify:chat` with a
  title and a preview; main only accepts a profile name, a title and a body, and builds the target itself.
- Renderer: `stores/notices.ts` (newest 100, unread ids, at most 3 toasts, in memory only), `noticeActions.ts`
  (`openNoticeTarget`, `notifyChatReply`), `components/Notices.tsx` (`NoticeBell` popover: Esc and a click outside
  close it, opening marks all read, Clear; `Toasts` for 6 s, bottom right above the status bar and the terminal).
- Settings: `notify.desktop`, `notify.kinds`, `notify.preview`, `notify.sound`, `notify.quiet`, `app.launchAtLogin`
  (Windows/macOS, installed app only; the window opens in front at sign-in unless `app.startMinimized` is on), `app.startMinimized`, `app.tray`. `IpcDeps.onSetting` lets
  `index.ts` apply the tray and the login item at once.
- Workspace: the vault path (chosen and checked with the existing `VaultSetup`, removable), the Hermes home, `hermes`,
  python and version from the preflight (read only), and the upload folder with a link to Uploads.

## Not done

- Kanban hand-off and agent-offline notifications (no event stream for them yet).
- Export and import of settings, clearing caches beyond Reset settings and Clear snapshots.
- An update check (F-APP-6 auto-update is still open).

## Tests

`tests/unit/notify.test.ts` (quiet hours, deliver, texts, the center with a fake OS notification, the store) and
`tests/e2e/notifications.spec.ts` (Notifications, Workspace and General tabs; a reply that finishes on another
screen lands in the bell and opens the chat). Manual: checklist steps 143-147.
