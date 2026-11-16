import SwiftUI

/// 关于: the settings' page about Dudu itself (owner, 2026-11-12). The logo, the name and the product's one line,
/// set as the connection guide sets them; the page has the settings' own chrome.
struct AboutView: View {
    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                DuduLogo(size: 76)

                VStack(spacing: 12) {
                    Text("Dudu")
                        .font(.system(size: 29, weight: .medium))
                        .tracking(-0.7)
                        .foregroundStyle(DSBotStyle.ink)
                    Text(AppInfo.tagline)
                        .font(.system(size: 14))
                        .foregroundStyle(DSBotStyle.muted)
                        .multilineTextAlignment(.center)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 24)
            .padding(.top, 72)
            .padding(.bottom, 30)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("about.header")
        }
        .background(DSBotStyle.settingsBackground.ignoresSafeArea())
        .navigationBarBackButtonHidden(false)
        .toolbarRole(.editor)
        .tint(DSBotStyle.ink)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .toolbarBackground(DSBotStyle.settingsBackground, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarColorScheme(.light, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text(L10n.text("关于"))
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(DSBotStyle.ink)
                    .lineLimit(1)
            }
        }
    }
}
