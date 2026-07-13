import Foundation

enum SubscriptionConfig {
    enum RevenueCat {
        // This is the public RevenueCat iOS SDK key. It is safe to ship in the app.
        static let publicSDKKey = "appl_YAECBJOyyQIEdBDCINpscWRhmWL"

        // Must match the existing RevenueCat entitlement identifier exactly.
        static let proEntitlementIdentifier = "The Rise Pro"

        static let defaultOfferingIdentifier = "default"
        static let monthlyPackageIdentifier = "$rc_monthly"
        static let annualPackageIdentifier = "$rc_annual"
        static let monthlyProductIdentifier = "therise_pro_monthly"
        static let annualProductIdentifier = "therise_pro_annual"
    }
}
