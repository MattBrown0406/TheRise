// UNCOMPILED. Written for the watchOS 10 SDK in Swift 5 mode; see
// docs/watch-app.md.

import CoreLocation
import Foundation

struct RiseCoordinate: Equatable {
    var lat: Double
    var lon: Double
}

/// One location fix for "Which water am I on?", and nothing else. The fix is
/// handed back to the caller, compared with the pack's waters and dropped:
/// it is never stored, never put on a catch and never sent to the iPhone.
@MainActor
final class RiseWatchLocator: NSObject, CLLocationManagerDelegate {
    private static let timeoutNanoseconds: UInt64 = 20_000_000_000

    private let manager = CLLocationManager()
    private var waiting: [CheckedContinuation<RiseCoordinate?, Never>] = []
    private var timeoutTask: Task<Void, Never>?

    override init() {
        super.init()
        manager.delegate = self
        // Two miles is the match radius; a hundred metres is plenty and
        // settles faster on a wrist.
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    func currentLocation() async -> RiseCoordinate? {
        switch manager.authorizationStatus {
        case .denied, .restricted:
            return nil
        default:
            break
        }
        return await withCheckedContinuation { continuation in
            waiting.append(continuation)
            guard waiting.count == 1 else { return }
            if manager.authorizationStatus == .notDetermined {
                // The answer arrives in locationManagerDidChangeAuthorization.
                manager.requestWhenInUseAuthorization()
            } else {
                manager.requestLocation()
            }
            timeoutTask = Task { [weak self] in
                try? await Task.sleep(nanoseconds: Self.timeoutNanoseconds)
                guard !Task.isCancelled else { return }
                self?.finish(nil)
            }
        }
    }

    private func finish(_ coordinate: RiseCoordinate?) {
        timeoutTask?.cancel()
        timeoutTask = nil
        let pending = waiting
        waiting = []
        pending.forEach { $0.resume(returning: coordinate) }
    }

    private func authorizationChanged(_ status: CLAuthorizationStatus) {
        guard !waiting.isEmpty else { return }
        switch status {
        case .authorizedWhenInUse, .authorizedAlways:
            manager.requestLocation()
        case .denied, .restricted:
            finish(nil)
        default:
            break
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let coordinate = locations.last.map { RiseCoordinate(lat: $0.coordinate.latitude, lon: $0.coordinate.longitude) }
        Task { @MainActor [weak self] in
            self?.finish(coordinate)
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor [weak self] in
            self?.finish(nil)
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor [weak self] in
            self?.authorizationChanged(status)
        }
    }
}
