import SwiftUI

struct DuduLogo: View {
    var size: CGFloat = 32

    var body: some View {
        Image("DuduLogo")
            .renderingMode(.template)
            .resizable()
            .interpolation(.high)
            .scaledToFit()
            .frame(width: size, height: size)
            .foregroundStyle(DuduStyle.blue)
            .accessibilityHidden(true)
    }
}
