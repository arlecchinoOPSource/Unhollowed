# U-36 — Signing, updater and bundle identity strategy

Issue: [U-36 (#38)](https://github.com/arlecchinoOPSource/Unhollowed/issues/38). Date: 2026-11-10. Builds on the approved host identifier `com.arlecchino.unhlw` ([DATA-DECISIONS-U33.md](DATA-DECISIONS-U33.md)). Nothing here creates a certificate, key or account, and nothing claims that signing or updates work: U-29 must verify that.

## Where the apps stand today

- **No updater.** None of the three apps depends on `tauri-plugin-updater`; users download new installers from GitHub Releases.
- **macOS:** Terminal's `release.yml` already signs with a Developer ID and notarizes **when** six Apple secrets exist (`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`); without them it builds an ad-hoc signed app, not notarized. Ember and Swish release builds are ad-hoc signed. The shipped releases are not notarized.
- **Windows:** installers are unsigned. Terminal's release notes say a signing provider is not chosen; Azure Trusted Signing was the noted candidate.
- **Targets today:** Terminal and Ember build `app`, `dmg`, `nsis` and `msi` (universal macOS); Swish's config lists `app` and `nsis`. Terminal uses a per-user NSIS install and embeds the WebView2 bootstrapper.

## Facts from current official sources

- **Tauri updater:** needs its own keypair (`tauri signer generate`), a public key embedded in the app config, and signed update artifacts; the signature requirement cannot be disabled. Endpoints can be a static `latest.json` on GitHub Releases or a dynamic server. **Losing the private key means installed copies can never receive another update.** ([Tauri updater](https://v2.tauri.app/plugin/updater/))
- **macOS:** distribution outside the App Store needs a **Developer ID Application** certificate, created by the Apple Developer account holder, plus notarization. The Apple Developer Program is 99 USD per year; a free account cannot notarize. Ad-hoc signing (`-`) does not stop macOS asking users to approve the app. ([Tauri macOS signing](https://v2.tauri.app/distribute/sign/macos/))
- **Windows:** unsigned apps run but trigger SmartScreen, and Smart App Control on Windows 11 can block them. Since 2024 EV and OV certificates build SmartScreen reputation the same way. Tauri supports Azure Artifact Signing and Azure Key Vault through `signCommand`. ([Tauri Windows signing](https://v2.tauri.app/distribute/sign/windows/))
- **Azure Artifact Signing (formerly Trusted Signing):** a search found a Basic tier of 9.99 USD per month and general availability in the USA, Canada and Europe as of January 2026, but **no clear 2026 rule on whether individuals qualify**; one report says organizations with a verifiable multi-year history only. Treat price and eligibility as unverified until checked on Microsoft's current pages. ([pricing](https://azure.microsoft.com/pricing/details/trusted-signing/), [January 2026 article](https://devclass.com/2026/01/14/code-signing-windows-apps-may-be-easier-and-more-secure-with-new-azure-artifact-service/))
- Industry rules since mid-2023 require Windows code-signing private keys to be held on hardware or a cloud signing service. This is general knowledge, not from the pages above; confirm with whichever issuer is chosen.

## Decisions (recommended, pending product-owner approval)

1. **No in-app updater for 1.0.** Users download new installers from GitHub Releases. Reasons: it keeps the "no network at runtime" promise of the three apps and of `PRODUCT.md`, adds no key whose loss strands users, and matches how the standalone apps ship. **Consequence:** an installed 1.0 can never self-update later, so a future updater requires users to install a newer build manually once. The alternative is a **user-initiated** update check backed by a static `latest.json` on GitHub Releases with the updater plugin and public key shipped in 1.0; this needs your approval because it adds a network request and a signing key from the start.
2. **macOS: Developer ID signing and notarization for 1.0**, reusing Terminal's workflow pattern (secrets present means sign and notarize; absent means ad-hoc and a clearly worded notice). It requires the owner to hold an Apple Developer Program membership. Without it, 1.0 ships ad-hoc signed and the docs say so.
3. **Windows: attempt Azure Artifact Signing first**, via `bundle.windows.signCommand` and `artifact-signing-cli`; if the owner does not qualify or does not want the cost, ship **unsigned with honest SmartScreen wording**. Do not buy a certificate before eligibility is checked. Re-evaluate once Microsoft's current individual-developer rules are confirmed.
4. **Bundle identity and targets:** identifier `com.arlecchino.unhlw`; product name chosen with the brand (not decided here); macOS universal `app` + `dmg`, minimum 11.0 like the apps; Windows NSIS per-user install (`currentUser`), WebView2 `embedBootstrapper` like Terminal; MSI optional for managed installs, as Terminal and Ember provide. The host installs beside the standalone apps and does not replace them.
5. **Uninstall must not delete module data.** Module folders (`com.arlecchino.terminal`, `.ember`, `.swish`) are shared with the standalone apps. The host's NSIS "delete app data" option may only touch the host's own folder (`com.arlecchino.unhlw`).
6. **Key and secret custody:** the owner holds every credential; secrets live only in GitHub Actions secrets (or an Actions environment with a required reviewer); nothing is committed, printed or pasted into issues. Release builds run only from a tag the owner approves. Record a rotation and revocation note per credential when it is created.
7. **Honest wording:** README, release notes and installer pages state the actual signing, notarization and update status of each build; nothing says signed or auto-updating until U-29 verifies it.

## Owner actions required (none done here)

- Decide the updater question (item 1).
- Decide whether to join the Apple Developer Program (99 USD per year) and act as account holder for the Developer ID certificate (item 2).
- Check Azure Artifact Signing eligibility and cost for your situation, or choose unsigned for 1.0 (item 3).
- Choose the product name and approve bundle targets (item 4).

## What U-29 must verify (not verified now)

- macOS: `codesign --verify --deep --strict`, `spctl --assess`, `xcrun stapler validate`, first launch on a clean Mac, and the notarization log.
- Windows: `signtool verify`, install, upgrade and uninstall on a clean machine, SmartScreen behavior.
- Upgrade over a previous UNHLW build and installation beside each standalone app, with module data intact.
- If an updater is chosen: signature verification, a failed-update path, and key custody.

## Not verified

- Current Azure Artifact Signing eligibility and price for an individual; the pricing figure comes from a search snippet.
- Windows hardware-key requirement details for the chosen issuer.
- Apple account status, any existing certificates, and whether Terminal's workflow has ever run with real secrets.
