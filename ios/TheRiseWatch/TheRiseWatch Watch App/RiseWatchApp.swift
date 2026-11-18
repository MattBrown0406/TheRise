// UNCOMPILED. Written for the watchOS 10 SDK in Swift 5 mode; no toolchain
// has checked it. Not in project.pbxproj - docs/watch-app.md has the Xcode
// steps that create the Watch target and add these files to it.

import SwiftUI

@main
struct RiseWatchApp: App {
    @StateObject private var model = RiseWatchModel()

    var body: some Scene {
        WindowGroup {
            RiseRootView()
                .environmentObject(model)
        }
    }
}

/// The waters list once a trip pack has arrived, the empty state before.
struct RiseRootView: View {
    @EnvironmentObject private var model: RiseWatchModel
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        NavigationStack(path: $model.path) {
            if let pack = model.pack {
                RiseWatersListView(pack: pack)
            } else {
                RiseEmptyPackView()
            }
        }
        .onAppear {
            model.start()
        }
        .onChange(of: scenePhase) { _, phase in
            model.scenePhaseChanged(phase)
        }
    }
}
