import SwiftUI

/// The system owns the tab items, badges, glass selection and press/drag interaction.
/// A chosen tab shows its own drawing inverted, not another one (owner, 2026-11-21, `.local/designs/tab-selected-2026-11-21/` look E): the closed shape black, the lines inside it white
/// (`scripts/render-tab-icons.mjs` writes `Home-{Inbox,Tasks,Settings}Selected`); the board keeps its coloured dial.
/// Each destination keeps its existing content and neutral control tint.
struct HomeTabs<Board: View, Inbox: View, Tasks: View, Settings: View>: View {
    @Binding var selection: HomeTab
    let boardUnread: Int
    let inboxUnread: Int
    let hidesBar: Bool
    @ViewBuilder var board: () -> Board
    @ViewBuilder var inbox: () -> Inbox
    @ViewBuilder var tasks: () -> Tasks
    @ViewBuilder var settings: () -> Settings

    var body: some View {
        TabView(selection: $selection) {
            Tab(value: HomeTab.board) {
                page(board())
            } label: {
                tabLabel(.board, outline: .issueStatus,
                         filled: Image("Home-BoardSelected"), renderingMode: .original)
            }
            .badge(boardUnread)

            Tab(value: HomeTab.inbox) {
                page(inbox())
            } label: {
                tabLabel(.inbox, outline: .inbox, filled: Image("Home-InboxSelected"), renderingMode: .original)
            }
            .badge(inboxUnread)

            Tab(value: HomeTab.tasks) {
                page(tasks())
            } label: {
                tabLabel(.tasks, outline: .schedule, filled: Image("Home-TasksSelected"), renderingMode: .original)
            }

            Tab(value: HomeTab.settings) {
                page(settings())
            } label: {
                tabLabel(.settings, outline: .settings, filled: Image("Home-SettingsSelected"), renderingMode: .original)
            }
        }
        .tabViewStyle(.tabBarOnly)
        .tint(DuduStyle.ink)
    }

    private func tabLabel(_ tab: HomeTab, outline: DuduGlyph, filled: Image,
                          renderingMode: Image.TemplateRenderingMode = .template) -> DuduLabel {
        if selection == tab {
            return DuduLabel(tab.title, image: filled, renderingMode: renderingMode)
        }
        return DuduLabel(tab.title, icon: outline)
    }

    @ViewBuilder
    private func page<Content: View>(_ content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content
                .tint(DuduStyle.ink)
                .toolbar(hidesBar ? .hidden : .automatic, for: .tabBar)
                .scrollEdgeEffectHidden(true, for: .bottom)
        } else {
            content
                .tint(DuduStyle.ink)
                .toolbar(hidesBar ? .hidden : .automatic, for: .tabBar)
        }
    }
}

extension View {
    /// A page pushed over a tab root takes the tab bar with it, in step with the push and the pop, because the page itself says so: the root used to hide the bar once it had
    /// disappeared, so the bar went late and came back with a jump (owner, 2026-11-21: "延迟消失…猛然出现…非常的吓人"). `.automatic` on the roots leaves this to the pushed page.
    func hidesTabBarWhenPushed() -> some View {
        toolbar(.hidden, for: .tabBar)
    }
}
