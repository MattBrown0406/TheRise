import Foundation

enum SubscriptionConfig {
    enum RevenueCat {
        // Must match the existing RevenueCat entitlement identifier exactly.
        static let proEntitlementIdentifier = "The Rise Pro"

        static let defaultOfferingIdentifier = "default"
        static let monthlyProductIdentifier = "therise_pro_monthly"
        static let annualProductIdentifier = "therise_pro_annual"
    }
}
