output "record_ids" {
  description = "レコードの ID（キーは `key`、なければ型・名前・内容のハッシュ）"
  value       = { for k, r in cloudflare_dns_record.this : k => r.id }
}
