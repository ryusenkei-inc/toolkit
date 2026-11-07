output "aud" {
  description = "Application Audience（AUD）タグ。`@ryusenkei/adapter-access` の `aud` に渡す"
  value       = cloudflare_zero_trust_access_application.this.aud
}

output "application_id" {
  description = "アプリの ID"
  value       = cloudflare_zero_trust_access_application.this.id
}
