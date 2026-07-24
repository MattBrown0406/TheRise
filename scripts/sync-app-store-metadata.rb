#!/usr/bin/env ruby
# frozen_string_literal: true

require "base64"
require "json"
require "net/http"
require "openssl"
require "optparse"
require "uri"

ROOT = File.expand_path("..", __dir__)
METADATA_ROOT = File.join(ROOT, "app-store-metadata")
MANIFEST_PATH = File.join(METADATA_ROOT, "subscriptions.json")
DESCRIPTION_PATH = File.join(METADATA_ROOT, "en-US", "description.txt")
REVIEW_NOTES_PATH = File.join(METADATA_ROOT, "en-US", "review-notes.txt")
PRIVACY_URL_PATH = File.join(METADATA_ROOT, "en-US", "privacy-url.txt")
API_BASE = "https://api.appstoreconnect.apple.com"

options = { apply: false, version: "1.0" }
OptionParser.new do |parser|
  parser.banner = "Usage: sync-app-store-metadata.rb [--apply] [--version 1.0]"
  parser.on("--apply", "Write the versioned metadata to App Store Connect") { options[:apply] = true }
  parser.on("--version VERSION", "App Store marketing version (default: 1.0)") { |value| options[:version] = value }
end.parse!

class AppStoreConnectClient
  def initialize(key_id:, issuer_id:, key_path:)
    @key_id = key_id
    @issuer_id = issuer_id
    @private_key = OpenSSL::PKey::EC.new(File.read(key_path))
  end

  def get(path)
    request(:get, path)
  end

  def post(path, body)
    request(:post, path, body)
  end

  def patch(path, body)
    request(:patch, path, body)
  end

  private

  def base64url(value)
    Base64.urlsafe_encode64(value, padding: false)
  end

  def token
    header = base64url(JSON.generate(alg: "ES256", kid: @key_id, typ: "JWT"))
    payload = base64url(JSON.generate(
      iss: @issuer_id,
      iat: Time.now.to_i - 5,
      exp: Time.now.to_i + 600,
      aud: "appstoreconnect-v1"
    ))
    signing_input = "#{header}.#{payload}"
    digest = OpenSSL::Digest::SHA256.digest(signing_input)
    der_signature = @private_key.dsa_sign_asn1(digest)
    integers = OpenSSL::ASN1.decode(der_signature).value
    raw_signature = integers.map { |integer| integer.value.to_s(16).rjust(64, "0") }
                            .join
                            .scan(/../)
                            .map { |hex| hex.to_i(16).chr }
                            .join
    "#{signing_input}.#{base64url(raw_signature)}"
  end

  def request(method, path, body = nil)
    uri = URI("#{API_BASE}#{path}")
    request_class = { get: Net::HTTP::Get, post: Net::HTTP::Post, patch: Net::HTTP::Patch }.fetch(method)
    http_request = request_class.new(uri)
    http_request["Authorization"] = "Bearer #{token}"
    http_request["Content-Type"] = "application/json"
    http_request.body = JSON.generate(body) if body
    response = Net::HTTP.start(
      uri.host,
      uri.port,
      use_ssl: true,
      open_timeout: 15,
      read_timeout: 45
    ) { |http| http.request(http_request) }
    parsed = response.body.to_s.empty? ? {} : JSON.parse(response.body)
    return parsed if response.code.to_i.between?(200, 299)

    raise "#{method.upcase} #{path} failed (#{response.code}): #{response.body.to_s[0, 1500]}"
  end
end

def one!(rows, description)
  raise "Expected exactly one #{description}; found #{rows.length}" unless rows.length == 1
  rows.first
end

def resource(type, id, attributes)
  { data: { type: type, id: id, attributes: attributes } }
end

def changed?(current, desired)
  desired.any? { |key, value| current[key.to_s] != value }
end

required_env = %w[ASC_KEY_ID ASC_ISSUER_ID ASC_KEY_PATH]
missing_env = required_env.reject { |name| ENV[name] && !ENV[name].empty? }
abort "Missing environment variables: #{missing_env.join(', ')}" unless missing_env.empty?

manifest = JSON.parse(File.read(MANIFEST_PATH))
description = File.read(DESCRIPTION_PATH).strip
review_notes = File.read(REVIEW_NOTES_PATH).strip
privacy_url = File.read(PRIVACY_URL_PATH).strip
locale = manifest.fetch("subscriptionGroupLocalization").fetch("locale")
client = AppStoreConnectClient.new(
  key_id: ENV.fetch("ASC_KEY_ID"),
  issuer_id: ENV.fetch("ASC_ISSUER_ID"),
  key_path: ENV.fetch("ASC_KEY_PATH")
)

bundle_id = manifest.fetch("bundleId")
app = one!(client.get("/v1/apps?filter%5BbundleId%5D=#{URI.encode_www_form_component(bundle_id)}&limit=10").fetch("data"), "app for #{bundle_id}")
raise "App ID mismatch: #{app['id']}" unless app["id"] == manifest.fetch("appStoreConnectAppId")

versions = client.get("/v1/apps/#{app['id']}/appStoreVersions?filter%5Bplatform%5D=IOS&limit=50").fetch("data")
version = one!(versions.select { |item| item.dig("attributes", "versionString") == options[:version] }, "iOS version #{options[:version]}")
version_id = version.fetch("id")

version_localizations = client.get("/v1/appStoreVersions/#{version_id}/appStoreVersionLocalizations?limit=50").fetch("data")
version_localization = one!(version_localizations.select { |item| item.dig("attributes", "locale") == locale }, "#{locale} version localization")
review_detail = client.get("/v1/appStoreVersions/#{version_id}/appStoreReviewDetail").fetch("data")

app_infos = client.get("/v1/apps/#{app['id']}/appInfos?limit=20").fetch("data")
app_info = one!(app_infos, "app info")
app_info_localizations = client.get("/v1/appInfos/#{app_info['id']}/appInfoLocalizations?limit=50").fetch("data")
app_info_localization = one!(app_info_localizations.select { |item| item.dig("attributes", "locale") == locale }, "#{locale} app info localization")

group_id = manifest.fetch("subscriptionGroupId")
group_localizations = client.get("/v1/subscriptionGroups/#{group_id}/subscriptionGroupLocalizations?limit=50").fetch("data")
group_localization = group_localizations.find { |item| item.dig("attributes", "locale") == locale }

subscriptions = client.get("/v1/subscriptionGroups/#{group_id}/subscriptions?limit=50").fetch("data")
subscriptions_by_product_id = subscriptions.to_h { |item| [item.dig("attributes", "productId"), item] }

operations = []
operations << ["App Description", version_localization.dig("attributes", "description"), description]
operations << ["App Review notes", review_detail.dig("attributes", "notes"), review_notes]
operations << ["Privacy Policy URL", app_info_localization.dig("attributes", "privacyPolicyUrl"), privacy_url]
operations << ["Subscription group localization", group_localization&.dig("attributes", "name"), manifest.dig("subscriptionGroupLocalization", "name")]

manifest.fetch("products").each do |product|
  subscription = subscriptions_by_product_id.fetch(product.fetch("productId"))
  raise "Subscription ID mismatch for #{product['productId']}" unless subscription["id"] == product.fetch("id")
  localizations = client.get("/v1/subscriptions/#{subscription['id']}/subscriptionLocalizations?limit=50").fetch("data")
  localization = one!(localizations.select { |item| item.dig("attributes", "locale") == product.fetch("locale") }, "#{product['productId']} localization")
  screenshot = client.get("/v1/subscriptions/#{subscription['id']}/appStoreReviewScreenshot").fetch("data")
  delivery_state = screenshot.dig("attributes", "assetDeliveryState", "state")
  raise "Review screenshot is not complete for #{product['productId']}: #{delivery_state}" unless delivery_state == "COMPLETE"

  operations << ["#{product['productId']} display name", localization.dig("attributes", "name"), product.fetch("displayName")]
  operations << ["#{product['productId']} description", localization.dig("attributes", "description"), product.fetch("description")]
  operations << ["#{product['productId']} review note", subscription.dig("attributes", "reviewNote"), product.fetch("reviewNote")]
end

puts(options[:apply] ? "Applying App Store Connect metadata:" : "Dry run — planned App Store Connect metadata changes:")
operations.each do |label, current, desired|
  puts "- #{label}: #{current == desired ? 'already correct' : 'update required'}"
end

unless options[:apply]
  puts "No writes performed. Re-run with --apply after reviewing the plan."
  exit 0
end

if changed?(version_localization.fetch("attributes"), description: description)
  client.patch("/v1/appStoreVersionLocalizations/#{version_localization['id']}", resource("appStoreVersionLocalizations", version_localization["id"], description: description))
end
if changed?(review_detail.fetch("attributes"), notes: review_notes)
  client.patch("/v1/appStoreReviewDetails/#{review_detail['id']}", resource("appStoreReviewDetails", review_detail["id"], notes: review_notes))
end
if changed?(app_info_localization.fetch("attributes"), privacyPolicyUrl: privacy_url)
  client.patch("/v1/appInfoLocalizations/#{app_info_localization['id']}", resource("appInfoLocalizations", app_info_localization["id"], privacyPolicyUrl: privacy_url))
end

if group_localization
  desired_group = manifest.dig("subscriptionGroupLocalization", "name")
  if group_localization.dig("attributes", "name") != desired_group
    client.patch(
      "/v1/subscriptionGroupLocalizations/#{group_localization['id']}",
      resource("subscriptionGroupLocalizations", group_localization["id"], name: desired_group)
    )
  end
else
  client.post("/v1/subscriptionGroupLocalizations", {
    data: {
      type: "subscriptionGroupLocalizations",
      attributes: {
        locale: locale,
        name: manifest.dig("subscriptionGroupLocalization", "name")
      },
      relationships: {
        subscriptionGroup: { data: { type: "subscriptionGroups", id: group_id } }
      }
    }
  })
end

manifest.fetch("products").each do |product|
  subscription = subscriptions_by_product_id.fetch(product.fetch("productId"))
  localizations = client.get("/v1/subscriptions/#{subscription['id']}/subscriptionLocalizations?limit=50").fetch("data")
  localization = one!(localizations.select { |item| item.dig("attributes", "locale") == product.fetch("locale") }, "#{product['productId']} localization")
  desired_localization = { name: product.fetch("displayName"), description: product.fetch("description") }
  if changed?(localization.fetch("attributes"), desired_localization)
    client.patch(
      "/v1/subscriptionLocalizations/#{localization['id']}",
      resource("subscriptionLocalizations", localization["id"], desired_localization)
    )
  end
  if subscription.dig("attributes", "reviewNote") != product.fetch("reviewNote")
    client.patch(
      "/v1/subscriptions/#{subscription['id']}",
      resource("subscriptions", subscription["id"], reviewNote: product.fetch("reviewNote"))
    )
  end
end

states = manifest.fetch("products").to_h do |product|
  subscription = client.get("/v1/subscriptions/#{product['id']}").fetch("data")
  [product.fetch("productId"), subscription.dig("attributes", "state")]
end

final_version_localization = client.get("/v1/appStoreVersionLocalizations/#{version_localization['id']}").fetch("data")
final_review_detail = client.get("/v1/appStoreReviewDetails/#{review_detail['id']}").fetch("data")
raise "Description read-back is missing EULA" unless final_version_localization.dig("attributes", "description") == description
raise "Review notes read-back mismatch" unless final_review_detail.dig("attributes", "notes") == review_notes

puts JSON.pretty_generate(
  appId: app["id"],
  versionId: version_id,
  versionState: version.dig("attributes", "appStoreState"),
  descriptionHasEula: description.include?("stdeula"),
  privacyPolicyUrl: privacy_url,
  subscriptionStates: states
)

if states.value?("MISSING_METADATA")
  abort "App Store Connect still reports MISSING_METADATA for at least one subscription. Do not submit until the remaining field is identified."
end

puts "PASS: App Store Connect metadata synchronized and verified."
