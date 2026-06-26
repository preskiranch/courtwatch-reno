# Court Watch AAU iOS App Store Prep

This repo now includes a Capacitor iOS shell for Court Watch AAU.

The native app opens the production website:

```text
https://www.courtwatchaau.com
```

That means tournament fixes, data-sync improvements, and UI changes can keep shipping through the existing Render deployment without waiting for Apple review every time.

## Native App Settings

- App name: `Court Watch AAU`
- Bundle ID: `com.preskiranch.courtwatchaau`
- Version: `1.0`
- Build: `1`
- iOS project: `ios/App/App.xcodeproj`
- Live URL: `https://www.courtwatchaau.com`

## Local Commands

```bash
npm ci
npm run ios:icons
npm run ios:sync
npm run ios:open
```

`npm run ios:open` opens the native project in Xcode.

## Apple Developer Setup

1. Enroll in the Apple Developer Program.
2. Install full Xcode from the Mac App Store.
3. Point command-line tools at full Xcode:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
xcodebuild -version
```

4. Open `ios/App/App.xcodeproj` in Xcode.
5. Select the `App` project, then the `App` target.
6. In `Signing & Capabilities`, select the Preski Ranch LLC Apple Developer Team.
7. Keep the bundle identifier as `com.preskiranch.courtwatchaau`.
8. Let Xcode create the signing certificate and provisioning profile automatically.
9. Run on a real iPhone first.
10. Archive from Xcode with `Product > Archive`.
11. Use Organizer to upload the archive to App Store Connect.
12. Send the first build to TestFlight before submitting to the App Store.

The current Mac has Command Line Tools selected at `/Library/Developer/CommandLineTools`; native builds need full Xcode selected before `xcodebuild` will work.

## App Store Connect Checklist

- Create a new app named `Court Watch AAU`.
- Platform: iOS.
- Bundle ID: `com.preskiranch.courtwatchaau`.
- SKU: `courtwatch-aau-ios`.
- Primary category: Sports.
- Secondary category: Utilities.
- Age rating: likely 4+, because the app does not include user-generated social content or direct messaging.
- Privacy Policy URL: `https://www.courtwatchaau.com/privacy`.
- Support URL: `https://www.courtwatchaau.com/support`.
- Marketing URL: `https://www.courtwatchaau.com`.

## Review Notes

Suggested review note:

```text
Court Watch AAU is an independent youth basketball tournament companion app. It helps parents, coaches, and fans follow registered teams across supported tournament sources, view schedules, courts, locations, records, final placements, and alerts.

No login is required to use the app. A free account is optional for syncing followed teams across devices.

The app is not affiliated with tournament operators. Official schedules and rulings come from tournament staff.
```

## App Review Risk

Apple's App Review Guideline 4.2 says apps should provide useful, app-like functionality beyond a repackaged website. This native shell is enough to start TestFlight, but App Store approval is stronger if we add native-only value later, such as:

- Native APNs push notifications for followed-team game updates.
- Native saved-team storage bridge.
- Native share sheets for generated result graphics.
- Native deep links into specific tournaments, teams, courts, and final-result cards.

For the first submission, emphasize the app's live tournament utility, installable phone-first design, optional account sync, followed-team workflow, alerts, and official-source links.

## Push Notifications

The website already supports browser push and audible browser alerts where the browser allows it. A true App Store build should eventually add APNs-based native push notifications because iOS WebView apps do not behave exactly like Safari home-screen PWAs.

Do not remove the current web push system. Add native push as a second channel when Apple Developer credentials, APNs capability, and production certificates are ready.

## Release Flow

Normal web updates:

```bash
git push
# Render deploys the website/API/worker.
```

iOS shell updates:

```bash
npm run ios:sync
npm run ios:open
# Archive and upload from Xcode.
```

Only submit a new iOS build when native shell behavior, icons, bundle metadata, or native plugins change.
