resource "cloudflare_turnstile_widget" "this" {
  account_id = var.account_id
  name       = var.name
  domains    = var.domains
  mode       = var.mode
}
