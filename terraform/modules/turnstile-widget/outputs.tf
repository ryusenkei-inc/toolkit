output "sitekey" {
  description = "ページに置く sitekey（公開の値）"
  value       = cloudflare_turnstile_widget.this.sitekey
}

output "secret" {
  description = "サーバー側の検証の秘密鍵。.env に手で写さず、デプロイの処理が Worker の秘密値へ渡す"
  value       = cloudflare_turnstile_widget.this.secret
  sensitive   = true
}
