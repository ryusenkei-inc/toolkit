output "record_ids" {
  description = "TXT のレコードの ID（キーは確認の値）"
  value       = { for k, r in cloudflare_dns_record.verification : k => r.id }
}
