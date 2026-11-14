output "ruleset_id" {
  description = "転送の ruleset の ID（ほかのスタックから参照する、取り込みを確かめるときなど）"
  value       = cloudflare_ruleset.redirect.id
}
